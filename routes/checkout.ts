import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware } from "../middlewares/auth";
import { mailService } from "../lib/mail";
import { logger } from "../lib/logger";

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
 * API Buy - Đã sửa lỗi Race Condition cho Coupon
 */
checkoutRoutes.post("/buy", authMiddleware, zValidator("json", buySchema), async (c) => {
  const { productId, amount, couponCode } = c.req.valid("json");
  
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  try {
    // Lấy thông tin cơ bản ngoài Transaction để giảm tải cho DB
    const [user, product] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.product.findUnique({ where: { id: productId, status: true } }),
    ]);

    if (!user) return c.json({ message: t(c, "auth_not_found") }, 404);
    if (!product) return c.json({ message: t(c, "product_not_found") }, 404);

    // Kiểm tra kho (bước lọc nhanh ban đầu)
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
      // 1. Kiểm tra lại User và Số dư trong Transaction (Chống race condition tiền tệ)
      const freshUser = await tx.user.findUnique({ where: { id: userId } });
      if (!freshUser) throw new Error("USER_NOT_FOUND");

      let discountAmount = 0;
      const subTotal = product.price * amount;

      // 2. XỬ LÝ MÃ GIẢM GIÁ (CHỐNG RACE CONDITION)
      if (couponCode) {
        /**
         * QUAN TRỌNG: Phải tìm Coupon bên trong Transaction.
         * Trong MariaDB/MySQL, Prisma sẽ tự động xử lý tính nhất quán.
         * Để an toàn tuyệt đối, chúng ta kiểm tra giới hạn ngay tại đây.
         */
        const freshCoupon = await tx.coupon.findUnique({
          where: { code: couponCode, status: true }
        });

        if (!freshCoupon) throw new Error("COUPON_INVALID");
        
        // Kiểm tra hạn dùng
        if (freshCoupon.expiryDate && new Date() > freshCoupon.expiryDate) {
          throw new Error("COUPON_INVALID");
        }

        // KIỂM TRA GIỚI HẠN SỬ DỤNG (RACE CONDITION FIX)
        if (freshCoupon.usedCount >= freshCoupon.usageLimit) {
          throw new Error("COUPON_USAGE_LIMIT");
        }

        // Kiểm tra đơn hàng tối thiểu
        if (subTotal < freshCoupon.minOrder) {
          throw new Error("COUPON_MIN_ORDER");
        }

        // Tính toán giảm giá
        if (freshCoupon.isPercent) {
          discountAmount = (subTotal * freshCoupon.discount) / 100;
          if (freshCoupon.maxDiscount && discountAmount > freshCoupon.maxDiscount) {
            discountAmount = freshCoupon.maxDiscount;
          }
        } else {
          discountAmount = freshCoupon.discount;
        }

        // Cập nhật lượt dùng Coupon ngay trong transaction
        await tx.coupon.update({
          where: { id: freshCoupon.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      const finalPrice = Math.max(0, subTotal - discountAmount);

      // Kiểm tra lại số dư cuối cùng
      if (freshUser.balance < finalPrice) throw new Error("INSUFFICIENT_BALANCE");

      // 3. Thực hiện trừ tiền User
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: finalPrice } }
      });

      // 4. Tạo đơn hàng
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

      // 5. Ghi log giao dịch
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

      // 6. Đẩy vào Job Queue
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
    // Xử lý các lỗi ném ra từ Transaction
    if (error.message === "INSUFFICIENT_BALANCE") return c.json({ message: t(c, "checkout_insufficient_balance") }, 400);
    if (error.message === "COUPON_INVALID") return c.json({ message: t(c, "coupon_invalid") }, 400);
    if (error.message === "COUPON_USAGE_LIMIT") return c.json({ message: t(c, "coupon_usage_limit") }, 400);
    if (error.message === "COUPON_MIN_ORDER") return c.json({ message: t(c, "coupon_min_order") }, 400);
    
    logger.error("[Checkout Error]:", error);
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