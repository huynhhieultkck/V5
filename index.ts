import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { authRoutes } from "./routes/auth";
import { productRoutes } from "./routes/products";
import { categoryRoutes } from "./routes/categories";
import { checkoutRoutes } from "./routes/checkout";
import { userRoutes } from "./routes/users";
import { bankRoutes } from "./routes/banks";
import { cryptoRoutes } from "./routes/crypto";
import { statsRoutes } from "./routes/stats";
import { orderRoutes } from "./routes/orders";
import { transactionRoutes } from "./routes/transactions";
import { startBankCron } from "./cron/bankCron";
import { startSyncCron } from "./cron/syncCron";

const app = new Hono();

// --- Middlewares ---
if (process.env.ENABLE_LOGS === 'true') {
  app.use("*", logger());
}

/**
 * CẤU HÌNH CORS BẢO MẬT
 * Lấy danh sách các domain cho phép từ biến môi trường ALLOWED_ORIGINS.
 * Ví dụ: ALLOWED_ORIGINS=https://shop.cua-ban.com,http://localhost:5173
 */
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:5173"]; // Mặc định cho môi trường phát triển

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Nếu origin nằm trong whitelist hoặc không có origin (như gọi từ Server-to-Server/Postman)
      if (allowedOrigins.includes(origin) || !origin) {
        return origin;
      }
      return null; // Từ chối các origin lạ
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
    exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
    maxAge: 600,
    credentials: true,
  })
);

app.use("*", prettyJSON());

// --- Đăng ký Routes ---
app.route("/api/auth", authRoutes);
app.route("/api/products", productRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/checkout", checkoutRoutes);
app.route("/api/users", userRoutes);
app.route("/api/banks", bankRoutes);
app.route("/api/crypto", cryptoRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/orders", orderRoutes);
app.route("/api/transactions", transactionRoutes);

app.get("/", (c) => {
  return c.json({
    status: "success",
    message: "MMO Shop API is fully functional!",
    modules: ["Auth", "Catalog", "Checkout", "Billing", "Stats", "History", "Sync"]
  });
});

const port = Number(process.env.PORT || 3000);
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

// Khởi chạy các tiến trình chạy ngầm
startBankCron();
startSyncCron();