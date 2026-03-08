import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { getLanguage, t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const categoryRoutes = new Hono();

// --- Schemas ---
const translationSchema = z.object({
  language: z.enum(["VI", "EN", "ZH", "RU"]),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

const createCategorySchema = z.object({
  slug: z.string().min(2),
  icon: z.string().optional().nullable(),
  order: z.number().default(0),
  translations: z.array(translationSchema).min(1),
});

const updateCategorySchema = createCategorySchema.partial();

// --- Public: Lấy danh sách danh mục ---
categoryRoutes.get("/", async (c) => {
  const lang = getLanguage(c);
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 10), 1), 100);
  const search = c.req.query("search");
  const getAll = c.req.query("all") === "true";

  try {
    const whereClause: any = {};
    if (search) {
      whereClause.translations = {
        some: {
          language: lang,
          name: { contains: search }
        }
      };
    }

    const totalItems = await prisma.category.count({ where: whereClause });

    const queryOptions: any = {
      where: whereClause,
      orderBy: { order: "asc" },
      include: {
        translations: { where: { language: lang } },
        _count: { select: { products: true } }
      }
    };

    if (!getAll) {
      queryOptions.take = limit;
      queryOptions.skip = (page - 1) * limit;
    }

    const categories = await prisma.category.findMany(queryOptions);

    const result = categories.map((cat: any) => ({
      id: cat.id,
      slug: cat.slug,
      icon: cat.icon,
      order: cat.order,
      name: cat.translations[0]?.name || cat.slug,
      description: cat.translations[0]?.description || "",
      productCount: cat._count?.products || 0
    }));

    return c.json({
      status: "success",
      meta: getAll ? null : {
        totalItems,
        itemCount: result.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page
      },
      data: result
    });
  } catch (error) {
    return c.json({ message: t(c, "category_fetch_error") }, 500);
  }
});

/**
 * GET /:id - Xem chi tiết một danh mục
 * Đã bỏ logic kiểm tra Admin, luôn trả về bản dịch theo ngôn ngữ hiện tại
 */
categoryRoutes.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const lang = getLanguage(c);

  try {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        translations: { where: { language: lang } },
        _count: { select: { products: true } }
      }
    });

    if (!category) {
      return c.json({ message: t(c, "category_not_found") }, 404);
    }

    const result = {
      id: category.id,
      slug: category.slug,
      icon: category.icon,
      order: category.order,
      productCount: category._count?.products || 0,
      name: category.translations[0]?.name || category.slug,
      description: category.translations[0]?.description || ""
    };

    return c.json({
      status: "success",
      data: result
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- Admin: Tạo danh mục mới ---
categoryRoutes.post("/", authMiddleware, adminMiddleware, zValidator("json", createCategorySchema), async (c) => {
  const { slug, icon, order, translations } = c.req.valid("json");

  try {
    const category = await prisma.category.create({
      data: {
        slug,
        icon: icon ?? null,
        order: order ?? 0,
        translations: {
          create: translations.map(trans => ({
            language: trans.language,
            name: trans.name,
            description: trans.description ?? null
          }))
        }
      }
    });

    return c.json({ status: "success", data: category }, 201);
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- Admin: Chỉnh sửa danh mục ---
categoryRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateCategorySchema), async (c) => {
  const id = parseInt(c.req.param("id"));
  const { slug, icon, order, translations } = c.req.valid("json");

  try {
    const exists = await prisma.category.findUnique({ where: { id } });
    if (!exists) return c.json({ message: t(c, "category_not_found") }, 404);

    const updateData: any = {};
    if (slug !== undefined) updateData.slug = slug;
    if (icon !== undefined) updateData.icon = icon ?? null;
    if (order !== undefined) updateData.order = order;
    
    if (translations) {
      updateData.translations = {
        upsert: translations.map(trans => ({
          where: { categoryId_language: { categoryId: id, language: trans.language } },
          create: { 
            language: trans.language, 
            name: trans.name, 
            description: trans.description ?? null 
          },
          update: { 
            name: trans.name, 
            description: trans.description ?? null 
          }
        }))
      };
    }

    const category = await prisma.category.update({
      where: { id },
      data: updateData
    });

    return c.json({ status: "success", data: category });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- Admin: Xóa danh mục ---
categoryRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    await prisma.category.delete({ where: { id } });
    return c.json({ status: "success", message: t(c, "category_deleted") });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { categoryRoutes };