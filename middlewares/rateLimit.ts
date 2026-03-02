import type { Context, Next } from "hono";
import { t } from "../lib/lang";

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

/**
 * Cấu hình Rate Limit
 * @param windowMs Thời gian theo dõi (milliseconds)
 * @param max Số lượng yêu cầu tối đa trong khoảng thời gian đó
 */
export const rateLimit = (windowMs: number, max: number) => {
  return async (c: Context, next: Next) => {
    // Lấy IP từ header (hỗ trợ proxy như Cloudflare/Nginx)
    const ip = c.req.header("x-forwarded-for") || "unknown";
    const now = Date.now();

    if (!store[ip] || now > store[ip].resetTime) {
      store[ip] = {
        count: 1,
        resetTime: now + windowMs,
      };
    } else {
      store[ip].count++;
    }

    // Gắn thông tin limit vào Header để Client biết (chuẩn RFC)
    c.header("X-RateLimit-Limit", max.toString());
    c.header("X-RateLimit-Remaining", Math.max(0, max - store[ip].count).toString());
    c.header("X-RateLimit-Reset", Math.ceil(store[ip].resetTime / 1000).toString());

    if (store[ip].count > max) {
      return c.json({ 
        status: "error",
        message: t(c, "rate_limit_exceeded") 
      }, 429);
    }

    await next();
  };
};

// Dọn dẹp bộ nhớ định kỳ mỗi 10 phút để tránh Memory Leak
setInterval(() => {
  const now = Date.now();
  for (const ip in store) {
    if (now > (store[ip]?.resetTime || 0)) {
      delete store[ip];
    }
  }
}, 600000);