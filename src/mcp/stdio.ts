import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  AgentRequestResult,
  PublicSecretRequest,
  RequestSource,
  ServerPolicyInfo,
} from "../shared/types";
import { createMcpServer, type McpBackend } from "../server/mcp";
import { ServiceError } from "../server/service";
import type { InlineGrant } from "../shared/inline";

export interface RemoteBackendOptions {
  port: number;
  token: string;
  cwd: string;
  clientName?: string;
  clientVersion?: string;
  inputMode?: "browser" | "inline";
}

export function createRemoteBackend(options: RemoteBackendOptions): McpBackend {
  const base = `http://127.0.0.1:${options.port}`;
  const sessionId = randomUUID();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    "Content-Type": "application/json",
    "X-SecureInput-Client-Name": options.clientName ?? "Coding agent",
    "X-SecureInput-Session": sessionId,
    "X-SecureInput-CWD": options.cwd,
  };
  if (options.clientVersion) headers["X-SecureInput-Client-Version"] = options.clientVersion;

  async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ServiceError(
        "daemon_unavailable",
        "SecureInput daemon is not reachable. Run `secureinput pair` or restart the MCP server.",
      );
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // The status code below provides the useful error.
    }
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ServiceError(error?.code ?? "remote_error", error?.message ?? `SecureInput returned HTTP ${response.status}.`, error?.details);
    }
    return body as T;
  }

  return {
    async create(input, _source: RequestSource, inline = false) {
      return request<{ request: PublicSecretRequest; inline?: InlineGrant }>(
        inline ? "/api/agent/inline-requests" : "/api/agent/requests",
        { method: "POST", body: JSON.stringify(input) },
        15_000,
      );
    },
    async submitInline(envelope) {
      const result = await request<{ request: PublicSecretRequest }>("/api/agent/inline-submit", {
        method: "POST", body: JSON.stringify(envelope),
      }, 15_000);
      return result.request;
    },
    async wait(requestId, waitSeconds) {
      return request<AgentRequestResult>(
        `/api/agent/requests/${encodeURIComponent(requestId)}?wait=${waitSeconds}`,
        { method: "GET" },
        (waitSeconds + 15) * 1000,
      );
    },
    async cancel(requestId) {
      const result = await request<{ request: PublicSecretRequest }>(
        `/api/agent/requests/${encodeURIComponent(requestId)}/cancel`,
        { method: "POST" },
        15_000,
      );
      return result.request;
    },
    async status() {
      return request<{ policy: ServerPolicyInfo; pending: PublicSecretRequest[] }>(
        "/api/agent/status",
        { method: "GET" },
        15_000,
      );
    },
  };
}

export async function runStdioMcp(options: RemoteBackendOptions): Promise<void> {
  const backend = createRemoteBackend(options);
  const server = createMcpServer(backend, {
    via: "stdio",
    cwd: options.cwd,
    clientName: options.clientName,
    clientVersion: options.clientVersion,
    sessionId: randomUUID(),
  }, { inlineEnabled: options.inputMode === "inline" });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
