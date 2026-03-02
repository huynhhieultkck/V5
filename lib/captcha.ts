import type { Context } from "hono";
import { logger } from "./logger";

// FAIL-FAST: Ràng buộc TURNSTILE_SECRET_KEY
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
if (!TURNSTILE_SECRET_KEY) {
  throw new Error("CRITICAL: TURNSTILE_SECRET_KEY environment variable is missing.");
}

/**
 * Xác thực token Turnstile từ Cloudflare
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!token) return false;

  try {
    const formData = new FormData();
    formData.append("secret", TURNSTILE_SECRET_KEY!);
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
    logger.error("Turnstile error:", err);
    return false;
  }
}