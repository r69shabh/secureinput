import type { Delivery, SecretField } from "./schemas";

export type RequestStatus =
  | "pending"
  | "executing"
  | "completed"
  | "failed"
  | "denied"
  | "expired"
  | "canceled";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskReason {
  code: string;
  message: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
  requiresCommandReview: boolean;
  requiresOverwriteConfirm: boolean;
  requiresReturnConfirm: boolean;
}

export interface RequestSource {
  via: "stdio" | "http";
  clientName?: string;
  clientVersion?: string;
  cwd?: string;
  sessionId?: string;
  userAgent?: string;
  ip?: string;
}

export interface DeliverySummary {
  mode: Delivery["mode"];
  command?: string;
  args?: string[];
  cwd?: string;
  stdinFields?: string[];
  envKeys?: { key: string; fields: string[] }[];
  path?: string;
  mapping?: { fieldId: string; envKey: string; exists: boolean }[];
  returnsToAgent?: boolean;
}

export interface ExecutionResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

export interface EnvWriteResult {
  path: string;
  keys: { key: string; field: string; overwritten: boolean }[];
}

export interface RequestResult {
  ok: boolean;
  status: Extract<RequestStatus, "completed" | "failed" | "denied" | "expired" | "canceled">;
  message: string;
  execution?: ExecutionResult;
  envFile?: EnvWriteResult;
  /** Only present for opt-in return mode, and only in the agent-facing result. */
  returned?: Record<string, string>;
}

export interface PublicSecretRequest {
  id: string;
  title: string;
  description: string;
  fields: SecretField[];
  delivery: DeliverySummary;
  source: RequestSource;
  risk: RiskAssessment;
  status: RequestStatus;
  createdAt: number;
  expiresAt: number;
  claimedAt?: number;
  completedAt?: number;
  result?: Omit<RequestResult, "returned">;
}

export interface ServerPolicyInfo {
  allowReturn: boolean;
  allowShell: boolean;
  allowedRoots: string[];
  maxRequestTtlSeconds: number;
  version: string;
  port: number;
  configPath: string;
  auditEnabled: boolean;
}

export interface AgentRequestResult {
  request: PublicSecretRequest;
  /** Present only when return mode is enabled and the request completed. */
  returned?: Record<string, string>;
}

export interface HealthInfo {
  name: "SecureInput";
  version: string;
  pid: number;
  port: number;
  uptimeSeconds: number;
  pending: number;
  instanceId: string;
}

export interface PublicState {
  requests: PublicSecretRequest[];
  history: PublicSecretRequest[];
  policy: ServerPolicyInfo;
  serverTime: number;
}

export interface AuditEvent {
  ts: string;
  event:
    | "request.created"
    | "request.submitted"
    | "request.denied"
    | "request.canceled"
    | "request.expired"
    | "request.completed"
    | "request.failed"
    | "auth.paired"
    | "auth.failed"
    | "auth.rate_limited";
  requestId?: string;
  client?: string;
  cwd?: string;
  delivery?: { mode: string; path?: string; command?: string; envKeys?: string[] };
  fields?: string[];
  outcome?: string;
  exitCode?: number | null;
  durationMs?: number;
}

export type TemplateValues = Record<string, string>;
