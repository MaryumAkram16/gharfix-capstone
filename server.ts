import axios from "axios";
import _axiosRetry from "axios-retry";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

// Fix for axios-retry when bundled as CJS
const axiosRetry = (typeof _axiosRetry === 'function' ? _axiosRetry : (_axiosRetry as any).default) as typeof _axiosRetry;

// Configure axios retries
if (typeof axiosRetry === 'function') {
  axiosRetry(axios, { 
    retries: 3, 
    retryDelay: (retryCount) => {
      console.log(`[Proxy] Retry attempt #${retryCount}...`);
      return retryCount * 1000; // time interval between retries
    },
    retryCondition: (error: any) => {
      // Retry on network errors or DNS errors (like EAI_AGAIN)
      return (axiosRetry as any).isNetworkOrIdempotentRequestError?.(error) || 
             error.code === 'EAI_AGAIN' || 
             error.code === 'ECONNRESET';
    }
  });
} else {
  console.error("[Proxy] Critical: axiosRetry is not a function", typeof axiosRetry);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

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
    const { endpoint, ...body } = req.body;
    console.log(`[Proxy] Request received for endpoint: ${endpoint}`);
    
    if (!endpoint) {
      console.error("[Proxy] Error: Missing endpoint in request body");
      return res.status(400).json({ error: "Endpoint is required" });
    }

    const N8N_BASE = process.env.N8N_WEBHOOK_BASE_URL || "https://n8ndigitalstudio.duckdns.org/webhook";
    const url = `${N8N_BASE}/${endpoint}`;
    
    // Duplicate message field for better n8n compatibility. 
    const enrichedBody = {
      ...body,
      message: body.message || body.raw_message || "",
      timestamp: new Date().toISOString(),
      agent_id: "khidmatgaar_v1"
    };

    console.log(`[Proxy] Forwarding to: ${url}`);
    console.log(`[Proxy] Payload keys: ${Object.keys(enrichedBody).join(", ")}`);

    try {
      const response = await axios.post(url, enrichedBody, {
        timeout: 30000, // 30s timeout for n8n
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        // Handle all status codes to prevent axios from throwing on 4xx/5xx
        validateStatus: () => true 
      });

      console.log(`[Proxy] Response from ${endpoint}: Status ${response.status}`);
      
      // Return whatever the webhook returned
      if (typeof response.data === 'object' && response.data !== null) {
        return res.status(response.status).json(response.data);
      } else {
        return res.status(response.status).send(response.data);
      }
    } catch (error: any) {
      const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
      console.error(`[Proxy] ${isTimeout ? 'Timeout' : 'Critical Error'} for ${endpoint}: ${error.message}`);
      
      if (error.response) {
        console.error(`[Proxy] Error data:`, error.response.data);
        return res.status(error.response.status).send(error.response.data);
      }

      res.status(isTimeout ? 504 : 500).json({
        error: isTimeout ? "Webhook Timeout" : "Failed to forward request",
        details: error.message,
        code: error.code,
        endpoint,
      });
    }
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
