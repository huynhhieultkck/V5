import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const transactionRoutes = new Hono();

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

/**
 * CLIENT: Xem lịch sử biến động số dư của tôi
 */
transactionRoutes.get("/", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  const page = Math.max(Number(c.req.query("page") || 1), 1);
  // Áp dụng giới hạn limit tối đa là 100
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 10), 1), 100);
  const type = c.req.query("type");

  try {
    const where: any = { userId };
    if (type) where.type = type;

    const [total, items] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" }
      })
    ]);

    return c.json({
      status: "success",
      message: t(c, "transaction_fetch_success"),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: items
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * ADMIN: Xem toàn bộ biến động số dư hệ thống
 */
transactionRoutes.get("/admin/all", authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  // Admin được phép lấy tối đa 200
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 200);
  const search = c.req.query("search");
  const type = c.req.query("type");

  try {
    const where: any = {};
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { code: { contains: search } },
        { user: { username: { contains: search } } }
      ];
    }

    const [total, items] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { username: true, email: true } }
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

export { transactionRoutes };