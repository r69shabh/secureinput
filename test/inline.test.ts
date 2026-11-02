import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { encryptInlineSubmission, INLINE_META_KEY, REQUEST_META_KEY, INLINE_RESOURCE_URI, type InlineGrant } from "../src/shared/inline";
import { loadConfig } from "../src/server/config";
import { requestSecretInputSchema } from "../src/shared/schemas";
import { SecureInputService } from "../src/server/service";
import { AuditLog } from "../src/server/audit";
import { EventBus } from "../src/server/events";
import { createRemoteBackend } from "../src/mcp/stdio";
import { createMcpServer, createLocalBackend } from "../src/server/mcp";
import { startTestServer, pair, submit, waitForTerminal, createWithAgent, type TestServer } from "./helpers";

const body = {
  title: "Inline test", description: "Synthetic credentials only", waitSeconds: 0,
  fields: [{ id: "token", label: "Token", type: "password", required: true }],
  delivery: { mode: "execute", command: process.execPath, args: ["-e", "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(Buffer.from(s).toString('hex')))"], stdin: "{{token}}", timeoutSeconds: 5 },
};

test("inline startup and requests do not open an extra browser; unsupported clients still open paired input", async () => {
  const opened: string[] = [];
  const daemon = await startTestServer({ inputMode: "inline", openBrowser: true, openUrl: async (url) => { opened.push(url); } });
  try {
    assert.deepEqual(opened, []);
    daemon.started.service.create(requestSecretInputSchema.parse(body), { via: "stdio", cwd: daemon.home }, true);
    assert.deepEqual(opened, []);
    await createWithAgent(daemon, body);
    assert.deepEqual(opened, [`${daemon.base}/#pair=${daemon.config.pairingToken}`]);
  } finally { await daemon.close(); }
});

test("missing inline build falls back without advertising a broken UI resource", async () => {
  const daemon = await startTestServer({ inputMode: "inline" });
  const server = createMcpServer(createLocalBackend(daemon.started.service), { via: "stdio", cwd: daemon.home }, {
    inlineEnabled: true, inlineHtml: () => { throw new Error("Missing build"); },
  });
  const client = new Client({ name: "missing-template-test", version: "1" }, {
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.find((t) => t.name === "request_secret")?._meta?.ui, undefined);
    assert.equal(tools.some((t) => t.name === "submit_inline_secret"), false);
    const result = await client.callTool({ name: "request_secret", arguments: body });
    assert.equal((result.structuredContent as any).inputMode, "browser");
  } finally { await client.close(); await server.close(); await daemon.close(); }
});

async function connect(server: TestServer, apps = true) {
  const client = new Client({ name: "inline-test", version: "1" }, {
    capabilities: apps ? { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } : {},
  });
  const transport = new StreamableHTTPClientTransport(new URL(`${server.base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${server.config.mcpToken}`, "x-secureinput-cwd": server.home } },
  });
  await client.connect(transport);
  return { client, close: async () => { await transport.terminateSession(); await client.close(); } };
}

