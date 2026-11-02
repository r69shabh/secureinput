import { RE2JS } from "re2js";
import { MAX_FIELD_BYTES, MAX_TOTAL_VALUE_BYTES } from "./constants";
import type { SecretField } from "./schemas";

export function isSensitiveField(field: Pick<SecretField, "sensitive" | "type">): boolean {
  return field.sensitive ?? field.type === "password";
}

export function extractTemplateRefs(template: string): string[] {
  const refs = new Set<string>();
  for (const match of template.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}/g)) {
    if (match[1]) refs.add(match[1]);
  }
  return [...refs];
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}/g, (_match, id: string) => values[id] ?? "");
}

export function fieldIsEmpty(field: SecretField, value: string | undefined): boolean {
  if (value === undefined) return true;
  if (field.required === false) return value.length === 0;
  return value.length === 0;
}

export interface FieldValidationResult {
  ok: boolean;
  errors: Record<string, string>;
  values: Record<string, string>;
}

export function validateFieldValues(
  fields: SecretField[],
  rawValues: Record<string, string>,
): FieldValidationResult {
  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};
  let totalBytes = 0;
  const encoder = new TextEncoder();

  for (const field of fields) {
    const raw = rawValues[field.id];
    const value = typeof raw === "string" ? raw : "";
    const empty = field.required === false ? value.length === 0 : value.length === 0;
    if (empty) {
      if (field.required !== false) errors[field.id] = `${field.label} is required.`;
      continue;
    }

    const bytes = encoder.encode(value).byteLength;
    if (bytes > MAX_FIELD_BYTES) {
      errors[field.id] = `${field.label} is too long (maximum ${MAX_FIELD_BYTES} bytes).`;
      continue;
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_VALUE_BYTES) {
      errors[field.id] = "The combined values are too long.";
      continue;
    }
    if (field.minLength !== undefined && value.length < field.minLength) {
      errors[field.id] = `${field.label} must be at least ${field.minLength} characters.`;
      continue;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors[field.id] = `${field.label} must be at most ${field.maxLength} characters.`;
      continue;
    }
    if (field.pattern) {
      try {
        if (!RE2JS.compile(field.pattern).matches(value)) {
          errors[field.id] = `${field.label} does not match the required format.`;
          continue;
        }
      } catch {
        errors[field.id] = `${field.label} has an invalid validation pattern.`;
        continue;
      }
    }
    values[field.id] = value;
  }

  for (const field of fields) {
    if (field.required !== false && !(field.id in values) && !(field.id in errors)) {
      errors[field.id] = `${field.label} is required.`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}

export function sanitizeMetaString(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return clean.length > 0 ? clean : undefined;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const side = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, side)}…${value.slice(value.length - side)}`;
}
