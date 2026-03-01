import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const userRoutes = new Hono();

// Interface Payload JWT để TypeScript hiểu cấu trúc thông tin người dùng
interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

// Schema kiểm tra dữ liệu cập nhật thành viên
const updateUserSchema = z.object({
  balance: z.number().optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  isBanned: z.boolean().optional(),
  wallet: z.string().optional(),
});

/**
 * Admin: Lấy danh sách thành viên
 * Hỗ trợ: Phân trang, Tìm kiếm (Username/Email/ID/Wallet), Lọc theo quyền và trạng thái khóa
 */
userRoutes.get("/", authMiddleware, adminMiddleware, async (c) => {
  const page = Number(c.req.query("page") || 1);
  const limit = Number(c.req.query("limit") || 20);
  const search = c.req.query("search");
  const role = c.req.query("role") as "USER" | "ADMIN" | undefined;
  const isBannedStr = c.req.query("isBanned");
  const sort = c.req.query("sort") || "newest";

  try {
    // Xây dựng điều kiện lọc động để tránh lỗi exactOptionalPropertyTypes
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

    // Xác định thứ tự sắp xếp
    let orderBy: any = { createdAt: "desc" };
    switch (sort) {
      case "balance_desc": orderBy = { balance: "desc" }; break;
      case "balance_asc": orderBy = { balance: "asc" }; break;
      case "oldest": orderBy = { createdAt: "asc" }; break;
      case "newest": default: orderBy = { createdAt: "desc" }; break;
    }

    // Truy vấn dữ liệu và tổng số lượng đồng thời
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
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Lấy chi tiết một thành viên theo ID
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

    // Loại bỏ mật khẩu trước khi trả về dữ liệu
    const { password, ...safeUser } = user;
    return c.json({ status: "success", data: safeUser });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Cập nhật thông tin thành viên
 * Bao gồm: Điều chỉnh số dư (có ghi log transaction), thay đổi quyền hạn và trạng thái khóa
 */
userRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", updateUserSchema), async (c) => {
  const id = c.req.param("id");
  const validatedData = c.req.valid("json");

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return c.json({ message: t(c, "user_not_found") }, 404);

    // Nếu có sự thay đổi về số dư, tiến hành tạo log giao dịch để đối soát
    if (validatedData.balance !== undefined && validatedData.balance !== user.balance) {
      const diff = validatedData.balance - user.balance;
      await prisma.transaction.create({
        data: {
          userId: id,
          amount: diff,
          balanceBefore: user.balance,
          balanceAfter: validatedData.balance,
          type: diff > 0 ? "DEPOSIT" : "PURCHASE",
          content: `Admin manual adjustment: ${diff > 0 ? 'Added' : 'Subtracted'} funds`
        }
      });
    }

    // Xây dựng đối tượng updateData sạch để tránh lỗi Prisma exactOptionalPropertyTypes
    const updateData: any = {};
    if (validatedData.balance !== undefined) updateData.balance = validatedData.balance;
    if (validatedData.role !== undefined) updateData.role = validatedData.role;
    if (validatedData.isBanned !== undefined) updateData.isBanned = validatedData.isBanned;
    if (validatedData.wallet !== undefined) updateData.wallet = validatedData.wallet;

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
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Xóa thành viên khỏi hệ thống
 */
userRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param("id");
  try {
    // Kiểm tra xem thành viên có tồn tại không trước khi xóa
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) return c.json({ message: t(c, "user_not_found") }, 404);

    await prisma.user.delete({ where: { id } });
    return c.json({ status: "success", message: t(c, "user_deleted_success") });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { userRoutes };