<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Box,
  Globe,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Upload,
} from "lucide-vue-next";

interface NetworkEndpoint {
  host: string;
  port: number;
  allow_encoded_slash?: boolean;
}

interface NetworkRuleRow {
  name: string;
  host: string;
  port: number;
  binary: string;
  allowEncodedSlash: boolean;
}

interface PolicyDoc {
  version: 1;
  filesystem_policy?: {
    include_workdir?: boolean;
    read_only?: string[];
    read_write?: string[];
  };
  landlock?: { compatibility?: string };
  network_policies?: Record<
    string,
    {
      name?: string;
      endpoints?: NetworkEndpoint[];
      binaries?: { path: string }[];
    }
  >;
}

interface Snapshot {
  sandbox: string;
  policyFile: string | null;
  fileExists: boolean;
  filePolicy: PolicyDoc | null;
  fileText: string | null;
  live: {
    version?: number;
    hash?: string;
    status?: string;
    scope?: string;
    policy: PolicyDoc | null;
    error?: string;
  };
  revisions: {
    version: number;
    hash?: string;
    status?: string;
    createdAtMs?: number;
    loadedAtMs?: number;
  }[];
  openshell: {
    installed: boolean;
    gatewayConnected: boolean;
    version?: string;
    sandboxes: { name: string; phase: string }[];
    error?: string;
  };
}

const props = defineProps<{
  sandboxes?: { name: string; phase: string }[];
}>();

const loading = ref(false);
const saving = ref(false);
const applying = ref(false);
const sandbox = ref("dsh");
const snapshot = ref<Snapshot | null>(null);
const rows = ref<NetworkRuleRow[]>([]);
const readOnlyText = ref("");
const readWriteText = ref("");
const includeWorkdir = ref(true);
const yamlText = ref("");
const showYaml = ref(false);

const presets = [
  { name: "news_hn", host: "news.ycombinator.com", port: 443 },
  { name: "techcrunch", host: "techcrunch.com", port: 443 },
  { name: "openai_api", host: "api.openai.com", port: 443 },
  { name: "github", host: "github.com", port: 443 },
];

const form = reactive({
  name: "",
  host: "",
  port: 443,
  binary: "/usr/local/bin/node",
});

const sandboxOptions = computed(() => {
  const names = new Set<string>();
  for (const item of snapshot.value?.openshell.sandboxes ?? []) names.add(item.name);
  for (const item of props.sandboxes ?? []) names.add(item.name);
  if (sandbox.value) names.add(sandbox.value);
  return [...names];
});

const gatewayOk = computed(() => snapshot.value?.openshell.gatewayConnected === true);

