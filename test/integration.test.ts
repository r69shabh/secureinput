import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startTestServer, pair, createWithAgent, submit, waitForTerminal } from "./helpers";
import { AuditLog } from "../src/server/audit";
import { EventBus } from "../src/server/events";
import { SecureInputService } from "../src/server/service";
import { requestSecretInputSchema } from "../src/shared/schemas";

const executeBody = (command: string, args: string[], stdin: string) => ({
  title: "Test secret",
  description: "Integration test",
  fields: [{ id: "token", label: "Token", type: "password", required: true }],
  delivery: { mode: "execute", command, args, stdin, timeoutSeconds: 10 },
  timeoutSeconds: 120,
  waitSeconds: 0,
});

test("requests open the paired local UI without putting tokens or request data in the URL", async () => {
  const opened: string[] = [];
  const testServer = await startTestServer({ openBrowser: true, openUrl: async (url) => { opened.push(url); } });
  try {
    assert.equal(opened[0], `${testServer.base}/#pair=${testServer.config.pairingToken}`);
    await createWithAgent(testServer, executeBody(process.execPath, [], "{{token}}"));
    assert.deepEqual(opened.slice(1), [`${testServer.base}/`]);
  } finally {
    await testServer.close();
  }
});

test("disabled browser opening also applies to new requests", async () => {
  const opened: string[] = [];
  const testServer = await startTestServer({ openUrl: async (url) => { opened.push(url); } });
  try {
    await createWithAgent(testServer, executeBody(process.execPath, [], "{{token}}"));
    assert.deepEqual(opened, []);
  } finally {
    await testServer.close();
  }
});

test("execute flow delivers stdin, redacts output, and is one-time", async () => {
  const testServer = await startTestServer();
  try {
    const unauthorized = await fetch(`${testServer.base}/api/state`);
    assert.equal(unauthorized.status, 401);

    const cookie = await pair(testServer.base, testServer.config.pairingToken);
    const created = await createWithAgent(
      testServer,
      executeBody(
        process.execPath,
        ["-e", "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('token='+d))"],
        "{{token}}",
      ),
    );
    assert.equal(created.request.status, "pending");

    const state = await (await fetch(`${testServer.base}/api/state`, { headers: { cookie } })).json();
    assert.equal((state as { requests: unknown[] }).requests.length, 1);

    const secret = "super-secret-value-123";
    const response = await submit(testServer, cookie, created.request.id, { token: secret }, { reviewedCommand: true });
    assert.equal(response.status, 202);
    const finished = await waitForTerminal(testServer, cookie, created.request.id);
    assert.equal(finished.status, "completed");
    const stdout = (finished.result as { execution?: { stdout?: string } } | undefined)?.execution?.stdout ?? "";
    assert.match(stdout, /token=\[REDACTED\]/);
    assert.equal(stdout.includes(secret), false);

    const second = await submit(testServer, cookie, created.request.id, { token: secret });
    assert.equal(second.status, 409);

    const agentResult = await fetch(`${testServer.base}/api/agent/requests/${created.request.id}?wait=0`, {
      headers: { authorization: `Bearer ${testServer.config.mcpToken}` },
    });
    const agentJson = (await agentResult.json()) as { request: { status: string }; returned?: unknown };
    assert.equal(agentJson.request.status, "completed");
    assert.equal(agentJson.returned, undefined);
  } finally {
    await testServer.close();
  }
});

test("high-risk execute requires explicit command confirmation", async () => {
  const testServer = await startTestServer();
  try {
    const cookie = await pair(testServer.base, testServer.config.pairingToken);
    const created = await createWithAgent(
      testServer,
      executeBody("sh", ["-c", "cat"], "{{token}}"),
    );
    assert.equal((created.request.risk as { level: string }).level, "high");

    const rejected = await submit(testServer, cookie, created.request.id, { token: "abc" });
    assert.equal(rejected.status, 400);
    assert.equal(((await rejected.json()) as { error: { code: string } }).error.code, "confirmation_required");

    const accepted = await submit(testServer, cookie, created.request.id, { token: "abc" }, { reviewedCommand: true });
    assert.equal(accepted.status, 202);
    const finished = await waitForTerminal(testServer, cookie, created.request.id);
    assert.equal(finished.status, "completed");
  } finally {
    await testServer.close();
  }
});

