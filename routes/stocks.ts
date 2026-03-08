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

const updateSingleStockSchema = z.object({
  content: z.string().min(1),
});

stockRoutes.get("/", authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 500);
  const productId = c.req.query("productId") ? Number(c.req.query("productId")) : undefined;
  const isSoldStr = c.req.query("isSold");
  const search = c.req.query("search");

  try {
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
 * ADMIN: Chỉnh sửa nội dung của 1 tài khoản trong kho
 */
stockRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateSingleStockSchema), async (c) => {
  const id = parseInt(c.req.param("id"));
  const { content } = c.req.valid("json");

  try {
    const stock = await prisma.stock.findUnique({ where: { id } });
    if (!stock) return c.json({ message: t(c, "stock_not_found") }, 404);

    const updatedStock = await prisma.stock.update({
      where: { id },
      data: { content }
    });

    return c.json({ 
      status: "success", 
      message: "Cập nhật tài khoản thành công", 
      data: updatedStock 
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

stockRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));

  try {
    const item = await prisma.stock.findUnique({ where: { id } });
    if (!item) return c.json({ message: t(c, "stock_not_found") }, 404);

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

stockRoutes.delete("/product/:productId", authMiddleware, adminMiddleware, async (c) => {
  const productId = parseInt(c.req.param("productId"));
  const onlyUnsold = c.req.query("onlyUnsold") !== "false";

  try {
    await prisma.$transaction(async (tx) => {
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