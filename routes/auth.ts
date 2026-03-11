import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { mailService } from "../lib/mail";
import { verifyTurnstile } from "../lib/captcha";
import { randomBytes, randomUUID } from "node:crypto";
import { authMiddleware } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rateLimit";

const authRoutes = new Hono();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("CRITICAL: JWT_SECRET environment variable is missing.");
}

const prefix = process.env.DEPOSIT_PREFIX || 'VMMO';

interface CustomJWTPayload {
  id: string;
  username: string;
  role: string;
  version: number;
  exp: number;
}

const generateWalletCode = () => {
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}${randomPart}`;
};

// --- Schemas ---
const registerSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  captchaToken: z.string(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  captchaToken: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  captchaToken: z.string(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(6),
  captchaToken: z.string(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

/**
 * GET /me - Lấy thông tin profile người dùng hiện tại
 */
authRoutes.get("/me", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        balance: true,
        wallet: true,
        apiKey: true,
        createdAt: true
      }
    });

    if (!user) {
      return c.json({ message: t(c, "auth_not_found") }, 404);
    }

    return c.json({
      status: "success",
      data: user
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * POST /change-password - Đổi mật khẩu (Dành cho người đã đăng nhập)
 */
authRoutes.post("/change-password", authMiddleware, zValidator("json", changePasswordSchema), async (c) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const { oldPassword, newPassword } = c.req.valid("json");

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return c.json({ message: t(c, "auth_not_found") }, 404);

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordValid) {
      return c.json({ message: t(c, "auth_old_password_invalid") }, 400);
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedNewPassword,
        tokenVersion: { increment: 1 }
      }
    });

    return c.json({
      status: "success",
      message: t(c, "auth_password_updated")
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * API Tạo/Cấp mới API Key
 */
authRoutes.post("/generate-api-key", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  try {
    const newApiKey = randomUUID();
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { apiKey: newApiKey },
      select: { apiKey: true }
    });

    return c.json({
      status: "success",
      message: t(c, "auth_api_key_generated"),
      apiKey: updatedUser.apiKey
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * API Hủy bỏ API Key (Dành cho người dùng không muốn dùng API nữa)
 */
authRoutes.post("/revoke-api-key", authMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as CustomJWTPayload;
  const userId = payload.id;

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { apiKey: null }
    });

    return c.json({
      status: "success",
      message: t(c, "auth_api_key_deleted")
    });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- REGISTER ---
authRoutes.post(
  "/register", 
  rateLimit(600000, 5), 
  zValidator("json", registerSchema), 
  async (c) => {
    const { username, email, password, captchaToken } = c.req.valid("json");

    const isCaptchaValid = await verifyTurnstile(captchaToken, c.req.header("x-forwarded-for"));
    if (!isCaptchaValid) return c.json({ message: t(c, "captcha_invalid") }, 400);

    try {
      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] },
      });
      if (existingUser) return c.json({ message: t(c, "auth_exists") }, 400);

      const hashedPassword = await bcrypt.hash(password, 10);

      let wallet = generateWalletCode();
      let isWalletExists = await prisma.user.findUnique({ where: { wallet } });

      while (isWalletExists) {
        wallet = generateWalletCode();
        isWalletExists = await prisma.user.findUnique({ where: { wallet } });
      }

      const user = await prisma.user.create({
        data: { username, email, password: hashedPassword, wallet },
      });

      return c.json({ status: "success", message: t(c, "auth_register_success"), userId: user.id }, 201);
    } catch (e) {
      return c.json({ message: t(c, "system_error") }, 500);
    }
  }
);

// --- LOGIN ---
authRoutes.post(
  "/login", 
  rateLimit(300000, 10), 
  zValidator("json", loginSchema), 
  async (c) => {
    const { username, password, captchaToken } = c.req.valid("json");

    const isCaptchaValid = await verifyTurnstile(captchaToken, c.req.header("x-forwarded-for"));
    if (!isCaptchaValid) return c.json({ message: t(c, "captcha_invalid") }, 400);

    try {
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return c.json({ message: t(c, "auth_invalid") }, 401);
      }
      if (user.isBanned) return c.json({ message: t(c, "auth_banned") }, 403);

      const token = await sign(
        {
          id: user.id,
          username: user.username,
          role: user.role,
          version: user.tokenVersion,
          exp: Math.floor(Date.now() / 1000) + 86400
        },
        JWT_SECRET,
        "HS256"
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { lastIp: c.req.header("x-forwarded-for") || "unknown" }
      });

      return c.json({
        status: "success",
        message: t(c, "auth_login_success"),
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          balance: user.balance,
          wallet: user.wallet
        }
      });
    } catch (e) {
      return c.json({ message: t(c, "system_error") }, 500);
    }
  }
);

// --- FORGOT PASSWORD ---
authRoutes.post(
  "/forgot-password", 
  rateLimit(1800000, 3), 
  zValidator("json", forgotPasswordSchema), 
  async (c) => {
    const { email, captchaToken } = c.req.valid("json");
    const isCaptchaValid = await verifyTurnstile(captchaToken, c.req.header("x-forwarded-for"));
    if (!isCaptchaValid) return c.json({ message: t(c, "captcha_invalid") }, 400);

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return c.json({ message: t(c, "auth_reset_sent") });

      const resetToken = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 3600 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpiry: expiry
        }
      });

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

      await mailService.sendMail({
        to: user.email,
        subject: t(c, "mail_reset_subject"),
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
            <h2>${t(c, "mail_reset_hello")} ${user.username},</h2>
            <p>${t(c, "mail_reset_text1")}</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                ${t(c, "mail_reset_button")}
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">${t(c, "mail_reset_footer")}</p>
          </div>
        `
      });

      return c.json({ message: t(c, "auth_reset_sent") });
    } catch (e) {
      return c.json({ message: t(c, "system_error") }, 500);
    }
  }
);

// --- RESET PASSWORD ---
authRoutes.post(
  "/reset-password", 
  rateLimit(900000, 5), 
  zValidator("json", resetPasswordSchema), 
  async (c) => {
    const { token, newPassword, captchaToken } = c.req.valid("json");
    const isCaptchaValid = await verifyTurnstile(captchaToken, c.req.header("x-forwarded-for"));
    if (!isCaptchaValid) return c.json({ message: t(c, "captcha_invalid") }, 400);

    try {
      const user = await prisma.user.findUnique({
        where: { resetToken: token }
      });

      if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
        return c.json({ message: t(c, "auth_token_invalid") }, 400);
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
          tokenVersion: { increment: 1 }
        }
      });

      return c.json({ status: "success", message: t(c, "auth_password_updated") });
    } catch (e) {
      return c.json({ message: t(c, "system_error") }, 500);
    }
  }
);

export { authRoutes };