test("inline MCP form encrypts values; execution completes without returning output or capability to model-visible content", async () => {
  const server = await startTestServer({ inputMode: "inline", audit: true });
  const connection = await connect(server);
  try {
    const tools = (await connection.client.listTools()).tools;
    assert.deepEqual((tools.find((t) => t.name === "submit_inline_secret")?._meta?.ui as { visibility: string[] }).visibility, ["app"]);
    assert.deepEqual((tools.find((t) => t.name === "inline_request_status")?._meta?.ui as { visibility: string[] }).visibility, ["app"]);
    const resourceUri = (tools.find((t) => t.name === "request_secret")?._meta?.ui as { resourceUri: string }).resourceUri;
    assert.ok(resourceUri.startsWith(`${INLINE_RESOURCE_URI}?v=`));
    const resource = await connection.client.readResource({ uri: resourceUri });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.ok("text" in resource.contents[0]);
    assert.match(resource.contents[0].text, /SecureInput/);
    const result = await connection.client.callTool({ name: "request_secret", arguments: { ...body, waitSeconds: 240 } });
    assert.equal(result.isError, undefined);
    const request = result._meta?.[REQUEST_META_KEY] as any;
    assert.equal(request.inputMode, "inline");
    const modelResult = JSON.stringify({ content: result.content, structuredContent: result.structuredContent });
    assert.ok(modelResult.length < 260, `Model response is too large: ${modelResult.length}`);
    assert.equal(modelResult.includes(server.home), false);
    assert.equal(modelResult.includes('"fields"'), false);
    const grant = result._meta?.[INLINE_META_KEY] as InlineGrant;
    assert.ok(grant?.capability);
    assert.equal(JSON.stringify(result.content).includes(grant.capability), false);
    assert.equal(JSON.stringify(result.structuredContent).includes(grant.capability), false);
    const secret = "synthetic-inline-secret-123";
    const encrypted = await encryptInlineSubmission(request.id, grant, { values: { token: secret }, confirmations: { reviewedCommand: true } });
    assert.equal(JSON.stringify(encrypted).includes(secret), false);
    assert.equal(JSON.stringify(encrypted).includes(grant.capability), false);
    const submitted = await connection.client.callTool({ name: "submit_inline_secret", arguments: encrypted });
    assert.equal(submitted.isError, undefined);
    const checked = await connection.client.callTool({ name: "check_secret_request", arguments: { requestId: request.id, waitSeconds: 10 } });
    const execution = (checked._meta?.[REQUEST_META_KEY] as any).result.execution;
    assert.equal((checked.structuredContent as any).status, "completed");
    assert.equal(execution.stdout, "");
    assert.equal(execution.stderr, "");
    assert.equal(execution.outputWithheld, true);
    const widgetStatus = await connection.client.callTool({ name: "inline_request_status", arguments: { requestId: request.id, waitSeconds: 0 } });
    assert.equal((widgetStatus.structuredContent as any).status, "completed");
    assert.ok(widgetStatus._meta?.[REQUEST_META_KEY]);
    assert.equal(JSON.stringify(checked).includes(Buffer.from(secret).toString("hex")), false);
    const log = await readFile(server.config.auditPath, "utf8");
    assert.equal(log.includes(secret), false);
    assert.equal(log.includes(grant.capability), false);
    const replay = await connection.client.callTool({ name: "submit_inline_secret", arguments: encrypted });
    assert.equal(replay.isError, true);
  } finally { await connection.close(); await server.close(); }
});

