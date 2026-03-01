import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { authRoutes } from "./routes/auth";
import { productRoutes } from "./routes/products";

const app = new Hono();

// --- Middlewares ---
app.use("*", logger());
app.use("*", cors());
app.use("*", prettyJSON());

// --- Routes ---
app.route("/api/auth", authRoutes);
app.route("/api/products", productRoutes);

app.get("/", (c) => {
  return c.json({
    status: "success",
    message: "MMO Shop API is running!",
    supported_languages: ["VI", "EN", "ZH", "RU"]
  });
});

const port = 3000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});