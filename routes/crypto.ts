import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { sign, verify } from "hono/jwt";

const cryptoRoutes = new Hono();

const PAYID19_PUBLIC_KEY = process.env.PAYID19_PUBLIC_KEY || "1fcb6b5d-5082-4897-a54c-7bbdfcab2e89";
const PAYID19_PRIVATE_KEY = process.env.PAYID19_PRIVATE_KEY || "1fcb6b5d-5082-4897-a54c-7bbdfcab2e89";

/**
 * QUAN TRỌNG: Sử dụng một Secret riêng biệt cho Deposit Tokens.
 * Không được trùng với JWT_SECRET dùng cho việc đăng nhập (Authentication).
 */
const JWT_DEPOSIT_SECRET = process.env.JWT_DEPOSIT_SECRET || "1fcb6b5d-5082-4897-a54c-7bbdfcab2e89";
const EXCHANGE_RATE = 25000; // 1 USD = 25,000 VND

// Schema cho tạo Invoice
const createInvoiceSchema = z.object({
  amount: z.number().int().min(1), // Số tiền theo USD
});

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

// Interface cho Token nạp tiền (Cấu trúc payload khác biệt hoàn toàn với Auth Token)
interface DepositTokenPayload {
  amount: number;
  userId: string;
  type: "DEPOSIT_FLOW"; // Thêm trường type để định danh mục đích của token
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
    // Ký token nạp tiền bằng Secret riêng biệt
    const depositToken = await sign(
      {
        amount,
        userId,
        type: "DEPOSIT_FLOW",
        exp: Math.floor(Date.now() / 1000) + 3600, // Hiệu lực 1 giờ
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
      callback_url: `${process.env.BACKEND_URL || "http://localhost:3000"}/api/crypto/callback?token=${depositToken}`,
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
      console.error("[Payid19] Create Fail:", result);
      return c.json({ message: t(c, "deposit_create_fail") }, 500);
    }

    return c.json({
      status: "success",
      invoice_url: result.message,
    });
  } catch (error) {
    console.error(error);
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
    
    // Xác thực bằng Secret riêng biệt và thuật toán HS256
    const verifiedToken = (await verify(token, JWT_DEPOSIT_SECRET, "HS256")) as unknown as DepositTokenPayload;
    
    // Kiểm tra định danh mục đích của token (type check)
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

      console.log(`[Deposit] Success for User ${userId}: +${creditAmount} VND (Code: ${uniqueCode})`);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("[Deposit Callback Error]:", error.message);
    return c.json({ success: false, message: error.message }, 400);
  }
});

export { cryptoRoutes };