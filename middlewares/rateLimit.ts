import type { Context, Next } from "hono";
import { t } from "../lib/lang";

// Định nghĩa interface cho bộ lưu trữ rate limit
interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

/**
 * Bộ lưu trữ trong bộ nhớ (In-memory)
 * LƯU Ý: Trong môi trường production chạy đa instance (PM2 Cluster, Docker Swarm, K8s), 
 * dữ liệu này sẽ không đồng bộ giữa các tiến trình. 
 * Khuyến nghị: Thay thế 'store' bằng một Redis client để đảm bảo tính nhất quán toàn hệ thống.
 */
const store: RateLimitStore = {};

/**
 * Hàm lấy địa chỉ IP thật của người dùng một cách an toàn.
 * Ưu tiên các header từ các Proxy tin cậy.
 */
const getRealIp = (c: Context): string => {
  // 1. Ưu tiên Cloudflare (nếu hệ thống nằm sau CF)
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;

  // 2. Ưu tiên X-Real-IP (thường được Nginx cấu hình)
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;

  // 3. X-Forwarded-For: Lấy IP đầu tiên trong danh sách (Client IP thực sự)
  // Tránh việc kẻ tấn công chèn thêm IP giả vào chuỗi header.
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",");
    const firstIp = ips[0]?.trim();
    if (firstIp) return firstIp;
  }

  // 4. Fallback: Nếu không tìm thấy header nào (gọi trực tiếp hoặc qua proxy lạ)
  return "unknown";
};

/**
 * Middleware Rate Limit cải tiến
 * @param windowMs Thời gian theo dõi (milliseconds)
 * @param max Số lượng yêu cầu tối đa trong khoảng thời gian đó
 */
export const rateLimit = (windowMs: number, max: number) => {
  return async (c: Context, next: Next) => {
    const ip = getRealIp(c);
    
    // Nếu không xác định được IP, có thể áp dụng chính sách chặn hoặc cho qua (tùy nhu cầu)
    if (ip === "unknown") {
      return await next();
    }

    const now = Date.now();

    // Khởi tạo hoặc đặt lại bộ đếm nếu đã quá thời gian reset
    if (!store[ip] || now > store[ip].resetTime) {
      store[ip] = {
        count: 1,
        resetTime: now + windowMs,
      };
    } else {
      store[ip].count++;
    }

    // Gắn thông tin giới hạn vào Header (Tuân thủ chuẩn RFC 6585)
    const remaining = Math.max(0, max - store[ip].count);
    const resetAtSeconds = Math.ceil(store[ip].resetTime / 1000);

    c.header("X-RateLimit-Limit", max.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", resetAtSeconds.toString());

    // Nếu vượt quá giới hạn, trả về mã lỗi 429
    if (store[ip].count > max) {
      return c.json({ 
        status: "error",
        message: t(c, "rate_limit_exceeded") 
      }, 429);
    }

    await next();
  };
};

/**
 * Cơ chế dọn dẹp bộ nhớ tự động (Garbage Collection)
 * Chạy mỗi 5 phút để xóa các bản ghi IP đã hết hạn, tránh Memory Leak.
 */
setInterval(() => {
  const now = Date.now();
  for (const ip in store) {
    const entry = store[ip];
    if (entry && now > entry.resetTime) {
      delete store[ip];
    }
  }
}, 300000);