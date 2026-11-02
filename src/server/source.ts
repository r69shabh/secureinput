import type { Request } from "express";
import {
  CLIENT_CWD_HEADER,
  CLIENT_NAME_HEADER,
  CLIENT_SESSION_HEADER,
  CLIENT_VERSION_HEADER,
} from "../shared/constants";
import type { RequestSource } from "../shared/types";
import { sanitizeMetaString } from "../shared/validation";

export function sourceFromHeaders(req: Request, via: RequestSource["via"]): RequestSource {
  return {
    via,
    clientName: sanitizeMetaString(req.header(CLIENT_NAME_HEADER), 80) ?? "Coding agent",
    clientVersion: sanitizeMetaString(req.header(CLIENT_VERSION_HEADER), 40),
    cwd: sanitizeMetaString(req.header(CLIENT_CWD_HEADER), 2000),
    sessionId: sanitizeMetaString(req.header(CLIENT_SESSION_HEADER), 100),
    userAgent: sanitizeMetaString(req.header("user-agent"), 200),
    ip: req.socket.remoteAddress,
  };
}

export function sourceFromClientInfo(
  via: RequestSource["via"],
  client: { name?: string; version?: string } | undefined,
  fallback: Partial<RequestSource> = {},
): RequestSource {
  return {
    via,
    clientName: sanitizeMetaString(client?.name, 80) ?? fallback.clientName ?? "Coding agent",
    clientVersion: sanitizeMetaString(client?.version, 40) ?? fallback.clientVersion,
    cwd: fallback.cwd,
    sessionId: fallback.sessionId,
    userAgent: fallback.userAgent,
    ip: fallback.ip,
  };
}
