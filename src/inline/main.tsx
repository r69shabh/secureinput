import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { RequestDetail } from "../web/components/request-detail";
import { Button } from "../web/components/ui/button";
import { ApiError } from "../web/lib/api";
import type { PublicSecretRequest } from "../shared/types";
import { encryptInlineSubmission, INLINE_META_KEY, type InlineGrant } from "../shared/inline";
import "../web/index.css";

const bridge = new App({ name: "SecureInput", version: "0.1.0" }, {});

function InlineInput() {
  const [request, setRequest] = useState<PublicSecretRequest | null>(null);
  const [grant, setGrant] = useState<InlineGrant | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const canEncrypt = Boolean(globalThis.crypto?.subtle);

  useEffect(() => {
    bridge.ontoolresult = (result) => {
      const data = result.structuredContent as { request?: PublicSecretRequest; browserUrl?: string } | undefined;
      if (data?.request) setRequest(data.request);
      if (data?.browserUrl) setBrowserUrl(data.browserUrl);
      const inline = result._meta?.[INLINE_META_KEY] as InlineGrant | undefined;
      if (inline) setGrant(inline);
    };
    void bridge.connect().catch(() => setError("Could not connect to this chat host. Use the local SecureInput browser page."));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); void bridge.close(); };
  }, []);

  useEffect(() => {
    if (!request || !["pending", "executing"].includes(request.status)) return;
    let disposed = false;
    let timer: number;
    const refresh = async () => {
      try {
        const result = await bridge.callServerTool({ name: "check_secret_request", arguments: { requestId: request.id, waitSeconds: 0 } });
        const data = result.structuredContent as { request?: PublicSecretRequest } | undefined;
        if (!disposed && data?.request) {
          setRequest(data.request);
          setError(null);
        } else if (!disposed && result.isError) {
          setError("This request is no longer available. Ask the agent to create another.");
          return;
        }
      } catch {
        if (!disposed) setError("Connection interrupted. Reconnect the MCP server or use the local browser.");
      }
      if (!disposed) timer = window.setTimeout(refresh, 2500);
    };
    timer = window.setTimeout(refresh, 2500);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [request?.id, request?.status]);

  useEffect(() => {
    if (request && !["pending", "executing"].includes(request.status)) setGrant(null);
  }, [request?.status]);

  async function send(requestId: string, values: Record<string, string>, confirmations?: Parameters<typeof encryptInlineSubmission>[2]["confirmations"], action?: "deny") {
    if (!grant || !canEncrypt) throw new ApiError("Inline encryption is unavailable. Use the local browser.", "inline_unavailable");
    const envelope = await encryptInlineSubmission(requestId, grant, { values, confirmations, action });
    const result = await bridge.callServerTool({ name: "submit_inline_secret", arguments: envelope });
    const data = result.structuredContent as { request?: PublicSecretRequest; error?: { code: string; message: string; details?: unknown } } | undefined;
    if (result.isError || !data?.request) throw new ApiError(data?.error?.message ?? "Could not submit. Check the request status before retrying.", data?.error?.code ?? "inline_failed", data?.error?.details);
    setRequest(data.request);
    setGrant(null);
    return data.request;
  }

  return <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
    <h1 className="text-lg font-semibold">SecureInput</h1>
    <p className="text-sm text-muted-foreground">Inline input is encrypted before submission to your local daemon. This form runs inside your chat host; use it only with a host you trust. Command output stays local.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {browserUrl && <Button variant="outline" onClick={() => void bridge.openLink({ url: browserUrl }).catch(() => setError("Open the local SecureInput page or run secureinput pair."))}>Use local browser</Button>}
    {!request ? <p role="status" className="text-sm text-muted-foreground">Waiting for a secure input request…</p> : !canEncrypt || (request.status === "pending" && !grant) ? <p role="status" className="text-sm text-muted-foreground">Inline input is unavailable for this request. Finish in the local browser, or run <code>secureinput pair</code>.</p> : <RequestDetail
      request={request} now={now}
      onSubmit={(id, values, confirmations) => send(id, values, confirmations)}
      onDeny={(id) => send(id, {}, undefined, "deny")}
    />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<InlineInput />);
