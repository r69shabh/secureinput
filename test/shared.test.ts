import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyEnvUpdates, findEnvKeys, formatEnvValue } from "../src/shared/env";
import { redactSecrets, sanitizeOutput, stripAnsi } from "../src/shared/redaction";
import { requestSecretInputSchema, secretFieldSchema } from "../src/shared/schemas";
import { validateFieldValues } from "../src/shared/validation";
import { buildPolicy, resolveCommandCwd, resolveEnvPath, PolicyError } from "../src/server/policy";
import { assessRisk } from "../src/server/risk";
import type { SecureInputConfig } from "../src/server/config";
import { isLoopbackHost } from "../src/server/config";
import { safeEqual } from "../src/server/auth";

const baseRequest = {
  title: "GitHub token",
  description: "Authenticate the GitHub CLI",
  fields: [{ id: "token", label: "Token", type: "password", required: true }],
  delivery: { mode: "execute", command: "gh", args: ["auth", "login", "--with-token"], stdin: "{{token}}" },
  timeoutSeconds: 300,
  waitSeconds: 0,
};

test("schema accepts a safe execute request", () => {
  const parsed = requestSecretInputSchema.safeParse(baseRequest);
  assert.equal(parsed.success, true);
});

test("schema rejects a sensitive field in command args", () => {
  const parsed = requestSecretInputSchema.safeParse({
    ...baseRequest,
    delivery: { mode: "execute", command: "gh", args: ["--token", "{{token}}"], stdin: "{{token}}" },
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join(" ") ?? "", /cannot go in command arguments/i);
});

test("schema allows a non-sensitive field in command args", () => {
  const parsed = requestSecretInputSchema.safeParse({
    ...baseRequest,
    fields: [
      { id: "username", label: "Username", type: "text", sensitive: false },
      { id: "password", label: "Password", type: "password" },
    ],
    delivery: {
      mode: "execute",
      command: "docker",
      args: ["login", "--username", "{{username}}", "--password-stdin"],
      stdin: "{{password}}",
    },
  });
  assert.equal(parsed.success, true);
});

test("schema rejects unknown template references and command placeholders", () => {
  const unknown = requestSecretInputSchema.safeParse({
    ...baseRequest,
    delivery: { mode: "execute", command: "gh", stdin: "{{missing}}" },
  });
  assert.equal(unknown.success, false);
  const placeholder = requestSecretInputSchema.safeParse({
    ...baseRequest,
    delivery: { mode: "execute", command: "gh {{token}}", stdin: "{{token}}" },
  });
  assert.equal(placeholder.success, false);
});

test("schema rejects duplicate field ids and invalid RE2 patterns", () => {
  const duplicate = requestSecretInputSchema.safeParse({
    ...baseRequest,
    fields: [
      { id: "token", label: "One" },
      { id: "token", label: "Two" },
    ],
  });
  assert.equal(duplicate.success, false);
  const pattern = secretFieldSchema.safeParse({ id: "token", label: "Token", pattern: "(" });
  assert.equal(pattern.success, false);
});

test("env updates preserve comments and existing keys", () => {
  const before = "# comment\nexport FOO=old\nBAR=keep\r\n";
  const found = findEnvKeys(before);
  assert.equal(found.get("FOO"), 1);
  const result = applyEnvUpdates(before, { FOO: "new value", NEW_KEY: "a\nb" });
  assert.match(result.content, /# comment/);
  assert.match(result.content, /export FOO="new value"/);
  assert.match(result.content, /BAR=keep\r\n/);
  assert.match(result.content, /NEW_KEY="a\\nb"/);
  assert.deepEqual(result.overwritten, ["FOO"]);
  assert.deepEqual(result.written, ["NEW_KEY"]);
});

test("env values are quoted when needed", () => {
  assert.equal(formatEnvValue("simple-value_1.2"), "simple-value_1.2");
  assert.equal(formatEnvValue("with space"), '"with space"');
  assert.equal(formatEnvValue('quote"here'), '"quote\\"here"');
  assert.equal(formatEnvValue(""), '""');
});

test("redaction removes raw, URL-encoded, base64, and common tokens", () => {
  const secret = "super secret/value";
  const encoded = encodeURIComponent(secret);
  const base64 = Buffer.from(secret).toString("base64");
  const output = `raw=${secret} url=${encoded} b64=${base64} github=ghp_123456789012345678901234`;
  const redacted = redactSecrets(output, [secret]);
  assert.equal(redacted.includes(secret), false);
  assert.equal(redacted.includes(encoded), false);
  assert.equal(redacted.includes(base64), false);
  assert.equal(redacted.includes("ghp_"), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test("ANSI output is stripped before display", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red");
  assert.match(sanitizeOutput("\u001b[32msecret\u001b[0m", ["secret"]), /\[REDACTED\]/);
});

test("field validation enforces required, lengths, and RE2 patterns", () => {
  const fields = [
    { id: "token", label: "Token", type: "password" as const, required: true, pattern: "[A-Z]{3}-[0-9]{3}" },
    { id: "note", label: "Note", type: "text" as const, required: false },
  ];
  const good = validateFieldValues(fields, { token: "ABC-123" });
  assert.equal(good.ok, true);
  const bad = validateFieldValues(fields, { token: "abc" });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.token ?? "", /format/);
  const empty = validateFieldValues(fields, {});
  assert.equal(empty.ok, false);
});

test("policy keeps env files and cwd inside allowed roots", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "secureinput-policy-"));
  const inside = path.join(home, ".env.local");
  await writeFile(inside, "A=1\n");
  await mkdir(path.join(home, "sub"));
  const config = {
    allowedRoots: [home],
    allowReturn: false,
  } as unknown as SecureInputConfig;
  const policy = buildPolicy(config, home);
  const realHome = await realpath(home);
  assert.equal(resolveCommandCwd("sub", home, policy), path.join(realHome, "sub"));
  assert.equal(resolveEnvPath(".env.local", home, policy).path, path.join(realHome, ".env.local"));
  assert.equal(resolveEnvPath(".env", home, policy).path, path.join(realHome, ".env"));
  assert.throws(() => resolveEnvPath(".env.example", home, policy), PolicyError);
  assert.throws(() => resolveEnvPath(".envrc", home, policy), PolicyError);
  assert.throws(() => resolveEnvPath("../outside/.env", home, policy), PolicyError);
  assert.throws(() => resolveCommandCwd("..", home, policy), PolicyError);

  const link = path.join(home, ".env.link");
  await symlink(inside, link);
  assert.throws(() => resolveEnvPath(".env.link", home, policy), /symlink/i);
  await rm(home, { recursive: true, force: true });
});

test("risk flags network tools, shells, and return mode", () => {
  const base = {
    policy: { roots: ["/tmp"], daemonCwd: "/tmp", allowReturn: true },
    baseCwd: "/tmp",
    summary: { mode: "execute" as const, command: "curl", args: [], cwd: "/tmp" },
  };
  const curlRisk = assessRisk({
    ...base,
    delivery: { mode: "execute", command: "curl", args: [], timeoutSeconds: 10 },
  });
  assert.equal(curlRisk.level, "high");
  assert.equal(curlRisk.requiresCommandReview, true);

  const ghRisk = assessRisk({
    ...base,
    summary: { mode: "execute", command: "gh", args: [], cwd: "/tmp" },
    delivery: { mode: "execute", command: "gh", args: [], timeoutSeconds: 10 },
  });
  assert.equal(ghRisk.level, "medium");

  const returnRisk = assessRisk({
    ...base,
    summary: { mode: "return", returnsToAgent: true },
    delivery: { mode: "return" },
  });
  assert.equal(returnRisk.level, "high");
  assert.equal(returnRisk.requiresReturnConfirm, true);
});

test("loopback host validation and constant-time token comparison", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("192.168.1.2"), false);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abc "), false);
});
