#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Command, Option } from "commander";
import open from "open";
import { APP_NAME, APP_VERSION } from "../shared/constants";
import type { HealthInfo } from "../shared/types";
import { runStdioMcp } from "../mcp/stdio";
import {
  fetchHealth,
  isDaemonHealthy,
  pairingUrl,
  startServer,
  stopServer,
} from "../server";
import {
  clearRuntime,
  loadConfig,
  processIsAlive,
  readRuntime,
  type RuntimeInfo,
  type SecureInputConfig,
} from "../server/config";

const program = new Command();

program
  .name("secureinput")
  .description("Secure secret input for AI coding agents over MCP")
  .version(APP_VERSION)
  .showHelpAfterError();

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535.");
  return port;
}

program
  .command("serve")
  .description("Start the local SecureInput daemon and browser UI")
  .option("-p, --port <port>", "loopback port", parsePort)
  .option("--root <path>", "allowed root for commands and env files (repeatable)", collect, [])
  .option("--allow-return", "allow agents to receive secret values (dangerous)", undefined)
  .addOption(new Option("--input-mode <mode>", "input preference (inline requires a compatible, trusted MCP host)").choices(["browser", "inline"]))
  .option("--no-open", "do not open the browser automatically")
  .option("--no-audit", "disable the audit log")
  .option("--home <path>", "SecureInput config directory")
  .option("--web-dir <path>", "built web UI directory")
  .option("--daemon", "run as a background daemon")
  .action(async (options: {
    port?: number;
    root: string[];
    allowReturn?: boolean;
    inputMode?: "browser" | "inline";
    open: boolean;
    audit: boolean;
    home?: string;
    webDir?: string;
    daemon?: boolean;
  }) => {
    const config = loadConfig({
      home: options.home,
      port: options.port,
      roots: options.root.length > 0 ? options.root : undefined,
      allowReturn: options.allowReturn,
      inputMode: options.inputMode,
      openBrowser: options.open,
      audit: options.audit,
    });

    const health = await fetchHealth(config.port);
    if (health) {
      const runtime = readRuntime(config);
      if (runtime?.instanceId === health.instanceId) {
        console.log(`SecureInput is already running at http://127.0.0.1:${health.port}/`);
        console.log(`Pair this browser: ${pairingUrl({ ...config, port: health.port })}`);
        if (!options.daemon) console.log(`Config: ${config.configPath}`);
        return;
      }
      throw new Error(`Port ${config.port} is used by another SecureInput instance or process. Use --port.`);
    }

    const started = await startServer({
      config,
      webDir: options.webDir,
      openBrowser: options.open,
      daemon: options.daemon,
    });
    console.log(`${APP_NAME} ${APP_VERSION} is running at ${started.url}`);
    console.log(`Pair this browser: ${started.pairingUrl}`);
    console.log(`Config: ${config.configPath}`);
    console.log("Press Ctrl+C to stop.");
  });

program
  .command("mcp")
  .description("Run the stdio MCP bridge (auto-starts the daemon)")
  .option("--home <path>", "SecureInput config directory")
  .option("-p, --port <port>", "daemon port", parsePort)
  .option("--client-name <name>", "client name shown in the UI")
  .option("--client-version <version>", "client version shown in the UI")
  .action(async (options: McpOptions) => {
    const config = loadConfig({ home: options.home, port: options.port });
    let runtime: RuntimeInfo;
    try {
      runtime = await ensureDaemon(config);
    } catch (error) {
      console.error(`[secureinput] ${error instanceof Error ? error.message : "Could not start the daemon."}`);
      process.exit(1);
    }
    await runStdioMcp({
      port: runtime.port,
      token: config.mcpToken,
      cwd: process.cwd(),
      clientName: options.clientName ?? process.env.SECUREINPUT_CLIENT_NAME,
      clientVersion: options.clientVersion ?? process.env.SECUREINPUT_CLIENT_VERSION,
      inputMode: config.inputMode,
    });
  });

program
  .command("settings")
  .description("Show or change the input preference; restart the daemon and reconnect MCP clients after changes")
  .option("--home <path>", "SecureInput config directory")
  .addOption(new Option("--input-mode <mode>", "browser (default) or encrypted inline input").choices(["browser", "inline"]))
  .action((options: { home?: string; inputMode?: "browser" | "inline" }) => {
    const config = loadConfig({ home: options.home, inputMode: options.inputMode });
    console.log(`Input mode: ${config.inputMode}`);
    if (options.inputMode) console.log("Saved. Restart the daemon and reconnect MCP clients to apply.");
  });

program
  .command("pair")
  .description("Print and open the browser pairing URL")
  .option("--home <path>", "SecureInput config directory")
  .option("-p, --port <port>", "daemon port", parsePort)
  .option("--no-open", "do not open the browser")
  .action(async (options: { home?: string; port?: number; open: boolean }) => {
    const config = loadConfig({ home: options.home, port: options.port });
    const runtime = await ensureDaemon(config);
    const url = pairingUrl({ ...config, port: runtime.port });
    console.log(`Pair this browser: ${url}`);
    if (options.open) {
      await open(url).catch(() => console.error("Could not open the browser. Copy the URL above."));
    }
  });

