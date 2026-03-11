import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { verify } from "hono/jwt";
import { prisma } from "../lib/prisma";
import { getLanguage, t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const productRoutes = new Hono();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("CRITICAL: JWT_SECRET environment variable is missing.");
}

// --- Schemas ---

const translationSchema = z.object({
  language: z.enum(["VI", "EN", "ZH", "RU"]),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

const createProductSchema = z.object({
  categoryId: z.number(),
  image: z.string().url().optional().nullable(),
  icon: z.string().url().optional().nullable(), 
  warrantyDays: z.number().int().min(0).default(0), 
  price: z.number().min(0),
  originalPrice: z.number().optional().nullable(),
  type: z.enum(["LOCAL", "RESELL"]),
  status: z.boolean().default(true),
  minPurchase: z.number().min(1).default(1),
  maxPurchase: z.number().optional().nullable(),
  resellProviderId: z.number().optional().nullable(),
  resellProductId: z.string().optional().nullable(),
  translations: z.array(translationSchema).min(1),
});

const updateProductSchema = createProductSchema.partial();

/**
 * CLIENT & ADMIN: Xem danh sách sản phẩm
 * Đã sửa lỗi: Ưu tiên lựa chọn sắp xếp của người dùng lên hàng đầu
 */
productRoutes.get("/view", async (c) => {
  const lang = getLanguage(c);
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 100);
  const search = c.req.query("search");
  const categoryId = c.req.query("categoryId") ? Number(c.req.query("categoryId")) : undefined;
  const sort = c.req.query("sort") || "newest";

  let isAdmin = false;
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const payload = await verify(token!, JWT_SECRET, "HS256") as any;
      if (payload?.role === "ADMIN") isAdmin = true;
    } catch (e) {}
  }

  try {
    const whereClause: any = isAdmin ? {} : { status: true };
    if (search) {
      whereClause.translations = {
        some: { language: lang, name: { contains: search } }
      };
    }
    if (categoryId) whereClause.categoryId = categoryId;

    // Xác định tiêu chí sắp xếp chính dựa trên yêu cầu của người dùng
    let primarySort: any = { createdAt: "desc" }; 
    switch (sort) {
      case "price_asc": primarySort = { price: "asc" }; break;
      case "price_desc": primarySort = { price: "desc" }; break;
      case "stock_asc": primarySort = { resellStock: "asc" }; break;
      case "stock_desc": primarySort = { resellStock: "desc" }; break;
      case "sold_desc": primarySort = { soldCount: "desc" }; break;
      case "newest": primarySort = { createdAt: "desc" }; break;
      case "oldest": primarySort = { createdAt: "asc" }; break;
    }

    /**
     * CƠ CHẾ SẮP XẾP MỚI:
     * 1. Luôn ưu tiên tiêu chí người dùng chọn (primarySort).
     * 2. Nếu các sản phẩm trùng tiêu chí chính, dùng id giảm dần để đảm bảo kết quả ổn định.
     */
    const orderBy: any[] = [
      primarySort,
      { id: "desc" }
    ];

    const [totalItems, products] = await Promise.all([
      prisma.product.count({ where: whereClause }),
      prisma.product.findMany({
        where: whereClause,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: orderBy,
        include: {
          translations: { where: { language: lang } },
          category: { include: { translations: { where: { language: lang } } } },
          resellProvider: true
        }
      })
    ]);

    const result = products.map((p: any) => ({
      id: p.id,
      image: p.image,
      icon: p.icon,
      warrantyDays: p.warrantyDays,
      price: p.price,
      originalPrice: p.originalPrice,
      name: p.translations[0]?.name || "N/A",
      description: p.translations[0]?.description || "",
      category: {
        id: p.categoryId,
        name: p.category?.translations[0]?.name || "N/A"
      },
      minPurchase: p.minPurchase,
      maxPurchase: p.maxPurchase,
      stock: p.resellStock,
      soldCount: p.soldCount,
      status: p.status,
      ...(isAdmin && { 
        type: p.type,
        resellProviderId: p.resellProviderId,
        resellProvider: p.resellProvider,
        resellProductId: p.resellProductId
      })
    }));

    return c.json({
      status: "success",
      meta: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
        itemsPerPage: limit
      },
      data: result
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * CLIENT & ADMIN: Xem chi tiết sản phẩm
 */
productRoutes.get("/detail/:id", async (c) => {
  const lang = getLanguage(c);
  const id = parseInt(c.req.param("id"));

  let isAdmin = false;
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const payload = await verify(token!, JWT_SECRET, "HS256") as any;
      if (payload?.role === "ADMIN") isAdmin = true;
    } catch (e) {}
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        translations: { where: { language: lang } },
        category: { include: { translations: { where: { language: lang } } } },
        resellProvider: true
      }
    });

    if (!product || (!product.status && !isAdmin)) {
      return c.json({ message: t(c, "product_not_found") }, 404);
    }

    return c.json({
      status: "success",
      data: {
        id: product.id,
        image: product.image,
        icon: product.icon,
        warrantyDays: product.warrantyDays,
        price: product.price,
        originalPrice: product.originalPrice,
        name: product.translations[0]?.name || "N/A",
        description: product.translations[0]?.description || "",
        categoryName: product.category.translations[0]?.name || "N/A",
        stock: product.resellStock,
        soldCount: product.soldCount,
        minPurchase: product.minPurchase,
        maxPurchase: product.maxPurchase,
        status: product.status,
        ...(isAdmin && { 
          type: product.type,
          resellProviderId: product.resellProviderId,
          resellProvider: product.resellProvider,
          resellProductId: product.resellProductId
        })
      }
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * ADMIN: Tạo sản phẩm
 */
productRoutes.post("/", authMiddleware, adminMiddleware, zValidator("json", createProductSchema), async (c) => {
  const data = c.req.valid("json");
  try {
    const product = await prisma.product.create({
      data: {
        categoryId: data.categoryId,
        image: data.image ?? null,
        icon: data.icon ?? null,
        warrantyDays: data.warrantyDays,
        price: data.price,
        originalPrice: data.originalPrice ?? null,
        type: data.type,
        status: data.status,
        minPurchase: data.minPurchase,
        maxPurchase: data.maxPurchase ?? null,
        resellProviderId: data.type === "RESELL" ? (data.resellProviderId ?? null) : null,
        resellProductId: data.type === "RESELL" ? (data.resellProductId ?? null) : null,
        translations: {
          create: data.translations.map(t => ({
            language: t.language,
            name: t.name,
            description: t.description ?? null
          }))
        }
      }
    });
    return c.json({ status: "success", data: product }, 201);
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * ADMIN: Chỉnh sửa sản phẩm
 */
productRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateProductSchema), async (c) => {
  const id = parseInt(c.req.param("id"));
  const data = c.req.valid("json");
  try {
    const updateData: any = {};
    
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.image !== undefined) updateData.image = data.image ?? null;
    if (data.icon !== undefined) updateData.icon = data.icon ?? null;
    if (data.warrantyDays !== undefined) updateData.warrantyDays = data.warrantyDays;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.originalPrice !== undefined) updateData.originalPrice = data.originalPrice ?? null;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.minPurchase !== undefined) updateData.minPurchase = data.minPurchase;
    if (data.maxPurchase !== undefined) updateData.maxPurchase = data.maxPurchase ?? null;
    
    if (data.resellProviderId !== undefined) updateData.resellProviderId = data.resellProviderId ?? null;
    if (data.resellProductId !== undefined) updateData.resellProductId = data.resellProductId ?? null;

    if (data.translations) {
      updateData.translations = {
        upsert: data.translations.map(t => ({
          where: { productId_language: { productId: id, language: t.language } },
          create: { language: t.language, name: t.name, description: t.description ?? null },
          update: { name: t.name, description: t.description ?? null }
        }))
      };
    }

    const product = await prisma.product.update({ 
      where: { id }, 
      data: updateData 
    });
    
    return c.json({ status: "success", data: product });
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

productRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    await prisma.product.delete({ where: { id } }); 
    return c.json({ status: "success", message: t(c, "product_deleted") });
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { productRoutes };