const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const COMMON_TOKEN_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function base64Variants(value: string): string[] {
  try {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary);
    return [encoded, encoded.replace(/=+$/, ""), encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")];
  } catch {
    return [];
  }
}

export function secretVariants(secret: string): string[] {
  if (secret.length === 0) return [];
  const variants = new Set<string>([secret]);
  try {
    const json = JSON.stringify(secret);
    if (json.length > 2) variants.add(json.slice(1, -1));
  } catch {
    // Ignore encoding failures.
  }
  try {
    variants.add(encodeURIComponent(secret));
  } catch {
    // Ignore encoding failures.
  }
  try {
    variants.add(encodeURI(secret));
  } catch {
    // Ignore encoding failures.
  }
  for (const variant of base64Variants(secret)) {
    if (variant.length >= 4) variants.add(variant);
  }
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

export function redactSecrets(value: string, secrets: string[]): string {
  let output = value;
  const variants = new Set<string>();
  for (const secret of secrets) {
    for (const variant of secretVariants(secret)) variants.add(variant);
  }
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    output = output.split(variant).join("[REDACTED]");
  }
  for (const pattern of COMMON_TOKEN_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

export function sanitizeOutput(value: string, secrets: string[], maxBytes = 256 * 1024): string {
  let output = stripAnsi(value);
  output = redactSecrets(output, secrets);
  const encoder = new TextEncoder();
  if (encoder.encode(output).byteLength > maxBytes) {
    let truncated = output.slice(0, maxBytes);
    while (encoder.encode(truncated).byteLength > maxBytes) truncated = truncated.slice(0, -1);
    output = `${truncated}\n… output truncated …`;
  }
  return output;
}
