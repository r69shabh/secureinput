/** Run with npm run demo:host. Isolated temp workspace; synthetic credentials only. */
import express from "express";
import { build } from "esbuild";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startTestServer } from "./helpers";
import { INLINE_RESOURCE_URI } from "../src/shared/inline";

const daemon = await startTestServer({ inputMode: "inline", audit: true });
const client = new Client({ name: "SecureInput local test host", version: "1" }, {
  capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
});
const transport = new StreamableHTTPClientTransport(new URL(`${daemon.base}/mcp`), { requestInit: { headers: {
  authorization: `Bearer ${daemon.config.mcpToken}`, "x-secureinput-cwd": daemon.home,
} } });
await client.connect(transport);
const bundled = await build({ entryPoints: ["test/fixtures/inline-host.js"], bundle: true, write: false, format: "esm", platform: "browser" });
const app = express();
const token = randomUUID();
// The reference host is a separate loopback-only test process. Do not relax the production daemon's policies.
app.use((req, res, next) => {
  if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? "")) { res.sendStatus(403); return; }
  if (req.method === "POST" && (req.header("x-secureinput-demo") !== "1" || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`))) { res.sendStatus(403); return; }
  if (req.path !== "/" && !req.headers.cookie?.split("; ").includes(`demo=${token}`)) { res.sendStatus(401); return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "256kb" }));
app.get("/", (_req, res) => {
  res.setHeader("Set-Cookie", `demo=${token}; HttpOnly; SameSite=Strict; Path=/`);
  res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SecureInput local test</title><style>body{margin:24px auto;padding:0 16px;max-width:780px;font:15px system-ui;color:#202020;background:#fafafa}h1{font-size:22px}p{line-height:1.5}iframe{width:100%;border:1px solid #ddd;background:white;border-radius:12px;height:80px}code{font-size:13px}</style><h1>SecureInput · local MCP test host</h1><p>Synthetic credentials only. This test renders the real MCP App and forwards its encrypted submission to the local daemon. The approved command writes a demo .env file in an isolated temporary folder.</p><p id="status" role="status">Waiting for input.</p><iframe title="SecureInput MCP App" sandbox="allow-scripts"></iframe><script type="module" src="/host.js"></script></html>`);
});
app.get("/host.js", (_req, res) => res.type("js").send(bundled.outputFiles[0].text));
let requestId: string | undefined;
const traffic: unknown[] = [];
app.post("/demo/start", async (_req, res) => {
  if (requestId) {
    try { await client.callTool({ name: "cancel_secret_request", arguments: { requestId } }); } catch { /* Already terminal. */ }
  }
  const input = {
    title: "Save a synthetic demo credential", description: "Test encrypted inline input followed by a local terminal command. Use a fake credential only.",
    fields: [{ id: "token", label: "Demo API key", type: "password", required: true }],
    delivery: { mode: "execute", command: process.execPath, args: ["-e", "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{require('fs').writeFileSync('.env.inline-demo','DEMO_KEY='+JSON.stringify(s)+String.fromCharCode(10),{mode:0o600});console.log('credential='+s)})"], stdin: "{{token}}", timeoutSeconds: 10 },
    waitSeconds: 0, timeoutSeconds: 900,
  };
  const result = await client.callTool({ name: "request_secret", arguments: input });
  requestId = (result.structuredContent as any)?.requestId;
  const resource = await client.readResource({ uri: INLINE_RESOURCE_URI });
  res.json({ input, result, html: "text" in resource.contents[0] ? resource.contents[0].text : "" });
});
app.post("/demo/tool", async (req, res) => {
  if (!["submit_inline_secret", "inline_request_status", "check_secret_request", "cancel_secret_request"].includes(req.body.name)) { res.sendStatus(403); return; }
  traffic.push(req.body);
  const result = await client.callTool(req.body);
  traffic.push(result);
  res.json(result);
});
app.get("/demo/verification", async (_req, res) => {
  const file = path.join(daemon.home, ".env.inline-demo");
  const content = await readFile(file, "utf8").catch(() => "");
  res.json({
    requestId,
    status: requestId ? daemon.started.service.get(requestId).status : "none",
    fileWritten: content.startsWith("DEMO_KEY="),
    mode: (await stat(file).catch(() => null))?.mode! & 0o777,
    syntheticValueVerified: content.includes("synthetic-chat-demo-2026"),
    envLineComplete: content.endsWith("\n"),
    plaintextInToolTraffic: JSON.stringify(traffic).includes("synthetic-chat-demo-2026"),
  });
});
const host = app.listen(0, "127.0.0.1", () => {
  const address = host.address();
  if (address && typeof address !== "string") console.log(`SecureInput local test host: http://127.0.0.1:${address.port}/`);
});
process.once("SIGINT", () => { void transport.terminateSession().finally(async () => { await client.close(); await daemon.close(); host.close(); }); });
