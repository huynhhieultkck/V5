import type { Context } from "hono";

// Secret Key bạn cung cấp
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "0x4AAAAAA";

/**
 * Xác thực token Turnstile từ Cloudflare
 * @param token Mã token nhận được từ frontend
 * @param ip Địa chỉ IP của người dùng (tùy chọn)
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!token) return false;

  try {
    const formData = new FormData();
    formData.append("secret", TURNSTILE_SECRET_KEY);
    formData.append("response", token);
    if (ip) {
      formData.append("remoteip", ip);
    }

    const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    const result = await fetch(url, {
      body: formData,
      method: "POST",
    });

    const outcome = await result.json();
    return !!outcome.success;
  } catch (err) {
    console.error("Turnstile error:", err);
    return false;
  }
}