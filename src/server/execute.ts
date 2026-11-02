import { spawn, type ChildProcess } from "node:child_process";
import { MAX_OUTPUT_BYTES } from "../shared/constants";
import { sanitizeOutput } from "../shared/redaction";
import type { ExecuteDelivery } from "../shared/schemas";
import type { ExecutionResult, RequestResult } from "../shared/types";
import { renderTemplate } from "../shared/validation";

export interface ExecuteOptions {
  cwd: string;
  values: Record<string, string>;
  timeoutSeconds: number;
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
}

export async function executeDelivery(delivery: ExecuteDelivery, options: ExecuteOptions): Promise<RequestResult> {
  const args = delivery.args.map((arg) => renderTemplate(arg, options.values));
  const stdin = delivery.stdin !== undefined ? renderTemplate(delivery.stdin, options.values) : undefined;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    TERM: "dumb",
    CI: process.env.CI ?? "1",
  };
  for (const [key, template] of Object.entries(delivery.env ?? {})) {
    childEnv[key] = renderTemplate(template, options.values);
  }

  const startedAt = Date.now();
  const secrets = Object.values(options.values);

  return await new Promise<RequestResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnError: Error | null = null;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    let child: ChildProcess;
    try {
      child = spawn(delivery.command, args, {
        cwd: options.cwd,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      resolve(failedResult(error instanceof Error ? error.message : "Could not start the command.", startedAt));
      return;
    }

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const execution: ExecutionResult = {
        exitCode,
        signal: signal ?? null,
        stdout: sanitizeOutput(stdout, secrets, MAX_OUTPUT_BYTES),
        stderr: sanitizeOutput(stderr, secrets, MAX_OUTPUT_BYTES),
        truncated,
        timedOut,
        durationMs,
      };
      const ok = !spawnError && !timedOut && exitCode === 0;
      let message = ok ? "Command completed successfully." : `Command exited with code ${exitCode ?? "unknown"}.`;
      if (timedOut) message = `Command timed out after ${options.timeoutSeconds}s and was stopped.`;
      if (spawnError) message = `Could not start the command: ${spawnError.message}`;
      if (truncated) message += " Output was truncated.";
      resolve({ ok, status: ok ? "completed" : "failed", message, execution });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 3000).unref();
    }, options.timeoutSeconds * 1000);

    child.on("error", (error) => {
      spawnError = error;
      finish(null, null);
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const slice = text.slice(0, remaining);
      stdout += slice;
      stdoutBytes += Buffer.byteLength(slice);
      if (slice.length < text.length) truncated = true;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - stderrBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const slice = text.slice(0, remaining);
      stderr += slice;
      stderrBytes += Buffer.byteLength(slice);
      if (slice.length < text.length) truncated = true;
    });

    child.on("close", (code, signal) => finish(code, signal));
    child.stdin?.on("error", () => {
      // Commands are allowed to exit without reading stdin.
    });
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }
  });
}

function failedResult(message: string, startedAt: number): RequestResult {
  return {
    ok: false,
    status: "failed",
    message,
    execution: {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      truncated: false,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    },
  };
}
