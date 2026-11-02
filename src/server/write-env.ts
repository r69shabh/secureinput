import { randomBytes } from "node:crypto";
import { chmod, lstat, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { applyEnvUpdates, findEnvKeys } from "../shared/env";
import type { SecretField, WriteEnvDelivery } from "../shared/schemas";
import type { EnvWriteResult, RequestResult } from "../shared/types";
import { PolicyError, resolveEnvPath, type Policy } from "./policy";

const MAX_ENV_FILE_BYTES = 1024 * 1024;

export interface WriteEnvOptions {
  cwd: string;
  policy: Policy;
  fields: SecretField[];
  values: Record<string, string>;
}

export async function writeEnvDelivery(delivery: WriteEnvDelivery, options: WriteEnvOptions): Promise<RequestResult> {
  let info;
  try {
    info = resolveEnvPath(delivery.path, options.cwd, options.policy);
  } catch (error) {
    if (error instanceof PolicyError) {
      return { ok: false, status: "failed", message: error.message };
    }
    throw error;
  }

  let existingContent = "";
  if (info.existing) {
    const fileStat = await stat(info.path);
    if (fileStat.size > MAX_ENV_FILE_BYTES) {
      return { ok: false, status: "failed", message: `Env file is too large to update safely (max ${MAX_ENV_FILE_BYTES} bytes).` };
    }
    existingContent = await readFile(info.path, "utf8");
  }

  const existingKeys = findEnvKeys(existingContent);
  const conflicts = Object.values(delivery.mapping).filter((envKey) => existingKeys.has(envKey));
  if (conflicts.length > 0 && !delivery.overwrite) {
    return {
      ok: false,
      status: "failed",
      message: `These keys already exist and overwrite was not requested: ${conflicts.join(", ")}`,
    };
  }

  const updates: Record<string, string> = {};
  const keyField = new Map<string, string>();
  for (const [fieldId, envKey] of Object.entries(delivery.mapping)) {
    const field = options.fields.find((candidate) => candidate.id === fieldId);
    if (!field) return { ok: false, status: "failed", message: `Unknown field: ${fieldId}` };
    const value = options.values[fieldId];
    if (value === undefined || value.length === 0) {
      if (field.required === false) continue;
      return { ok: false, status: "failed", message: `${field.label} is required.` };
    }
    updates[envKey] = value;
    keyField.set(envKey, fieldId);
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, status: "failed", message: "No values were provided to write." };
  }

  const updated = applyEnvUpdates(existingContent, updates);
  await atomicWrite(info.path, updated.content);

  const keys = [...updated.written, ...updated.overwritten].map((key) => ({
    key,
    field: keyField.get(key) ?? "",
    overwritten: updated.overwritten.includes(key),
  }));

  const result: EnvWriteResult = { path: info.path, keys };
  const written = updated.written.length;
  const overwritten = updated.overwritten.length;
  const message = [
    written > 0 ? `${written} key${written === 1 ? "" : "s"} written` : "",
    overwritten > 0 ? `${overwritten} existing key${overwritten === 1 ? "" : "s"} replaced` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return { ok: true, status: "completed", message: `${message} in ${info.path}.`, envFile: result };
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.secureinput-${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const existing = await lstat(filePath).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw new PolicyError("env_symlink", `Refusing to replace a symlink: ${filePath}`);
    }
    await rename(tempPath, filePath);
    if (process.platform !== "win32") await chmod(filePath, 0o600);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
