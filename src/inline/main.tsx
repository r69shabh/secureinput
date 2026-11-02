import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import type { PublicSecretRequest } from "../shared/types";
import { encryptInlineSubmission, INLINE_META_KEY, REQUEST_META_KEY, type InlineGrant } from "../shared/inline";
import { validateFieldValues } from "../shared/validation";
import "./style.css";

const bridge = new App({ name: "SecureInput", version: "0.1.0" }, {});

function InlineInput() {
  const [request, setRequest] = useState<PublicSecretRequest | null>(null);
  const [grant, setGrant] = useState<InlineGrant | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bridge.ontoolresult = (result) => {
      const incoming = result._meta?.[REQUEST_META_KEY] as PublicSecretRequest | undefined;
      if (incoming) { setRequest(incoming); setValues({}); }
      const inline = result._meta?.[INLINE_META_KEY] as InlineGrant | undefined;
      if (inline) setGrant(inline);
      if (typeof result._meta?.browserUrl === "string") setBrowserUrl(result._meta.browserUrl);
    };
    const applyTheme = () => { document.documentElement.style.colorScheme = bridge.getHostContext()?.theme ?? "light"; };
    bridge.onhostcontextchanged = applyTheme;
    void bridge.connect().then(applyTheme).catch(() => setError("Reconnect SecureInput to continue."));
    return () => { void bridge.close(); };
  }, []);

  // No polling while the user types. Only wait after a delivery has started,
  // using an app-only tool so background updates do not clutter model context.
  useEffect(() => {
    if (request?.status !== "executing") return;
    let disposed = false;
    async function wait() {
      try {
        const result = await bridge.callServerTool({ name: "inline_request_status", arguments: { requestId: request!.id, waitSeconds: 45 } });
        const next = result._meta?.[REQUEST_META_KEY] as PublicSecretRequest | undefined;
        if (disposed) return;
        if (next) setRequest(next);
        else if (result.isError) { setError("Check the request status before retrying."); return; }
        if (next?.status === "executing") void wait();
      } catch { if (!disposed) setError("Reconnect SecureInput to check delivery."); }
    }
    void wait();
    return () => { disposed = true; };
  }, [request?.id, request?.status]);

  async function send() {
    if (!request || !grant || busy || request.status !== "pending") return;
    const validation = validateFieldValues(request.fields, values);
    if (!validation.ok) { setError(Object.values(validation.errors)[0] ?? "Enter a value."); return; }
    setBusy(true);
    setError(null);
    try {
      const envelope = await encryptInlineSubmission(request.id, grant, { values: validation.values });
      const result = await bridge.callServerTool({ name: "submit_inline_secret", arguments: envelope });
      const next = result._meta?.[REQUEST_META_KEY] as PublicSecretRequest | undefined;
      if (result.isError || !next) {
        const failure = result.structuredContent?.error as { message?: string } | undefined;
        throw new Error(failure?.message ?? "Could not submit. Check the request status.");
      }
      setRequest(next);
      setGrant(null);
      setValues({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not submit."); }
    finally { setBusy(false); }
  }

  const pending = request?.status === "pending";
  const unavailable = pending && (!grant || !globalThis.crypto?.subtle);
  const done = request?.status === "completed";
  return <main className="secure-input">
    {request && !unavailable && <form onSubmit={(event) => event.preventDefault()} autoComplete="off">
      {request.fields.map((field, index) => <div className="field" key={field.id}>
        <label htmlFor={`input-${field.id}`}>{field.label}</label>
        <div className="input-row">
          <input id={`input-${field.id}`} type={field.type} value={values[field.id] ?? ""}
            onChange={(event) => { setValues((previous) => ({ ...previous, [field.id]: event.target.value })); setError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }}
            disabled={!pending || busy} maxLength={field.maxLength ?? 8192}
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            aria-invalid={Boolean(error)} aria-describedby={error ? "input-error" : undefined} />
          {index === request.fields.length - 1 && <button type="button" onClick={() => void send()} disabled={!pending || busy}>
            {done ? "Done" : busy || request.status === "executing" ? "Entering…" : "Enter"}
          </button>}
        </div>
      </div>)}
    </form>}
    {unavailable && browserUrl && <button type="button" onClick={() => void bridge.openLink({ url: browserUrl }).catch(() => setError("Run secureinput pair."))}>Open input</button>}
    {error && <p id="input-error" role="alert">{error}</p>}
    {request?.status === "failed" && !error && <p role="alert">Delivery failed. Check with the agent.</p>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<InlineInput />);
