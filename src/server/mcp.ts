import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { INLINE_META_KEY, REQUEST_META_KEY, INLINE_RESOURCE_URI, inlineEnvelopeSchema, type InlineEnvelope, type InlineGrant } from "../shared/inline";
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
      instructions: "For secrets use request_secret, never chat. Deliver through execute stdin/env or write_env. Check pending requests with check_secret_request. Values and command output stay local unless return mode is explicitly enabled.",
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
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } },
    }] }));
    registerAppTool(server, "submit_inline_secret", {
      title: "Submit encrypted secure input",
      description: "Submit an encrypted input envelope.",
      inputSchema: inlineEnvelopeSchema,
      _meta: { ui: { visibility: ["app"] } },
      annotations: { openWorldHint: true, destructiveHint: true },
    }, async (envelope) => {
      try {
        const request = await backend.submitInline(envelope);
        return requestResult(request);
      } catch (error) { return serviceErrorResult(error); }
    });
    registerAppTool(server, "inline_request_status", {
      description: "Wait for inline delivery status.", inputSchema: checkRequestInputSchema,
      _meta: { ui: { visibility: ["app"] } }, annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (input) => {
      try { return requestResult((await backend.wait(input.requestId, input.waitSeconds)).request); }
      catch (error) { return serviceErrorResult(error); }
    });
  }

  server.registerTool(
    "request_secret",
    {
      title: "Request a secret from the user",
      description: "Collect secret input. Use {{fieldId}} in execute stdin/env, or map fields to write_env keys. Never put secrets in args. Returns requestId and status.",
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
        const result = requestResult(waited.request, waited.returned);
        result._meta = { ...result._meta, browserUrl: `http://127.0.0.1:${(await backend.status()).policy.port}/`,
          ...(created.inline ? { [INLINE_META_KEY]: created.inline } : {}) };
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
      description: "Wait for request status. Use waitSeconds=45 to avoid repeated polling.",
      inputSchema: checkRequestInputSchema,
      annotations: { openWorldHint: false },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const waited = await backend.wait(input.requestId, input.waitSeconds);
        return requestResult(waited.request, waited.returned);
      } catch (error) {
        return serviceErrorResult(error);
      }
    },
  );

  server.registerTool(
    "cancel_secret_request",
    {
      title: "Cancel a pending secure input request",
      description: "Cancel pending input.",
      inputSchema: cancelRequestInputSchema,
      annotations: { openWorldHint: false, destructiveHint: true },
    },
    async (input): Promise<CallToolResult> => {
      try {
        return requestResult(await backend.cancel(input.requestId));
      } catch (error) {
        return serviceErrorResult(error);
      }
    },
  );

  server.registerTool(
    "secureinput_status",
    {
      title: "SecureInput status",
      description: "Get input mode and pending request IDs.",
      annotations: { openWorldHint: false },
    },
    async (): Promise<CallToolResult> => {
      const status = await backend.status();
      return toolResult({
        inputMode: status.policy.inputMode,
        allowReturn: status.policy.allowReturn,
        pending: status.pending.map((request) => ({
          requestId: request.id,
          status: request.status,
        })),
      });
    },
  );

  return server;
}

function toolResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function requestResult(request: PublicSecretRequest, returned?: Record<string, string>): CallToolResult {
  const payload: Record<string, unknown> = { requestId: request.id, status: request.status };
  if (request.status === "pending") payload.inputMode = request.inputMode;
  if (request.result?.execution) payload.exitCode = request.result.execution.exitCode;
  if (request.status === "failed") payload.error = request.result?.message;
  if (returned) payload.returned = returned;
  return { ...toolResult(payload), _meta: { [REQUEST_META_KEY]: request } };
}

function serviceErrorResult(error: unknown): CallToolResult {
  if (error instanceof ServiceError) {
    const payload = {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  const payload = { ok: false, error: { code: "internal_error", message } };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}
