import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { highestSensitiveSeverity } from "./sensitive-scan.js";
import type {
  Decision,
  PolicyDecision,
  PromptEvent,
  SensitiveFinding,
  ToolCallEvent,
  TevVerdict,
} from "./types.js";

const PolicySchema = z.object({
  version: z.literal(1),
  product: z.string().default("agent-security-runtime"),
  modules: z
    .object({
      toolSecurity: z.boolean().default(true),
      policyEngine: z.boolean().default(true),
      riskAssessment: z.boolean().default(true),
      sandboxIsolation: z.boolean().default(false),
      sensitiveData: z.boolean().default(false),
    })
    .default({}),
  tev: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default("tev1:0.8b"),
      endpoint: z.string().default("http://127.0.0.1:11434/v1/systemone"),
      /** Block when Tev score >= this (0–1). Tunable; 0.8B needs higher recall bias. */
      blockThreshold: z.number().min(0).max(1).default(0.35),
      askThreshold: z.number().min(0).max(1).default(0.2),
    })
    .default({}),
  tools: z
    .object({
      deny: z.array(z.string()).default([]),
      ask: z.array(z.string()).default([]),
      allow: z.array(z.string()).default(["*"]),
    })
    .default({}),
  skills: z
    .object({
      blockOnSeverity: z
        .enum(["low", "medium", "high", "critical"])
        .default("high"),
    })
    .default({}),
  /** Layer-1 secret/PII rules applied in gatePrompt / gateTool. */
  sensitive: z
    .object({
      /** observe=记日志不改决策；ask=需确认；deny=直接拒绝 */
      onMatch: z.enum(["observe", "ask", "deny"]).default("ask"),
      /** critical 命中时至少升到该决策（仍受 onMatch 上限约束以外的抬升） */
      criticalEscalation: z.enum(["ask", "deny"]).default("deny"),
    })
    .default({}),
  openshell: z
    .object({
      requiredFor: z.array(z.string()).default(["bash", "shell", "exec", "terminal"]),
      policyFile: z.string().optional(),
    })
    .default({}),
});

export type AsrPolicy = z.infer<typeof PolicySchema>;

export function loadPolicy(path: string): AsrPolicy {
  const raw = readFileSync(path, "utf8");
  return PolicySchema.parse(parseYaml(raw));
}

function matchName(patterns: string[], name: string): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => {
    if (p === "*") return true;
    if (p.endsWith("*")) return lower.startsWith(p.slice(0, -1).toLowerCase());
    return lower === p.toLowerCase();
  });
}

