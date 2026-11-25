import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SkillFinding } from "./types.js";

interface Rule {
  id: string;
  severity: SkillFinding["severity"];
  message: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: "inj-ignore-previous",
    severity: "critical",
    message: "Possible instruction-override / prompt injection phrasing",
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)/i,
  },
  {
    id: "inj-jailbreak",
    severity: "high",
    message: "Jailbreak-style role override",
    pattern: /\b(dan\s+mode|developer\s+mode|no\s+restrictions|bypass\s+(safety|guardrails))\b/i,
  },
  {
    id: "exfil-curl-secret",
    severity: "critical",
    message: "Outbound exfil pattern involving secrets/env",
    pattern: /\b(curl|wget|fetch)\b[\s\S]{0,80}\b(api[_-]?key|secret|token|password|AUTHORIZATION)\b/i,
  },
  {
    id: "priv-sudo",
    severity: "high",
    message: "Privilege escalation via sudo/root shell",
    pattern: /\bsudo\s+(-i|-s|su\b)|chmod\s+777\b/i,
  },
  {
    id: "net-raw-socket",
    severity: "medium",
    message: "Raw network or reverse shell indicators",
    pattern: /\b(nc\s+-e|\/dev\/tcp\/|reverse\s+shell|socket\.connect)\b/i,
  },
  {
    id: "skill-hidden-instr",
    severity: "high",
    message: "Hidden instruction block for the model",
    pattern: /<(hidden|system|secret)_instructions?>|<!--\s*SYSTEM:/i,
  },
];

const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".json",
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".py",
  ".sh",
]);

export interface SkillScanOptions {
  root: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export function scanSkills(opts: SkillScanOptions): SkillFinding[] {
  const maxFiles = opts.maxFiles ?? 400;
  const maxBytes = opts.maxBytesPerFile ?? 256_000;
  const findings: SkillFinding[] = [];
  const files = listFiles(opts.root, maxFiles);

  for (const file of files) {
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!TEXT_EXT.has(ext) && !file.endsWith("SKILL.md") && !file.includes("/skills/")) {
      continue;
    }
    let text: string;
    try {
      const st = statSync(file);
      if (!st.isFile() || st.size > maxBytes) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const skillId = relative(opts.root, file) || file;
    for (const rule of RULES) {
      const m = rule.pattern.exec(text);
      if (!m) continue;
      const start = Math.max(0, (m.index ?? 0) - 40);
      const excerpt = text.slice(start, start + 120).replace(/\s+/g, " ");
      findings.push({
        skillId,
        path: file,
        severity: rule.severity,
        ruleId: rule.id,
        message: rule.message,
        excerpt,
      });
    }
  }

  return findings;
}

function listFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

const SEV_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export function shouldBlockSkills(
  findings: SkillFinding[],
  blockOn: SkillFinding["severity"],
): boolean {
  const threshold = SEV_RANK[blockOn];
  return findings.some((f) => SEV_RANK[f.severity] >= threshold);
}
