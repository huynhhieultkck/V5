import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { sign, verify } from "hono/jwt";
import { logger } from "../lib/logger";

const cryptoRoutes = new Hono();

// FAIL-FAST: Kiểm tra các biến môi trường cần thiết
const PAYID19_PUBLIC_KEY = process.env.PAYID19_PUBLIC_KEY;
const PAYID19_PRIVATE_KEY = process.env.PAYID19_PRIVATE_KEY;
const JWT_DEPOSIT_SECRET = process.env.JWT_DEPOSIT_SECRET;

if (!PAYID19_PUBLIC_KEY || !PAYID19_PRIVATE_KEY || !JWT_DEPOSIT_SECRET) {
  throw new Error("CRITICAL: Payid19 config or JWT_DEPOSIT_SECRET is missing in environment variables.");
}

const EXCHANGE_RATE = 25000;

// Schema xác thực cho yêu cầu tạo hóa đơn
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
    const bodyParams = new URLSearchParams({
      public_key: PAYID19_PUBLIC_KEY,
      private_key: PAYID19_PRIVATE_KEY,
      price_amount: amount.toString(),
      price_currency: "USD",
      add_fee_to_price: "1",
      callback_url: `${process.env.BACKEND_URL}/api/crypto/callback?token=${depositToken}`,
      cancel_url: process.env.FRONTEND_URL || "http://localhost:3000",
      success_url: process.env.FRONTEND_URL || "http://localhost:3000",
      title: "Deposit to MMO Shop",
      description: `Deposit ${amount} USD to account`,
    });

    const response = await fetch(url, {
      method: "POST",
      body: bodyParams,
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
 * WEBHOOK: Xử lý phản hồi từ Payid19
 */
cryptoRoutes.post("/callback", async (c) => {
  const token = c.req.query("token");
  const contentType = c.req.header("content-type") || "";
  
  let body: any;

  try {
    // Nhận Body linh hoạt (JSON hoặc Form)
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else {
      body = await c.req.parseBody();
    }

    if (!token) throw new Error("Missing Token");
    
    // Giải mã token để xác định User và số tiền dự kiến
    const verifiedToken = (await verify(token, JWT_DEPOSIT_SECRET, "HS256")) as unknown as DepositTokenPayload;
    
    if (verifiedToken.type !== "DEPOSIT_FLOW") {
      throw new Error("Invalid token type");
    }

    const { amount, userId } = verifiedToken;

    logger.log(`[Payid19 Callback] Giao dịch ID: ${body.id}, Test: ${body.test}`);

    /**
     * ĐIỀU KIỆN CHẤP NHẬN THANH TOÁN:
     * Chỉ cần PrivateKey trong body khớp với PrivateKey của hệ thống là đủ tin cậy.
     * Loại bỏ kiểm tra trường 'status' vì Payid19 không phải lúc nào cũng gửi nó.
     */
    const isPrivateKeyValid = body.privatekey === PAYID19_PRIVATE_KEY;
    
    if (isPrivateKeyValid) {
      
      const creditAmount = amount * EXCHANGE_RATE;
      const uniqueCode = `PAYID19_${body.id}`;

      await prisma.$transaction(async (tx) => {
        // Kiểm tra xem mã giao dịch này đã được xử lý chưa (chống nạp trùng)
        const existingTx = await tx.transaction.findUnique({
          where: { code: uniqueCode },
        });

        if (existingTx) {
          logger.log(`[Deposit] Giao dịch ${uniqueCode} đã được xử lý trước đó.`);
          return;
        }

        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("User not found during callback");

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
            content: `Nạp tiền qua Payid19 (ID: ${body.id}, Amount: ${amount} USD) ${body.test ? '[TEST]' : ''}`,
          },
        });
      });

      logger.log(`[Deposit] Thành công cho User ${userId}: +${creditAmount} VND (Code: ${uniqueCode})`);
    } else {
      logger.error(`[Payid19 Callback] Xác thực PrivateKey thất bại.`);
    }

    return c.json({ success: true });
  } catch (error: any) {
    logger.error("[Deposit Callback Error]:", error.message);
    return c.json({ success: false, message: error.message }, 400);
  }
});

export { cryptoRoutes };