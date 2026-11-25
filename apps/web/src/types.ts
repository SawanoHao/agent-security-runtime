export type Decision = "allow" | "ask" | "deny" | "escalate_sandbox";

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

export interface RuntimeStatus {
  product: string;
  version: string;
  modules: {
    id: string;
    name: string;
    enabled: boolean;
    healthy: boolean;
    detail?: string;
  }[];
  agents: {
    id: string;
    name: string;
    kind: string;
    detected: boolean;
    version?: string;
    path?: string;
  }[];
  openshell: {
    installed: boolean;
    gatewayConnected: boolean;
    version?: string;
    sandboxes: { name: string; phase: string }[];
    error?: string;
  };
  tev: {
    endpoint: string;
    model: string;
    reachable: boolean;
    error?: string;
  };
  policyPath: string;
  recentDecisions: {
    id: string;
    at: string;
    agentId: string;
    kind: string;
    decision: Decision;
    summary: string;
    score?: number;
  }[];
  setup: SetupState;
}