test("env write preserves comments, sets 0600, and requires overwrite confirmation", async () => {
  const testServer = await startTestServer();
  try {
    const cookie = await pair(testServer.base, testServer.config.pairingToken);
    const envPath = path.join(testServer.home, ".env.local");
    await writeFile(envPath, "# keep this\nFOO=bar\n", "utf8");

    const body = {
      title: "Store key",
      description: "Store the key for later",
      cwd: testServer.home,
      fields: [{ id: "token", label: "Token", type: "password", required: true }],
      delivery: { mode: "write_env", path: ".env.local", mapping: { token: "NEW_API_KEY" }, overwrite: false },
      timeoutSeconds: 120,
      waitSeconds: 0,
    };
    const created = await createWithAgent(testServer, body);
    const accepted = await submit(testServer, cookie, created.request.id, { token: "env-secret" });
    assert.equal(accepted.status, 202);
    const finished = await waitForTerminal(testServer, cookie, created.request.id);
    assert.equal(finished.status, "completed");

    const content = await readFile(envPath, "utf8");
    assert.match(content, /# keep this/);
    assert.match(content, /FOO=bar/);
    assert.match(content, /NEW_API_KEY=env-secret/);
    const mode = (await stat(envPath)).mode & 0o777;
    assert.equal(mode, 0o600);

    const conflict = await fetch(`${testServer.base}/api/agent/requests`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${testServer.config.mcpToken}`,
        "content-type": "application/json",
        "x-secureinput-cwd": testServer.home,
      },
      body: JSON.stringify(body),
    });
    assert.equal(conflict.status, 400);
    assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, "env_key_exists");

    const overwriteRequest = await createWithAgent(testServer, {
      ...body,
      delivery: { ...body.delivery, overwrite: true },
    });
    const noConfirm = await submit(testServer, cookie, overwriteRequest.request.id, { token: "replacement" });
    assert.equal(noConfirm.status, 400);
    assert.equal(((await noConfirm.json()) as { error: { code: string } }).error.code, "confirmation_required");
    const confirmed = await submit(testServer, cookie, overwriteRequest.request.id, { token: "replacement" }, { overwrite: true });
    assert.equal(confirmed.status, 202);
    await waitForTerminal(testServer, cookie, overwriteRequest.request.id);
    assert.match(await readFile(envPath, "utf8"), /NEW_API_KEY=replacement/);
  } finally {
    await testServer.close();
  }
});

test("deny, auth, CSRF, origin, and SSE behavior", async () => {
  const testServer = await startTestServer();
  try {
    const badPair = await fetch(`${testServer.base}/api/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: testServer.base },
      body: JSON.stringify({ token: "wrong" }),
    });
    assert.equal(badPair.status, 401);

    const cookie = await pair(testServer.base, testServer.config.pairingToken);
    const created = await createWithAgent(testServer, executeBody("sh", ["-c", "cat"], "{{token}}"));

    const noCsrf = await fetch(`${testServer.base}/api/requests/${created.request.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: testServer.base },
      body: JSON.stringify({ values: { token: "x" } }),
    });
    assert.equal(noCsrf.status, 403);

    const differentOrigin = await fetch(`${testServer.base}/api/requests/${created.request.id}/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://evil.example",
        "x-secureinput-csrf": "1",
      },
      body: JSON.stringify({ values: { token: "x" } }),
    });
    assert.equal(differentOrigin.status, 403);

    const denied = await fetch(`${testServer.base}/api/requests/${created.request.id}/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: testServer.base, "x-secureinput-csrf": "1" },
      body: JSON.stringify({ reason: "not needed" }),
    });
    assert.equal(denied.status, 200);
    assert.equal(((await denied.json()) as { request: { status: string } }).request.status, "denied");

    const controller = new AbortController();
    const sse = await fetch(`${testServer.base}/api/events`, { headers: { cookie }, signal: controller.signal });
    assert.equal(sse.status, 200);
    const reader = sse.body?.getReader();
    assert.ok(reader);
    let text = "";
    const deadline = Date.now() + 3000;
    while (!text.includes("event: hello") && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    assert.match(text, /event: hello/);
    assert.match(text, /"history"/);
  } finally {
    await testServer.close();
  }
});

test("expired requests cannot be submitted", async () => {
  const testServer = await startTestServer();
  try {
    const clock = { value: Date.now() };
    const service = new SecureInputService({
      config: testServer.config,
      policy: testServer.started.policy,
      audit: new AuditLog(null, false),
      bus: new EventBus(),
      now: () => clock.value,
    });
    const input = requestSecretInputSchema.parse(executeBody("sh", ["-c", "cat"], "{{token}}"));
    const created = service.create(input, { via: "stdio", clientName: "Expiry test", cwd: testServer.home });
    clock.value += 200_000;
    assert.throws(() => service.submit(created.request.id, { token: "x" }), /expired/i);
    assert.equal(service.get(created.request.id).status, "expired");
  } finally {
    await testServer.close();
  }
});

test("MCP Streamable HTTP exposes tools and completes a request", async () => {
  const testServer = await startTestServer();
  try {
    const cookie = await pair(testServer.base, testServer.config.pairingToken);
    const transport = new StreamableHTTPClientTransport(new URL(`${testServer.base}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${testServer.config.mcpToken}`,
          "x-secureinput-cwd": testServer.home,
        },
      },
    });
    const client = new Client({ name: "mcp-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      assert.ok(names.includes("request_secret"));
      assert.ok(names.includes("check_secret_request"));
      assert.ok(names.includes("cancel_secret_request"));
      assert.ok(names.includes("secureinput_status"));

      const result = await client.callTool({
        name: "request_secret",
        arguments: {
          ...executeBody(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], "{{token}}"),
          waitSeconds: 0,
        },
      });
      const resultContent = result.content as { type: string; text: string }[];
      const payload = JSON.parse(resultContent[0]!.text) as {
        requestId: string;
        error?: unknown;
      };
      assert.ok(payload.requestId, resultContent[0]!.text);
      const requestId = payload.requestId;
      assert.ok(requestId);

      const submitted = await submit(
        testServer,
        cookie,
        requestId,
        { token: "mcp-secret-value" },
        testServer.started.service.get(requestId).risk.level === "high" ? { reviewedCommand: true } : undefined,
      );
      assert.equal(submitted.status, 202);

      const checked = await client.callTool({
        name: "check_secret_request",
        arguments: { requestId, waitSeconds: 10 },
      });
      const checkedContent = checked.content as { type: string; text: string }[];
      const checkedText = checkedContent[0]!.text;
      const checkedPayload = JSON.parse(checkedText) as { status: string; returned?: unknown };
      assert.equal(checkedPayload.status, "completed");
      assert.equal(checkedPayload.returned, undefined);
      assert.equal(checkedText.includes("mcp-secret-value"), false);
    } finally {
      await client.close();
    }
  } finally {
    await testServer.close();
  }
});
