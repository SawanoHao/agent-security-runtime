import type { SensitiveFinding } from "./types.js";

export type SensitiveSeverity = SensitiveFinding["severity"];

interface Rule {
  id: string;
  severity: SensitiveSeverity;
  label: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: "aws-access-key",
    severity: "critical",
    label: "AWS Access Key ID",
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "openai-key",
    severity: "critical",
    label: "OpenAI API Key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "anthropic-key",
    severity: "critical",
    label: "Anthropic API Key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "github-token",
    severity: "critical",
    label: "GitHub Token",
    pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    id: "slack-token",
    severity: "high",
    label: "Slack Token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "private-key",
    severity: "critical",
    label: "Private Key Block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    id: "jwt",
    severity: "high",
    label: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "generic-secret-assign",
    severity: "high",
    label: "密钥赋值",
    pattern:
      /\b(api[_-]?key|secret|token|password|passwd|access[_-]?key)\b\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  },
  {
    id: "env-file-dump",
    severity: "medium",
    label: ".env 内容特征",
    pattern: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)\b\s*=\s*\S+/g,
  },
  {
    id: "cn-mobile",
    severity: "medium",
    label: "中国大陆手机号",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  },
  {
    id: "cn-id-card",
    severity: "high",
    label: "身份证号",
    pattern: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
  },
  {
    id: "email-cred-pair",
    severity: "medium",
    label: "邮箱+口令上下文",
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b[\s\S]{0,40}\b(password|passwd|口令|密码)\b/gi,
  },
];

export function maskSecret(value: string): string {
  const s = value.trim();
  if (s.length <= 8) return "***";
  if (s.length <= 16) return `${s.slice(0, 2)}***${s.slice(-2)}`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Scan free text for secrets / PII. Dedupes by ruleId+excerpt. */
export function scanSensitiveText(text: string): SensitiveFinding[] {
  if (!text) return [];
  const findings: SensitiveFinding[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      const raw = match[0];
      const excerpt = maskSecret(raw);
      const key = `${rule.id}:${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        label: rule.label,
        excerpt,
      });
      if (findings.length >= 20) return findings;
    }
  }
  return findings;
}

export function highestSensitiveSeverity(
  findings: SensitiveFinding[],
): SensitiveSeverity | null {
  if (!findings.length) return null;
  const rank: Record<SensitiveSeverity, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return findings.reduce(
    (best, item) => (rank[item.severity] > rank[best] ? item.severity : best),
    findings[0].severity,
  );
}
