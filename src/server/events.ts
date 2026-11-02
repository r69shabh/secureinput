import type { PublicSecretRequest } from "../shared/types";

export type RequestEvent =
  | { type: "hello"; serverTime: number }
  | { type: "request.created"; request: PublicSecretRequest }
  | { type: "request.updated"; request: PublicSecretRequest }
  | { type: "request.removed"; requestId: string };

export class EventBus {
  private readonly listeners = new Set<(event: RequestEvent) => void>();

  subscribe(listener: (event: RequestEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RequestEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken SSE connection must not affect the request.
      }
    }
  }
}
