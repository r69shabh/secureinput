type CompletionStatus = "completed" | "failed" | "denied" | "canceled" | "expired";
const terminalStatuses = new Set<string>(["completed", "failed", "denied", "canceled", "expired"]);

interface CompletionBridge {
  getHostCapabilities(): { message?: { text?: object } } | undefined;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<{ isError?: boolean }>;
}

/** Notify only for requests submitted in this view, once per request. */
export function createCompletionNotifier(bridge: CompletionBridge) {
  const attempted = new Set<string>();
  return async (requestId: string, status: string): Promise<"sent" | "unavailable" | undefined> => {
    if (!terminalStatuses.has(status) || attempted.has(requestId)) return;
    attempted.add(requestId);
    if (!bridge.getHostCapabilities()?.message?.text) return "unavailable";
    const outcome = status as CompletionStatus;
    const text = outcome === "completed"
      ? `SecureInput request ${requestId} completed. Continue the task using the configured delivery. Keep secret values out of chat.`
      : `SecureInput request ${requestId} ended with status ${outcome}. Check its status and handle the result before continuing. Keep secret values out of chat.`;
    try {
      const result = await bridge.sendMessage({ role: "user", content: [{ type: "text", text }] });
      return result.isError ? "unavailable" : "sent";
    } catch {
      return "unavailable";
    }
  };
}
