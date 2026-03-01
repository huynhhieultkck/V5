import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { mailService } from "../lib/mail";

const checkoutRoutes = new Hono();

// Interface Payload để fix lỗi 'unknown'
interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

const buySchema = z.object({
  productId: z.number(),
  amount: z.number().int().min(1),
  couponCode: z.string().optional().nullable(),
});

/**
 * API Buy - Đẩy vào Job Queue với kiểm tra đa ngôn ngữ
 */
checkoutRoutes.post("/buy", authMiddleware, zValidator("json", buySchema), async (c) => {
  const { productId, amount, couponCode } = c.req.valid("json");
  
  // Ép kiểu để truy cập payload.id
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  try {
    const [user, product, coupon] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.product.findUnique({ where: { id: productId, status: true } }),
      couponCode ? prisma.coupon.findUnique({ where: { code: couponCode, status: true } }) : Promise.resolve(null)
    ]);

    if (!user) return c.json({ message: t(c, "auth_not_found") }, 404);
    if (!product) return c.json({ message: t(c, "product_not_found") }, 404);

    if (product.resellStock < amount) {
      return c.json({ message: t(c, "checkout_out_of_stock") }, 400);
    }

    if (amount < product.minPurchase) {
      return c.json({ message: t(c, "checkout_min_purchase") + product.minPurchase }, 400);
    }
    if (product.maxPurchase && amount > product.maxPurchase) {
      return c.json({ message: t(c, "checkout_max_purchase") + product.maxPurchase }, 400);
    }

    const subTotal = product.price * amount;
    let discountAmount = 0;

    if (couponCode) {
      if (!coupon) return c.json({ message: t(c, "coupon_invalid") }, 400);
      if (coupon.expiryDate && new Date() > coupon.expiryDate) return c.json({ message: t(c, "coupon_invalid") }, 400);
      if (coupon.usedCount >= coupon.usageLimit) return c.json({ message: t(c, "coupon_usage_limit") }, 400);
      if (subTotal < coupon.minOrder) return c.json({ message: t(c, "coupon_min_order") }, 400);

      if (coupon.isPercent) {
        discountAmount = (subTotal * coupon.discount) / 100;
        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) discountAmount = coupon.maxDiscount;
      } else {
        discountAmount = coupon.discount;
      }
    }

    const finalPrice = Math.max(0, subTotal - discountAmount);

    if (user.balance < finalPrice) {
      return c.json({ message: t(c, "checkout_insufficient_balance") }, 400);
    }

    const orderId = await prisma.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({ where: { id: userId } });
      if (!freshUser || freshUser.balance < finalPrice) throw new Error("INSUFFICIENT_BALANCE");

      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: finalPrice } }
      });

      if (coupon) {
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      const order = await tx.order.create({
        data: {
          userId,
          productId,
          amount,
          totalPrice: finalPrice,
          discountAmount,
          couponCode: couponCode ?? null,
          status: "PROCESSING",
          ip: c.req.header("x-forwarded-for") || "unknown"
        }
      });

      await tx.transaction.create({
        data: {
          userId,
          amount: -finalPrice,
          balanceBefore: freshUser.balance,
          balanceAfter: freshUser.balance - finalPrice,
          type: "PURCHASE",
          content: `Thanh toán đơn hàng #${order.id}`
        }
      });

      await tx.job.create({
        data: {
          type: "ORDER_FULFILLMENT",
          payload: JSON.stringify({ orderId: order.id, userId, productId, amount, finalPrice }),
          status: "PENDING",
          maxAttempts: 5
        }
      });

      return order.id;
    });

    return c.json({ status: "success", message: t(c, "checkout_success"), orderId });

  } catch (error: any) {
    if (error.message === "INSUFFICIENT_BALANCE") return c.json({ message: t(c, "checkout_insufficient_balance") }, 400);
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * API Lấy nội dung tài khoản (đọc từ OneDrive)
 */
checkoutRoutes.get("/content/:orderId", authMiddleware, async (c) => {
  const orderId = c.req.param("orderId");
  const payload = c.get("jwtPayload") as CustomJWTPayload;

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) return c.json({ message: t(c, "order_not_found") }, 404);
    if (order.userId !== payload.id && payload.role !== "ADMIN") {
      return c.json({ message: t(c, "order_forbidden") }, 403);
    }
    if (order.status !== "SUCCESS") {
      return c.json({ message: t(c, "order_not_ready"), status: order.status }, 400);
    }

    try {
      const content = await mailService.readText({
        filePath: `${order.id}.txt`,
        folder: "/Orders"
      });
      return c.json({ status: "success", orderId: order.id, content });
    } catch (e) {
      return c.json({ message: t(c, "storage_error") }, 500);
    }
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * API Polling Trạng thái
 */
checkoutRoutes.get("/status/:orderId", authMiddleware, async (c) => {
  const orderId = c.req.param("orderId");
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const order = await prisma.order.findUnique({ where: { id: orderId, userId: payload.id } });
  if (!order) return c.json({ message: t(c, "order_not_found") }, 404);
  return c.json({ status: order.status });
});

export { checkoutRoutes };