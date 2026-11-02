import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { INLINE_META_KEY, INLINE_RESOURCE_URI, inlineEnvelopeSchema, type InlineEnvelope, type InlineGrant } from "../shared/inline";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { APP_NAME, APP_VERSION } from "../shared/constants";
import {
  cancelRequestInputSchema,
  checkRequestInputSchema,
  requestSecretInputSchema,
  type RequestSecretInput,
} from "../shared/schemas";
import type {
  AgentRequestResult,
  PublicSecretRequest,
  RequestSource,
  ServerPolicyInfo,
} from "../shared/types";
import { ServiceError, type SecureInputService } from "./service";
import { sourceFromClientInfo } from "./source";

export interface McpBackend {
  create(input: RequestSecretInput, source: RequestSource, inline?: boolean): Promise<{ request: PublicSecretRequest; inline?: InlineGrant }>;
  submitInline(envelope: InlineEnvelope): Promise<PublicSecretRequest>;
  wait(requestId: string, waitSeconds: number): Promise<AgentRequestResult>;
  cancel(requestId: string): Promise<PublicSecretRequest>;
  status(): Promise<{ policy: ServerPolicyInfo; pending: PublicSecretRequest[] }>;
}

export function createLocalBackend(service: SecureInputService): McpBackend {
  return {
    async create(input, source, inline = false) {
      const created = service.create(input, source, inline);
      if (!inline) return created;
      try {
        return { ...created, inline: await service.prepareInline(created.request.id) };
      } catch (error) {
        if (service.get(created.request.id).status === "pending") service.cancel(created.request.id);
        throw error;
      }
    },
    async submitInline(envelope) { return service.submitInline(envelope); },
    async wait(requestId, waitSeconds) {
      return service.wait(requestId, waitSeconds);
    },
    async cancel(requestId) {
      return service.cancel(requestId);
    },
    async status() {
      return { policy: service.policyInfo(), pending: service.pending() };
    },
  };
}

