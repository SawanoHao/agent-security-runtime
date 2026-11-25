import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  AgentSecurityRuntime,
  advanceSetup,
  getPullJob,
  loadSetupState,
  resetSetup,
  runSetupChecks,
  startModelPull,
  type PolicyProfile,
  type SetupStepId,
} from "@asr/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
const policyPath =
  process.env.ASR_POLICY ?? join(root, "configs/policy.yaml");
const port = Number(process.env.ASR_PORT ?? 8787);
const webDist = join(root, "apps/web/dist");

const runtime = new AgentSecurityRuntime(policyPath);
const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({ ok: true, product: "Agent Security Runtime" }),
);

app.get("/api/status", async (c) => {
  const status = await runtime.status();
  return c.json(status);
});

app.get("/api/setup", async (c) => {
  const state = loadSetupState(runtime.statePath);
  const checks = await runSetupChecks({
    tevModel: runtime.policy.tev.model,
    tevEndpoint: runtime.policy.tev.endpoint,
  });
  return c.json({ state, checks, model: runtime.policy.tev.model });
});

app.post("/api/setup/advance", async (c) => {
  const body = await c.req.json<{
    step: SetupStepId;
    profile?: PolicyProfile;
  }>();
  if (body.profile) {
    applyPolicyProfile(body.profile);
  }
  const state = advanceSetup(
    body.step,
    body.profile ? { profile: body.profile } : undefined,
    runtime.statePath,
  );
  return c.json({ state });
});

app.post("/api/setup/complete", async (c) => {
  const body = await c.req.json<{ profile?: PolicyProfile }>().catch(() => ({}));
  if (body && typeof body === "object" && "profile" in body && body.profile) {
    applyPolicyProfile(body.profile);
  }
  const state = advanceSetup("finish", undefined, runtime.statePath);
  return c.json({ state });
});

app.post("/api/setup/reset", async (c) => {
  const state = resetSetup(runtime.statePath);
  return c.json({ state });
});

app.post("/api/setup/pull-model", async (c) => {
  const body = await c.req.json<{ model?: string }>().catch(() => ({}));
  const model =
    (body && typeof body === "object" && "model" in body && body.model) ||
    runtime.policy.tev.model;
  const { jobId } = startModelPull(String(model));
  return c.json({ jobId, model });
});

app.get("/api/setup/pull-model/:jobId", (c) => {
  const job = getPullJob(c.req.param("jobId"));
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json(job);
});

app.post("/api/gate/prompt", async (c) => {
  const body = await c.req.json<{
    agentId?: string;
    sessionId?: string;
    text: string;
  }>();
  const decision = await runtime.gatePrompt({
    agentId: body.agentId ?? "unknown",
    sessionId: body.sessionId ?? "session",
    text: body.text ?? "",
  });
  return c.json(decision);
});

app.post("/api/gate/tool", async (c) => {
  const body = await c.req.json<{
    agentId?: string;
    sessionId?: string;
    toolName: string;
    argsSummary?: string;
    workspace?: string;
  }>();
  const decision = await runtime.gateTool({
    agentId: body.agentId ?? "unknown",
    sessionId: body.sessionId ?? "session",
    toolName: body.toolName,
    argsSummary: body.argsSummary ?? "",
    workspace: body.workspace,
  });
  return c.json(decision);
});

app.post("/api/scan/skills", async (c) => {
  const body = await c.req.json<{ root?: string }>();
  const scanRoot = body.root ?? join(process.env.HOME ?? "", ".dsh");
  const result = runtime.scanSkillTree(scanRoot);
  return c.json(result);
});

function applyPolicyProfile(profile: PolicyProfile) {
  if (!existsSync(policyPath)) return;
  let text = readFileSync(policyPath, "utf8");
  const thresholds: Record<PolicyProfile, { block: string; ask: string }> = {
    observe: { block: "0.85", ask: "0.55" },
    balanced: { block: "0.35", ask: "0.2" },
    strict: { block: "0.22", ask: "0.12" },
  };
  const t = thresholds[profile];
  text = text.replace(/blockThreshold:\s*[\d.]+/, `blockThreshold: ${t.block}`);
  text = text.replace(/askThreshold:\s*[\d.]+/, `askThreshold: ${t.ask}`);
  writeFileSync(policyPath, text, "utf8");
}

if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
} else {
  app.get("/", (c) =>
    c.html(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>ASR</title></head>
<body style="font-family:system-ui;padding:2rem">
  <h1>Agent Security Runtime</h1>
  <p>WebUI 尚未构建。先运行 <code>npm run build -w @asr/web</code>。</p>
  <p>API: <a href="/api/setup">/api/setup</a></p>
</body></html>`),
  );
}

console.log(`Agent Security Runtime → http://127.0.0.1:${port}`);
console.log(`policy: ${policyPath}`);
console.log(`setup:  ${runtime.statePath}`);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
