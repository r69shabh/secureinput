import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  APP_NAME,
  APP_VERSION,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  MAX_PENDING_REQUESTS,
} from "../shared/constants";
import {
  denyRequestSchema,
  requestSecretInputSchema,
  submitRequestSchema,
} from "../shared/schemas";
import type { HealthInfo, PublicState } from "../shared/types";
import { AuditLog, Logger } from "./audit";
import {
  bearerToken,
  clearSessionCookie,
  isMcpTokenValid,
  isPairingTokenValid,
  issueSession,
  RateLimiter,
  sessionIsValid,
  setSessionCookie,
} from "./auth";
import { isLoopbackHost, type SecureInputConfig } from "./config";
import type { EventBus, RequestEvent } from "./events";
import { createLocalBackend, createMcpServer } from "./mcp";
import type { Policy } from "./policy";
import { ServiceError, type SecureInputService } from "./service";
import { sourceFromHeaders } from "./source";
import { inlineEnvelopeSchema } from "../shared/inline";

export interface AppOptions {
  config: SecureInputConfig;
  policy: Policy;
  service: SecureInputService;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  webDir: string;
  startedAt: number;
}

export function createApp(options: AppOptions): express.Express {
  const { config, service, bus, logger } = options;
  const app = express();
  const pairLimiter = new RateLimiter(10, 5 * 60_000);
  const startedAt = options.startedAt;
  const mcpSessions = new Map<string, { transport: StreamableHTTPServerTransport; close: () => void; touched: number }>();
  const sessionCleanup = setInterval(() => {
    for (const session of mcpSessions.values()) if (Date.now() - session.touched > 30 * 60_000) session.close();
  }, 60_000);
  sessionCleanup.unref();
  app.locals.closeMcpSessions = () => {
    clearInterval(sessionCleanup);
    for (const session of mcpSessions.values()) session.close();
  };

  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );
    if (req.path.startsWith("/api/") || req.path === "/mcp") {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host) {
      res.status(400).json({ error: { code: "missing_host", message: "Missing Host header." } });
      return;
    }
    try {
      const hostname = new URL(`http://${host}`).hostname;
      if (!isLoopbackHost(hostname)) {
        res.status(403).json({ error: { code: "forbidden_host", message: "SecureInput only accepts loopback requests." } });
        return;
      }
    } catch {
      res.status(400).json({ error: { code: "invalid_host", message: "Invalid Host header." } });
      return;
    }
    next();
  });

  app.use(express.json({ limit: "256kb", type: ["application/json", "application/*+json"] }));

  app.get("/api/health", (_req, res) => {
    const health: HealthInfo = {
      name: "SecureInput",
      version: APP_VERSION,
      pid: process.pid,
      port: config.port,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      pending: service.pending().length,
      instanceId: config.instanceId,
    };
    res.json(health);
  });

  app.post("/api/auth/pair", (req, res) => {
    requireSameOrigin(req, res, () => undefined);
    if (res.headersSent) return;
    const ip = req.socket.remoteAddress ?? "unknown";
    if (!pairLimiter.check(ip)) {
      options.audit.append({ ts: new Date().toISOString(), event: "auth.rate_limited" });
      res.status(429).json({ error: { code: "rate_limited", message: "Too many pairing attempts. Wait five minutes." } });
      return;
    }
    const parsed = z.object({ token: z.string().min(1).max(500) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid_request", message: "Paste the pairing token from `secureinput pair`." } });
      return;
    }
    if (!isPairingTokenValid(config, parsed.data.token)) {
      options.audit.append({ ts: new Date().toISOString(), event: "auth.failed" });
      res.status(401).json({ error: { code: "invalid_pairing_token", message: "That pairing token is not valid." } });
      return;
    }
    pairLimiter.reset(ip);
    setSessionCookie(res, issueSession(config.sessionSecret));
    options.audit.append({ ts: new Date().toISOString(), event: "auth.paired" });
    res.json({ ok: true });
  });

  app.get("/api/auth/session", (req, res) => {
    res.json({ authenticated: sessionIsValid(req, config) });
  });

  app.post("/api/auth/logout", (req, res) => {
    requireSameOrigin(req, res, () => undefined);
    if (res.headersSent) return;
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/state", requireSession(config), (_req, res) => {
    res.json(publicState(service));
  });

  app.get("/api/events", requireSession(config), (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // The connection is gone; cleanup runs on close.
      }
    };

    send("hello", publicState(service));
    const unsubscribe = bus.subscribe((event: RequestEvent) => {
      if (event.type === "hello") return;
      if (event.type === "request.removed") {
        send("request.removed", { requestId: event.requestId });
        return;
      }
      send(event.type, event.request);
    });
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // The close handler cleans up.
      }
    }, 15_000);
    heartbeat.unref();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

  app.get("/api/requests/:id", requireSession(config), (req, res) => {
    try {
      res.json({ request: service.get(String(req.params.id)) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.post("/api/requests/:id/submit", requireSession(config), requireCsrf, (req, res) => {
    const parsed = submitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid_request", message: "Invalid submission." } });
      return;
    }
    try {
      const request = service.submit(String(req.params.id), parsed.data.values, parsed.data.confirmations);
      res.status(request.status === "executing" ? 202 : 200).json({ request });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.post("/api/requests/:id/deny", requireSession(config), requireCsrf, (req, res) => {
    const parsed = denyRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid_request", message: "Invalid denial." } });
      return;
    }
    try {
      res.json({ request: service.deny(String(req.params.id), parsed.data.reason) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.post("/api/requests/:id/cancel", requireSession(config), requireCsrf, (req, res) => {
    try {
      res.json({ request: service.cancel(String(req.params.id)) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.post("/api/agent/requests", requireMcpAuth(config), (req, res) => {
    const parsed = requestSecretInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid_request", message: "Invalid secret request.", details: issues(parsed.error) } });
      return;
    }
    try {
      const created = service.create(parsed.data, sourceFromHeaders(req, "http"));
      res.status(201).json({ request: created.request });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.get("/api/agent/requests/:id", requireMcpAuth(config), async (req, res) => {
    const wait = Math.min(45, Math.max(0, Number.parseInt(String(req.query.wait ?? "0"), 10) || 0));
    try {
      res.json(await service.wait(String(req.params.id), wait));
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.post("/api/agent/inline-requests", requireMcpAuth(config), async (req, res) => {
    const parsed = requestSecretInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid_request", message: "Invalid secret request." } });
      return;
    }
    try {
      res.status(201).json(await createLocalBackend(service).create(parsed.data, sourceFromHeaders(req, "http"), true));
    } catch (error) { sendServiceError(res, error); }
  });

  app.post("/api/agent/inline-submit", requireMcpAuth(config), (req, res) => {
    const parsed = inlineEnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "invalid_request", message: "Invalid encrypted submission." } });
      return;
    }
    try {
      res.json({ request: service.submitInline(parsed.data) });
    } catch (error) { sendServiceError(res, error); }
  });

  app.post("/api/agent/requests/:id/cancel", requireMcpAuth(config), (req, res) => {
    try {
      res.json({ request: service.cancel(String(req.params.id)) });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  app.get("/api/agent/status", requireMcpAuth(config), (_req, res) => {
    res.json({
      ok: true,
      policy: service.policyInfo(),
      pending: service.pending(),
      health: {
        version: APP_VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        pending: service.pending().length,
        instanceId: config.instanceId,
      },
      limits: { maxPending: MAX_PENDING_REQUESTS },
    });
  });

  app.post("/mcp", requireMcpAuth(config), async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    if (sessionId) {
      const session = mcpSessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: { code: "session_not_found", message: "Reconnect the MCP client." } });
        return;
      }
      session.touched = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }
    if (!isInitializeRequest(req.body) || mcpSessions.size >= 30) {
      res.status(400).json({ error: { code: "mcp_initialize_required", message: "Initialize or reconnect the MCP client." } });
      return;
    }
    const server = createMcpServer(createLocalBackend(service), sourceFromHeaders(req, "http"), { inlineEnabled: config.inputMode === "inline" });
    const close = () => {
      if (transport.sessionId) mcpSessions.delete(transport.sessionId);
      void transport.close();
      void server.close();
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(), enableJsonResponse: true,
      onsessioninitialized: (id) => { mcpSessions.set(id, { transport, close, touched: Date.now() }); },
      onsessionclosed: (id) => { mcpSessions.delete(id); },
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      close();
      logger.error(`MCP request failed: ${error instanceof Error ? error.message : "unknown error"}`);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: "mcp_error", message: "MCP request failed." } });
      } else {
        res.end();
      }
    }
  });

  app.delete("/mcp", requireMcpAuth(config), async (req, res) => {
    const session = mcpSessions.get(req.header("mcp-session-id") ?? "");
    if (!session) { res.sendStatus(404); return; }
    await session.transport.handleRequest(req, res);
    session.close();
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: { code: "method_not_allowed", message: "Use POST /mcp with the Streamable HTTP transport." } });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found." } });
  });

  const indexFile = path.join(options.webDir, "index.html");
  if (existsSync(indexFile)) {
    app.use(
      express.static(options.webDir, {
        index: false,
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store");
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (!req.accepts("html")) {
        next();
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(indexFile);
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(503)
        .type("html")
        .send(
          `<html><body style="font-family:system-ui;padding:2rem"><h1>SecureInput UI is not built</h1><p>Run <code>npm run build:web</code> or use the published package.</p></body></html>`,
        );
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found." } });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const isBodyError = (error as { type?: string }).type === "entity.too.large";
    if (isBodyError) {
      res.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large." } });
      return;
    }
    logger.error(`HTTP error on ${req.method} ${req.path}: ${error instanceof Error ? error.message : "unknown"}`);
    res.status(500).json({ error: { code: "internal_error", message: "Internal error." } });
  });

  return app;
}

function publicState(service: SecureInputService): PublicState {
  return {
    requests: service.pending(),
    history: service.historyList(),
    policy: service.policyInfo(),
    serverTime: Date.now(),
  };
}

function requireSession(config: SecureInputConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!sessionIsValid(req, config)) {
      res.status(401).json({ error: { code: "not_paired", message: "This browser is not paired. Run `secureinput pair`." } });
      return;
    }
    next();
  };
}

function requireMcpAuth(config: SecureInputConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isMcpTokenValid(config, bearerToken(req))) {
      res.status(401).json({ error: { code: "unauthorized", message: "A valid MCP token is required." } });
      return;
    }
    next();
  };
}

function requireSameOrigin(req: Request, res: Response, next: () => void): void {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== req.headers.host || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        res.status(403).json({ error: { code: "forbidden_origin", message: "Cross-origin requests are not allowed." } });
        return;
      }
    } catch {
      res.status(403).json({ error: { code: "forbidden_origin", message: "Invalid Origin header." } });
      return;
    }
  }
  next();
}

function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  requireSameOrigin(req, res, () => {
    if (res.headersSent) return;
    if (req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      res.status(403).json({ error: { code: "csrf_failed", message: "Missing CSRF header." } });
      return;
    }
    next();
  });
}

function sendServiceError(res: Response, error: unknown): void {
  if (error instanceof ServiceError) {
    const status =
      error.code === "request_not_found"
        ? 404
        : error.code === "request_not_pending"
          ? 409
          : error.code === "request_expired"
            ? 410
            : error.code === "rate_limited" || error.code === "too_many_pending"
              ? 429
              : 400;
    res.status(status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  res.status(500).json({ error: { code: "internal_error", message: "Internal error." } });
}

function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
