import { z } from "zod";
import { submitRequestSchema } from "./schemas";

export const INLINE_RESOURCE_URI = "ui://secureinput/input.html";
export const INLINE_META_KEY = "secureinput/inline";
export const REQUEST_META_KEY = "secureinput/request";
export const inlineEnvelopeSchema = z.object({
  version: z.literal(1),
  requestId: z.string().regex(/^req_[A-Za-z0-9_-]{20,64}$/),
  key: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).length(344),
  iv: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).length(16),
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(24).max(180_000),
});
export const inlinePayloadSchema = submitRequestSchema.extend({
  action: z.enum(["submit", "deny"]).default("submit"),
  requestId: z.string(),
  capability: z.string().min(40).max(64),
}).strict();
export type InlineEnvelope = z.infer<typeof inlineEnvelopeSchema>;
export interface InlineGrant {
  publicKey: string;
  capability: string;
}
export function inlineAdditionalData(requestId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`secureinput:inline:v1:${requestId}`);
}

function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Runs in the widget. No plaintext is passed to the host bridge. */
export async function encryptInlineSubmission(
  requestId: string,
  grant: InlineGrant,
  submission: z.infer<typeof submitRequestSchema> & { action?: "submit" | "deny" },
): Promise<InlineEnvelope> {
  const publicKey = await crypto.subtle.importKey(
    "spki", Uint8Array.from(atob(grant.publicKey), (char) => char.charCodeAt(0)),
    { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
  );
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...submission, requestId, capability: grant.capability }));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: inlineAdditionalData(requestId), tagLength: 128 }, key, plaintext,
    );
    const rawKey = await crypto.subtle.exportKey("raw", key);
    try {
      const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawKey);
      return { version: 1, requestId, key: base64(wrappedKey), iv: base64(iv.buffer), ciphertext: base64(ciphertext) };
    } finally {
      new Uint8Array(rawKey).fill(0);
    }
  } finally {
    plaintext.fill(0);
  }
}
