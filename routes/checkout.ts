import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { mailService } from "../lib/mail";
import { logger } from "../lib/logger";

const checkoutRoutes = new Hono();

// Interface Payload để xác định thông tin người dùng từ JWT
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
 * API Buy - Thực hiện mua hàng với cơ chế chống Race Condition & Kiểm tra Coupon mục tiêu
 */
checkoutRoutes.post("/buy", authMiddleware, zValidator("json", buySchema), async (c) => {
  const { productId, amount, couponCode } = c.req.valid("json");
  
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  try {
    const [user, product] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.product.findUnique({ 
        where: { id: productId, status: true },
        include: { category: true } // Lấy category để kiểm tra coupon theo danh mục
      }),
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

    const orderId = await prisma.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({ where: { id: userId } });
      if (!freshUser) throw new Error("USER_NOT_FOUND");

      let discountAmount = 0;
      const subTotal = product.price * amount;

      if (couponCode) {
        const freshCoupon = await tx.coupon.findUnique({
          where: { code: couponCode, status: true }
        });

        if (!freshCoupon) throw new Error("COUPON_INVALID");
        
        // --- BẮT ĐẦU KIỂM TRA RÀNG BUỘC COUPON MỚI ---

        // 1. Kiểm tra theo Sản phẩm cụ thể
        if (freshCoupon.productId && freshCoupon.productId !== product.id) {
          throw new Error("COUPON_NOT_APPLICABLE");
        }

        // 2. Kiểm tra theo Danh mục cụ thể
        if (freshCoupon.categoryId && freshCoupon.categoryId !== product.categoryId) {
          throw new Error("COUPON_NOT_APPLICABLE");
        }

        // --- KẾT THÚC KIỂM TRA RÀNG BUỘC COUPON MỚI ---

        if (freshCoupon.expiryDate && new Date() > freshCoupon.expiryDate) {
          throw new Error("COUPON_INVALID");
        }

        if (freshCoupon.usedCount >= freshCoupon.usageLimit) {
          throw new Error("COUPON_USAGE_LIMIT");
        }

        if (subTotal < freshCoupon.minOrder) {
          throw new Error("COUPON_MIN_ORDER");
        }

        if (freshCoupon.isPercent) {
          discountAmount = (subTotal * freshCoupon.discount) / 100;
          if (freshCoupon.maxDiscount && discountAmount > freshCoupon.maxDiscount) {
            discountAmount = freshCoupon.maxDiscount;
          }
        } else {
          discountAmount = freshCoupon.discount;
        }

        await tx.coupon.update({
          where: { id: freshCoupon.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      const finalPrice = Math.max(0, subTotal - discountAmount);

      if (freshUser.balance < finalPrice) throw new Error("INSUFFICIENT_BALANCE");

      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: finalPrice } }
      });

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
    if (error.message === "COUPON_INVALID") return c.json({ message: t(c, "coupon_invalid") }, 400);
    if (error.message === "COUPON_USAGE_LIMIT") return c.json({ message: t(c, "coupon_usage_limit") }, 400);
    if (error.message === "COUPON_MIN_ORDER") return c.json({ message: t(c, "coupon_min_order") }, 400);
    if (error.message === "COUPON_NOT_APPLICABLE") return c.json({ message: t(c, "coupon_not_applicable") }, 400);
    
    logger.error("[Checkout Error]:", error);
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * API Lấy nội dung tài khoản
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

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) return c.json({ message: t(c, "order_not_found") }, 404);

    if (order.userId !== payload.id && payload.role !== "ADMIN") {
      return c.json({ message: t(c, "order_forbidden") }, 403);
    }

    return c.json({ 
      status: "success",
      orderId: order.id,
      orderStatus: order.status,
      ...(payload.role === "ADMIN" && {
        userId: order.userId,
        totalPrice: order.totalPrice,
        createdAt: order.createdAt
      })
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { checkoutRoutes };