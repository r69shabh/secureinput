import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { SecureInputConfig } from "./config";

export interface Policy {
  roots: string[];
  allowReturn: boolean;
  daemonCwd: string;
}

export function buildPolicy(config: SecureInputConfig, daemonCwd: string): Policy {
  const roots = config.allowedRoots.map((root) => {
    const resolved = realpathSync(path.resolve(root));
    if (!statSync(resolved).isDirectory()) throw new Error(`Allowed root is not a directory: ${root}`);
    return resolved;
  });
  const realCwd = realpathSync(path.resolve(daemonCwd));
  return { roots: [...new Set(roots)], allowReturn: config.allowReturn, daemonCwd: realCwd };
}

export function isWithinRoots(candidate: string, roots: string[]): boolean {
  for (const root of roots) {
    const relative = path.relative(root, candidate);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return true;
  }
  return false;
}

export function resolveCommandCwd(inputCwd: string | undefined, baseCwd: string, policy: Policy): string {
  const candidate = inputCwd ? path.resolve(baseCwd, inputCwd) : baseCwd;
  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch {
    throw new PolicyError("cwd_not_found", `Working directory does not exist: ${candidate}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new PolicyError("cwd_not_directory", `Working directory is not a directory: ${resolved}`);
  }
  if (!isWithinRoots(resolved, policy.roots)) {
    throw new PolicyError(
      "cwd_outside_roots",
      `Working directory is outside the allowed roots (${policy.roots.join(", ")}): ${resolved}`,
    );
  }
  return resolved;
}

const BLOCKED_ENV_NAMES = /(example|sample|template|dist|defaults|schema)/i;

export function isAllowedEnvFileName(filePath: string): boolean {
  const base = path.basename(filePath);
  return (base === ".env" || base.startsWith(".env.")) && !BLOCKED_ENV_NAMES.test(base);
}

export interface EnvPathInfo {
  path: string;
  existing: boolean;
}

export function resolveEnvPath(inputPath: string, baseCwd: string, policy: Policy): EnvPathInfo {
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(baseCwd, inputPath);
  if (!isAllowedEnvFileName(candidate)) {
    throw new PolicyError(
      "env_file_not_allowed",
      `Only .env-style files are allowed (not examples/templates): ${path.basename(candidate)}`,
    );
  }
  const parent = path.dirname(candidate);
  let realParent: string;
  try {
    realParent = realpathSync(parent);
  } catch {
    throw new PolicyError("env_parent_missing", `Parent directory does not exist: ${parent}`);
  }
  if (!statSync(realParent).isDirectory()) {
    throw new PolicyError("env_parent_not_directory", `Parent is not a directory: ${realParent}`);
  }
  const finalPath = path.join(realParent, path.basename(candidate));
  if (!isWithinRoots(finalPath, policy.roots)) {
    throw new PolicyError(
      "env_outside_roots",
      `Env file is outside the allowed roots (${policy.roots.join(", ")}): ${finalPath}`,
    );
  }
  let existing = false;
  try {
    const stat = lstatSync(finalPath);
    if (stat.isSymbolicLink()) {
      throw new PolicyError("env_symlink", `Refusing to write through a symlink: ${finalPath}`);
    }
    if (!stat.isFile()) {
      throw new PolicyError("env_not_file", `Env path is not a regular file: ${finalPath}`);
    }
    const real = realpathSync(finalPath);
    if (!isWithinRoots(real, policy.roots)) {
      throw new PolicyError("env_outside_roots", `Env file resolves outside the allowed roots: ${real}`);
    }
    existing = true;
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  return { path: finalPath, existing };
}

export class PolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}
