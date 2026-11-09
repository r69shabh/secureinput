import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { PublicSecretRequest } from "../shared/types";
import { encryptInlineSubmission, INLINE_META_KEY, REQUEST_META_KEY, type InlineGrant } from "../shared/inline";
import { validateFieldValues } from "../shared/validation";
import "./style.css";

const bridge = new App({ name: "SecureInput", version: "0.1.1" }, {}, { autoResize: false });

function InlineInput() {
  const [request, setRequest] = useState<PublicSecretRequest | null>(null);
  const [grant, setGrant] = useState<InlineGrant | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const submittedAt = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    bridge.ontoolresult = (result) => {
      const incoming = result._meta?.[REQUEST_META_KEY] as PublicSecretRequest | undefined;
      if (incoming) { setRequest(incoming); setValues({}); submittedAt.current = null; setElapsedMs(null); }
      const inline = result._meta?.[INLINE_META_KEY] as InlineGrant | undefined;
      if (inline) setGrant(inline);
      if (typeof result._meta?.browserUrl === "string") setBrowserUrl(result._meta.browserUrl);
    };
    // Adopt the host's own theme, design tokens, and fonts so the field reads
    // as part of the chat UI. Fallbacks in style.css cover hosts that send none.
    const applyTheme = () => {
      const context = bridge.getHostContext();
      const theme = context?.theme ?? "light";
      applyDocumentTheme(theme);
      document.documentElement.dataset.theme = theme;
      if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
      if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
      if (context?.platform) document.documentElement.dataset.platform = context.platform;
    };
    bridge.onhostcontextchanged = applyTheme;
    void bridge.connect().then(() => { applyTheme(); setConnected(true); }).catch(() => setError("Reconnect SecureInput to continue."));
    return () => { void bridge.close(); };
  }, []);

  useEffect(() => {
    if (!connected) return;
    const content = document.querySelector<HTMLElement>(".secure-input");
    if (!content) return;
    // Measure the actual form, not the iframe/document viewport. A host may
    // initially allocate a tall pane; reporting that viewport keeps its blank gap.
    const resize = () => {
      const { width, height } = content.getBoundingClientRect();
      void bridge.sendSizeChanged({ width: Math.ceil(width), height: Math.ceil(height) }).catch(() => undefined);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(content);
    resize();
    return () => observer.disconnect();
  }, [connected]);

  useEffect(() => {
    if (request?.status === "completed" && submittedAt.current !== null) {
      setElapsedMs(Math.round(performance.now() - submittedAt.current));
      submittedAt.current = null;
    }
  }, [request?.status]);

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
    submittedAt.current = performance.now();
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
          <div className="input-wrap"><input id={`input-${field.id}`} type={field.type} value={values[field.id] ?? ""}
            onChange={(event) => { setValues((previous) => ({ ...previous, [field.id]: event.target.value })); setError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }}
            placeholder={field.placeholder ?? "Paste value — it stays out of the chat"}
            disabled={!pending || busy} maxLength={field.maxLength ?? 8192}
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            aria-invalid={Boolean(error)} aria-describedby={error ? "input-error" : undefined} />
            {done && <svg className="success-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" role="img" aria-label="Saved"><path d="m5 12 4 4L19 6" /></svg>}
            {index === request.fields.length - 1 && !done && <button className="submit-arrow" type="button" onClick={() => void send()} disabled={!pending || busy} aria-label={busy || request.status === "executing" ? "Saving" : `Submit ${field.label}`} aria-busy={busy || request.status === "executing"}>
              {busy || request.status === "executing" ? <svg className="saving-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8" strokeOpacity=".2"/><path d="M12 4a8 8 0 0 1 8 8"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>}
            </button>}
          </div>
        </div>
      </div>)}
    </form>}
    {done && <p className="note delivery-time" role="status">Saved{elapsedMs !== null ? ` · ${elapsedMs} ms` : ""}</p>}
    {unavailable && browserUrl && <button className="open-browser" type="button" onClick={() => void bridge.openLink({ url: browserUrl }).catch(() => setError("Run secureinput pair."))}>Open input</button>}
    {error && <p id="input-error" className="note" role="alert">{error}</p>}
    {request?.status === "failed" && !error && <p className="note" role="alert">Delivery failed. Check with the agent.</p>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<InlineInput />);
