import type { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("CRITICAL: JWT_SECRET environment variable is not defined.");
}

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  version: number;
  exp: number;
}

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("x-api-key");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const payload = (await verify(token!, JWT_SECRET, "HS256")) as unknown as CustomJWTPayload;
      
      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { tokenVersion: true, isBanned: true }
      });

      if (!user || user.isBanned || user.tokenVersion !== payload.version) {
        return c.json({ message: t(c, "auth_invalid") }, 401);
      }

      c.set("jwtPayload", payload);
      return await next();
    } catch (e) {
      return c.json({ message: t(c, "auth_token_invalid") }, 401);
    }
  }

  if (apiKeyHeader) {
    const user = await prisma.user.findUnique({
      where: { apiKey: apiKeyHeader },
      select: { id: true, username: true, role: true, isBanned: true }
    });

    if (!user || user.isBanned) {
      return c.json({ message: t(c, "auth_invalid") }, 401);
    }

    const virtualPayload: Partial<CustomJWTPayload> = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    c.set("jwtPayload", virtualPayload);
    return await next();
  }

  return c.json({ message: t(c, "auth_unauthorized") }, 401);
};

export const adminMiddleware = async (c: Context, next: Next) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload | undefined;
  
  if (!payload || payload.role !== "ADMIN") {
    return c.json({ message: t(c, "auth_forbidden") }, 403);
  }
  await next();
};