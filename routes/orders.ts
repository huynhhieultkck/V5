import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { t, getLanguage } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const orderRoutes = new Hono();

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

/**
 * CLIENT: Lấy danh sách đơn hàng của tôi
 */
orderRoutes.get("/", authMiddleware, async (c) => {
  const lang = getLanguage(c);
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  const page = Math.max(Number(c.req.query("page") || 1), 1);
  // Giới hạn limit tối đa là 100
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 10), 1), 100);
  const status = c.req.query("status");

  try {
    const where: any = { userId };
    if (status) where.status = status;

    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" },
        include: {
          product: {
            include: { translations: { where: { language: lang } } }
          }
        }
      })
    ]);

    const result = items.map(order => ({
      id: order.id,
      productName: order.product.translations[0]?.name || "N/A",
      amount: order.amount,
      totalPrice: order.totalPrice,
      status: order.status,
      createdAt: order.createdAt
    }));

    return c.json({
      status: "success",
      message: t(c, "order_fetch_success"),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: result
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * ADMIN: Lấy tất cả đơn hàng hệ thống
 */
orderRoutes.get("/admin/all", authMiddleware, adminMiddleware, async (c) => {
  const lang = getLanguage(c);
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  // Admin được phép lấy nhiều hơn một chút nhưng vẫn có giới hạn
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 200);
  const search = c.req.query("search");
  const status = c.req.query("status");

  try {
    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { id: { contains: search } },
        { user: { username: { contains: search } } }
      ];
    }

    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { username: true, email: true } },
          product: {
            include: { translations: { where: { language: lang } } }
          }
        }
      })
    ]);

    return c.json({
      status: "success",
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: items
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { orderRoutes };