import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const stockRoutes = new Hono();

const importStockSchema = z.object({
  productId: z.number(),
  content: z.string().min(1),
});

/**
 * Admin: Danh sách tài khoản trong kho (Có lọc & Phân trang)
 */
stockRoutes.get("/", authMiddleware, adminMiddleware, async (c) => {
  const page = Number(c.req.query("page") || 1);
  const limit = Number(c.req.query("limit") || 50);
  const productId = c.req.query("productId") ? Number(c.req.query("productId")) : undefined;
  const isSoldStr = c.req.query("isSold");
  const search = c.req.query("search");

  try {
    // Xây dựng whereClause động để tránh lỗi exactOptionalPropertyTypes
    const where: any = {};
    if (productId) where.productId = productId;
    if (isSoldStr === "true") where.isSold = true;
    if (isSoldStr === "false") where.isSold = false;
    if (search) where.content = { contains: search };

    const [total, items] = await Promise.all([
      prisma.stock.count({ where }),
      prisma.stock.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" },
        include: {
          product: {
            select: { id: true, translations: { take: 1 } }
          }
        }
      })
    ]);

    return c.json({
      status: "success",
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      data: items
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Thêm hàng vào kho
 */
stockRoutes.post("/import", authMiddleware, adminMiddleware, zValidator("json", importStockSchema), async (c) => {
  const { productId, content } = c.req.valid("json");

  try {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return c.json({ message: t(c, "product_not_found") }, 404);
    if (product.type !== "LOCAL") return c.json({ message: t(c, "stock_invalid_type") }, 400);

    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return c.json({ message: t(c, "stock_empty") }, 400);

    await prisma.$transaction(async (tx) => {
      await tx.stock.createMany({
        data: lines.map(line => ({ productId, content: line, isSold: false }))
      });
      const unsold = await tx.stock.count({ where: { productId, isSold: false } });
      await tx.product.update({ where: { id: productId }, data: { resellStock: unsold } });
    });

    return c.json({ status: "success", message: t(c, "stock_import_success"), count: lines.length });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Xóa 1 tài khoản theo ID
 */
stockRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));

  try {
    const item = await prisma.stock.findUnique({ where: { id } });
    if (!item) return c.json({ message: "Item not found" }, 404);

    await prisma.$transaction(async (tx) => {
      await tx.stock.delete({ where: { id } });
      if (!item.isSold) {
        const unsold = await tx.stock.count({ where: { productId: item.productId, isSold: false } });
        await tx.product.update({ where: { id: item.productId }, data: { resellStock: unsold } });
      }
    });

    return c.json({ status: "success", message: t(c, "stock_deleted") });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Xóa tất cả tài khoản theo productId
 */
stockRoutes.delete("/product/:productId", authMiddleware, adminMiddleware, async (c) => {
  const productId = parseInt(c.req.param("productId"));
  const onlyUnsold = c.req.query("onlyUnsold") !== "false";

  try {
    await prisma.$transaction(async (tx) => {
      // Sửa lỗi exactOptionalPropertyTypes bằng cách xây dựng object where sạch
      const deleteWhere: any = { productId };
      if (onlyUnsold) {
        deleteWhere.isSold = false;
      }

      await tx.stock.deleteMany({
        where: deleteWhere
      });
      
      const unsold = await tx.stock.count({ where: { productId, isSold: false } });
      await tx.product.update({ where: { id: productId }, data: { resellStock: unsold } });
    });

    return c.json({ status: "success", message: t(c, "stock_cleared") });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Tải tất cả tài khoản của sản phẩm (.txt)
 */
stockRoutes.get("/export/:productId", authMiddleware, adminMiddleware, async (c) => {
  const productId = parseInt(c.req.param("productId"));
  const isSoldStr = c.req.query("isSold");

  try {
    const where: any = { productId };
    if (isSoldStr === "true") where.isSold = true;
    if (isSoldStr === "false") where.isSold = false;

    const items = await prisma.stock.findMany({
      where,
      select: { content: true }
    });

    const fileContent = items.map(i => i.content).join("\n");
    
    return new Response(fileContent, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="product_${productId}_stock.txt"`
      }
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { stockRoutes };