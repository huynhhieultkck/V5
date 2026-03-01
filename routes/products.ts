import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { verify } from "hono/jwt";
import { prisma } from "../lib/prisma";
import { getLanguage, t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";
import { verifyTurnstile } from "../lib/captcha";

const productRoutes = new Hono();
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-mmo-v5";

// --- Schemas ---
const translationSchema = z.object({
  language: z.enum(["VI", "EN", "ZH", "RU"]),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

const createProductSchema = z.object({
  categoryId: z.number(),
  price: z.number().min(0),
  originalPrice: z.number().optional().nullable(),
  type: z.enum(["LOCAL", "RESELL"]),
  status: z.boolean().default(true),
  minPurchase: z.number().min(1).default(1),
  maxPurchase: z.number().optional().nullable(),
  resellDomain: z.string().optional().nullable(),
  resellApiKey: z.string().optional().nullable(),
  resellProductId: z.string().optional().nullable(),
  translations: z.array(translationSchema).min(1),
});

const updateProductSchema = createProductSchema.partial();

// --- [SIÊU API] Public View: Phân trang, Tìm kiếm, Lọc Danh mục, Sắp xếp ---
// Tự động trả về thêm 'type' nếu người gọi là ADMIN
productRoutes.get("/view", async (c) => {
  const lang = getLanguage(c);
  
  const page = Number(c.req.query("page") || 1);
  const limit = Number(c.req.query("limit") || 20);
  const search = c.req.query("search");
  const categoryId = c.req.query("categoryId") ? Number(c.req.query("categoryId")) : undefined;
  const sort = c.req.query("sort") || "newest";

  // Kiểm tra quyền Admin một cách tùy chọn (không bắt buộc)
  let isAdmin = false;
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const payload = await verify(token!, JWT_SECRET, "HS256") as any;
      if (payload?.role === "ADMIN") isAdmin = true;
    } catch (e) {
      // Token lỗi hoặc hết hạn thì coi như khách vãng lai
    }
  }

  try {
    const whereClause: any = { status: true };
    if (search) {
      whereClause.translations = {
        some: { language: lang, name: { contains: search } }
      };
    }
    if (categoryId) whereClause.categoryId = categoryId;

    let orderBy: any = { createdAt: "desc" }; 
    switch (sort) {
      case "price_asc": orderBy = { price: "asc" }; break;
      case "price_desc": orderBy = { price: "desc" }; break;
      case "stock_asc": orderBy = { resellStock: "asc" }; break;
      case "stock_desc": orderBy = { resellStock: "desc" }; break;
      case "sold_desc": orderBy = { soldCount: "desc" }; break;
      case "newest": orderBy = { createdAt: "desc" }; break;
      case "oldest": orderBy = { createdAt: "asc" }; break;
    }

    const [totalItems, products] = await Promise.all([
      prisma.product.count({ where: whereClause }),
      prisma.product.findMany({
        where: whereClause,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: orderBy,
        include: {
          translations: { where: { language: lang } },
          category: { include: { translations: { where: { language: lang } } } }
        }
      })
    ]);

    const result = products.map((p: any) => ({
      id: p.id,
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
      // Chỉ trả về type nếu là Admin
      ...(isAdmin && { type: p.type })
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

// --- Public: Chi tiết sản phẩm ---
productRoutes.get("/detail/:id", async (c) => {
  const lang = getLanguage(c);
  const id = parseInt(c.req.param("id"));

  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        translations: { where: { language: lang } },
        category: { include: { translations: { where: { language: lang } } } }
      }
    });

    if (!product || !product.status) return c.json({ message: t(c, "product_not_found") }, 404);

    return c.json({
      status: "success",
      data: {
        id: product.id,
        price: product.price,
        originalPrice: product.originalPrice,
        name: product.translations[0]?.name || "N/A",
        description: product.translations[0]?.description || "",
        categoryName: product.category.translations[0]?.name || "N/A",
        stock: product.resellStock,
        soldCount: product.soldCount,
        minPurchase: product.minPurchase,
        maxPurchase: product.maxPurchase
      }
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- Admin: CRUD ---
productRoutes.post("/", authMiddleware, adminMiddleware, zValidator("json", createProductSchema), async (c) => {
  const data = c.req.valid("json");
  try {
    const product = await prisma.product.create({
      data: {
        price: data.price,
        originalPrice: data.originalPrice ?? null,
        type: data.type,
        status: data.status,
        minPurchase: data.minPurchase,
        maxPurchase: data.maxPurchase ?? null,
        categoryId: data.categoryId,
        resellDomain: data.resellDomain ?? null,
        resellApiKey: data.resellApiKey ?? null,
        resellProductId: data.resellProductId ?? null,
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

productRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateProductSchema), async (c) => {
  const id = parseInt(c.req.param("id"));
  const data = c.req.valid("json");
  try {
    const updateData: any = {};
    if (data.price !== undefined) updateData.price = data.price;
    if (data.originalPrice !== undefined) updateData.originalPrice = data.originalPrice ?? null;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.type !== undefined) updateData.type = data.type;
    
    if (data.resellDomain !== undefined) updateData.resellDomain = data.resellDomain ?? null;
    if (data.resellApiKey !== undefined) updateData.resellApiKey = data.resellApiKey ?? null;
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

    const product = await prisma.product.update({ where: { id }, data: updateData });
    return c.json({ status: "success", data: product });
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

productRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    await prisma.product.delete({ where: { id } }); 
    return c.json({ status: "success", message: "Product deleted" });
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { productRoutes };