import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeStatus } from "./types";

type GateResult = {
  decision: string;
  reasons: string[];
  tev?: { score: number; label: string; latencyMs: number; model: string };
  matchedRules: string[];
};

type Props = {
  onReinstall: () => void;
};

export function Dashboard({ onReinstall }: Props) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [probeText, setProbeText] = useState(
    "请帮我总结一下今天的会议纪要。",
  );
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<GateResult | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`status HTTP ${res.status}`);
      setStatus((await res.json()) as RuntimeStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const protectedOk = useMemo(() => {
    if (!status) return false;
    const enabled = status.modules.filter((m) => m.enabled);
    return (
      enabled.length > 0 &&
      enabled.every((m) => m.healthy || m.id === "sensitiveData")
    );
  }, [status]);

  async function runProbe() {
    setProbeBusy(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/gate/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "webui",
          sessionId: "console",
          text: probeText,
        }),
      });
      setProbeResult((await res.json()) as GateResult);
      await refresh();
    } finally {
      setProbeBusy(false);
    }
  }

  async function runSkillScan() {
    setScanBusy(true);
    setScanSummary(null);
    try {
      const res = await fetch("/api/scan/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        findings: unknown[];
        blocked: boolean;
      };
      setScanSummary(
        `扫描完成：${data.findings.length} 条命中；策略阻断=${data.blocked ? "是" : "否"}`,
      );
      await refresh();
    } finally {
      setScanBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="badge mono">ASR · security runtime</p>
        <h1 className="brand">Agent Security Runtime</h1>
        <p className="tagline">
          统一控制面：OpenShell 执行隔离 · YAML 策略 · Skill 扫描 · Tev1-0.8B
          风险评估。适配 DSH / OpenClaw / Hermes。
        </p>
        <div className="badge-row">
          {loading && !status ? (
            <span className="badge">加载状态…</span>
          ) : error ? (
            <span className="badge bad">控制面异常：{error}</span>
          ) : (
            <>
              <span className={`badge ${protectedOk ? "ok" : "warn"}`}>
                {protectedOk ? "安全保护已启用" : "部分模块未就绪"}
              </span>
              <span className="badge mono">v{status?.version}</span>
              <span className="badge mono">
                OpenShell{" "}
                {status?.openshell.gatewayConnected ? "已连接" : "未连接"}
              </span>
              <span className="badge mono">
                Tev1 {status?.tev.reachable && !status.tev.error ? "可达" : "离线"}
              </span>
              <span className="badge mono">
                档位 {status?.setup.profile ?? "balanced"}
              </span>
            </>
          )}
        </div>
        <div className="actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            刷新状态
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void runSkillScan()}
            disabled={scanBusy}
          >
            {scanBusy ? "扫描中…" : "扫描 ~/.dsh Skills"}
          </button>
          <button type="button" className="secondary" onClick={onReinstall}>
            重新安装向导
          </button>
        </div>
        {scanSummary ? <p className="empty">{scanSummary}</p> : null}
      </header>

      <div className="grid">
        <section className="panel half">
          <h2>安全模块</h2>
          <div className="module-list">
            {(status?.modules ?? []).map((m) => (
              <div className="row" key={m.id}>
                <div>
                  <strong>{m.name}</strong>
                  <span className="meta mono">{m.detail ?? m.id}</span>
                </div>
                <span
                  className={`pill ${m.enabled ? (m.healthy ? "on" : "ask") : "off"}`}
                >
                  {!m.enabled ? "off" : m.healthy ? "ok" : "degraded"}
                </span>
              </div>
            ))}
            {!status ? <p className="empty">等待控制面…</p> : null}
          </div>
        </section>

        <section className="panel half">
          <h2>已检测 Agent</h2>
          <div className="agent-list">
            {(status?.agents ?? []).map((a) => (
              <div className="row" key={a.id}>
                <div>
                  <strong>{a.name}</strong>
                  <span className="meta mono">
                    {a.detected ? a.path ?? a.kind : "未检测到"}
                  </span>
                </div>
                <span className={`pill ${a.detected ? "on" : "off"}`}>
                  {a.detected ? "detected" : "absent"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel third">
          <h2>OpenShell</h2>
          <div className="row">
            <div>
              <strong>
                {status?.openshell.installed ? "已安装" : "未安装"}
                {status?.openshell.version ? ` · ${status.openshell.version}` : ""}
              </strong>
              <span className="meta">
                Gateway{" "}
                {status?.openshell.gatewayConnected ? "Connected" : "Down"}
                {status?.openshell.error ? ` · ${status.openshell.error}` : ""}
              </span>
              <span className="meta mono">
                sandboxes:{" "}
                {status?.openshell.sandboxes.length
                  ? status.openshell.sandboxes
                      .map((s) => `${s.name}:${s.phase}`)
                      .join(", ")
                  : "none"}
              </span>
            </div>
          </div>
        </section>

        <section className="panel third">
          <h2>Tev1 · JEV</h2>
          <div className="row">
            <div>
              <strong>{status?.tev.model ?? "tev1:0.8b"}</strong>
              <span className="meta mono">{status?.tev.endpoint}</span>
              <span className="meta">
                {status?.tev.error ??
                  (status?.tev.reachable
                    ? "Ollama systemone 就绪"
                    : "等待 Ollama")}
              </span>
            </div>
          </div>
        </section>

        <section className="panel third">
          <h2>策略</h2>
          <div className="row">
            <div>
              <strong>YAML · {status?.setup.profile}</strong>
              <span className="meta mono">{status?.policyPath}</span>
            </div>
          </div>
        </section>

        <section className="panel half">
          <h2>即时探针 · Prompt Gate</h2>
          <div className="probe-box">
            <textarea
              value={probeText}
              onChange={(e) => setProbeText(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void runProbe()}
              disabled={probeBusy}
            >
              {probeBusy ? "评估中…" : "用 Tev1 + 策略评估"}
            </button>
            {probeResult ? (
              <div className="probe-result">
                <div>
                  决策{" "}
                  <span className={`pill ${probeResult.decision}`}>
                    {probeResult.decision}
                  </span>
                  {probeResult.tev ? (
                    <span className="mono">
                      {" "}
                      · score {probeResult.tev.score.toFixed(3)} ·{" "}
                      {probeResult.tev.latencyMs}ms
                    </span>
                  ) : null}
                </div>
                <div className="meta" style={{ marginTop: 8 }}>
                  {probeResult.reasons.join("；")}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel half">
          <h2>最近决策</h2>
          <div className="decision-list">
            {(status?.recentDecisions ?? []).length === 0 ? (
              <p className="empty">
                尚无记录。用左侧探针或接入 Agent 适配器后会出现。
              </p>
            ) : (
              status!.recentDecisions.map((d) => (
                <div className="row" key={d.id}>
                  <div>
                    <strong>
                      {d.kind} · {d.agentId}
                    </strong>
                    <span className="meta">{d.summary}</span>
                    <span className="meta mono">
                      {new Date(d.at).toLocaleString()}
                      {typeof d.score === "number"
                        ? ` · score ${d.score.toFixed(3)}`
                        : ""}
                    </span>
                  </div>
                  <span className={`pill ${d.decision}`}>{d.decision}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <p className="footer mono">
        Agent Security Runtime · Ubuntu control plane · installer journey ·
        tev1:0.8b
      </p>
    </div>
  );
}
