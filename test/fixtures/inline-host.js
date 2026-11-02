// A local reference host for manual testing; this is not a production chat client.
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const response = await fetch("/demo/start", { method: "POST", headers: { "x-secureinput-demo": "1" } });
if (!response.ok) throw new Error("Could not start the synthetic demo.");
const { result, html, input } = await response.json();
const frame = document.querySelector("iframe");
const bridge = new AppBridge(null, { name: "SecureInput local test host", version: "1" }, { serverTools: {}, openLinks: {} }, { hostContext: { theme: location.pathname === "/preview" ? "dark" : "light" } });
bridge.oncalltool = async (params) => {
  const response = await fetch("/demo/tool", { method: "POST", headers: { "content-type": "application/json", "x-secureinput-demo": "1" }, body: JSON.stringify(params) });
  if (!response.ok) throw new Error("The local test host could not forward the tool call.");
  const result = await response.json();
  const request = result.structuredContent;
  if (request?.status === "completed") document.querySelector("#status").textContent = `Agent result: ${request.status}; command output withheld.`;
  return result;
};
bridge.onopenlink = async ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); return {}; };
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: input });
  await bridge.sendToolResult(result);
};
bridge.onsizechange = ({ height }) => { frame.style.height = `${Math.max(68, height)}px`; };
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.srcdoc = html;
