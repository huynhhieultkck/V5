import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";

// Import các Routes
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
import { couponRoutes } from "./routes/coupons"; // Thêm route coupons
import { stockRoutes } from "./routes/stocks";   // Thêm route stocks

// Import các Cron Jobs
import { startBankCron } from "./cron/bankCron";
import { startSyncCron } from "./cron/syncCron";

const app = new Hono();

// --- Middlewares ---
if (process.env.ENABLE_LOGS === 'true') {
  app.use("*", logger());
}

/**
 * CẤU HÌNH CORS BẢO MẬT
 */
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (allowedOrigins.includes(origin) || !origin) {
        return origin;
      }
      return null;
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
app.route("/api/coupons", couponRoutes); // Mount Coupon Route
app.route("/api/stocks", stockRoutes);   // Mount Stock Route

app.get("/", (c) => {
  return c.json({
    status: "success",
    message: "MMO Shop API is fully functional!",
    modules: ["Auth", "Catalog", "Checkout", "Billing", "Stats", "History", "Sync", "Coupons", "Inventory"]
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