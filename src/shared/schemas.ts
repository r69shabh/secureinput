import { RE2JS } from "re2js";
import { z } from "zod";

export const FIELD_ID_PATTERN = "^[a-zA-Z_][a-zA-Z0-9_]{0,63}$";
export const ENV_KEY_PATTERN = "^[A-Za-z_][A-Za-z0-9_]*$";
export const TEMPLATE_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}\}/g;

const noNul = (value: string) => !value.includes("\0");
const controlFree = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

export const secretFieldSchema = z
  .object({
    id: z.string().regex(new RegExp(FIELD_ID_PATTERN), "Use letters, numbers, and underscores; start with a letter or underscore."),
    label: z.string().trim().min(1, "A label is required.").max(80),
    description: z.string().trim().max(300).optional(),
    type: z.enum(["password", "text"]).default("password"),
    placeholder: z.string().trim().max(120).optional(),
    minLength: z.number().int().min(0).max(8192).optional(),
    maxLength: z.number().int().min(1).max(8192).optional(),
    pattern: z.string().min(1).max(200).refine(noNul, "Pattern contains an invalid character.").optional(),
    required: z.boolean().default(true),
    sensitive: z.boolean().optional(),
    autocomplete: z
      .enum(["off", "username", "current-password", "new-password", "one-time-code"])
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minLength"], message: "minLength cannot exceed maxLength." });
    }
    if (field.pattern) {
      try {
        RE2JS.compile(field.pattern);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "Pattern is not a valid RE2 expression." });
      }
    }
  });

export const executeDeliverySchema = z.object({
  mode: z.literal("execute"),
  command: z
    .string()
    .trim()
    .min(1, "A command is required.")
    .max(500)
    .refine(controlFree, "Command contains an invalid control character."),
  args: z
    .array(z.string().max(2000).refine(controlFree, "Argument contains an invalid control character."))
    .max(64)
    .default([]),
  cwd: z.string().trim().min(1).max(2000).optional(),
  stdin: z.string().max(8192).optional(),
  env: z.record(z.string().regex(new RegExp(ENV_KEY_PATTERN)), z.string().max(8192)).optional(),
  timeoutSeconds: z.number().int().min(1).max(600).default(120),
});

export const writeEnvDeliverySchema = z.object({
  mode: z.literal("write_env"),
  path: z.string().trim().min(1).max(2000).refine(noNul, "Path contains an invalid character."),
  mapping: z
    .record(z.string().regex(new RegExp(FIELD_ID_PATTERN)), z.string().regex(new RegExp(ENV_KEY_PATTERN)))
    .refine((mapping) => Object.keys(mapping).length > 0, "At least one field must be mapped."),
  overwrite: z.boolean().default(false),
});

export const returnDeliverySchema = z.object({
  mode: z.literal("return"),
});

export const deliverySchema = z.discriminatedUnion("mode", [
  executeDeliverySchema,
  writeEnvDeliverySchema,
  returnDeliverySchema,
]);

export type SecretField = z.infer<typeof secretFieldSchema>;
export type ExecuteDelivery = z.infer<typeof executeDeliverySchema>;
export type WriteEnvDelivery = z.infer<typeof writeEnvDeliverySchema>;
export type ReturnDelivery = z.infer<typeof returnDeliverySchema>;
export type Delivery = z.infer<typeof deliverySchema>;

const baseRequestSchema = z.object({
  title: z.string().trim().min(1, "A title is required.").max(100),
  description: z.string().trim().min(1, "Explain why the secret is needed.").max(1000),
  cwd: z.string().trim().min(1).max(2000).optional(),
  fields: z.array(secretFieldSchema).min(1).max(10),
  delivery: deliverySchema,
  timeoutSeconds: z.number().int().min(30).max(900).default(300),
  waitSeconds: z.number().int().min(0).max(240).default(30),
});

export const requestSecretInputSchema = baseRequestSchema.superRefine((input, ctx) => {
  const ids = new Set<string>();
  for (const field of input.fields) {
    if (ids.has(field.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields"], message: `Duplicate field id: ${field.id}` });
    }
    ids.add(field.id);
  }

  const fieldsById = new Map(input.fields.map((field) => [field.id, field] as const));
  const isSensitive = (field: SecretField) => field.sensitive ?? field.type === "password";

  const checkTemplate = (template: string, location: (string | number)[], allowSensitive: boolean) => {
    const refs = new Set<string>();
    for (const match of template.matchAll(TEMPLATE_PATTERN)) {
      const id = match[1];
      if (!id || !fieldsById.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: location, message: `Unknown field reference: ${id ?? ""}` });
        continue;
      }
      if (!allowSensitive && isSensitive(fieldsById.get(id)!)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: location,
          message: `Sensitive field "${id}" cannot go in command arguments. Use stdin or env instead.`,
        });
      }
      refs.add(id);
    }
    return refs;
  };

  if (input.delivery.mode === "execute") {
    const delivery = input.delivery;
    if (delivery.command.includes("{{")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["delivery", "command"], message: "Command cannot contain placeholders." });
    }
    for (let i = 0; i < delivery.args.length; i += 1) {
      checkTemplate(delivery.args[i] ?? "", ["delivery", "args", i], false);
    }
    const stdinRefs = delivery.stdin ? checkTemplate(delivery.stdin, ["delivery", "stdin"], true) : new Set<string>();
    const envRefs = new Set<string>();
    for (const [key, value] of Object.entries(delivery.env ?? {})) {
      const refs = checkTemplate(value, ["delivery", "env", key], true);
      for (const ref of refs) envRefs.add(ref);
    }
    if (stdinRefs.size + envRefs.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delivery"],
        message: "The secret must be delivered through stdin or an environment variable.",
      });
    }
  }

  if (input.delivery.mode === "write_env") {
    const mapping = input.delivery.mapping;
    const seen = new Map<string, string>();
    for (const [fieldId, envKey] of Object.entries(mapping)) {
      if (!fieldsById.has(fieldId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["delivery", "mapping"], message: `Unknown field reference: ${fieldId}` });
      }
      if (seen.has(envKey)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["delivery", "mapping"], message: `Duplicate environment key: ${envKey}` });
      }
      seen.set(envKey, fieldId);
    }
  }
});

export type RequestSecretInput = z.infer<typeof requestSecretInputSchema>;

export const checkRequestInputSchema = z.object({
  requestId: z.string().min(1).max(100),
  waitSeconds: z.number().int().min(0).max(45).default(30),
});

export const cancelRequestInputSchema = z.object({
  requestId: z.string().min(1).max(100),
});

export const submitRequestSchema = z.object({
  values: z.record(z.string(), z.string()),
  confirmations: z
    .object({
      reviewedCommand: z.boolean().optional(),
      overwrite: z.boolean().optional(),
      sendToAgent: z.boolean().optional(),
    })
    .optional(),
});

export const denyRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
