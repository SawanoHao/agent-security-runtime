/** Unified decision returned by policy + Tev1. */
export type Decision = "allow" | "ask" | "deny" | "escalate_sandbox";

export type RiskLabel =
  | "benign"
  | "injection"
  | "secret_exfil"
  | "privilege_escalation"
  | "suspicious_skill"
  | "unknown";

export interface TevVerdict {
  score: number;
  label: RiskLabel;
  rationale?: string;
  latencyMs: number;
  model: string;
}

export interface SkillFinding {
  skillId: string;
  path: string;
  severity: "low" | "medium" | "high" | "critical";
  ruleId: string;
  message: string;
  excerpt?: string;
}

export interface ToolCallEvent {
  agentId: string;
  sessionId: string;
  toolName: string;
  argsSummary: string;
  workspace?: string;
}

export interface PromptEvent {
  agentId: string;
  sessionId: string;
  text: string;
}

export interface PolicyDecision {
  decision: Decision;
  reasons: string[];
  tev?: TevVerdict;
  matchedRules: string[];
}

export interface AgentDescriptor {
  id: string;
  name: string;
  kind: "dsh" | "openclaw" | "hermes" | "unknown";
  detected: boolean;
  version?: string;
  path?: string;
}

export interface RuntimeStatus {
  product: string;
  version: string;
  modules: ModuleStatus[];
  agents: AgentDescriptor[];
  openshell: OpenShellStatus;
  tev: TevStatus;
  policyPath: string;
  recentDecisions: DecisionRecord[];
  setup: SetupState;
}

export type SetupStepId =
  | "welcome"
  | "environment"
  | "model"
  | "agents"
  | "policy"
  | "finish";

export type PolicyProfile = "observe" | "balanced" | "strict";

export interface SetupState {
  version: 1;
  installCompleted: boolean;
  completedAt: string | null;
  currentStep: SetupStepId;
  profile: PolicyProfile;
  steps: Record<SetupStepId, boolean>;
}

export interface SetupCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  optional?: boolean;
}

export interface ModuleStatus {
  id: string;
  name: string;
  enabled: boolean;
  healthy: boolean;
  detail?: string;
}

export interface OpenShellStatus {
  installed: boolean;
  gatewayConnected: boolean;
  version?: string;
  sandboxes: { name: string; phase: string }[];
  error?: string;
}

export interface TevStatus {
  endpoint: string;
  model: string;
  reachable: boolean;
  error?: string;
}

export interface DecisionRecord {
  id: string;
  at: string;
  agentId: string;
  kind: "prompt" | "tool" | "skill";
  decision: Decision;
  summary: string;
  score?: number;
}
