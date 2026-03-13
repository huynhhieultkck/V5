import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const couponRoutes = new Hono();

// --- Schemas ---

// Cập nhật schema để hỗ trợ productId và categoryId (optional)
const createCouponSchema = z.object({
  code: z.string().min(3).toUpperCase(),
  discount: z.number().min(0),
  isPercent: z.boolean().default(false),
  minOrder: z.number().min(0).default(0),
  maxDiscount: z.number().optional().nullable(),
  usageLimit: z.number().int().min(1).default(1),
  expiryDate: z.string().optional().nullable(),
  status: z.boolean().default(true),
  productId: z.number().optional().nullable(), // Thêm ràng buộc sản phẩm
  categoryId: z.number().optional().nullable(), // Thêm ràng buộc danh mục
});

const updateCouponSchema = createCouponSchema.partial();

/**
 * Public: Kiểm tra mã giảm giá
 * Query Params: code, amount, productId
 */
couponRoutes.get("/check/:code", authMiddleware, async (c) => {
  const code = c.req.param("code").toUpperCase();
  const subTotal = Number(c.req.query("amount") || 0);
  const productId = c.req.query("productId") ? Number(c.req.query("productId")) : undefined;

  try {
    const coupon = await prisma.coupon.findUnique({
      where: { code, status: true }
    });

    if (!coupon) return c.json({ message: t(c, "coupon_invalid") }, 400);

    // 1. Kiểm tra ngày hết hạn
    if (coupon.expiryDate && new Date() > coupon.expiryDate) {
      return c.json({ message: t(c, "coupon_invalid") }, 400);
    }

    // 2. Kiểm tra giới hạn lượt dùng
    if (coupon.usedCount >= coupon.usageLimit) {
      return c.json({ message: t(c, "coupon_usage_limit") }, 400);
    }

    // 3. Kiểm tra giá trị đơn hàng tối thiểu
    if (subTotal < coupon.minOrder) {
      return c.json({ message: t(c, "coupon_min_order") }, 400);
    }

    // 4. KIỂM TRA RÀNG BUỘC SẢN PHẨM / DANH MỤC (NẾU CÓ TRUYỀN PRODUCTID)
    if (productId) {
      // Nếu coupon chỉ cho 1 SP mà ID truyền lên không khớp
      if (coupon.productId && coupon.productId !== productId) {
        return c.json({ message: t(c, "coupon_not_applicable") }, 400);
      }

      // Nếu coupon chỉ cho 1 danh mục, ta phải check danh mục của SP đó
      if (coupon.categoryId) {
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { categoryId: true }
        });
        if (!product || product.categoryId !== coupon.categoryId) {
          return c.json({ message: t(c, "coupon_not_applicable") }, 400);
        }
      }
    }

    let discountAmount = 0;
    if (coupon.isPercent) {
      discountAmount = (subTotal * coupon.discount) / 100;
      if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
        discountAmount = coupon.maxDiscount;
      }
    } else {
      discountAmount = coupon.discount;
    }

    return c.json({
      status: "success",
      data: {
        code: coupon.code,
        discount: coupon.discount,
        isPercent: coupon.isPercent,
        discountAmount,
        finalPrice: Math.max(0, subTotal - discountAmount)
      }
    });

  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Lấy danh sách mã giảm giá
 */
couponRoutes.get("/admin/list", authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 10), 1), 100);
  const search = c.req.query("search");
  const statusStr = c.req.query("status");
  const sort = c.req.query("sort") || "newest";

  try {
    const where: any = {};
    if (search) {
      where.code = { contains: search.toUpperCase() };
    }
    if (statusStr === "true") where.status = true;
    if (statusStr === "false") where.status = false;

    let orderBy: any = { createdAt: "desc" };
    switch (sort) {
      case "usage_asc": orderBy = { usageLimit: "asc" }; break;
      case "usage_desc": orderBy = { usageLimit: "desc" }; break;
      case "used_asc": orderBy = { usedCount: "asc" }; break;
      case "used_desc": orderBy = { usedCount: "desc" }; break;
      case "expiry_asc": orderBy = { expiryDate: "asc" }; break;
      case "expiry_desc": orderBy = { expiryDate: "desc" }; break;
      case "oldest": orderBy = { createdAt: "asc" }; break;
      case "newest": default: orderBy = { createdAt: "desc" }; break;
    }

    const [total, coupons] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy,
        include: {
          product: { select: { translations: { take: 1, select: { name: true } } } },
          category: { select: { translations: { take: 1, select: { name: true } } } }
        }
      })
    ]);

    return c.json({
      status: "success",
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: coupons
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Tạo mã giảm giá
 */
couponRoutes.post("/", authMiddleware, adminMiddleware, zValidator("json", createCouponSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    const coupon = await prisma.coupon.create({
      data: {
        code: data.code,
        discount: data.discount,
        isPercent: data.isPercent,
        minOrder: data.minOrder,
        maxDiscount: data.maxDiscount ?? null,
        usageLimit: data.usageLimit,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        status: data.status,
        productId: data.productId ?? null,
        categoryId: data.categoryId ?? null,
      }
    });
    return c.json({ status: "success", data: coupon }, 201);
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Cập nhật mã giảm giá
 */
couponRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateCouponSchema), async (c) => {
  const id = parseInt(c.req.param("id"));
  const data = c.req.valid("json");

  try {
    const updateData: any = { ...data };
    if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
    if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount ?? null;
    if (data.productId !== undefined) updateData.productId = data.productId ?? null;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId ?? null;

    const coupon = await prisma.coupon.update({
      where: { id },
      data: updateData
    });
    return c.json({ status: "success", data: coupon });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Xóa mã giảm giá
 */
couponRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    await prisma.coupon.delete({ where: { id } });
    return c.json({ status: "success", message: "Coupon deleted" });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { couponRoutes };