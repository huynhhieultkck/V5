import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const userRoutes = new Hono();

// --- Schemas ---

const updateUserSchema = z.object({
  balance: z.number().optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  isBanned: z.boolean().optional(),
  wallet: z.string().optional(),
  password: z.string().min(6).optional(), // Thêm trường mật khẩu mới cho admin cập nhật
});

/**
 * ADMIN: Lấy danh sách người dùng
 */
userRoutes.get("/", authMiddleware, adminMiddleware, async (c) => {
  const page = Math.max(Number(c.req.query("page") || 1), 1);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 100);
  const search = c.req.query("search");
  const role = c.req.query("role") as "USER" | "ADMIN" | undefined;
  const isBannedStr = c.req.query("isBanned");
  const sort = c.req.query("sort") || "newest";

  try {
    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: search } },
        { email: { contains: search } },
        { id: { contains: search } },
        { wallet: { contains: search } }
      ];
    }
    if (role) where.role = role;
    if (isBannedStr === "true") where.isBanned = true;
    if (isBannedStr === "false") where.isBanned = false;

    let orderBy: any = { createdAt: "desc" };
    switch (sort) {
      case "balance_desc": orderBy = { balance: "desc" }; break;
      case "balance_asc": orderBy = { balance: "asc" }; break;
      case "oldest": orderBy = { createdAt: "asc" }; break;
      case "newest": default: orderBy = { createdAt: "desc" }; break;
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy,
        select: {
          id: true,
          username: true,
          email: true,
          balance: true,
          role: true,
          wallet: true,
          isBanned: true,
          lastIp: true,
          createdAt: true,
          _count: { select: { orders: true, transactions: true } }
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
      data: users
    });
  } catch (error) {
    // Đã fix lỗi TS: "user_fetch_error" giờ đã tồn tại trong lang.ts
    return c.json({ message: t(c, "user_fetch_error") }, 500);
  }
});

/**
 * ADMIN: Xem chi tiết người dùng
 */
userRoutes.get("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param("id");
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: { select: { orders: true, transactions: true } }
      }
    });

    if (!user) return c.json({ message: t(c, "user_not_found") }, 404);

    const { password, ...safeUser } = user;
    return c.json({ status: "success", data: safeUser });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * ADMIN: Cập nhật thông tin người dùng (Bao gồm mật khẩu)
 */
userRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateUserSchema), async (c) => {
  const id = c.req.param("id");
  const validatedData = c.req.valid("json");

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return c.json({ message: t(c, "user_not_found") }, 404);

    const updateData: any = {};
    
    // Xử lý biến động số dư (Ghi log giao dịch nếu số dư thay đổi)
    if (validatedData.balance !== undefined && validatedData.balance !== user.balance) {
      const diff = validatedData.balance - user.balance;
      await prisma.transaction.create({
        data: {
          userId: id,
          amount: diff,
          balanceBefore: user.balance,
          balanceAfter: validatedData.balance,
          type: diff > 0 ? "DEPOSIT" : "PURCHASE",
          content: `${diff > 0 ? t(c, "user_adjustment_added") : t(c, "user_adjustment_subtracted")}: ${Math.abs(diff)}`
        }
      });
      updateData.balance = validatedData.balance;
    }

    if (validatedData.role !== undefined) updateData.role = validatedData.role;
    if (validatedData.isBanned !== undefined) updateData.isBanned = validatedData.isBanned;
    if (validatedData.wallet !== undefined) updateData.wallet = validatedData.wallet;

    // XỬ LÝ CẬP NHẬT MẬT KHẨU
    if (validatedData.password) {
      updateData.password = await bcrypt.hash(validatedData.password, 10);
      // Tăng version để logout user khỏi các thiết bị khác ngay lập tức
      updateData.tokenVersion = { increment: 1 };
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    });

    return c.json({ 
      status: "success", 
      message: t(c, "user_update_success"),
      data: { 
        id: updatedUser.id, 
        balance: updatedUser.balance, 
        role: updatedUser.role, 
        wallet: updatedUser.wallet,
        isBanned: updatedUser.isBanned 
      }
    });
  } catch (error) {
    // Đã fix lỗi TS: "user_update_error" giờ đã tồn tại trong lang.ts
    return c.json({ message: t(c, "user_update_error") }, 500);
  }
});

/**
 * ADMIN: Xóa người dùng
 */
userRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param("id");
  try {
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) return c.json({ message: t(c, "user_not_found") }, 404);

    await prisma.user.delete({ where: { id } });
    return c.json({ status: "success", message: t(c, "user_deleted_success") });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { userRoutes };