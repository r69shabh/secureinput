import type { Delivery, SecretField } from "../shared/schemas";
import type { DeliverySummary } from "../shared/types";
import { extractTemplateRefs } from "../shared/validation";
import { findEnvKeys } from "../shared/env";
import type { EnvPathInfo } from "./policy";

export function buildDeliverySummary(
  delivery: Delivery,
  fields: SecretField[],
  baseCwd: string,
  envInfo?: EnvPathInfo,
  existingContent?: string,
): DeliverySummary {
  if (delivery.mode === "execute") {
    const stdinFields = delivery.stdin ? extractTemplateRefs(delivery.stdin) : [];
    const envKeys = Object.entries(delivery.env ?? {}).map(([key, value]) => ({
      key,
      fields: extractTemplateRefs(value),
    }));
    return {
      mode: "execute",
      command: delivery.command,
      args: delivery.args,
      cwd: baseCwd,
      stdinFields,
      envKeys,
    };
  }
  if (delivery.mode === "write_env") {
    const existing = findEnvKeys(existingContent ?? "");
    return {
      mode: "write_env",
      path: envInfo?.path,
      mapping: Object.entries(delivery.mapping).map(([fieldId, envKey]) => ({
        fieldId,
        envKey,
        exists: existing.has(envKey),
      })),
    };
  }
  return { mode: "return", returnsToAgent: true };
}

export function fieldIds(fields: SecretField[]): string[] {
  return fields.map((field) => field.id);
}