test("input preference and host capabilities select inline or browser fallback", async () => {
  for (const [mode, supportsApps] of [["browser", true], ["inline", false]] as const) {
    const server = await startTestServer({ inputMode: mode });
    const connection = await connect(server, supportsApps);
    try {
      const result = await connection.client.callTool({ name: "request_secret", arguments: body });
      assert.equal((result.structuredContent as any).inputMode, "browser");
      assert.equal(result._meta?.[INLINE_META_KEY], undefined);
      if (mode === "browser") {
        assert.equal((await connection.client.listTools()).tools.some((t) => t.name === "submit_inline_secret"), false);
        const disabled = await fetch(`${server.base}/api/agent/inline-requests`, { method: "POST", headers: { authorization: `Bearer ${server.config.mcpToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        assert.equal(disabled.status, 400);
      }
    } finally { await connection.close(); await server.close(); }
  }
});

test("tampering, wrong capabilities and cross-request reuse cannot execute; inline Enter is consent", async () => {
  const server = await startTestServer({ inputMode: "inline" });
  try {
    const service = server.started.service;
    const input = requestSecretInputSchema.parse(body);
    const request = service.create(input, { via: "stdio", cwd: server.home }, true).request;
    const grant = await service.prepareInline(request.id);
    const wrong = await encryptInlineSubmission(request.id, { ...grant, capability: "x".repeat(43) }, { values: { token: "synthetic" }, confirmations: { reviewedCommand: true } });
    assert.throws(() => service.submitInline(wrong), /verify/);
    const valid = await encryptInlineSubmission(request.id, grant, { values: { token: "synthetic" } });
    const tampered = { ...valid, ciphertext: (valid.ciphertext[0] === "A" ? "B" : "A") + valid.ciphertext.slice(1) };
    assert.throws(() => service.submitInline(tampered), /verify/);
    const another = service.create(input, { via: "stdio", cwd: server.home }, true).request;
    await service.prepareInline(another.id);
    assert.throws(() => service.submitInline({ ...valid, requestId: another.id }), /verify/);
    const noValue = await encryptInlineSubmission(request.id, grant, { values: {}, confirmations: { reviewedCommand: true } });
    assert.throws(() => service.submitInline(noValue), /highlighted/);
    assert.equal(service.get(request.id).status, "pending");
    service.submitInline(valid);
    assert.throws(() => service.submitInline(valid), /no longer/);
    await service.wait(request.id, 5);
  } finally { await server.close(); }
});

test("inline .env delivery keeps permissions and browser submission wins a race", async () => {
  const server = await startTestServer({ inputMode: "inline" });
  try {
    const backend = createRemoteBackend({ port: server.config.port, token: server.config.mcpToken, cwd: server.home });
    const input = requestSecretInputSchema.parse({ ...body, delivery: { mode: "write_env", path: ".env.local", mapping: { token: "API_KEY" } } });
    const created = await backend.create(input, { via: "stdio" }, true);
    const secret = "synthetic-file-secret";
    const envelope = await encryptInlineSubmission(created.request.id, created.inline!, { values: { token: secret } });
    await backend.submitInline(envelope);
    assert.equal((await backend.wait(created.request.id, 5)).request.status, "completed");
    assert.match(await readFile(path.join(server.home, ".env.local"), "utf8"), /API_KEY=synthetic-file-secret/);
    assert.equal((await stat(path.join(server.home, ".env.local"))).mode & 0o777, 0o600);
    const replacement = await backend.create(requestSecretInputSchema.parse({ ...input, delivery: { ...input.delivery, overwrite: true } }), { via: "stdio" }, true);
    const overwrite = await encryptInlineSubmission(replacement.request.id, replacement.inline!, { values: { token: "replacement" } });
    const cookie = await pair(server.base, server.config.pairingToken);
    assert.equal((await submit(server, cookie, replacement.request.id, { token: "browser-wins" }, { overwrite: true })).status, 202);
    await assert.rejects(() => backend.submitInline(overwrite), /no longer/);
    await waitForTerminal(server, cookie, replacement.request.id);
    assert.match(await readFile(path.join(server.home, ".env.local"), "utf8"), /browser-wins/);
    const inlineReplacement = await backend.create(requestSecretInputSchema.parse({ ...input, delivery: { ...input.delivery, overwrite: true } }), { via: "stdio" }, true);
    await backend.submitInline(await encryptInlineSubmission(inlineReplacement.request.id, inlineReplacement.inline!, { values: { token: "inline-enter-consent" } }));
    await backend.wait(inlineReplacement.request.id, 5);
    assert.match(await readFile(path.join(server.home, ".env.local"), "utf8"), /inline-enter-consent/);
  } finally { await server.close(); }
});

test("expiry and denial revoke inline keys; return delivery cannot create an inline grant", async () => {
  const server = await startTestServer({ inputMode: "inline" });
  try {
    let now = Date.now();
    const service = new SecureInputService({ config: server.config, policy: server.started.policy, audit: new AuditLog(null, false), bus: new EventBus(), now: () => now });
    const input = requestSecretInputSchema.parse(body);
    const expired = service.create(input, { via: "stdio", cwd: server.home }, true).request;
    const grant = await service.prepareInline(expired.id);
    const envelope = await encryptInlineSubmission(expired.id, grant, { values: { token: "synthetic" } });
    now += 400_000;
    assert.throws(() => service.submitInline(envelope), /no longer/);
    const denied = service.create(input, { via: "stdio", cwd: server.home }, true).request;
    const deniedGrant = await service.prepareInline(denied.id);
    const deniedEnvelope = await encryptInlineSubmission(denied.id, deniedGrant, { values: {}, action: "deny" });
    assert.equal(service.submitInline(deniedEnvelope).status, "denied");
    assert.throws(() => service.submitInline(deniedEnvelope), /no longer/);
    assert.throws(() => service.create(requestSecretInputSchema.parse({ ...body, delivery: { mode: "return" } }), { via: "stdio" }, true), /unsupported/);
  } finally { await server.close(); }
});

test("new and legacy configs default to inline; an explicit browser preference persists", async () => {
  const server = await startTestServer();
  try {
    const legacy = JSON.parse(await readFile(server.config.configPath, "utf8"));
    delete legacy.inputMode;
    await writeFile(server.config.configPath, JSON.stringify(legacy), { mode: 0o600 });
    assert.equal(loadConfig({ home: path.join(server.home, "fresh-config") }).inputMode, "inline");
    assert.equal(loadConfig({ home: server.home }).inputMode, "inline");
    loadConfig({ home: server.home, inputMode: "browser" });
    assert.equal(loadConfig({ home: server.home }).inputMode, "browser");
  } finally { await server.close(); }
});

test("browser-mode transformed output is also withheld from the agent", async () => {
  const server = await startTestServer();
  try {
    const cookie = await pair(server.base, server.config.pairingToken);
    const created = await createWithAgent(server, body);
    await submit(server, cookie, created.request.id, { token: "synthetic-browser-secret" }, { reviewedCommand: true });
    const local = await waitForTerminal(server, cookie, created.request.id);
    assert.ok(local.result?.execution?.stdout);
    const agent = await server.started.service.wait(created.request.id, 0);
    assert.equal(agent.request.result?.execution?.stdout, "");
    assert.equal(agent.request.result?.execution?.outputWithheld, true);
  } finally { await server.close(); }
});
