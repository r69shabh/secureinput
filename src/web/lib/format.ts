import type { PublicSecretRequest, RequestStatus, RiskLevel } from "../../shared/types";

export function formatCountdown(expiresAt: number, now: number): string {
  const remaining = Math.max(0, expiresAt - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function statusLabel(status: RequestStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for you";
    case "executing":
      return "Delivering";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "denied":
      return "Denied";
    case "expired":
      return "Expired";
    case "canceled":
      return "Canceled";
  }
}

export function statusVariant(status: RequestStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "denied") return "destructive";
  if (status === "pending" || status === "executing") return "secondary";
  return "outline";
}

export function riskVariant(level: RiskLevel): "default" | "secondary" | "destructive" | "outline" {
  if (level === "high") return "destructive";
  if (level === "medium") return "secondary";
  return "outline";
}

export function deliveryLabel(request: PublicSecretRequest): string {
  if (request.delivery.mode === "execute") return `Run ${request.delivery.command ?? "command"}`;
  if (request.delivery.mode === "write_env") return "Write .env file";
  return "Return to agent";
}

export function maskCommand(command: string | undefined, args: string[] | undefined): string {
  return [command ?? "", ...(args ?? [])]
    .map((part) => (part.includes(" ") ? JSON.stringify(part) : part))
    .join(" ");
}