program
  .command("status")
  .description("Show daemon status and pending requests")
  .option("--home <path>", "SecureInput config directory")
  .option("-p, --port <port>", "daemon port", parsePort)
  .action(async (options: { home?: string; port?: number }) => {
    const config = loadConfig({ home: options.home, port: options.port });
    const runtime = readRuntime(config);
    const port = runtime?.port ?? config.port;
    const health = await fetchHealth(port);
    if (!health) {
      console.log("SecureInput is not running.");
      console.log(`Start it with: secureinput serve`);
      return;
    }
    const status = await fetch(`http://127.0.0.1:${port}/api/agent/status`, {
      headers: { Authorization: `Bearer ${config.mcpToken}` },
      signal: AbortSignal.timeout(2000),
    })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    printStatus(health, config, status as AgentStatus | null);
  });

program
  .command("stop")
  .description("Stop the running daemon")
  .option("--home <path>", "SecureInput config directory")
  .option("-p, --port <port>", "daemon port", parsePort)
  .action(async (options: { home?: string; port?: number }) => {
    const config = loadConfig({ home: options.home, port: options.port });
    const stopped = await stopServer(config);
    if (stopped) {
      clearRuntime(config);
      console.log("SecureInput stopped.");
    } else {
      console.log("SecureInput was not running.");
    }
  });

program
  .command("doctor")
  .description("Check the local installation")
  .option("--home <path>", "SecureInput config directory")
  .action(async (options: { home?: string }) => {
    const config = loadConfig({ home: options.home });
    const runtime = readRuntime(config);
    const port = runtime?.port ?? config.port;
    const health = await fetchHealth(port);
    const checks = [
      ["Node.js >= 22", Number(process.versions.node.split(".")[0]) >= 22],
      ["Config directory exists", true],
      ["Daemon reachable", health !== null],
      ["Runtime PID alive", runtime ? processIsAlive(runtime.pid) : false],
    ] as const;
    for (const [label, ok] of checks) console.log(`${ok ? "ok" : "--"}  ${label}`);
    console.log(`Config: ${config.configPath}`);
    if (runtime) console.log(`Runtime: pid ${runtime.pid}, port ${runtime.port}`);
    if (!health) console.log("Start the daemon with: secureinput serve");
  });

interface McpOptions {
  home?: string;
  port?: number;
  clientName?: string;
  clientVersion?: string;
}

interface AgentStatus {
  policy?: { allowedRoots?: string[]; allowReturn?: boolean };
  pending?: { id: string; title: string; status: string; source?: { clientName?: string } }[];
}

function printStatus(health: HealthInfo, config: SecureInputConfig, status: AgentStatus | null): void {
  console.log(`${APP_NAME} ${health.version} — pid ${health.pid}, port ${config.port}, up ${health.uptimeSeconds}s`);
  console.log(`Config: ${config.configPath}`);
  if (status?.policy) {
    console.log(`Allowed roots: ${(status.policy.allowedRoots ?? []).join(", ")}`);
    console.log(`Return mode: ${status.policy.allowReturn ? "enabled (dangerous)" : "disabled"}`);
  }
  const pending = status?.pending ?? [];
  console.log(`Pending requests: ${pending.length}`);
  for (const request of pending) {
    console.log(`  ${request.id}  ${request.status}  ${request.title}  (${request.source?.clientName ?? "agent"})`);
  }
}

async function ensureDaemon(config: SecureInputConfig): Promise<RuntimeInfo> {
  const runtime = readRuntime(config);
  if (runtime && (await isDaemonHealthy(runtime.port))) {
    return { ...runtime, port: runtime.port };
  }
  if (await isDaemonHealthy(config.port)) {
    return {
      port: config.port,
      pid: runtime?.pid ?? 0,
      startedAt: runtime?.startedAt ?? Date.now(),
      instanceId: runtime?.instanceId ?? "",
      version: APP_VERSION,
    };
  }

  const cliPath = process.argv[1];
  if (!cliPath) throw new Error("Cannot locate the SecureInput CLI entry point.");
  const isTypeScript = cliPath.endsWith(".ts");
  const args = isTypeScript
    ? ["--import", "tsx", cliPath, "serve", "--home", config.home, "--port", String(config.port)]
    : [cliPath, "serve", "--home", config.home, "--port", String(config.port)];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const health = await fetchHealth(config.port);
    if (health) {
      return {
        port: health.port,
        pid: health.pid,
        startedAt: runtime?.startedAt ?? Date.now(),
        instanceId: health.instanceId,
        version: health.version,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `SecureInput daemon did not start. See ${config.logPath} or run \`secureinput serve --no-open\` to see the error.`,
  );
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`[secureinput] ${error instanceof Error ? error.message : "Unexpected error."}`);
  process.exit(1);
});
