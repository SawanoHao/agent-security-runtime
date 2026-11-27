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

function ollamaProcessEnv(): NodeJS.ProcessEnv {
  const libDir = join(homedir(), ".local/ollama/lib/ollama");
  return {
    ...process.env,
    PATH: `${join(homedir(), ".local/ollama/bin")}:${process.env.PATH ?? ""}`,
    LD_LIBRARY_PATH: existsSync(libDir)
      ? `${libDir}:${process.env.LD_LIBRARY_PATH ?? ""}`
      : process.env.LD_LIBRARY_PATH,
  };
}

export async function probeOllamaServe(endpoint: string): Promise<{
  running: boolean;
  models: string[];
  error?: string;
}> {
  const base = endpoint.replace(/\/v1\/systemone\/?$/, "");
  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return { running: false, models: [], error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { models?: { name: string }[] };
    return {
      running: true,
      models: (body.models ?? []).map((m) => m.name),
    };
  } catch (err) {
    return {
      running: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function startOllamaServe(): {
  ok: boolean;
  bin?: string;
  alreadyRunning?: boolean;
  error?: string;
} {
  const bin = findOllamaBin();
  if (!bin) {
    return {
      ok: false,
      error: "未找到 ollama，请先安装到 ~/.local/ollama",
    };
  }

  const child = spawn(bin, ["serve"], {
    env: ollamaProcessEnv(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  child.on("error", () => {
    /* probed by caller */
  });
  return { ok: true, bin };
}

export async function ensureTevRuntime(opts: {
  model: string;
  endpoint: string;
  pullIfMissing?: boolean;
  waitMs?: number;
}): Promise<{
  ok: boolean;
  bin?: string;
  running: boolean;
  modelPresent: boolean;
  startedServe: boolean;
  pullJobId?: string;
  actions: string[];
  error?: string;
  models: string[];
}> {
  const actions: string[] = [];
  const bin = findOllamaBin();
  if (!bin) {
    return {
      ok: false,
      running: false,
      modelPresent: false,
      startedServe: false,
      actions,
      error: "未找到 ollama 可执行文件（预期 ~/.local/ollama/bin/ollama）",
      models: [],
    };
  }

  let probe = await probeOllamaServe(opts.endpoint);
  let startedServe = false;
  if (!probe.running) {
    const started = startOllamaServe();
    if (!started.ok) {
      return {
        ok: false,
        bin,
        running: false,
        modelPresent: false,
        startedServe: false,
        actions,
        error: started.error,
        models: [],
      };
    }
    startedServe = true;
    actions.push("started_ollama_serve");
    const deadline = Date.now() + (opts.waitMs ?? 15000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      probe = await probeOllamaServe(opts.endpoint);
      if (probe.running) break;
    }
  } else {
    actions.push("ollama_already_running");
  }

  if (!probe.running) {
    return {
      ok: false,
      bin,
      running: false,
      modelPresent: false,
      startedServe,
      actions,
      error: probe.error ?? "ollama serve 启动超时",
      models: [],
    };
  }

  const modelPresent = probe.models.some(
    (n) =>
      n === opts.model ||
      n === opts.model.replace(":0.8b", "") ||
      n.startsWith(`${opts.model.split(":")[0]}:`),
  );

  let pullJobId: string | undefined;
  if (!modelPresent && opts.pullIfMissing !== false) {
    pullJobId = startModelPull(opts.model).jobId;
    actions.push(`pull_started:${opts.model}`);
  } else if (modelPresent) {
    actions.push("model_ready");
  }

  return {
    ok: modelPresent || Boolean(pullJobId),
    bin,
    running: true,
    modelPresent,
    startedServe,
    pullJobId,
    actions,
    models: probe.models,
    error: modelPresent
      ? undefined
      : pullJobId
        ? `模型 ${opts.model} 正在拉取`
        : `模型 ${opts.model} 未安装`,
  };
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
  const env = ollamaProcessEnv();

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
