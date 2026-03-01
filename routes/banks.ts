import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const bankRoutes = new Hono();

const bankSchema = z.object({
  name: z.string(),
  code: z.string(),
  accountNumber: z.string(),
  accountName: z.string(),
  password: z.string().optional().nullable(),
  token: z.string(),
  enabled: z.boolean().default(true),
});

/**
 * Public: Lấy danh sách ngân hàng để khách nạp tiền
 */
bankRoutes.get("/active", async (c) => {
  try {
    const banks = await prisma.bank.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        code: true,
        accountNumber: true,
        accountName: true
      }
    });
    return c.json({ status: "success", data: banks });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

/**
 * Admin: Quản lý danh sách ngân hàng
 */
bankRoutes.get("/admin", authMiddleware, adminMiddleware, async (c) => {
  try {
    const banks = await prisma.bank.findMany();
    return c.json({ status: "success", data: banks });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

bankRoutes.post("/", authMiddleware, adminMiddleware, zValidator("json", bankSchema), async (c) => {
  const data = c.req.valid("json");
  try {
    const bank = await prisma.bank.create({
      data: {
        name: data.name,
        code: data.code,
        accountNumber: data.accountNumber,
        accountName: data.accountName,
        password: data.password ?? null,
        token: data.token,
        enabled: data.enabled
      }
    });
    return c.json({ status: "success", data: bank }, 201);
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

bankRoutes.put("/:id", authMiddleware, adminMiddleware, zValidator("json", bankSchema.partial()), async (c) => {
  const id = parseInt(c.req.param("id"));
  const data = c.req.valid("json");
  try {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.accountNumber !== undefined) updateData.accountNumber = data.accountNumber;
    if (data.accountName !== undefined) updateData.accountName = data.accountName;
    if (data.password !== undefined) updateData.password = data.password ?? null;
    if (data.token !== undefined) updateData.token = data.token;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    const bank = await prisma.bank.update({ where: { id }, data: updateData });
    return c.json({ status: "success", data: bank });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

bankRoutes.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));
  try {
    await prisma.bank.delete({ where: { id } });
    return c.json({ status: "success", message: "Deleted" });
  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { bankRoutes };