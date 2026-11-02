import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { loadConfig, type SecureInputConfig } from "../src/server/config";
import { startServer, type StartedServer } from "../src/server";
import type { PublicSecretRequest } from "../src/shared/types";

export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

export interface TestServer {
  started: StartedServer;
  config: SecureInputConfig;
  base: string;
  home: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const home = await mkdtemp(path.join(tmpdir(), "secureinput-test-"));
  const port = await freePort();
  const config = loadConfig({ home, port, roots: [home], openBrowser: false, audit: false });
  const started = await startServer({
    config,
    webDir: path.join(home, "missing-web"),
    openBrowser: false,
    handleSignals: false,
  });
  return {
    started,
    config,
    base: `http://127.0.0.1:${port}`,
    home,
    close: async () => {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    },
  };
}

export async function pair(base: string, token: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error(`pair failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("pair did not set a cookie");
  return cookie.split(";")[0] ?? "";
}

export async function createWithAgent(test: TestServer, body: unknown): Promise<{ request: PublicSecretRequest }> {
  const response = await fetch(`${test.base}/api/agent/requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${test.config.mcpToken}`,
      "content-type": "application/json",
      "x-secureinput-client-name": "Test Agent",
      "x-secureinput-cwd": test.home,
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { request?: PublicSecretRequest; error?: { message: string } };
  if (!response.ok || !json.request) throw new Error(json.error?.message ?? `create failed: ${response.status}`);
  return { request: json.request };
}

export async function submit(
  test: TestServer,
  cookie: string,
  requestId: string,
  values: Record<string, string>,
  confirmations?: Record<string, boolean>,
): Promise<Response> {
  return await fetch(`${test.base}/api/requests/${encodeURIComponent(requestId)}/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: test.base,
      "x-secureinput-csrf": "1",
    },
    body: JSON.stringify({ values, confirmations }),
  });
}

export async function waitForTerminal(
  test: TestServer,
  cookie: string,
  requestId: string,
  timeoutMs = 5000,
): Promise<PublicSecretRequest> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${test.base}/api/requests/${encodeURIComponent(requestId)}`, {
      headers: { cookie },
    });
    const json = (await response.json()) as { request?: PublicSecretRequest };
    const request = json.request;
    if (request && request.status !== "pending" && request.status !== "executing") return request;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("request did not finish");
}
