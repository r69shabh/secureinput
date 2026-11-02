import type { PublicSecretRequest, PublicState } from "../../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = "request_failed",
    readonly details?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("X-SecureInput-CSRF", "1");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Empty responses are fine for some endpoints.
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      error?.message ?? `Request failed (HTTP ${response.status}).`,
      error?.code ?? "request_failed",
      error?.details,
      response.status,
    );
  }
  return body as T;
}

export const api = {
  session(): Promise<{ authenticated: boolean }> {
    return request("/api/auth/session");
  },
  pair(token: string): Promise<{ ok: true }> {
    return request("/api/auth/pair", { method: "POST", body: JSON.stringify({ token }) });
  },
  logout(): Promise<{ ok: true }> {
    return request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  },
  state(): Promise<PublicState> {
    return request("/api/state");
  },
  submit(
    requestId: string,
    values: Record<string, string>,
    confirmations: { reviewedCommand?: boolean; overwrite?: boolean; sendToAgent?: boolean },
  ): Promise<{ request: PublicSecretRequest }> {
    return request(`/api/requests/${encodeURIComponent(requestId)}/submit`, {
      method: "POST",
      body: JSON.stringify({ values, confirmations }),
    });
  },
  deny(requestId: string, reason?: string): Promise<{ request: PublicSecretRequest }> {
    return request(`/api/requests/${encodeURIComponent(requestId)}/deny`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  cancel(requestId: string): Promise<{ request: PublicSecretRequest }> {
    return request(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
};
