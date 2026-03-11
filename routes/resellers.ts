import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const resellerRoutes = new Hono();

// Thêm SHOPGMAIL9999 vào danh sách các loại nguồn hàng hỗ trợ
const SUPPORTED_RESELL_TYPES = ["CMSNT", "SHOPGMAIL9999"];

const resellerSchema = z.object({
  name: z.string().min(1),
  type: z.string().default("CMSNT"),
  domain: z.string().url(),
  apiKey: z.string().min(1),
  status: z.boolean().default(true),
});

/**
 * Admin: Lấy danh sách các loại nguồn hàng được hỗ trợ
 */
resellerRoutes.get("/types", authMiddleware, adminMiddleware, async (c) => {
  return c.json({
    status: "success",
    data: SUPPORTED_RESELL_TYPES
  });
});

/**
 * Admin: Lấy danh sách nhà cung cấp
 */
resellerRoutes.get("/", authMiddleware, adminMiddleware, async (c) => {
  try {
    const resellers = await prisma.resellProvider.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { products: true } }
      }
    });
    return c.json({ status: "success", data: resellers });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Xem chi tiết nhà cung cấp
 */
resellerRoutes.get("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    const reseller = await prisma.resellProvider.findUnique({ where: { id } });
    if (!reseller) return c.json({ message: t(c, "reseller_not_found") }, 404);
    return c.json({ status: "success", data: reseller });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Tạo mới nhà cung cấp
 */
resellerRoutes.post("/", authMiddleware, adminMiddleware, zValidator("json", resellerSchema), async (c) => {
  const data = c.req.valid("json");
  try {
    const reseller = await prisma.resellProvider.create({ data });
    return c.json({ status: "success", data: reseller }, 201);
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Cập nhật nhà cung cấp
 */
resellerRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", resellerSchema.partial()), async (c) => {
  const id = parseInt(c.req.param("id"));
  const validatedData = c.req.valid("json");

  try {
    const exists = await prisma.resellProvider.findUnique({ where: { id } });
    if (!exists) return c.json({ message: t(c, "reseller_not_found") }, 404);

    const updateData: any = {};
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.type !== undefined) updateData.type = validatedData.type;
    if (validatedData.domain !== undefined) updateData.domain = validatedData.domain;
    if (validatedData.apiKey !== undefined) updateData.apiKey = validatedData.apiKey;
    if (validatedData.status !== undefined) updateData.status = validatedData.status;

    const reseller = await prisma.resellProvider.update({
      where: { id },
      data: updateData
    });

    return c.json({ 
      status: "success", 
      message: t(c, "reseller_update_success"),
      data: reseller 
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Xóa nhà cung cấp
 */
resellerRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    const productCount = await prisma.product.count({ where: { resellProviderId: id } });
    if (productCount > 0) {
      return c.json({ 
        message: "Không thể xóa nhà cung cấp đang có sản phẩm liên kết. Vui lòng chuyển sản phẩm sang nguồn khác trước." 
      }, 400);
    }

    await prisma.resellProvider.delete({ where: { id } });
    return c.json({ status: "success", message: t(c, "reseller_deleted") });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { resellerRoutes };