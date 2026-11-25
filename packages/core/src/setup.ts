import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { probeOpenShell } from "./openshell.js";
import { detectAgents, defaultAdapters } from "./adapters.js";
import type { SetupCheck, SetupState, SetupStepId } from "./types.js";

const SETUP_STEPS: SetupStepId[] = [
  "welcome",
  "environment",
  "model",
  "agents",
  "policy",
  "finish",
];

export function defaultStatePath(): string {
  return (
    process.env.ASR_STATE ?? join(homedir(), ".asr", "state.json")
  );
}

export function loadSetupState(path = defaultStatePath()): SetupState {
  if (!existsSync(path)) {
    return emptyState();
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SetupState>;
    return {
      ...emptyState(),
      ...raw,
      steps: { ...emptyState().steps, ...(raw.steps ?? {}) },
    };
  } catch {
    return emptyState();
  }
}

export function saveSetupState(state: SetupState, path = defaultStatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function emptyState(): SetupState {
  return {
    version: 1,
    installCompleted: false,
    completedAt: null,
    currentStep: "welcome",
    profile: "balanced",
    steps: {
      welcome: false,
      environment: false,
      model: false,
      agents: false,
      policy: false,
      finish: false,
    },
  };
}

export function advanceSetup(
  step: SetupStepId,
  extras?: Partial<Pick<SetupState, "profile">>,
  path = defaultStatePath(),
): SetupState {
  const state = loadSetupState(path);
  state.steps[step] = true;
  if (extras?.profile) state.profile = extras.profile;
  const idx = SETUP_STEPS.indexOf(step);
  const next = SETUP_STEPS[Math.min(idx + 1, SETUP_STEPS.length - 1)]!;
  state.currentStep = next;
  if (step === "finish") {
    state.installCompleted = true;
    state.completedAt = new Date().toISOString();
    state.currentStep = "finish";
  }
  saveSetupState(state, path);
  return state;
}

export function resetSetup(path = defaultStatePath()): SetupState {
  const state = emptyState();
  saveSetupState(state, path);
  return state;
}

export async function runSetupChecks(opts: {
  tevModel: string;
  tevEndpoint: string;
}): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];

  checks.push({
    id: "node",
    label: "Node.js ≥ 20",
    ok: Number(process.versions.node.split(".")[0]) >= 20,
    detail: `v${process.versions.node}`,
  });

  const ollamaBin = findOllamaBin();
  checks.push({
    id: "ollama_bin",
    label: "Ollama 可执行文件",
    ok: Boolean(ollamaBin),
    detail: ollamaBin ?? "未找到（将提示安装到 ~/.local/ollama）",
  });

  const tevBase = opts.tevEndpoint.replace(/\/v1\/systemone\/?$/, "");
  let ollamaUp = false;
  let hasModel = false;
  let ollamaErr: string | undefined;
  try {
    const res = await fetch(`${tevBase}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    ollamaUp = res.ok;
    if (res.ok) {
      const body = (await res.json()) as { models?: { name: string }[] };
      hasModel = (body.models ?? []).some(
        (m) =>
          m.name === opts.tevModel ||
          m.name.startsWith(`${opts.tevModel.split(":")[0]}:`),
      );
    } else {
      ollamaErr = `HTTP ${res.status}`;
    }
  } catch (err) {
    ollamaErr = err instanceof Error ? err.message : String(err);
  }

  checks.push({
    id: "ollama_serve",
    label: "Ollama 服务",
    ok: ollamaUp,
    detail: ollamaUp ? tevBase : ollamaErr ?? "未启动",
  });

  checks.push({
    id: "tev_model",
    label: `决策模型 ${opts.tevModel}`,
    ok: hasModel,
    detail: hasModel ? "已就绪" : `待拉取：ollama pull ${opts.tevModel}`,
  });

  const openshell = await probeOpenShell();
  checks.push({
    id: "openshell",
    label: "OpenShell",
    ok: openshell.installed,
    detail: openshell.installed
      ? `${openshell.version ?? "ok"}${openshell.gatewayConnected ? " · gateway up" : " · gateway down"}`
      : openshell.error ?? "未安装（可选，用于沙箱）",
    optional: true,
  });

  const agents = detectAgents(defaultAdapters());
  const detected = agents.filter((a) => a.detected);
  checks.push({
    id: "agents",
    label: "本机 Agent",
    ok: detected.length > 0,
    detail:
      detected.length > 0
        ? detected.map((a) => a.name).join(", ")
        : "暂未检测到 DSH / OpenClaw / Hermes",
    optional: true,
  });

  return checks;
}

export function findOllamaBin(): string | undefined {
  const candidates = [
    process.env.OLLAMA_BIN,
    join(homedir(), ".local/ollama/bin/ollama"),
    join(homedir(), ".local/bin/ollama"),
    "/usr/local/bin/ollama",
    "/usr/bin/ollama",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // PATH lookup via `which` is async-unfriendly; try common PATH pieces.
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const p = join(dir, "ollama");
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Fire-and-forget model pull; returns immediately with a job id tracked in memory. */
const pullJobs = new Map<
  string,
  { status: "running" | "ok" | "error"; log: string; startedAt: string }
>();

export function getPullJob(id: string) {
  return pullJobs.get(id);
}

export function startModelPull(model: string): { jobId: string } {
  const jobId = `pull-${Date.now()}`;
  const bin = findOllamaBin() ?? "ollama";
  const libDir = join(homedir(), ".local/ollama/lib/ollama");
  const env = {
    ...process.env,
    PATH: `${join(homedir(), ".local/ollama/bin")}:${process.env.PATH ?? ""}`,
    LD_LIBRARY_PATH: existsSync(libDir)
      ? `${libDir}:${process.env.LD_LIBRARY_PATH ?? ""}`
      : process.env.LD_LIBRARY_PATH,
  };

  pullJobs.set(jobId, {
    status: "running",
    log: `starting: ${bin} pull ${model}\n`,
    startedAt: new Date().toISOString(),
  });

  const child = spawn(bin, ["pull", model], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const append = (chunk: Buffer) => {
    const job = pullJobs.get(jobId);
    if (!job) return;
    job.log += chunk.toString("utf8");
    if (job.log.length > 20_000) job.log = job.log.slice(-16_000);
  };

  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("close", (code) => {
    const job = pullJobs.get(jobId);
    if (!job) return;
    job.status = code === 0 ? "ok" : "error";
    job.log += `\n[exit ${code}]\n`;
  });
  child.on("error", (err) => {
    const job = pullJobs.get(jobId);
    if (!job) return;
    job.status = "error";
    job.log += `\n[error] ${err.message}\n`;
  });

  return { jobId };
}

export { SETUP_STEPS };