export function createMcpServer(backend: McpBackend, baseSource: RequestSource, options: { inlineEnabled?: boolean; inlineHtml?: () => string } = {}): McpServer {
  const server = new McpServer(
    { name: "secureinput", version: APP_VERSION, title: APP_NAME },
    {
      instructions: [
        "SecureInput lets the user enter secrets in a local browser UI, or an opt-in encrypted inline form on compatible hosts.",
        "Use request_secret instead of asking the user to paste an API key, password, or token into chat.",
        "Prefer delivery.mode=execute for CLIs and write_env for .env files. Never put a secret in command args.",
        "Secrets are not returned to you unless the user enabled return mode.",
      ].join(" "),
    },
  );

  const source = () => sourceFromClientInfo(baseSource.via, server.server.getClientVersion(), baseSource);

  const readInlineHtml = options.inlineHtml ?? (() => {
    const built = path.resolve(import.meta.dirname, import.meta.url.endsWith(".ts") ? "../../dist/inline/index.html" : "../inline/index.html");
    return readFileSync(built, "utf8");
  });
  let inlineHtml: string | undefined;
  if (options.inlineEnabled) {
    try { inlineHtml = readInlineHtml(); } catch { /* Missing build: keep browser input working. */ }
  }
  const inlineEnabled = inlineHtml !== undefined;
  if (inlineEnabled) {
    registerAppResource(server, "SecureInput", INLINE_RESOURCE_URI, {}, async () => ({ contents: [{
      uri: INLINE_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: inlineHtml!,
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
    }] }));
    registerAppTool(server, "submit_inline_secret", {
      title: "Submit encrypted secure input",
      description: "Widget-only encrypted submission. Never supply plaintext secret values to this tool.",
      inputSchema: inlineEnvelopeSchema,
      _meta: { ui: { visibility: ["app"] } },
      annotations: { openWorldHint: true, destructiveHint: true },
    }, async (envelope) => {
      try {
        const request = await backend.submitInline(envelope);
        return toolResult({ ok: request.status === "completed", pending: request.status === "executing", request });
      } catch (error) { return serviceErrorResult(error); }
    });
  }

  server.registerTool(
    "request_secret",
    {
      title: "Request a secret from the user",
      description: [
        "Open a local secure input page and wait for the user to enter a secret.",
        "Use delivery.mode=execute to pass the secret directly to a non-interactive command via stdin or env, or write_env to store it in an .env file.",
        "Never put a secret field in command args; use stdin/env. The agent receives status and exit details; command output stays local.",
        "Deliveries: execute={command,args?,cwd?,stdin?,env?,timeoutSeconds?}; write_env={path,mapping,overwrite?}; return (disabled by default).",
        "Template syntax in stdin/env values is {{fieldId}}. Example: stdin='{{token}}'.",
        "If the result is pending, call check_secret_request with the requestId.",
      ].join(" "),
      inputSchema: requestSecretInputSchema,
      _meta: inlineEnabled ? { ui: { resourceUri: INLINE_RESOURCE_URI }, "ui/resourceUri": INLINE_RESOURCE_URI } : undefined,
      annotations: { openWorldHint: true, destructiveHint: true },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const inline = Boolean(inlineEnabled && input.delivery.mode !== "return" &&
          getUiCapability(server.server.getClientCapabilities())?.mimeTypes?.includes(RESOURCE_MIME_TYPE));
        const created = await backend.create(input, source(), inline);
        const waited =
          !inline && input.waitSeconds > 0 ? await backend.wait(created.request.id, input.waitSeconds) : { request: created.request };
        const pending = waited.request.status === "pending" || waited.request.status === "executing";
        const result = toolResult({
          ok: waited.request.status === "completed",
          pending,
          request: waited.request,
          browserUrl: `http://127.0.0.1:${(await backend.status()).policy.port}/`,
          returned: waited.returned,
          next: pending
            ? `The user has not submitted yet. Call check_secret_request with requestId="${created.request.id}".`
            : undefined,
        });
        if (created.inline) result._meta = { [INLINE_META_KEY]: created.inline };
        return result;
      } catch (error) {
        return serviceErrorResult(error);
      }
    },
  );

  server.registerTool(
    "check_secret_request",
    {
      title: "Check a pending secure input request",
      description:
        "Wait for or check a secret request created by request_secret. Returns pending, completed, failed, denied, expired, or canceled. Never returns the secret unless return mode is enabled.",
      inputSchema: checkRequestInputSchema,
      annotations: { openWorldHint: false },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const waited = await backend.wait(input.requestId, input.waitSeconds);
        const pending = waited.request.status === "pending" || waited.request.status === "executing";
        return toolResult({
          ok: waited.request.status === "completed",
          pending,
          request: waited.request,
          returned: waited.returned,
          next: pending ? "Still waiting. Ask the user to finish in SecureInput (the inline form or local browser)." : undefined,
        });
      } catch (error) {
        return serviceErrorResult(error);
      }
    },
  );

  server.registerTool(
    "cancel_secret_request",
    {
      title: "Cancel a pending secure input request",
      description: "Cancel a request that has not been submitted by the user yet.",
      inputSchema: cancelRequestInputSchema,
      annotations: { openWorldHint: false, destructiveHint: true },
    },
    async (input): Promise<CallToolResult> => {
      try {
        return toolResult({ ok: true, request: await backend.cancel(input.requestId) });
      } catch (error) {
        return serviceErrorResult(error);
      }
    },
  );

  server.registerTool(
    "secureinput_status",
    {
      title: "SecureInput status",
      description: "Show the local SecureInput daemon policy and any pending secret requests.",
      annotations: { openWorldHint: false },
    },
    async (): Promise<CallToolResult> => {
      const status = await backend.status();
      return toolResult({
        ok: true,
        policy: status.policy,
        pending: status.pending.map((request) => ({
          id: request.id,
          title: request.title,
          status: request.status,
          expiresAt: request.expiresAt,
          source: request.source,
        })),
      });
    },
  );

  return server;
}

function toolResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function serviceErrorResult(error: unknown): CallToolResult {
  if (error instanceof ServiceError) {
    const payload = {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  const payload = { ok: false, error: { code: "internal_error", message } };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}
