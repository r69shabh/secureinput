import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { APP_VERSION, DEFAULT_PORT } from "../shared/constants";

const configFileSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535),
  mcpToken: z.string().min(32),
  pairingToken: z.string().min(32),
  sessionSecret: z.string().min(32),
  allowedRoots: z.array(z.string().min(1)).min(1),
  allowReturn: z.boolean(),
  openBrowser: z.boolean(),
  audit: z.boolean(),
  inputMode: z.enum(["browser", "inline"]).default("inline"),
});

export type SecureInputConfigFile = z.infer<typeof configFileSchema>;

export interface SecureInputConfig extends SecureInputConfigFile {
  home: string;
  configPath: string;
  runtimePath: string;
  auditPath: string;
  logPath: string;
  instanceId: string;
}

export interface ConfigOverrides {
  home?: string;
  port?: number;
  roots?: string[];
  allowReturn?: boolean;
  openBrowser?: boolean;
  audit?: boolean;
  inputMode?: "browser" | "inline";
}

export function resolveHome(override?: string): string {
  return path.resolve(override ?? process.env.SECUREINPUT_HOME ?? path.join(homedir(), ".secureinput"));
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

function resolveExisting(pathValue: string): string {
  return path.resolve(pathValue);
}

export function loadConfig(overrides: ConfigOverrides = {}): SecureInputConfig {
  const home = resolveHome(overrides.home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configPath = path.join(home, "config.json");
  const runtimePath = path.join(home, "runtime.json");
  const auditPath = path.join(home, "audit.jsonl");
  const logPath = path.join(home, "server.log");

  let file: SecureInputConfigFile;
  if (existsSync(configPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      throw new Error(`Cannot read ${configPath}. Fix or remove it, then run secureinput again.`);
    }
    const result = configFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid config at ${configPath}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    file = result.data;
    if (process.platform !== "win32") {
      const mode = statSync(configPath).mode & 0o777;
      if ((mode & 0o077) !== 0) chmodSync(configPath, 0o600);
    }
  } else {
    file = {
      version: 1,
      port: overrides.port ?? DEFAULT_PORT,
      mcpToken: token(),
      pairingToken: token(),
      sessionSecret: token(),
      allowedRoots: overrides.roots?.length ? overrides.roots.map(resolveExisting) : [homedir()],
      allowReturn: overrides.allowReturn ?? false,
      openBrowser: overrides.openBrowser ?? true,
      audit: overrides.audit ?? true,
      inputMode: overrides.inputMode ?? "inline",
    };
    saveConfigFile(configPath, file);
  }

  const config: SecureInputConfig = {
    ...file,
    home,
    configPath,
    runtimePath,
    auditPath,
    logPath,
    instanceId: randomUUID(),
  };

  if (overrides.port !== undefined) config.port = overrides.port;
  if (overrides.roots?.length) {
    config.allowedRoots = overrides.roots.map(resolveExisting);
    file.allowedRoots = config.allowedRoots;
  }
  if (overrides.allowReturn !== undefined) {
    config.allowReturn = overrides.allowReturn;
    file.allowReturn = overrides.allowReturn;
  }
  if (overrides.openBrowser !== undefined) {
    config.openBrowser = overrides.openBrowser;
    file.openBrowser = overrides.openBrowser;
  }
  if (overrides.audit !== undefined) {
    config.audit = overrides.audit;
    file.audit = overrides.audit;
  }
  if (overrides.inputMode !== undefined) {
    config.inputMode = overrides.inputMode;
    file.inputMode = overrides.inputMode;
  }

  if (overrides.roots?.length || overrides.allowReturn !== undefined || overrides.openBrowser !== undefined || overrides.audit !== undefined || overrides.inputMode !== undefined) {
    saveConfigFile(configPath, file);
  }

  return config;
}

function saveConfigFile(configPath: string, file: SecureInputConfigFile): void {
  const temp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, configPath);
  if (process.platform !== "win32") chmodSync(configPath, 0o600);
}

export interface RuntimeInfo {
  port: number;
  pid: number;
  startedAt: number;
  instanceId: string;
  version: string;
}

export function writeRuntime(config: SecureInputConfig): void {
  const info: RuntimeInfo = {
    port: config.port,
    pid: process.pid,
    startedAt: Date.now(),
    instanceId: config.instanceId,
    version: APP_VERSION,
  };
  const temp = `${config.runtimePath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, config.runtimePath);
}

export function readRuntime(config: SecureInputConfig): RuntimeInfo | null {
  if (!existsSync(config.runtimePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(config.runtimePath, "utf8")) as RuntimeInfo;
    if (!Number.isInteger(parsed.port) || !Number.isInteger(parsed.pid)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRuntime(config: SecureInputConfig): void {
  try {
    if (existsSync(config.runtimePath)) {
      const current = readRuntime(config);
      if (!current || current.pid === process.pid) {
        unlinkSync(config.runtimePath);
      }
    }
  } catch {
    // Best effort.
  }
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}
