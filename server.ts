import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import { createApp } from "./lib/app.js";
import type { HttpResult } from "./lib/http/errors.js";
import { validationError } from "./lib/http/errors.js";

// Local dev server. /api/proxy and /api/booking run the same code as the
// Vercel functions in api/ (lib/app.ts). Requests forwarded to n8n are sent
// once and never retried: they are all POSTs, and a retried booking or
// reschedule could happen twice.

function send(res: express.Response, result: HttpResult<unknown>) {
  res.status(result.status).set("Cache-Control", "no-store");
  if (typeof result.body === "string") res.type("text/plain").send(result.body);
  else res.json(result.body);
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const gharfix = createApp();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Add basic CORS headers for internal calls
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Content-Length, X-Requested-With");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // API Proxy Route for Webhooks
  app.post("/api/proxy", async (req, res) => {
    send(res, await gharfix.proxy(req.body, { requestId: null }));
  });

  app.post("/api/booking", async (req, res) => {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    send(res, await gharfix.booking(body, { requestId: null }));
  });

  // Malformed JSON: answer like the Vercel functions instead of Express's HTML error page.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed") return send(res, validationError("Request body must be valid JSON", ["body"]));
    next(err);
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/test", (req, res) => {
    res.json({ message: "Proxy server is alive", timestamp: new Date() });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
