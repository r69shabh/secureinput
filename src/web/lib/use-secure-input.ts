import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicSecretRequest, PublicState } from "../../shared/types";
import { ApiError, api } from "./api";

export type AuthState = "loading" | "unpaired" | "paired";
export type ConnectionState = "connecting" | "live" | "offline";

function isTerminal(request: PublicSecretRequest): boolean {
  return ["completed", "failed", "denied", "expired", "canceled"].includes(request.status);
}

function upsert(list: PublicSecretRequest[], request: PublicSecretRequest): PublicSecretRequest[] {
  const index = list.findIndex((candidate) => candidate.id === request.id);
  if (index === -1) return [request, ...list];
  const next = [...list];
  next[index] = request;
  return next;
}

function applyRequest(state: PublicState, request: PublicSecretRequest): PublicState {
  const requests = upsert(state.requests, request);
  let history = state.history.filter((candidate) => candidate.id !== request.id);
  if (isTerminal(request)) history = [request, ...history].slice(0, 50);
  return { ...state, requests, history };
}

export function useSecureInput() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [state, setState] = useState<PublicState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [pairError, setPairError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);
  const startedRef = useRef(false);

  const apply = useCallback((incoming: PublicSecretRequest) => {
    setState((previous) => (previous ? applyRequest(previous, incoming) : previous));
  }, []);

  const connect = useCallback(() => {
    sourceRef.current?.close();
    const source = new EventSource("/api/events");
    sourceRef.current = source;
    setConnection("connecting");
    source.addEventListener("hello", (event) => {
      try {
        setState(JSON.parse((event as MessageEvent).data) as PublicState);
        setAuth("paired");
        setConnection("live");
      } catch {
        setConnection("offline");
      }
    });
    source.addEventListener("request.created", (event) => {
      apply(JSON.parse((event as MessageEvent).data) as PublicSecretRequest);
    });
    source.addEventListener("request.updated", (event) => {
      apply(JSON.parse((event as MessageEvent).data) as PublicSecretRequest);
    });
    source.addEventListener("request.removed", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { requestId: string };
      setState((previous) => (previous ? { ...previous, requests: previous.requests.filter((item) => item.id !== data.requestId) } : previous));
    });
    source.onopen = () => setConnection("live");
    source.onerror = () => {
      setConnection("offline");
      void api
        .session()
        .then((session) => {
          if (!mountedRef.current) return;
          if (!session.authenticated) {
            source.close();
            sourceRef.current = null;
            setAuth("unpaired");
            setState(null);
          }
        })
        .catch(() => undefined);
    };
  }, [apply]);

  const refresh = useCallback(async () => {
    const next = await api.state();
    if (!mountedRef.current) return;
    setState(next);
    setAuth("paired");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = fragment.get("pair");
      if (token) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        try {
          await api.pair(token);
        } catch (error) {
          if (mountedRef.current) {
            setPairError(error instanceof ApiError ? error.message : "Could not pair this browser.");
          }
        }
      }

      try {
        const session = await api.session();
        if (!session.authenticated) {
          if (mountedRef.current) {
            setAuth("unpaired");
            setConnection("offline");
          }
          return;
        }
        await refresh();
        if (mountedRef.current) connect();
      } catch {
        if (mountedRef.current) {
          setAuth("unpaired");
          setConnection("offline");
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [connect, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state) {
      document.title = "SecureInput";
      return;
    }
    const pending = state.requests.filter((request) => request.status === "pending").length;
    document.title = pending > 0 ? `(${pending}) SecureInput` : "SecureInput";
  }, [state]);

  const pair = useCallback(
    async (token: string) => {
      setPairError(null);
      setAuth("loading");
      try {
        await api.pair(token);
        await refresh();
        connect();
      } catch (error) {
        setAuth("unpaired");
        setPairError(error instanceof ApiError ? error.message : "Could not pair this browser.");
      }
    },
    [connect, refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Clearing the local view is still useful.
    }
    sourceRef.current?.close();
    sourceRef.current = null;
    setState(null);
    setAuth("unpaired");
    setConnection("offline");
  }, []);

  const submit = useCallback(
    async (
      requestId: string,
      values: Record<string, string>,
      confirmations: { reviewedCommand?: boolean; overwrite?: boolean; sendToAgent?: boolean },
    ) => {
      const result = await api.submit(requestId, values, confirmations);
      apply(result.request);
      return result.request;
    },
    [apply],
  );

  const deny = useCallback(
    async (requestId: string, reason?: string) => {
      const result = await api.deny(requestId, reason);
      apply(result.request);
      return result.request;
    },
    [apply],
  );

  const cancel = useCallback(
    async (requestId: string) => {
      const result = await api.cancel(requestId);
      apply(result.request);
      return result.request;
    },
    [apply],
  );

  return {
    auth,
    state,
    connection,
    pairError,
    now,
    pair,
    logout,
    refresh,
    submit,
    deny,
    cancel,
  };
}
