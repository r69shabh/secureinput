import { constants, createDecipheriv, generateKeyPair, privateDecrypt, randomBytes, type KeyObject } from "node:crypto";
import { inlineAdditionalData, inlinePayloadSchema, type InlineEnvelope, type InlineGrant } from "../shared/inline";
import { safeEqual } from "./auth";

export interface InlineKeys {
  privateKey: KeyObject;
  grant: InlineGrant;
}

export async function createInlineKeys(): Promise<InlineKeys> {
  return new Promise((resolve, reject) => {
    generateKeyPair("rsa", { modulusLength: 2048 }, (error, publicKey, privateKey) => {
      if (error) return reject(new Error("Could not prepare inline input."));
      resolve({ privateKey, grant: {
        publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        capability: randomBytes(32).toString("base64url"),
      } });
    });
  });
}

/** All errors are intentionally generic: never echo decrypted input. */
export function decryptInlineSubmission(keys: InlineKeys, envelope: InlineEnvelope) {
  const key = privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.key, "base64"));
  let plaintext: Buffer | undefined;
  try {
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(inlineAdditionalData(envelope.requestId));
    decipher.setAuthTag(ciphertext.subarray(-16));
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
    const parsed = inlinePayloadSchema.safeParse(JSON.parse(plaintext.toString("utf8")));
    if (!parsed.success || parsed.data.requestId !== envelope.requestId || !safeEqual(parsed.data.capability, keys.grant.capability)) {
      throw new Error("Invalid inline submission.");
    }
    return { values: parsed.data.values, confirmations: parsed.data.confirmations, action: parsed.data.action };
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}
