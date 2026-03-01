import type { Context, Next } from "hono";
import { verify } from "hono/jwt";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-mmo-v5";

// Định nghĩa interface để TypeScript hiểu cấu trúc Token của bạn
interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  exp: number;
}

/**
 * Middleware xác thực người dùng qua JWT
 */
export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    // Thêm thuật toán 'HS256' để fix lỗi "Expected 3 arguments"
    const payload = (await verify(token!, JWT_SECRET, "HS256")) as unknown as CustomJWTPayload;
    
    c.set("jwtPayload", payload);
    await next();
  } catch (e) {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
};

/**
 * Middleware kiểm tra quyền Admin
 */
export const adminMiddleware = async (c: Context, next: Next) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload | undefined;
  
  if (!payload || payload.role !== "ADMIN") {
    return c.json({ message: "Forbidden: Admin access required" }, 403);
  }
  await next();
};