function policyToRows(policy: PolicyDoc | null | undefined): NetworkRuleRow[] {
  const next: NetworkRuleRow[] = [];
  for (const [key, rule] of Object.entries(policy?.network_policies ?? {})) {
    const endpoint = rule.endpoints?.[0];
    next.push({
      name: rule.name || key,
      host: endpoint?.host ?? "",
      port: Number(endpoint?.port ?? 443),
      binary: rule.binaries?.[0]?.path || "/usr/local/bin/node",
      allowEncodedSlash: Boolean(endpoint?.allow_encoded_slash),
    });
  }
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

function rowsToPolicy(): PolicyDoc {
  const network_policies: NonNullable<PolicyDoc["network_policies"]> = {};
  for (const row of rows.value) {
    const name = row.name.trim();
    if (!name || !row.host.trim()) continue;
    network_policies[name] = {
      name,
      endpoints: [
        {
          host: row.host.trim(),
          port: Number(row.port) || 443,
          ...(row.allowEncodedSlash ? { allow_encoded_slash: true } : {}),
        },
      ],
      binaries: [{ path: row.binary.trim() || "/usr/local/bin/node" }],
    };
  }
  return {
    version: 1,
    filesystem_policy: {
      include_workdir: includeWorkdir.value,
      read_only: splitLines(readOnlyText.value),
      read_write: splitLines(readWriteText.value),
    },
    landlock: { compatibility: "best_effort" },
    network_policies,
  };
}

function splitLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function applyPolicyToForm(policy: PolicyDoc | null | undefined) {
  rows.value = policyToRows(policy);
  includeWorkdir.value = policy?.filesystem_policy?.include_workdir !== false;
  readOnlyText.value = (policy?.filesystem_policy?.read_only ?? []).join("\n");
  readWriteText.value = (policy?.filesystem_policy?.read_write ?? []).join("\n");
}

async function loadSnapshot(preferred?: string) {
  loading.value = true;
  try {
    const query = new URLSearchParams();
    if (preferred || sandbox.value) query.set("sandbox", preferred || sandbox.value);
    const res = await fetch(`/api/openshell/policy?${query.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Snapshot;
    snapshot.value = data;
    sandbox.value = data.sandbox;
    const source = data.filePolicy ?? data.live.policy;
    applyPolicyToForm(source);
    yamlText.value = data.fileText ?? "";
    if (data.live.error && !data.filePolicy) {
      ElMessage.warning(data.live.error);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

function addRow(partial?: Partial<NetworkRuleRow>) {
  const name = (partial?.name || form.name || `rule_${rows.value.length + 1}`).trim();
  const host = (partial?.host || form.host || "").trim();
  if (!host) {
    ElMessage.warning("请填写主机名");
    return;
  }
  if (rows.value.some((row) => row.name === name)) {
    ElMessage.warning(`规则 ${name} 已存在`);
    return;
  }
  rows.value.push({
    name,
    host,
    port: Number(partial?.port ?? form.port) || 443,
    binary: partial?.binary || form.binary || "/usr/local/bin/node",
    allowEncodedSlash: Boolean(partial?.allowEncodedSlash),
  });
  form.name = "";
  form.host = "";
  form.port = 443;
}

function addPreset(preset: { name: string; host: string; port: number }) {
  addRow({
    name: preset.name,
    host: preset.host,
    port: preset.port,
    binary: "/usr/local/bin/node",
  });
}

function removeRow(index: number) {
  rows.value.splice(index, 1);
}

function loadLiveIntoEditor() {
  if (!snapshot.value?.live.policy) {
    ElMessage.warning("暂无 live 策略");
    return;
  }
  applyPolicyToForm(snapshot.value.live.policy);
  ElMessage.success("已载入沙箱当前生效策略");
}

async function savePolicy(apply: boolean) {
  const policy = rowsToPolicy();
  const runner = apply ? applying : saving;
  runner.value = true;
  try {
    if (apply) {
      await ElMessageBox.confirm(
        `将策略写入文件并应用到沙箱「${sandbox.value}」。仅白名单内的主机可被沙箱访问。`,
        "应用 OpenShell 策略",
        { type: "warning", confirmButtonText: "保存并应用", cancelButtonText: "取消" },
      );
    }
    const res = await fetch("/api/openshell/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sandbox: sandbox.value,
        policy,
        apply,
        wait: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    snapshot.value = data as Snapshot;
    applyPolicyToForm((data as Snapshot).filePolicy ?? policy);
    yamlText.value = (data as { text?: string }).text ?? yamlText.value;
    ElMessage.success(apply ? "策略已保存并应用到沙箱" : "策略文件已保存");
  } catch (error) {
    if (isCancel(error)) return;
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    runner.value = false;
  }
}

async function applyFileOnly() {
  applying.value = true;
  try {
    await ElMessageBox.confirm(
      `使用磁盘上的策略文件应用到沙箱「${sandbox.value}」？`,
      "应用已保存策略",
      { type: "warning", confirmButtonText: "应用", cancelButtonText: "取消" },
    );
    const res = await fetch("/api/openshell/policy/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sandbox: sandbox.value, wait: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    snapshot.value = data as Snapshot;
    applyPolicyToForm((data as Snapshot).filePolicy ?? (data as Snapshot).live.policy);
    ElMessage.success("已应用到沙箱");
  } catch (error) {
    if (isCancel(error)) return;
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    applying.value = false;
  }
}

function isCancel(error: unknown) {
  return error === "cancel" || error === "close" || (error instanceof Error && /cancel|close/i.test(error.message));
}

function stamp(ms?: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

watch(sandbox, (value, old) => {
  if (value && old && value !== old && snapshot.value) {
    void loadSnapshot(value);
  }
});

onMounted(() => {
  void loadSnapshot();
});
</script>

<template>
  <div class="os-panel" v-loading="loading && !snapshot">
    <section class="os-hero">
      <div>
        <div class="os-kicker"><Box :size="16" /> OpenShell</div>
        <h2>沙箱网络与文件系统策略</h2>
        <p>DSH 等 Agent 的出网白名单在这里配置。未列出的主机默认不可达。</p>
      </div>
      <div class="os-actions">
        <el-select v-model="sandbox" style="width: 140px" placeholder="沙箱">
          <el-option v-for="name in sandboxOptions" :key="name" :label="name" :value="name" />
        </el-select>
        <button type="button" class="ghost-btn" :disabled="loading" @click="loadSnapshot()">
          <RefreshCw :size="15" />
          刷新
        </button>
        <button type="button" class="ghost-btn" :disabled="saving" @click="savePolicy(false)">
          <Save :size="15" />
          保存文件
        </button>
        <button type="button" class="primary-btn" :disabled="applying" @click="savePolicy(true)">
          <Upload :size="15" />
          保存并应用
        </button>
      </div>
    </section>

    <section class="os-status">
      <article>
        <span>Gateway</span>
        <strong :class="gatewayOk ? 'ok' : 'bad'">
          {{ gatewayOk ? "已连接" : "未连接" }}
        </strong>
        <small>{{ snapshot?.openshell.version || snapshot?.openshell.error || "—" }}</small>
      </article>
      <article>
        <span>沙箱</span>
        <strong>{{ sandbox }}</strong>
        <small>
          {{
            snapshot?.openshell.sandboxes.find((item) => item.name === sandbox)?.phase || "—"
          }}
        </small>
      </article>
      <article>
        <span>Live 版本</span>
        <strong>v{{ snapshot?.live.version ?? "—" }}</strong>
        <small>{{ snapshot?.live.status || snapshot?.live.error || "—" }}</small>
      </article>
      <article>
        <span>策略文件</span>
        <strong class="path">{{ snapshot?.policyFile || "未解析" }}</strong>
        <small>{{ snapshot?.fileExists ? "磁盘可读" : "文件不存在" }}</small>
      </article>
    </section>

    <section class="os-grid">
      <article class="panel">
        <header class="panel-head">
          <h3><Globe :size="16" /> 网络白名单</h3>
          <button type="button" class="text-link" @click="loadLiveIntoEditor">载入 live 策略</button>
        </header>

        <div class="add-row">
          <el-input v-model="form.name" placeholder="规则名 news_hn" />
          <el-input v-model="form.host" placeholder="主机 news.ycombinator.com" />
          <el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right" />
          <el-input v-model="form.binary" placeholder="二进制路径" />
          <button type="button" class="ghost-btn" @click="addRow()">
            <Plus :size="15" />
            添加
          </button>
        </div>

        <div class="presets">
          <span>快捷放行：</span>
          <button
            v-for="preset in presets"
            :key="preset.name"
            type="button"
            class="chip"
            @click="addPreset(preset)"
          >
            {{ preset.host }}
          </button>
        </div>

        <el-table :data="rows" empty-text="暂无网络规则" size="default">
          <el-table-column label="规则名" min-width="120">
            <template #default="{ row }">
              <el-input v-model="row.name" />
            </template>
          </el-table-column>
          <el-table-column label="主机" min-width="180">
            <template #default="{ row }">
              <el-input v-model="row.host" />
            </template>
          </el-table-column>
          <el-table-column label="端口" width="110">
            <template #default="{ row }">
              <el-input-number v-model="row.port" :min="1" :max="65535" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="二进制" min-width="180">
            <template #default="{ row }">
              <el-input v-model="row.binary" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ $index }">
              <button type="button" class="icon-danger" @click="removeRow($index)">
                <Trash2 :size="15" />
              </button>
            </template>
          </el-table-column>
        </el-table>
      </article>

      <aside class="side-stack">
        <article class="panel">
          <header class="panel-head">
            <h3><Shield :size="16" /> 文件系统</h3>
          </header>
          <label class="toggle">
            <el-switch v-model="includeWorkdir" />
            包含工作目录
          </label>
          <label class="field">
            <span>只读路径</span>
            <el-input v-model="readOnlyText" type="textarea" :rows="6" placeholder="每行一个路径" />
          </label>
          <label class="field">
            <span>读写路径</span>
            <el-input v-model="readWriteText" type="textarea" :rows="5" placeholder="每行一个路径" />
          </label>
          <button type="button" class="ghost-btn wide" :disabled="applying || !snapshot?.fileExists" @click="applyFileOnly">
            <Upload :size="15" />
            仅应用磁盘文件
          </button>
        </article>

        <article class="panel">
          <header class="panel-head">
            <h3>策略历史</h3>
          </header>
          <ul v-if="snapshot?.revisions?.length" class="rev-list">
            <li v-for="item in snapshot.revisions" :key="`${item.version}-${item.hash}`">
              <strong>v{{ item.version }}</strong>
              <span>{{ item.status || "—" }}</span>
              <small>{{ stamp(item.loadedAtMs || item.createdAtMs) }}</small>
            </li>
          </ul>
          <p v-else class="empty">暂无历史</p>
        </article>
      </aside>
    </section>

    <section class="panel yaml-panel">
      <header class="panel-head">
        <h3>策略文件预览</h3>
        <button type="button" class="text-link" @click="showYaml = !showYaml">
          {{ showYaml ? "收起" : "展开 YAML" }}
        </button>
      </header>
      <pre v-if="showYaml" class="yaml">{{ yamlText || "保存后可在此查看文件内容" }}</pre>
      <p v-else class="empty">当前编辑会在「保存文件 / 保存并应用」时写入磁盘策略，再通过 openshell policy set 推到沙箱。</p>
    </section>
  </div>
</template>

<style scoped>
.os-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.os-hero,
.os-status article,
.panel {
  background: #fff;
  border: 1px solid #e8eef6;
  border-radius: 18px;
  box-shadow: 0 10px 28px rgba(59, 111, 245, 0.05);
}

.os-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  background: linear-gradient(90deg, #f5f8ff 0%, #fff 55%);
}

.os-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #3b6ff5;
  font-size: 13px;
  font-weight: 600;
}

.os-hero h2 {
  margin: 8px 0 6px;
  font-size: 22px;
  letter-spacing: -0.03em;
}

.os-hero p {
  margin: 0;
  color: #94a3b8;
  font-size: 13px;
}

.os-actions,
.presets,
.panel-head,
.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.os-status {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.os-status article {
  padding: 14px 16px;
}

.os-status span,
.field span,
.empty {
  color: #94a3b8;
  font-size: 12px;
}

.os-status strong {
  display: block;
  margin-top: 6px;
  font-size: 18px;
  color: #1e293b;
}

.os-status strong.path {
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
}

.os-status strong.ok { color: #16a34a; }
.os-status strong.bad { color: #ea580c; }

.os-status small {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 12px;
}

.os-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.85fr);
  gap: 16px;
  align-items: start;
}

.side-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  padding: 16px 18px 18px;
}

.panel-head {
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
}

.add-row {
  margin-bottom: 10px;
}

.add-row :deep(.el-input),
.add-row :deep(.el-input-number) {
  width: auto;
  flex: 1;
}

.presets {
  margin-bottom: 12px;
  color: #94a3b8;
  font-size: 12px;
}

.chip,
.ghost-btn,
.primary-btn,
.text-link,
.icon-danger {
  font: inherit;
  cursor: pointer;
}

.chip {
  border: 1px solid #e6edf5;
  background: #f8fbff;
  color: #3b6ff5;
  border-radius: 999px;
  padding: 4px 10px;
}

.ghost-btn,
.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
}

.ghost-btn {
  border: 1px solid #e6edf5;
  background: #fff;
  color: #64748b;
}

.ghost-btn.wide {
  width: 100%;
  justify-content: center;
  margin-top: 8px;
}

.primary-btn {
  border: 0;
  background: #3b6ff5;
  color: #fff;
  font-weight: 600;
}

.text-link {
  border: 0;
  background: transparent;
  color: #3b6ff5;
  padding: 0;
  font-size: 13px;
}

.icon-danger {
  border: 0;
  background: transparent;
  color: #ef4444;
}

.toggle,
.field {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.toggle {
  align-items: center;
  color: #475569;
  font-size: 13px;
}

.field {
  flex-direction: column;
}

.rev-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rev-list li {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 2px 10px;
  padding: 10px 0;
  border-bottom: 1px solid #eef2f7;
}

.rev-list strong {
  grid-row: span 2;
  color: #3b6ff5;
}

.rev-list small {
  color: #94a3b8;
  font-size: 12px;
}

.yaml {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 1100px) {
  .os-grid,
  .os-status {
    grid-template-columns: 1fr;
  }
  .os-hero {
    flex-direction: column;
  }
}
</style>
