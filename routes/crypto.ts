import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { sign, verify } from "hono/jwt";

const cryptoRoutes = new Hono();

const PAYID19_PUBLIC_KEY = process.env.PAYID19_PUBLIC_KEY || "";
const PAYID19_PRIVATE_KEY = process.env.PAYID19_PRIVATE_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-mmo-v5";
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

// Interface cho Token nạp tiền
interface DepositTokenPayload {
  amount: number;
  userId: string;
  exp: number;
  [key: string]: unknown; // Thêm index signature để khớp với JWTPayload
}

/**
 * CLIENT: Tạo hóa đơn nạp tiền (Invoice)
 */
cryptoRoutes.post("/create", authMiddleware, zValidator("json", createInvoiceSchema), async (c) => {
  const { amount } = c.req.valid("json");
  const userPayload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = userPayload.id;

  try {
    // 1. Tạo một token ngắn hạn để bảo mật callback
    // Thêm thuật toán 'HS256' để fix lỗi TypeScript
    const depositToken = await sign(
      {
        amount,
        userId,
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 giờ
      },
      JWT_SECRET,
      "HS256"
    );

    // 2. Gọi API Payid19 để lấy Invoice URL
    const url = "https://payid19.com/api/v1/create_invoice";
    const body = new URLSearchParams({
      public_key: PAYID19_PUBLIC_KEY,
      private_key: PAYID19_PRIVATE_KEY,
      customer_id: userId,
      price_amount: amount.toString(),
      price_currency: "USD",
      add_fee_to_price: "1",
      callback_url: `${process.env.BACKEND_URL || "http://localhost:3000"}/api/crypto/callback?token=${depositToken}`,
      cancel_url: process.env.FRONTEND_URL || "http://localhost:5173",
      success_url: process.env.FRONTEND_URL || "http://localhost:5173",
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
    // 1. Xác thực Token từ query
    if (!token) throw new Error("Missing Token");
    
    // Thêm thuật toán 'HS256' và ép kiểu đúng để fix lỗi
    const verifiedToken = (await verify(token, JWT_SECRET, "HS256")) as unknown as DepositTokenPayload;

    const { amount, userId } = verifiedToken;

    // 2. Kiểm tra tính hợp lệ của dữ liệu gửi từ Payid19
    if (
      body.customer_id === userId &&
      body.privatekey === PAYID19_PRIVATE_KEY &&
      body.status === "1" && 
      !body.test 
    ) {
      const creditAmount = amount * EXCHANGE_RATE;

      // 3. Thực hiện cộng tiền vào Database (Atomic Transaction)
      await prisma.$transaction(async (tx) => {
        // Kiểm tra xem giao dịch này đã được xử lý chưa (Tránh replay attack)
        const existingTx = await tx.transaction.findUnique({
          where: { code: body.id as string },
        });

        if (existingTx) return;

        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) return;

        // Cập nhật số dư
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: creditAmount } },
        });

        // Tạo log giao dịch nạp tiền
        await tx.transaction.create({
          data: {
            userId,
            code: body.id as string,
            amount: creditAmount,
            balanceBefore: user.balance,
            balanceAfter: updatedUser.balance,
            type: "DEPOSIT",
            content: `Deposit via Payid19 (ID: ${body.id}, Amount: ${amount} USD)`,
          },
        });
      });

      console.log(`[Deposit] Success for User ${userId}: +${creditAmount} VND`);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("[Deposit Callback Error]:", error.message);
    return c.json({ success: false, message: error.message }, 400);
  }
});

export { cryptoRoutes };