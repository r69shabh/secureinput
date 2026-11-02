import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  MAX_PENDING_PER_CLIENT,
  MAX_PENDING_REQUESTS,
  MAX_REQUESTS_PER_MINUTE,
  MAX_REQUEST_TTL_SECONDS,
} from "../shared/constants";
import { findEnvKeys } from "../shared/env";
import type { Delivery, RequestSecretInput, SecretField } from "../shared/schemas";
import type {
  AgentRequestResult,
  PublicSecretRequest,
  RequestResult,
  RequestSource,
  ServerPolicyInfo,
} from "../shared/types";
import { validateFieldValues } from "../shared/validation";
import { sanitizeOutput } from "../shared/redaction";
import type { AuditLog } from "./audit";
import { RateLimiter } from "./auth";
import type { SecureInputConfig } from "./config";
import { executeDelivery } from "./execute";
import { EventBus } from "./events";
import { PolicyError, resolveCommandCwd, resolveEnvPath, type Policy } from "./policy";
import { assessRisk } from "./risk";
import { buildDeliverySummary } from "./summary";
import { writeEnvDelivery } from "./write-env";
import { createInlineKeys, decryptInlineSubmission, type InlineKeys } from "./inline";
import type { InlineEnvelope, InlineGrant } from "../shared/inline";

const RESULT_RETENTION_MS = 10 * 60_000;
const HISTORY_LIMIT = 50;

interface InternalRequest {
  inlineKeys?: InlineKeys;
  inlineAttempts?: number;
  id: string;
  input: RequestSecretInput;
  delivery: Delivery;
  fields: SecretField[];
  baseCwd: string;
  public: PublicSecretRequest;
  result?: RequestResult;
  waiters: Set<() => void>;
  purgeTimer?: NodeJS.Timeout;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface CreateResult {
  request: PublicSecretRequest;
}

export interface SecureInputServiceOptions {
  config: SecureInputConfig;
  policy: Policy;
  audit: AuditLog;
  bus: EventBus;
  now?: () => number;
}

export class SecureInputService {
  private readonly requests = new Map<string, InternalRequest>();
  private readonly history: PublicSecretRequest[] = [];
  private readonly rate = new RateLimiter(MAX_REQUESTS_PER_MINUTE, 60_000);
  private readonly now: () => number;

  constructor(private readonly options: SecureInputServiceOptions) {
    this.now = options.now ?? Date.now;
    setInterval(() => this.expireRequests(), 5000).unref();
  }

  policyInfo(): ServerPolicyInfo {
    return {
      inputMode: this.options.config.inputMode,
      allowReturn: this.options.policy.allowReturn,
      allowShell: false,
      allowedRoots: this.options.policy.roots,
      maxRequestTtlSeconds: MAX_REQUEST_TTL_SECONDS,
      version: "0.1.0",
      port: this.options.config.port,
      configPath: this.options.config.configPath,
      auditEnabled: this.options.config.audit,
    };
  }

  pending(): PublicSecretRequest[] {
    return [...this.requests.values()]
      .filter((request) => request.public.status === "pending" || request.public.status === "executing")
      .map((request) => this.publicView(request));
  }

  historyList(): PublicSecretRequest[] {
    return this.history.map((request) => structuredClone(request));
  }

  get(requestId: string): PublicSecretRequest {
    return this.publicView(this.require(requestId));
  }

