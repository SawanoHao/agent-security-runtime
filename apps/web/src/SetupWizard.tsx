import { useCallback, useEffect, useMemo, useState } from "react";
import type { PolicyProfile, SetupCheck, SetupState, SetupStepId } from "./types";

const STEPS: { id: SetupStepId; title: string; blurb: string }[] = [
  { id: "welcome", title: "欢迎", blurb: "认识 Agent Security Runtime" },
  { id: "environment", title: "环境检测", blurb: "检查本机依赖与服务" },
  { id: "model", title: "决策模型", blurb: "Tev1-0.8B 风险评估" },
  { id: "agents", title: "Agent", blurb: "发现已安装的 Agent" },
  { id: "policy", title: "策略档位", blurb: "选择默认安全姿态" },
  { id: "finish", title: "完成", blurb: "进入安全控制台" },
];

const PROFILES: {
  id: PolicyProfile;
  name: string;
  desc: string;
}[] = [
  {
    id: "observe",
    name: "观察",
    desc: "几乎只记录与提示，适合先摸清流量。",
  },
  {
    id: "balanced",
    name: "均衡（推荐）",
    desc: "规则 + Tev1 初筛；危险工具 ask，高风险 deny。",
  },
  {
    id: "strict",
    name: "严格",
    desc: "更低阈值、更易升级到 OpenShell 沙箱。",
  },
];

type Props = {
  onFinished: () => void;
};

