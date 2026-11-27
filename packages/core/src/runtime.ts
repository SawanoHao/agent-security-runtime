import { randomUUID } from "node:crypto";
import { detectAgents, defaultAdapters } from "./adapters.js";
import { probeOpenShell } from "./openshell.js";
import {
  applySensitiveFindings,
  decidePrompt,
  decideToolCall,
  loadPolicy,
  type AsrPolicy,
} from "./policy.js";
import { scanSensitiveText } from "./sensitive-scan.js";
import { scanSkills, shouldBlockSkills } from "./skill-scan.js";
import { defaultStatePath, loadSetupState } from "./setup.js";
import { TevClient } from "./tev.js";
import type {
  DecisionRecord,
  PolicyDecision,
  PromptEvent,
  RuntimeStatus,
  ToolCallEvent,
} from "./types.js";

const PRODUCT = "Agent Security Runtime";
const VERSION = "0.1.0";

export class AgentSecurityRuntime {
  readonly policy: AsrPolicy;
  readonly tev: TevClient;
  readonly statePath: string;
  private readonly decisions: DecisionRecord[] = [];
  private readonly maxDecisions = 100;

  constructor(private readonly policyPath: string, statePath?: string) {
    this.policy = loadPolicy(policyPath);
    this.statePath = statePath ?? defaultStatePath();
    this.tev = new TevClient({
      endpoint: this.policy.tev.endpoint,
      model: this.policy.tev.model,
    });
  }

  async status(): Promise<RuntimeStatus> {
    const [openshell, tev] = await Promise.all([
      probeOpenShell(),
      this.tev.status(),
    ]);
    const agents = detectAgents(defaultAdapters());
    const setup = loadSetupState(this.statePath);

    const modules = [
      {
        id: "toolSecurity",
        name: "工具安全",
        enabled: this.policy.modules.toolSecurity,
        healthy: true,
      },
      {
        id: "policyEngine",
        name: "策略管理",
        enabled: this.policy.modules.policyEngine,
        healthy: true,
        detail: this.policyPath,
      },
      {
        id: "riskAssessment",
        name: "风险评估 (Tev1)",
        enabled: this.policy.modules.riskAssessment && this.policy.tev.enabled,
        healthy: tev.reachable && !tev.error,
        detail: tev.error ?? tev.model,
      },
      {
        id: "sandboxIsolation",
        name: "沙箱隔离 (OpenShell)",
        enabled: this.policy.modules.sandboxIsolation,
        healthy: openshell.installed && openshell.gatewayConnected,
        detail: openshell.error ?? openshell.version,
      },
      {
        id: "sensitiveData",
        name: "敏感信息保护",
        enabled: this.policy.modules.sensitiveData,
        healthy: true,
        detail: this.policy.modules.sensitiveData
          ? `Gate 规则扫描 · onMatch=${this.policy.sensitive.onMatch}`
          : "未启用 · 可拦截密钥/PII 外泄",
      },
    ];

    return {
      product: PRODUCT,
      version: VERSION,
      modules,
      agents,
      openshell,
      tev,
      policyPath: this.policyPath,
      recentDecisions: [...this.decisions].slice(0, 30),
      setup,
    };
  }

  async gatePrompt(event: PromptEvent): Promise<PolicyDecision> {
    const tev =
      this.policy.modules.riskAssessment && this.policy.tev.enabled
        ? await this.tev.evaluate(event.text)
        : undefined;
    let decision = decidePrompt(this.policy, event, tev);
    if (this.policy.modules.sensitiveData) {
      decision = applySensitiveFindings(
        this.policy,
        decision,
        scanSensitiveText(event.text),
      );
    }
    this.record({
      agentId: event.agentId,
      kind: "prompt",
      decision: decision.decision,
      summary: summarizeGate(event.text, decision),
      score: tev?.score,
    });
    return decision;
  }

  async gateTool(event: ToolCallEvent): Promise<PolicyDecision> {
    const payload = `tool=${event.toolName}\nargs=${event.argsSummary}`;
    const tev =
      this.policy.modules.riskAssessment && this.policy.tev.enabled
        ? await this.tev.evaluate(payload)
        : undefined;
    let decision = decideToolCall(this.policy, event, tev);
    if (this.policy.modules.sensitiveData) {
      decision = applySensitiveFindings(
        this.policy,
        decision,
        scanSensitiveText(payload),
      );
    }
    this.record({
      agentId: event.agentId,
      kind: "tool",
      decision: decision.decision,
      summary: summarizeGate(
        `${event.toolName} ${event.argsSummary}`.slice(0, 160),
        decision,
      ),
      score: tev?.score,
    });
    return decision;
  }

  scanSkillTree(root: string) {
    const findings = scanSkills({ root });
    const blocked = shouldBlockSkills(
      findings,
      this.policy.skills.blockOnSeverity,
    );
    if (blocked) {
      this.record({
        agentId: "scanner",
        kind: "skill",
        decision: "deny",
        summary: `${findings.length} finding(s) under ${root}`,
      });
    }
    return { findings, blocked };
  }

  private record(
    partial: Omit<DecisionRecord, "id" | "at"> & { score?: number },
  ) {
    this.decisions.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      ...partial,
    });
    if (this.decisions.length > this.maxDecisions) this.decisions.length = this.maxDecisions;
  }
}

function summarizeGate(text: string, decision: PolicyDecision): string {
  const hit = decision.sensitive?.length
    ? ` · 敏感×${decision.sensitive.length}`
    : "";
  return `${text.slice(0, 100)}${hit}`;
}
