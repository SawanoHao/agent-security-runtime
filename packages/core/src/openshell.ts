import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  OpenShellPolicyRevision,
  OpenShellPolicySnapshot,
  OpenShellSandboxPolicy,
  OpenShellStatus,
} from "./types.js";

const execFileAsync = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  timeoutMs = 8000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? e.message ?? String(err),
    };
  }
}

export async function probeOpenShell(): Promise<OpenShellStatus> {
  const which = await run("bash", ["-lc", "command -v openshell"]);
  if (!which.ok || !which.stdout.trim()) {
    return {
      installed: false,
      gatewayConnected: false,
      sandboxes: [],
      error: "openshell CLI not found on PATH",
    };
  }

  const ver = await run("openshell", ["--version"]);
  const version = ver.stdout.trim() || ver.stderr.trim() || undefined;

  const status = await run("openshell", ["status"]);
  const connected =
    status.ok &&
    /Status:\s*Connected/i.test(status.stdout + status.stderr);

  const list = await run("openshell", ["sandbox", "list"]);
  const sandboxes: { name: string; phase: string }[] = [];
  if (list.ok) {
    const lines = list.stdout.split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[0] && parts[0] !== "NAME") {
        sandboxes.push({
          name: parts[0],
          phase: parts[parts.length - 1] ?? "Unknown",
        });
      }
    }
  }

  return {
    installed: true,
    gatewayConnected: connected,
    version: version?.replace(/^openshell\s+/i, ""),
    sandboxes,
    error: connected ? undefined : status.stderr || "gateway not connected",
  };
}

export function resolveOpenShellPolicyFile(
  asrPolicyPath: string,
  configured?: string,
): string | null {
  const candidates: string[] = [];
  if (configured) {
    if (isAbsolute(configured)) candidates.push(configured);
    else {
      candidates.push(resolve(dirname(asrPolicyPath), configured));
      candidates.push(resolve(dirname(asrPolicyPath), "..", configured));
      candidates.push(resolve(process.cwd(), configured));
    }
  }
  candidates.push(join(homedir(), "openshell-dsh", "policy.yaml"));
  const existing = candidates.find((path) => existsSync(path));
  return existing ?? candidates[0] ?? null;
}

function parsePolicyText(text: string): OpenShellSandboxPolicy {
  const raw = parseYaml(text) as OpenShellSandboxPolicy;
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid OpenShell policy YAML");
  }
  return {
    version: 1,
    filesystem_policy: raw.filesystem_policy,
    landlock: raw.landlock,
    network_policies: raw.network_policies ?? {},
  };
}

export function normalizeOpenShellPolicy(
  policy: OpenShellSandboxPolicy,
): OpenShellSandboxPolicy {
  const network: NonNullable<OpenShellSandboxPolicy["network_policies"]> = {};
  for (const [key, rule] of Object.entries(policy.network_policies ?? {})) {
    const name = rule.name?.trim() || key;
    network[name] = {
      name,
      endpoints: (rule.endpoints ?? []).map((endpoint) => ({
        host: String(endpoint.host ?? "").trim(),
        port: Number(endpoint.port ?? 443),
        ...(endpoint.allow_encoded_slash
          ? { allow_encoded_slash: true }
          : {}),
      })),
      binaries: (rule.binaries?.length
        ? rule.binaries
        : [{ path: "/usr/local/bin/node" }]
      ).map((binary) => ({ path: String(binary.path ?? "").trim() })),
    };
  }
  return {
    version: 1,
    filesystem_policy: {
      include_workdir: policy.filesystem_policy?.include_workdir ?? true,
      read_only: [...(policy.filesystem_policy?.read_only ?? [])],
      read_write: [...(policy.filesystem_policy?.read_write ?? [])],
    },
    landlock: {
      compatibility: policy.landlock?.compatibility ?? "best_effort",
    },
    network_policies: network,
  };
}

export function stringifyOpenShellPolicy(policy: OpenShellSandboxPolicy): string {
  const normalized = normalizeOpenShellPolicy(policy);
  return stringifyYaml(normalized, {
    lineWidth: 0,
    defaultKeyType: null,
    defaultStringType: "PLAIN",
  });
}

export function readOpenShellPolicyFile(path: string): {
  policy: OpenShellSandboxPolicy;
  text: string;
} {
  const text = readFileSync(path, "utf8");
  return { policy: normalizeOpenShellPolicy(parsePolicyText(text)), text };
}

export function writeOpenShellPolicyFile(
  path: string,
  policy: OpenShellSandboxPolicy,
): string {
  const text = stringifyOpenShellPolicy(policy);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return text;
}

function parseJson<T>(stdout: string, stderr: string): T {
  const text = stdout.trim() || stderr.trim();
  if (!text) throw new Error("empty OpenShell response");
  return JSON.parse(text) as T;
}

