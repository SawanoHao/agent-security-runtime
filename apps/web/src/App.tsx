import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "./Dashboard";
import { SetupWizard } from "./SetupWizard";
import type { SetupState } from "./types";

export function App() {
  const [mode, setMode] = useState<"loading" | "setup" | "console">("loading");
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    try {
      const res = await fetch("/api/setup");
      if (!res.ok) throw new Error(`setup HTTP ${res.status}`);
      const data = (await res.json()) as { state: SetupState };
      setMode(data.state.installCompleted ? "console" : "setup");
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
      setMode("setup");
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  async function reinstall() {
    await fetch("/api/setup/reset", { method: "POST" });
    setMode("setup");
  }

  if (mode === "loading") {
    return (
      <div className="boot">
        <p className="badge mono">ASR</p>
        <h1 className="brand">正在打开安装旅途…</h1>
        {bootError ? <p className="banner bad">{bootError}</p> : null}
      </div>
    );
  }

  if (mode === "setup") {
    return <SetupWizard onFinished={() => setMode("console")} />;
  }

  return <Dashboard onReinstall={() => void reinstall()} />;
}