  async wait(requestId: string, waitSeconds: number): Promise<AgentRequestResult> {
    const request = this.require(requestId);
    if (request.public.status !== "pending" && request.public.status !== "executing") {
      return this.agentView(request);
    }
    if (waitSeconds <= 0) return this.agentView(request);

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        request.waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, waitSeconds * 1000);
      request.waiters.add(finish);
    });
    return this.agentView(request);
  }

  create(input: RequestSecretInput, source: RequestSource, inline = false): CreateResult {
    if (inline && (this.options.config.inputMode !== "inline" || input.delivery.mode === "return")) {
      throw new ServiceError("inline_unavailable", "Inline input is disabled or unsupported for this delivery. Use the local browser.");
    }
    if (input.delivery.mode === "return" && !this.options.policy.allowReturn) {
      throw new ServiceError(
        "return_mode_disabled",
        "Returning secrets to the agent is disabled. Use execute or write_env, or start the daemon with --allow-return.",
      );
    }

    const clientKey = source.sessionId ?? source.clientName ?? source.ip ?? "unknown";
    if (!this.rate.check(clientKey)) {
      this.options.audit.append({ ts: new Date().toISOString(), event: "auth.rate_limited", client: clientKey });
      throw new ServiceError("rate_limited", "Too many secret requests. Wait a minute and try again.");
    }

    const pendingCount = this.pending().length;
    if (pendingCount >= MAX_PENDING_REQUESTS) {
      throw new ServiceError("too_many_pending", `There are already ${MAX_PENDING_REQUESTS} pending requests. Ask the user to resolve them first.`);
    }
    const clientPending = [...this.requests.values()].filter(
      (request) =>
        (request.public.status === "pending" || request.public.status === "executing") &&
        (request.public.source.sessionId ?? request.public.source.clientName ?? request.public.source.ip) === clientKey,
    ).length;
    if (clientPending >= MAX_PENDING_PER_CLIENT) {
      throw new ServiceError("too_many_pending", `This agent already has ${MAX_PENDING_PER_CLIENT} pending requests. Resolve one first.`);
    }

    let baseCwd = this.options.policy.daemonCwd;
    const reportedCwd = source.cwd ?? input.cwd;
    if (reportedCwd) {
      try {
        baseCwd = resolveCommandCwd(reportedCwd, this.options.policy.daemonCwd, this.options.policy);
      } catch (error) {
        throw new ServiceError(
          "cwd_outside_roots",
          error instanceof Error ? error.message : "Reported working directory is not available.",
        );
      }
    }

    let commandCwd: string | undefined;
    let envPathInfo;
    let existingEnvContent = "";
    let existingEnvKeys: Set<string> | undefined;

    if (input.delivery.mode === "execute") {
      commandCwd = resolveCommandCwd(input.delivery.cwd, baseCwd, this.options.policy);
    }
    if (input.delivery.mode === "write_env") {
      envPathInfo = resolveEnvPath(input.delivery.path, baseCwd, this.options.policy);
      if (envPathInfo.existing) {
        const file = awaitReadFileSafe(envPathInfo.path);
        existingEnvContent = file;
        const keysInFile = findEnvKeys(file);
        existingEnvKeys = new Set(Object.values(input.delivery.mapping).filter((envKey) => keysInFile.has(envKey)));
      }
      if ((existingEnvKeys?.size ?? 0) > 0 && !input.delivery.overwrite) {
        throw new ServiceError(
          "env_key_exists",
          `These keys already exist: ${[...existingEnvKeys!].join(", ")}. Retry with overwrite: true if replacing them is intended.`,
          { keys: [...existingEnvKeys!] },
        );
      }
    }

    const summary = buildDeliverySummary(
      input.delivery,
      input.fields,
      commandCwd ?? baseCwd,
      envPathInfo,
      existingEnvContent,
    );
    const risk = assessRisk({
      delivery: input.delivery,
      summary,
      policy: this.options.policy,
      baseCwd,
      envPath: envPathInfo,
      existingEnvKeys,
    });

    const createdAt = this.now();
    const executionTimeout = input.delivery.mode === "execute" ? input.delivery.timeoutSeconds : 0;
    const ttlSeconds = Math.min(
      MAX_REQUEST_TTL_SECONDS,
      Math.max(input.timeoutSeconds, executionTimeout > 0 ? executionTimeout + 60 : 0),
    );
    const id = `req_${randomBytes(16).toString("base64url")}`;
    const publicRequest: PublicSecretRequest = {
      inputMode: inline ? "inline" : "browser",
      id,
      title: input.title,
      description: input.description,
      fields: input.fields,
      delivery: summary,
      source,
      risk,
      status: "pending",
      createdAt,
      expiresAt: createdAt + ttlSeconds * 1000,
    };
    const internal: InternalRequest = {
      id,
      input,
      delivery: input.delivery,
      fields: input.fields,
      baseCwd,
      public: publicRequest,
      waiters: new Set(),
    };
    this.requests.set(id, internal);
    this.options.audit.append({
      ts: new Date().toISOString(),
      event: "request.created",
      requestId: id,
      client: clientKey,
      cwd: commandCwd ?? baseCwd,
      delivery: {
        mode: input.delivery.mode,
        path: input.delivery.mode === "write_env" ? envPathInfo?.path : undefined,
        command: input.delivery.mode === "execute" ? input.delivery.command : undefined,
        envKeys: input.delivery.mode === "write_env" ? Object.values(input.delivery.mapping) : undefined,
      },
      fields: input.fields.map((field) => field.id),
    });
    this.options.bus.emit({ type: "request.created", request: this.publicView(internal) });
    return { request: this.publicView(internal) };
  }

  async prepareInline(requestId: string): Promise<InlineGrant> {
    const request = this.require(requestId);
    if (request.public.inputMode !== "inline" || request.public.status !== "pending" || request.inlineKeys) {
      throw new ServiceError("inline_unavailable", "Inline input is not available for this request.");
    }
    const keys = await createInlineKeys();
    if (request.public.status !== "pending" || request.public.expiresAt <= this.now()) {
      throw new ServiceError("inline_unavailable", "This request is no longer pending.");
    }
    request.inlineKeys = keys;
    return keys.grant;
  }

  submitInline(envelope: InlineEnvelope): PublicSecretRequest {
    const request = this.require(envelope.requestId);
    if (!request.inlineKeys || request.public.status !== "pending" || request.public.expiresAt <= this.now()) {
      throw new ServiceError("inline_unavailable", "Inline input is no longer available. Check the request status.");
    }
    if ((request.inlineAttempts ?? 0) >= 10) {
      throw new ServiceError("rate_limited", "Too many inline attempts. Finish in the local browser or create a new request.");
    }
    request.inlineAttempts = (request.inlineAttempts ?? 0) + 1;
    let submission;
    try {
      submission = decryptInlineSubmission(request.inlineKeys, envelope);
    } catch {
      throw new ServiceError("invalid_inline_submission", "Could not verify the encrypted submission. Retry or use the local browser.");
    }
    try {
      return submission.action === "deny" ? this.deny(envelope.requestId) : this.submit(envelope.requestId, submission.values, submission.confirmations);
    } finally {
      for (const key of Object.keys(submission.values)) delete submission.values[key];
    }
  }

  submit(requestId: string, rawValues: Record<string, string>, confirmations?: {
    reviewedCommand?: boolean;
    overwrite?: boolean;
    sendToAgent?: boolean;
  }): PublicSecretRequest {
    const request = this.require(requestId);
    if (request.public.status !== "pending") {
      throw new ServiceError("request_not_pending", `This request is already ${request.public.status}.`);
    }
    if (request.public.expiresAt <= this.now()) {
      this.finish(request, { ok: false, status: "expired", message: "This request expired before it was submitted." });
      throw new ServiceError("request_expired", "This request has expired. Ask the agent to create a new one.");
    }

    const validation = validateFieldValues(request.fields, rawValues);
    if (!validation.ok) {
      throw new ServiceError("validation_failed", "Check the highlighted fields and try again.", {
        fieldErrors: validation.errors,
      });
    }

    if (request.public.risk.requiresCommandReview && !confirmations?.reviewedCommand) {
      throw new ServiceError("confirmation_required", "This request needs explicit confirmation that you reviewed the command.", {
        confirmations: ["reviewedCommand"],
      });
    }
    if (request.public.risk.requiresOverwriteConfirm && !confirmations?.overwrite) {
      throw new ServiceError("confirmation_required", "Confirm that replacing the existing env keys is intended.", {
        confirmations: ["overwrite"],
      });
    }
    if (request.public.risk.requiresReturnConfirm && !confirmations?.sendToAgent) {
      throw new ServiceError("confirmation_required", "Confirm that the agent may receive this secret.", {
        confirmations: ["sendToAgent"],
      });
    }

    request.public.status = "executing";
    request.inlineKeys = undefined;
    request.public.claimedAt = this.now();
    this.options.audit.append({
      ts: new Date().toISOString(),
      event: "request.submitted",
      requestId: request.id,
      client: request.public.source.clientName,
    });
    this.options.bus.emit({ type: "request.updated", request: this.publicView(request) });

    const values = { ...validation.values };
    void this.run(request, values);
    return this.publicView(request);
  }

  deny(requestId: string, reason?: string): PublicSecretRequest {
    const request = this.require(requestId);
    if (request.public.status !== "pending") {
      throw new ServiceError("request_not_pending", `This request is already ${request.public.status}.`);
    }
    this.finish(request, {
      ok: false,
      status: "denied",
      message: reason ? `The user denied this request: ${reason}` : "The user denied this request.",
    });
    return this.publicView(request);
  }

  cancel(requestId: string): PublicSecretRequest {
    const request = this.require(requestId);
    if (request.public.status !== "pending") {
      throw new ServiceError("request_not_pending", `This request is already ${request.public.status}.`);
    }
    this.finish(request, { ok: false, status: "canceled", message: "The request was canceled." });
    return this.publicView(request);
  }

  private async run(request: InternalRequest, values: Record<string, string>): Promise<void> {
    try {
      let result: RequestResult;
      if (request.delivery.mode === "execute") {
        result = await executeDelivery(request.delivery, {
          cwd: request.public.delivery.cwd ?? request.baseCwd,
          values,
          timeoutSeconds: request.delivery.timeoutSeconds,
        });
      } else if (request.delivery.mode === "write_env") {
        result = await writeEnvDelivery(request.delivery, {
          cwd: request.baseCwd,
          policy: this.options.policy,
          fields: request.fields,
          values,
        });
      } else {
        result = {
          ok: true,
          status: "completed",
          message: "The secret was returned to the agent.",
          returned: { ...values },
        };
      }
      this.finish(request, result);
    } catch (error) {
      const message = sanitizeOutput(error instanceof Error ? error.message : "Delivery failed.", Object.values(values));
      this.finish(request, { ok: false, status: "failed", message });
    } finally {
      for (const key of Object.keys(values)) delete values[key];
    }
  }

  private finish(request: InternalRequest, result: RequestResult): void {
    if (request.public.status !== "pending" && request.public.status !== "executing") return;
    request.result = result;
    request.inlineKeys = undefined;
    request.public.status = result.status;
    request.public.completedAt = this.now();
    request.public.result = this.publicResult(result);
    this.options.audit.append({
      ts: new Date().toISOString(),
      event:
        result.status === "completed"
          ? "request.completed"
          : result.status === "denied"
            ? "request.denied"
            : result.status === "canceled"
              ? "request.canceled"
              : result.status === "expired"
                ? "request.expired"
                : "request.failed",
      requestId: request.id,
      client: request.public.source.clientName,
      outcome: result.status,
      exitCode: result.execution?.exitCode,
      durationMs: result.execution?.durationMs,
    });
    this.options.bus.emit({ type: "request.updated", request: this.publicView(request) });
    this.history.unshift(this.publicView(request));
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    for (const waiter of request.waiters) waiter();
    request.waiters.clear();
    request.purgeTimer = setTimeout(() => {
      this.requests.delete(request.id);
      this.options.bus.emit({ type: "request.removed", requestId: request.id });
    }, RESULT_RETENTION_MS);
    request.purgeTimer.unref();
  }

  private expireRequests(): void {
    const now = this.now();
    for (const request of this.requests.values()) {
      if (request.public.status === "pending" && request.public.expiresAt <= now) {
        this.finish(request, { ok: false, status: "expired", message: "The request expired before the user submitted it." });
      }
    }
  }

  private require(requestId: string): InternalRequest {
    const request = this.requests.get(requestId);
    if (!request) throw new ServiceError("request_not_found", "Request not found or no longer available.");
    return request;
  }

  private publicView(request: InternalRequest): PublicSecretRequest {
    return structuredClone({
      ...request.public,
      result: request.public.result ? this.publicResult(request.public.result) : undefined,
    });
  }

  private publicResult(result: RequestResult): Omit<RequestResult, "returned"> {
    const { returned: _returned, ...rest } = result;
    return rest;
  }

  private agentView(request: InternalRequest): AgentRequestResult {
    const response: AgentRequestResult = { request: this.publicView(request) };
    if (response.request.result?.execution) {
      response.request.result.execution.stdout = "";
      response.request.result.execution.stderr = "";
      response.request.result.execution.outputWithheld = true;
    }
    if (request.result?.returned) response.returned = { ...request.result.returned };
    return response;
  }
}

function awaitReadFileSafe(filePath: string): string {
  // Synchronous reads keep request creation atomic. Only key names are used here.
  try {
    if (statSync(filePath).size > 1024 * 1024) return "";
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
