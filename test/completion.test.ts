import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionNotifier } from "../src/inline/completion";

test("completion sends one continuation message after delivery and excludes request values", async () => {
  const messages: unknown[] = [];
  const notify = createCompletionNotifier({
    getHostCapabilities: () => ({ message: { text: {} } }),
    sendMessage: async (message) => { messages.push(message); return {}; },
  });
  assert.equal(await notify("req_demo", "pending"), undefined);
  assert.equal(await notify("req_demo", "executing"), undefined);
  assert.equal(messages.length, 0);
  assert.equal(await notify("req_demo", "completed"), "sent");
  await notify("req_demo", "completed");
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], {
    role: "user",
    content: [{ type: "text", text: "SecureInput request req_demo completed. Continue the task using the configured delivery. Keep secret values out of chat." }],
  });
});

test("failed delivery reports failure rather than success", async () => {
  let text = "";
  const notify = createCompletionNotifier({
    getHostCapabilities: () => ({ message: { text: {} } }),
    sendMessage: async (message) => { text = message.content[0].text; return {}; },
  });
  await notify("req_failure", "failed");
  assert.match(text, /status failed/);
  assert.doesNotMatch(text, /completed/);
});

test("unsupported, rejected, or disconnected hosts expose continuation fallback", async () => {
  for (const mode of ["unsupported", "rejected", "disconnected"]) {
    const notify = createCompletionNotifier({
      getHostCapabilities: () => mode === "unsupported" ? {} : { message: { text: {} } },
      sendMessage: async () => {
        assert.notEqual(mode, "unsupported");
        if (mode === "disconnected") throw new Error("Host disconnected");
        return { isError: true };
      },
    });
    assert.equal(await notify("req_demo", "completed"), "unavailable");
  }
});
