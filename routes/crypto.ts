import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { sign, verify } from "hono/jwt";
import { logger } from "../lib/logger";

const cryptoRoutes = new Hono();

// FAIL-FAST: Bỏ toàn bộ fallback secret cho cổng thanh toán
const PAYID19_PUBLIC_KEY = process.env.PAYID19_PUBLIC_KEY;
const PAYID19_PRIVATE_KEY = process.env.PAYID19_PRIVATE_KEY;
const JWT_DEPOSIT_SECRET = process.env.JWT_DEPOSIT_SECRET;

if (!PAYID19_PUBLIC_KEY || !PAYID19_PRIVATE_KEY || !JWT_DEPOSIT_SECRET) {
  throw new Error("CRITICAL: Payid19 config or JWT_DEPOSIT_SECRET is missing in environment variables.");
}

const EXCHANGE_RATE = 25000;

// Schema cho tạo Invoice
const createInvoiceSchema = z.object({
  amount: z.number().int().min(1), 
});

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

interface DepositTokenPayload {
  amount: number;
  userId: string;
  type: "DEPOSIT_FLOW";
  exp: number;
  [key: string]: unknown;
}

/**
 * CLIENT: Tạo hóa đơn nạp tiền (Invoice)
 */
cryptoRoutes.post("/create", authMiddleware, zValidator("json", createInvoiceSchema), async (c) => {
  const { amount } = c.req.valid("json");
  const userPayload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = userPayload.id;

  try {
    const depositToken = await sign(
      {
        amount,
        userId,
        type: "DEPOSIT_FLOW",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      JWT_DEPOSIT_SECRET,
      "HS256"
    );

    const url = "https://payid19.com/api/v1/create_invoice";
    const body = new URLSearchParams({
      public_key: PAYID19_PUBLIC_KEY,
      private_key: PAYID19_PRIVATE_KEY,
      customer_id: userId,
      price_amount: amount.toString(),
      price_currency: "USD",
      add_fee_to_price: "1",
      callback_url: `${process.env.BACKEND_URL}/api/crypto/callback?token=${depositToken}`,
      cancel_url: process.env.FRONTEND_URL || "http://localhost:3000",
      success_url: process.env.FRONTEND_URL || "http://localhost:3000",
      title: "Deposit to MMO Shop",
      description: `Deposit ${amount} USD to user ${userPayload.username}`,
    });

    const response = await fetch(url, {
      method: "POST",
      body: body,
    });

    const result = await response.json();

    if (result.status === "error" || !result.message) {
      logger.error("[Payid19] Create Fail:", result);
      return c.json({ message: t(c, "deposit_create_fail") }, 500);
    }

    return c.json({
      status: "success",
      invoice_url: result.message,
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * WEBHOOK: Xử lý callback từ Payid19
 */
cryptoRoutes.post("/callback", async (c) => {
  const token = c.req.query("token");
  const body = await c.req.parseBody();

  try {
    if (!token) throw new Error("Missing Token");
    
    const verifiedToken = (await verify(token, JWT_DEPOSIT_SECRET, "HS256")) as unknown as DepositTokenPayload;
    
    if (verifiedToken.type !== "DEPOSIT_FLOW") {
      throw new Error("Invalid token type");
    }

    const { amount, userId } = verifiedToken;

    if (
      body.customer_id === userId &&
      body.privatekey === PAYID19_PRIVATE_KEY &&
      body.status === "1" && 
      !body.test 
    ) {
      const creditAmount = amount * EXCHANGE_RATE;
      const uniqueCode = `PAYID19_${body.id}`;

      await prisma.$transaction(async (tx) => {
        const existingTx = await tx.transaction.findUnique({
          where: { code: uniqueCode },
        });

        if (existingTx) return;

        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) return;

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: creditAmount } },
        });

        await tx.transaction.create({
          data: {
            userId,
            code: uniqueCode,
            amount: creditAmount,
            balanceBefore: user.balance,
            balanceAfter: updatedUser.balance,
            type: "DEPOSIT",
            content: `Deposit via Payid19 (ID: ${body.id}, Amount: ${amount} USD)`,
          },
        });
      });

      logger.log(`[Deposit] Success for User ${userId}: +${creditAmount} VND (Code: ${uniqueCode})`);
    }

    return c.json({ success: true });
  } catch (error: any) {
    logger.error("[Deposit Callback Error]:", error.message);
    return c.json({ success: false, message: error.message }, 400);
  }
});

export { cryptoRoutes };