function worse(a: Decision, b: Decision): Decision {
  const rank: Record<Decision, number> = {
    allow: 0,
    ask: 1,
    escalate_sandbox: 2,
    deny: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

/** Combine YAML tool rules with optional Tev1 verdict. */
export function decideToolCall(
  policy: AsrPolicy,
  event: ToolCallEvent,
  tev?: TevVerdict,
): PolicyDecision {
  const reasons: string[] = [];
  const matchedRules: string[] = [];
  let decision: Decision = "allow";

  if (!policy.modules.toolSecurity && !policy.modules.policyEngine) {
    return { decision: "allow", reasons: ["tool security modules disabled"], matchedRules };
  }

  if (matchName(policy.tools.deny, event.toolName)) {
    decision = "deny";
    matchedRules.push(`tools.deny:${event.toolName}`);
    reasons.push(`tool "${event.toolName}" is denied by policy`);
  } else if (matchName(policy.tools.ask, event.toolName)) {
    decision = worse(decision, "ask");
    matchedRules.push(`tools.ask:${event.toolName}`);
    reasons.push(`tool "${event.toolName}" requires approval`);
  } else if (
    policy.tools.allow.length > 0 &&
    !matchName(policy.tools.allow, event.toolName)
  ) {
    decision = "deny";
    matchedRules.push(`tools.allow:miss`);
    reasons.push(`tool "${event.toolName}" is not in allow list`);
  }

  if (
    policy.modules.sandboxIsolation &&
    matchName(policy.openshell.requiredFor, event.toolName)
  ) {
    decision = worse(decision, "escalate_sandbox");
    matchedRules.push(`openshell.requiredFor:${event.toolName}`);
    reasons.push(`tool "${event.toolName}" must run inside OpenShell`);
  }

  if (policy.modules.riskAssessment && policy.tev.enabled && tev) {
    if (tev.score >= policy.tev.blockThreshold) {
      decision = worse(decision, "deny");
      matchedRules.push("tev.block");
      reasons.push(`Tev1 score ${tev.score.toFixed(3)} ≥ block ${policy.tev.blockThreshold}`);
    } else if (tev.score >= policy.tev.askThreshold) {
      decision = worse(decision, "ask");
      matchedRules.push("tev.ask");
      reasons.push(`Tev1 score ${tev.score.toFixed(3)} ≥ ask ${policy.tev.askThreshold}`);
    }
  }

  if (reasons.length === 0) reasons.push("default allow");
  return { decision, reasons, tev, matchedRules };
}

export function decidePrompt(
  policy: AsrPolicy,
  _event: PromptEvent,
  tev?: TevVerdict,
): PolicyDecision {
  const reasons: string[] = [];
  const matchedRules: string[] = [];
  let decision: Decision = "allow";

  if (policy.modules.riskAssessment && policy.tev.enabled && tev) {
    if (tev.score >= policy.tev.blockThreshold) {
      decision = "deny";
      matchedRules.push("tev.block");
      reasons.push(`prompt Tev1 score ${tev.score.toFixed(3)} blocked`);
    } else if (tev.score >= policy.tev.askThreshold) {
      decision = "ask";
      matchedRules.push("tev.ask");
      reasons.push(`prompt Tev1 score ${tev.score.toFixed(3)} needs review`);
    }
  }

  if (reasons.length === 0) reasons.push("prompt allowed");
  return { decision, reasons, tev, matchedRules };
}

/** Merge layer-1 sensitive findings into an existing gate decision. */
export function applySensitiveFindings(
  policy: AsrPolicy,
  base: PolicyDecision,
  findings: SensitiveFinding[],
): PolicyDecision {
  if (!policy.modules.sensitiveData || findings.length === 0) {
    return findings.length
      ? { ...base, sensitive: findings }
      : base;
  }

  const reasons = [...base.reasons];
  const matchedRules = [...base.matchedRules];
  let decision = base.decision;
  const top = highestSensitiveSeverity(findings);
  const labels = findings
    .slice(0, 3)
    .map((f) => `${f.label}(${f.excerpt})`)
    .join("、");

  matchedRules.push(`sensitive:${findings.map((f) => f.ruleId).join(",")}`);
  reasons.push(`敏感信息命中 ${findings.length} 条：${labels}`);

  const onMatch = policy.sensitive.onMatch;
  if (onMatch === "ask") {
    decision = worse(decision, "ask");
    matchedRules.push("sensitive.ask");
  } else if (onMatch === "deny") {
    decision = worse(decision, "deny");
    matchedRules.push("sensitive.deny");
  } else {
    matchedRules.push("sensitive.observe");
  }

  if (top === "critical" && onMatch !== "observe") {
    decision = worse(decision, policy.sensitive.criticalEscalation);
    matchedRules.push(`sensitive.critical:${policy.sensitive.criticalEscalation}`);
    reasons.push(`critical 敏感命中 → ${policy.sensitive.criticalEscalation}`);
  }

  // Drop the generic "allowed" reason once we have a real hit.
  const cleaned = reasons.filter(
    (r) => r !== "prompt allowed" && r !== "default allow",
  );

  return {
    ...base,
    decision,
    reasons: cleaned.length ? cleaned : reasons,
    matchedRules,
    sensitive: findings,
  };
}
