import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { INLINE_META_KEY, encryptInlineSubmission, type InlineGrant } from "../src/shared/inline";
import { startTestServer } from "./helpers";

test("built stdio bridge delivers encrypted inline input to a terminal command that writes a private env file", async () => {
  const server = await startTestServer({ inputMode: "inline", audit: true });
  const client = new Client({ name: "stdio-production-build-test", version: "1" }, {
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
  });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve("dist/cli/index.js"), "mcp", "--home", server.home], cwd: server.home,
  });
  try {
    await client.connect(transport);
    const requested = await client.callTool({ name: "request_secret", arguments: {
      title: "Terminal-to-env test", description: "Synthetic value only", waitSeconds: 0,
      fields: [{ id: "token", label: "Key", type: "password" }],
      delivery: { mode: "execute", command: process.execPath,
        args: ["-e", "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{require('fs').writeFileSync('.env.terminal','TEST_KEY='+JSON.stringify(s)+String.fromCharCode(10),{mode:0o600}); console.log(Buffer.from(s).toString('hex'))})"],
        stdin: "{{token}}", timeoutSeconds: 5 },
    } });
    const requestId = (requested.structuredContent as { requestId: string }).requestId;
    const grant = requested._meta?.[INLINE_META_KEY] as InlineGrant;
    assert.ok(grant);
    const secret = "synthetic-stdio-terminal-credential";
    const envelope = await encryptInlineSubmission(requestId, grant, { values: { token: secret }, confirmations: { reviewedCommand: true } });
    assert.equal((await client.callTool({ name: "submit_inline_secret", arguments: envelope })).isError, undefined);
    const result = await client.callTool({ name: "check_secret_request", arguments: { requestId, waitSeconds: 10 } });
    assert.equal((result.structuredContent as { status: string }).status, "completed");
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes(Buffer.from(secret).toString("hex")), false);
    const file = path.join(server.home, ".env.terminal");
    assert.equal(await readFile(file, "utf8"), `TEST_KEY=${JSON.stringify(secret)}\n`);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await readFile(server.config.auditPath, "utf8")).includes(secret), false);
  } finally {
    await client.close();
    await server.close();
  }
});
