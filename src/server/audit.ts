import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "../shared/redaction";
import type { AuditEvent } from "../shared/types";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

function rotate(filePath: string): void {
  try {
    if (existsSync(filePath) && statSync(filePath).size > MAX_LOG_BYTES) {
      renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    // Rotation is best effort.
  }
}

export class Logger {
  constructor(private readonly filePath: string | null) {
    if (filePath) mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  private write(level: string, message: string): void {
    const line = `${new Date().toISOString()} ${level} ${message}`;
    if (this.filePath) {
      try {
        rotate(this.filePath);
        appendFileSync(this.filePath, `${line}\n`, { mode: 0o600 });
        if (process.platform !== "win32") chmodSync(this.filePath, 0o600);
      } catch {
        // Logging must never break a request.
      }
    }
    if (level === "ERROR") console.error(line);
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }
}

export class AuditLog {
  constructor(
    private readonly filePath: string | null,
    private readonly enabled: boolean,
  ) {
    if (filePath) mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  append(event: AuditEvent): void {
    if (!this.enabled || !this.filePath) return;
    const safe: AuditEvent = {
      ...event,
      delivery: event.delivery
        ? {
            ...event.delivery,
            command: event.delivery.command ? redactSecrets(event.delivery.command, []) : undefined,
          }
        : undefined,
    };
    try {
      rotate(this.filePath);
      appendFileSync(this.filePath, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
      if (process.platform !== "win32") chmodSync(this.filePath, 0o600);
    } catch {
      // Audit failures are reported by the logger, never by leaking data.
    }
  }
}
