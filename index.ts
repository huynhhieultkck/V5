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
import { startSyncCron } from "./cron/syncCron"; // Import tiến trình đồng bộ mới

const app = new Hono();

// --- Middlewares ---
app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

// --- Routes Registration ---
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

// Khởi chạy tiến trình quét ngân hàng tự động
startBankCron();

// Khởi chạy tiến trình đồng bộ kho hàng Resell tự động
startSyncCron();