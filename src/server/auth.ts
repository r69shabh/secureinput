import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { SESSION_COOKIE } from "../shared/constants";
import type { SecureInputConfig } from "./config";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b) && left.length === right.length;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueSession(secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sid: randomBytes(24).toString("base64url"), exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload, secret))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sid?: string; exp?: number };
    return typeof parsed.sid === "string" && typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export function isPairingTokenValid(config: SecureInputConfig, token: string): boolean {
  return safeEqual(token, config.pairingToken);
}

export function isMcpTokenValid(config: SecureInputConfig, token: string): boolean {
  return safeEqual(token, config.mcpToken);
}

export function sessionIsValid(req: Request, config: SecureInputConfig): boolean {
  return verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE], config.sessionSecret);
}

export function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header) return "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? (value ?? "") : "";
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 1000) {
      for (const [entryKey, times] of this.hits) {
        if (times.every((time) => time <= cutoff)) this.hits.delete(entryKey);
      }
    }
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
