import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { mailService } from "../lib/mail";
import { verifyTurnstile } from "../lib/captcha";
import { randomBytes } from "node:crypto";

const authRoutes = new Hono();
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-mmo-v5";

// Hàm tạo mã ví nạp tiền ngẫu nhiên (VMMO + 8 ký tự)
const generateWalletCode = () => {
  return `VMMO${randomBytes(4).toString("hex").toUpperCase()}`;
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

// --- Register ---
authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
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
      data: { 
        username, 
        email, 
        password: hashedPassword,
        wallet
      },
    });

    return c.json({ status: "success", message: t(c, "auth_register_success"), userId: user.id }, 201);
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- Login ---
authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
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
      { id: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 }, 
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
});

// --- Forgot Password ---
authRoutes.post("/forgot-password", zValidator("json", forgotPasswordSchema), async (c) => {
  const { email, captchaToken } = c.req.valid("json");
  const isCaptchaValid = await verifyTurnstile(captchaToken, c.req.header("x-forwarded-for"));
  if (!isCaptchaValid) return c.json({ message: t(c, "captcha_invalid") }, 400);

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return c.json({ message: t(c, "auth_reset_sent") }); 

    const resetToken = randomBytes(32).toString("hex");
    // Thiết lập hết hạn sau 1 giờ (3600 giây * 1000 ms)
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
        <p>${t(c, "mail_reset_hello")} ${user.username},</p>
        <p>${t(c, "mail_reset_text1")}</p>
        <a href="${resetUrl}" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">
          ${t(c, "mail_reset_button")}
        </a>
        <p>${t(c, "mail_reset_footer")}</p>
      `
    });

    return c.json({ message: t(c, "auth_reset_sent") });
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

// --- Reset Password ---
authRoutes.post("/reset-password", zValidator("json", resetPasswordSchema), async (c) => {
  const { token, newPassword, captchaToken } = c.req.valid("json");
  const isCaptchaValid = await verifyTurnstile(captchaToken, c.req.header("x-forwarded-for"));
  if (!isCaptchaValid) return c.json({ message: t(c, "captcha_invalid") }, 400);

  try {
    const user = await prisma.user.findUnique({ 
      where: { resetToken: token } 
    });

    // Kiểm tra xem user có tồn tại và token còn hạn hay không
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return c.json({ message: t(c, "auth_token_invalid") }, 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        password: hashedPassword, 
        resetToken: null,
        resetTokenExpiry: null
      }
    });

    return c.json({ status: "success", message: t(c, "auth_password_updated") });
  } catch (e) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { authRoutes };