import type { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "1fcb6b5d-5082-4897-a54c-7bbdfcab2e89";

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  version: number;
  exp: number;
}

/**
 * Middleware xác thực đa phương thức: JWT hoặc API Key
 */
export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("x-api-key");

  // 1. TRƯỜNG HỢP: XÁC THỰC QUA JWT (Dành cho trình duyệt/người dùng)
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const payload = (await verify(token!, JWT_SECRET, "HS256")) as unknown as CustomJWTPayload;
      
      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { tokenVersion: true, isBanned: true }
      });

      if (!user || user.isBanned || user.tokenVersion !== payload.version) {
        return c.json({ message: "Token invalid or user banned." }, 401);
      }

      c.set("jwtPayload", payload);
      return await next();
    } catch (e) {
      return c.json({ message: "Invalid or expired token" }, 401);
    }
  }

  // 2. TRƯỜNG HỢP: XÁC THỰC QUA API KEY (Dành cho Tools/Developers)
  if (apiKeyHeader) {
    const user = await prisma.user.findUnique({
      where: { apiKey: apiKeyHeader },
      select: { id: true, username: true, role: true, isBanned: true }
    });

    if (!user || user.isBanned) {
      return c.json({ message: "Invalid API Key or user banned." }, 401);
    }

    // Giả lập payload để tương thích với các route hiện tại
    const virtualPayload: Partial<CustomJWTPayload> = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    c.set("jwtPayload", virtualPayload);
    return await next();
  }

  // Nếu không cung cấp phương thức xác thực nào
  return c.json({ message: "Unauthorized: Missing Token or API Key" }, 401);
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