export async function getLiveOpenShellPolicy(sandbox: string): Promise<{
  version?: number;
  hash?: string;
  status?: string;
  scope?: string;
  policy: OpenShellSandboxPolicy | null;
  error?: string;
}> {
  const result = await run("openshell", [
    "policy",
    "get",
    sandbox,
    "--full",
    "-o",
    "json",
  ]);
  if (!result.ok) {
    return {
      policy: null,
      error: result.stderr || result.stdout || "failed to read live policy",
    };
  }
  try {
    const payload = parseJson<{
      version?: number;
      hash?: string;
      status?: string;
      scope?: string;
      policy?: OpenShellSandboxPolicy;
    }>(result.stdout, result.stderr);
    return {
      version: payload.version,
      hash: payload.hash,
      status: payload.status,
      scope: payload.scope,
      policy: payload.policy
        ? normalizeOpenShellPolicy(payload.policy)
        : null,
    };
  } catch (error) {
    return {
      policy: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listOpenShellPolicyRevisions(
  sandbox: string,
): Promise<OpenShellPolicyRevision[]> {
  const result = await run("openshell", [
    "policy",
    "list",
    sandbox,
    "-o",
    "json",
  ]);
  if (!result.ok) return [];
  try {
    const payload = parseJson<{
      revisions?: Array<{
        version?: number;
        hash?: string;
        status?: string;
        scope?: string;
        sandbox?: string;
        created_at_ms?: number;
        loaded_at_ms?: number;
      }>;
    }>(result.stdout, result.stderr);
    return (payload.revisions ?? []).map((item) => ({
      version: Number(item.version ?? 0),
      hash: item.hash,
      status: item.status,
      scope: item.scope,
      sandbox: item.sandbox,
      createdAtMs: item.created_at_ms,
      loadedAtMs: item.loaded_at_ms,
    }));
  } catch {
    return [];
  }
}

export async function applyOpenShellPolicyFile(options: {
  sandbox: string;
  policyFile: string;
  wait?: boolean;
  timeoutSec?: number;
}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const args = [
    "policy",
    "set",
    "--policy",
    options.policyFile,
    options.sandbox,
  ];
  if (options.wait !== false) {
    args.push("--wait", "--timeout", String(options.timeoutSec ?? 60));
  }
  return run("openshell", args, (options.timeoutSec ?? 60) * 1000 + 5000);
}

export interface OpenShellLogLine {
  raw: string;
  /** Original timestamp token from openshell (often unix seconds). */
  ts?: string;
  /** Human-readable local time derived from `ts`. */
  at?: string;
  source?: string;
  level?: string;
  message: string;
  kind: "network" | "policy" | "ssh" | "other";
}

export async function fetchOpenShellLogs(options: {
  sandbox?: string;
  lines?: number;
  level?: string;
  source?: string;
  since?: string;
  /** Keep noisy SSH channel chatter. Default false. */
  includeSsh?: boolean;
}): Promise<{
  ok: boolean;
  sandbox: string;
  raw: string;
  lines: OpenShellLogLine[];
  error?: string;
}> {
  const sandbox = options.sandbox?.trim() || "dsh";
  const fetchN = Math.max(options.lines ?? 200, options.includeSsh === false ? 400 : 200);
  const args = ["logs", sandbox, "-n", String(fetchN)];
  if (options.level) args.push("--level", options.level);
  if (options.source) args.push("--source", options.source);
  if (options.since) args.push("--since", options.since);

  const result = await run("openshell", args, 12000);
  const raw = (result.stdout || result.stderr || "").trim();
  if (!result.ok && !raw) {
    return {
      ok: false,
      sandbox,
      raw: "",
      lines: [],
      error: result.stderr || "failed to read openshell logs",
    };
  }

  let lines = raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => parseOpenShellLogLine(line));

  if (options.includeSsh !== true) {
    lines = lines.filter((line) => line.kind !== "ssh");
  }

  const limit = options.lines ?? 200;
  if (lines.length > limit) lines = lines.slice(-limit);

  return { ok: true, sandbox, raw, lines };
}

export function formatOpenShellTimestamp(raw?: string): string | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1_000_000_000) {
    // OpenShell emits unix seconds (optionally fractional).
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("zh-CN", { hour12: false });
    }
  }
  return raw;
}

function parseOpenShellLogLine(raw: string): OpenShellLogLine {
  const m = raw.match(
    /^\[(?<ts>[^\]]+)\]\s+\[(?<source>[^\]]+)\]\s+\[(?<level>[^\]]+)\]\s+(?<rest>.*)$/,
  );
  const message = m?.groups?.rest ?? raw;
  const lower = message.toLowerCase();
  let kind: OpenShellLogLine["kind"] = "other";
  if (
    /network|connect|dns|tcp|udp|egress|ingress|proxy|whitelist|allowlist|denied|blocked|unreachable|permission denied/.test(
      lower,
    )
  ) {
    kind = "network";
  } else if (/policy|landlock|filesystem|seccomp/.test(lower)) {
    kind = "policy";
  } else if (/ssh|channel/.test(lower)) {
    kind = "ssh";
  }
  const ts = m?.groups?.ts;
  return {
    raw,
    ts,
    at: formatOpenShellTimestamp(ts),
    source: m?.groups?.source,
    level: m?.groups?.level?.trim(),
    message,
    kind,
  };
}

export async function loadOpenShellPolicySnapshot(options: {
  asrPolicyPath: string;
  configuredPolicyFile?: string;
  sandbox?: string;
}): Promise<OpenShellPolicySnapshot> {
  const openshell = await probeOpenShell();
  const sandbox =
    options.sandbox?.trim() ||
    openshell.sandboxes[0]?.name ||
    "dsh";
  const policyFile = resolveOpenShellPolicyFile(
    options.asrPolicyPath,
    options.configuredPolicyFile,
  );
  const fileExists = Boolean(policyFile && existsSync(policyFile));
  let filePolicy: OpenShellSandboxPolicy | null = null;
  let fileText: string | null = null;
  if (fileExists && policyFile) {
    try {
      const loaded = readOpenShellPolicyFile(policyFile);
      filePolicy = loaded.policy;
      fileText = loaded.text;
    } catch (error) {
      fileText = null;
      filePolicy = null;
      openshell.error =
        openshell.error ??
        (error instanceof Error ? error.message : String(error));
    }
  }

  const [live, revisions] = await Promise.all([
    getLiveOpenShellPolicy(sandbox),
    listOpenShellPolicyRevisions(sandbox),
  ]);

  return {
    sandbox,
    policyFile,
    fileExists,
    filePolicy,
    fileText,
    live,
    revisions,
    openshell,
  };
}
