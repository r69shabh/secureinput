import path from "node:path";
import type { Delivery } from "../shared/schemas";
import type { DeliverySummary, RiskAssessment, RiskLevel, RiskReason } from "../shared/types";
import type { EnvPathInfo, Policy } from "./policy";

const HIGH_RISK_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "node",
  "nodejs",
  "deno",
  "bun",
  "python",
  "python3",
  "ruby",
  "perl",
  "php",
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "socat",
  "ssh",
  "scp",
  "sftp",
  "ftp",
  "telnet",
  "rsync",
  "env",
  "xargs",
  "npx",
  "pnpx",
]);

const MEDIUM_RISK_COMMANDS = new Set([
  "gh",
  "git",
  "aws",
  "gcloud",
  "az",
  "vercel",
  "netlify",
  "flyctl",
  "fly",
  "heroku",
  "docker",
  "kubectl",
  "helm",
  "npm",
  "pnpm",
  "yarn",
  "pip",
  "pip3",
  "uv",
  "cargo",
  "go",
  "terraform",
  "pulumi",
  "stripe",
]);

function levelFor(level: RiskLevel, next: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high"];
  return order.indexOf(next) > order.indexOf(level) ? next : level;
}

export interface RiskInput {
  delivery: Delivery;
  summary: DeliverySummary;
  policy: Policy;
  baseCwd: string;
  envPath?: EnvPathInfo;
  existingEnvKeys?: Set<string>;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: RiskReason[] = [];
  let level: RiskLevel = "low";

  if (input.delivery.mode === "return") {
    level = "high";
    reasons.push({
      code: "return_to_agent",
      message: "The agent will receive the secret value in its context and transcript.",
    });
  }

  if (input.delivery.mode === "execute") {
    const base = path.basename(input.delivery.command).toLowerCase();
    if (HIGH_RISK_COMMANDS.has(base)) {
      level = levelFor(level, "high");
      reasons.push({
        code: "high_risk_command",
        message: `"${base}" can run arbitrary code or send data to another host. Review the exact destination before approving.`,
      });
    } else if (MEDIUM_RISK_COMMANDS.has(base)) {
      level = levelFor(level, "medium");
      reasons.push({
        code: "network_capable_command",
        message: `"${base}" commonly talks to a remote service. Make sure that service is the intended destination.`,
      });
    }
    if (input.summary.cwd && !isWithin(input.summary.cwd, input.policy.daemonCwd)) {
      level = levelFor(level, "medium");
      reasons.push({ code: "cwd_outside_project", message: `The command runs outside the project directory: ${input.summary.cwd}` });
    }
    if (path.isAbsolute(input.delivery.command)) {
      level = levelFor(level, "medium");
      reasons.push({ code: "absolute_command", message: `The command uses an absolute path: ${input.delivery.command}` });
    }
  }

  if (input.delivery.mode === "write_env") {
    const existing = input.existingEnvKeys ?? new Set<string>();
    if (existing.size > 0) {
      level = "high";
      reasons.push({
        code: "env_overwrite",
        message: `This will replace existing values for: ${[...existing].join(", ")}.`,
      });
    }
    if (input.envPath && !isWithin(input.envPath.path, input.policy.daemonCwd)) {
      level = levelFor(level, "medium");
      reasons.push({ code: "env_outside_project", message: `The env file is outside the project directory: ${input.envPath.path}` });
    }
    if (!input.delivery.overwrite && existing.size > 0) {
      reasons.push({ code: "overwrite_not_allowed", message: "The agent did not request permission to overwrite existing keys." });
    }
  }

  return {
    level,
    reasons,
    requiresCommandReview: level === "high" && input.delivery.mode === "execute",
    requiresOverwriteConfirm: input.delivery.mode === "write_env" && (input.existingEnvKeys?.size ?? 0) > 0,
    requiresReturnConfirm: input.delivery.mode === "return",
  };
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