export function SetupWizard({ onFinished }: Props) {
  const [state, setState] = useState<SetupState | null>(null);
  const [checks, setChecks] = useState<SetupCheck[]>([]);
  const [model, setModel] = useState("tev1:0.8b");
  const [busy, setBusy] = useState(false);
  const [pullLog, setPullLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PolicyProfile>("balanced");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/setup");
    if (!res.ok) throw new Error(`setup HTTP ${res.status}`);
    const data = (await res.json()) as {
      state: SetupState;
      checks: SetupCheck[];
      model: string;
    };
    setState(data.state);
    setChecks(data.checks);
    setModel(data.model);
    setProfile(data.state.profile);
  }, []);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [refresh]);

  const stepIndex = useMemo(() => {
    if (!state) return 0;
    return Math.max(
      0,
      STEPS.findIndex((s) => s.id === state.currentStep),
    );
  }, [state]);

  const current = STEPS[stepIndex] ?? STEPS[0];

  async function advance(step: SetupStepId, extra?: { profile?: PolicyProfile }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/advance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step, ...extra }),
      });
      if (!res.ok) throw new Error(`advance HTTP ${res.status}`);
      const data = (await res.json()) as { state: SetupState };
      setState(data.state);
      if (data.state.installCompleted) onFinished();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      const res = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) throw new Error(`complete HTTP ${res.status}`);
      onFinished();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pullModel() {
    setBusy(true);
    setPullLog("开始拉取…\n");
    setError(null);
    try {
      const res = await fetch("/api/setup/pull-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const { jobId } = (await res.json()) as { jobId: string };
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const jr = await fetch(`/api/setup/pull-model/${jobId}`);
        const job = (await jr.json()) as {
          status: string;
          log: string;
        };
        setPullLog(job.log.slice(-1200));
        if (job.status !== "running") {
          if (job.status === "error") throw new Error("模型拉取失败");
          break;
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const requiredOk = checks.filter((c) => !c.optional).every((c) => c.ok);
  const modelOk = checks.find((c) => c.id === "tev_model")?.ok ?? false;

  return (
    <div className="setup">
      <aside className="setup-rail">
        <p className="badge mono">ASR Installer</p>
        <h1 className="brand setup-brand">Agent Security Runtime</h1>
        <ol className="setup-steps">
          {STEPS.map((s, i) => {
            const done = state?.steps[s.id];
            const active = s.id === current.id;
            return (
              <li
                key={s.id}
                className={[
                  done ? "done" : "",
                  active ? "active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="idx">{i + 1}</span>
                <div>
                  <strong>{s.title}</strong>
                  <span>{s.blurb}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </aside>

      <main className="setup-main">
        <header className="setup-head">
          <p className="eyebrow mono">
            步骤 {stepIndex + 1} / {STEPS.length}
          </p>
          <h2>{current.title}</h2>
          <p className="tagline">{current.blurb}</p>
        </header>

        {error ? <p className="banner bad">{error}</p> : null}

        {current.id === "welcome" && (
          <div className="setup-card">
            <p>
              这是面向多 Agent（DSH / OpenClaw / Hermes）的本机安全运行时：用
              OpenShell 做执行隔离，YAML 策略做闸门，Skill
              扫描拦危险扩展，Tev1-0.8B 做低延迟风险初筛。
            </p>
            <ul className="feature-list">
              <li>安装完成后进入控制台，而非空白页</li>
              <li>模型与依赖会在旅途中逐项确认</li>
              <li>策略档位可随时在控制台调整</li>
            </ul>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance("welcome")}
              >
                开始安装
              </button>
            </div>
          </div>
        )}

        {current.id === "environment" && (
          <div className="setup-card">
            <div className="check-list">
              {checks.map((c) => (
                <div className="row" key={c.id}>
                  <div>
                    <strong>
                      {c.label}
                      {c.optional ? " · 可选" : ""}
                    </strong>
                    <span className="meta mono">{c.detail}</span>
                  </div>
                  <span className={`pill ${c.ok ? "on" : c.optional ? "ask" : "off"}`}>
                    {c.ok ? "ok" : c.optional ? "skip" : "need"}
                  </span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void refresh()}
              >
                重新检测
              </button>
              <button
                type="button"
                disabled={busy || !requiredOk}
                onClick={() => void advance("environment")}
              >
                {requiredOk ? "继续" : "请先满足必需项"}
              </button>
            </div>
          </div>
        )}

        {current.id === "model" && (
          <div className="setup-card">
            <p>
              使用 Together AI 的 <code className="mono">{model}</code>{" "}
              作为 JEV / System-one 决策模型（约 833MB）。召回偏弱，会与规则引擎叠用。
            </p>
            <div className="row">
              <div>
                <strong>{model}</strong>
                <span className="meta">
                  {modelOk ? "本机已就绪" : "尚未检测到，可一键拉取"}
                </span>
              </div>
              <span className={`pill ${modelOk ? "on" : "ask"}`}>
                {modelOk ? "ready" : "missing"}
              </span>
            </div>
            {pullLog ? (
              <pre className="pull-log mono">{pullLog}</pre>
            ) : null}
            <div className="actions">
              {!modelOk ? (
                <button type="button" disabled={busy} onClick={() => void pullModel()}>
                  {busy ? "拉取中…" : `拉取 ${model}`}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || !modelOk}
                onClick={() => void advance("model")}
              >
                继续
              </button>
            </div>
          </div>
        )}

        {current.id === "agents" && (
          <div className="setup-card">
            <p>已扫描常见 Agent 安装路径。未检测到也不影响安装，稍后可再接入适配器。</p>
            <div className="check-list">
              {checks
                .filter((c) => c.id === "agents" || c.id === "openshell")
                .map((c) => (
                  <div className="row" key={c.id}>
                    <div>
                      <strong>{c.label}</strong>
                      <span className="meta mono">{c.detail}</span>
                    </div>
                    <span className={`pill ${c.ok ? "on" : "off"}`}>
                      {c.ok ? "detected" : "absent"}
                    </span>
                  </div>
                ))}
            </div>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance("agents")}
              >
                继续
              </button>
            </div>
          </div>
        )}

        {current.id === "policy" && (
          <div className="setup-card">
            <div className="profile-grid">
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`profile ${profile === p.id ? "selected" : ""}`}
                  onClick={() => setProfile(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span>{p.desc}</span>
                </button>
              ))}
            </div>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void advance("policy", { profile })}
              >
                应用并继续
              </button>
            </div>
          </div>
        )}

        {current.id === "finish" && (
          <div className="setup-card">
            <p>
              安装旅途完成。控制面将按「{PROFILES.find((p) => p.id === profile)?.name}」
              档位运行，Tev1 与策略闸门已接通。
            </p>
            <ul className="feature-list">
              <li>控制台查看模块健康度与最近决策</li>
              <li>Prompt / Tool Gate 可即时探针</li>
              <li>需要重走安装：控制台里点「重新安装向导」</li>
            </ul>
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => void complete()}>
                进入控制台
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
