import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import path from "node:path";
import open from "open";
import { APP_NAME, APP_VERSION } from "../shared/constants";
import type { HealthInfo } from "../shared/types";
import { createApp } from "./app";
import { AuditLog, Logger } from "./audit";
import {
  clearRuntime,
  processIsAlive,
  readRuntime,
  writeRuntime,
  type RuntimeInfo,
  type SecureInputConfig,
} from "./config";
import { EventBus } from "./events";
import { buildPolicy, type Policy } from "./policy";
import { SecureInputService } from "./service";

export interface StartedServer {
  server: Server;
  service: SecureInputService;
  config: SecureInputConfig;
  policy: Policy;
  logger: Logger;
  url: string;
  pairingUrl: string;
  runtime: RuntimeInfo;
}

export interface StartOptions {
  config: SecureInputConfig;
  webDir?: string;
  openBrowser?: boolean;
  daemon?: boolean;
  handleSignals?: boolean;
}

export function pairingUrl(config: SecureInputConfig): string {
  return `http://127.0.0.1:${config.port}/#pair=${encodeURIComponent(config.pairingToken)}`;
}

export function findWebDir(): string {
  const candidates = [
    process.env.SECUREINPUT_WEB_DIR,
    path.resolve(import.meta.dirname, "../web"),
    path.resolve(import.meta.dirname, "../../dist/web"),
    path.resolve(process.cwd(), "dist/web"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return candidates[1] ?? path.resolve(process.cwd(), "dist/web");
}

export async function startServer(options: StartOptions): Promise<StartedServer> {
  const { config } = options;
  const logger = new Logger(config.logPath);
  const audit = new AuditLog(config.auditPath, config.audit);
  const policy = buildPolicy(config, process.cwd());
  const bus = new EventBus();
  const service = new SecureInputService({ config, policy, audit, bus });
  const webDir = options.webDir ?? findWebDir();
  const app = createApp({
    config,
    policy,
    service,
    bus,
    audit,
    logger,
    webDir,
    startedAt: Date.now(),
  });

  const server = createHttpServer(app);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`Port ${config.port} is already in use. Stop the other process or use --port.`)
          : error,
      );
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, "127.0.0.1");
  });

  writeRuntime(config);
  const url = `http://127.0.0.1:${config.port}/`;
  const pairUrl = pairingUrl(config);

  logger.info(`${APP_NAME} ${APP_VERSION} listening on ${url}`);
  logger.info(`Pairing URL written for the browser (contains a token; do not share).`);

  if (options.openBrowser !== false && config.openBrowser && process.env.SECUREINPUT_NO_OPEN !== "1") {
    void open(pairUrl).catch(() => {
      logger.warn("Could not open the browser automatically. Run `secureinput pair`.");
    });
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`Shutting down (${signal}).`);
    clearRuntime(config);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };
  if (options.handleSignals !== false) {
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  } else {
    server.on("close", () => clearRuntime(config));
  }

  return {
    server,
    service,
    config,
    policy,
    logger,
    url,
    pairingUrl: pairUrl,
    runtime: {
      port: config.port,
      pid: process.pid,
      startedAt: Date.now(),
      instanceId: config.instanceId,
      version: APP_VERSION,
    },
  };
}

export async function stopServer(config: SecureInputConfig): Promise<boolean> {
  const runtime = readRuntime(config);
  if (!runtime || !processIsAlive(runtime.pid)) {
    clearRuntime(config);
    return false;
  }
  try {
    process.kill(runtime.pid, "SIGTERM");
  } catch {
    return false;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!processIsAlive(runtime.pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  clearRuntime(config);
  return true;
}

export async function fetchHealth(port: number): Promise<HealthInfo | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const body = (await response.json()) as HealthInfo;
    return body.name === "SecureInput" ? body : null;
  } catch {
    return null;
  }
}

export async function isDaemonHealthy(port: number): Promise<boolean> {
  return (await fetchHealth(port)) !== null;
}
