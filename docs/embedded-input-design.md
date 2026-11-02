# Embedded secret input: proposed design

Status: implemented as the default MCP Apps path on compatible hosts, with localhost browser fallback. Protocol integration tests and a visible local reference-host test cover encrypted submission and terminal-to-env delivery. Native rendering inside a particular chat product still requires verification; this is not an independent security audit.

## Goal and trust boundary

On an MCP Apps-capable host, show the request and its destination in an embedded form. Submitted field values must not appear in model-visible tool inputs, tool results, or ordinary host logs of tool calls. Continue to support the existing local browser for hosts that cannot render the app or cannot provide the required cryptography.

The host remains trusted: it supplies the iframe, can inspect or alter the widget, and can see widget-only metadata. Encryption does not protect against a malicious or compromised host, browser, extension, or operating system. A host that exposes widget-only metadata to the model also breaks the approval boundary. Local stdio and remotely hosted MCP are different deployment models; a hosted chat service does not automatically gain access to a user's local daemon or filesystem.

## Implemented protocol

1. The daemon creates the normal pending request and, for an app-enabled request, a fresh ephemeral encryption key pair and a random, single-request approval capability. The private key and a hash of the capability remain in the daemon, associated with the request and its expiry. Never expose the daemon's MCP, pairing, or session tokens.
2. Return only requestId/status/inputMode (and exitCode on completion) in the model-visible result. Full non-secret request details go in widget-only metadata. Deliver the capability and public key only in widget-only tool-result `_meta`. Register an MCP App resource and an app-only submission tool. Capability filtering and widget-only metadata are host responsibilities, not authentication provided by the MCP server.
3. The compact widget renders field labels, inputs and Enter. In inline mode, Enter is consent for the requested delivery; browser-style destination review and overwrite checkboxes are not displayed. The browser flow retains them. It does not store input in widget state, send it to the model, or include it in follow-up messages. On submission, it encrypts the field values, confirmation flags, request ID, and capability as a single authenticated envelope with Web Crypto. A fresh AES-GCM key encrypts the payload; RSA-OAEP-SHA-256 encrypts the AES key with the request public key. Bind a protocol version and request ID as authenticated data. The app-only tool receives only the encrypted envelope and routing ID.
4. The daemon enforces size and rate limits before decryption, checks the request is pending and unexpired, decrypts the envelope, compares the capability in constant time, validates the request ID and payload, and applies existing field validation. A verified inline Enter action supplies consent for command/overwrite delivery; browser submissions still require their separate confirmations. Atomically claim the request before delivery. An invalid or replayed envelope must not execute anything. Clear the capability and private key when the request is claimed, canceled, denied, expired, or purged. Normal delivery and redaction rules still apply.
5. Return only status or generic validation errors. Do not log plaintext, private keys, capabilities, or decrypted validation payloads. The host can log ciphertext, so ciphertext and nonces must be fresh for each attempt. The tool result does not contain `returned` values for this path; opt-in return mode intentionally exposes values to the model and uses browser input instead. Agent-facing stdout and stderr are withheld for both modes.

The capability is needed even with app-only visibility: servers receive ordinary tool calls and cannot independently tell whether a model or a widget initiated one. Anyone who obtains the capability can approve that pending request by encrypting their own payload. Widget-only `_meta` is therefore sensitive, and host logs and metadata retention must be evaluated before enabling a host. A capability is not evidence against a malicious host.

## Integration requirements

- The widget must receive the pending request promptly; a long-polling `request_secret` call cannot wait for a form that the host renders only after the call returns. Preserve the text-only client's polling flow.
- Detect MCP Apps support and unavailable `crypto.subtle`; retain a clear local-browser fallback. Confirm whether the host's sandbox is a secure context where Web Crypto works.
- Do not weaken the local server's same-origin, pairing, CSRF, or framing restrictions to make the widget work.
- Preserve browser review controls while keeping the inline form input-only. Plaintext must never be inserted as HTML.
- Test hybrid encryption, tampering, incorrect or expired capabilities, replay, concurrent browser/widget submissions, validation and confirmations, cancellation, result redaction, disabled return mode, and absence of plaintext in serialized MCP traffic and audit logs.
- Exercise an actual compatible host, including metadata isolation, app-only tool visibility, error handling, reloads, fallback, and what that host records. SDK conformance alone does not establish those properties.

## References

- [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html): app resources, host mediation, and app-only tool visibility.
- [OpenAI Apps reference](https://developers.openai.com/plugins/reference): model-visible tool content and widget-only result metadata for ChatGPT.
- [MCP Apps visibility notes](https://py.sdk.modelcontextprotocol.io/advanced/apps/): host-side filtering of app-only tools.

## Running the implementation

`secureinput settings --input-mode inline`, then stop the daemon and reconnect MCP clients. Use `browser` to force browser-only input. `npm test` builds the assets and exercises both HTTP and the built stdio bridge. `npm run demo:host` opens an isolated local reference-host workflow; submit a synthetic key and inspect the completed status. Its iframe intentionally omits form permissions, so submission is handled in JavaScript rather than native form navigation. This test host does not establish native Codex/ChatGPT compatibility.
