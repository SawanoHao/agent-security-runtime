<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  Aim,
  Avatar,
  Box,
  Cpu,
  DataLine,
  Lock,
  Refresh,
  Search,
  Setting,
} from "@element-plus/icons-vue";
import {
  Activity,
  BookOpen,
  Bot,
  Box as LucideBox,
  Crosshair,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Shield,
} from "lucide-vue-next";
import OpenShellPanel from "./OpenShellPanel.vue";
import OverviewPanel from "./OverviewPanel.vue";
import type { RuntimeStatus } from "./types";

const emit = defineEmits<{ reinstall: [] }>();

type View = "overview" | "agents" | "gate" | "activity" | "openshell" | "system";

const view = ref<View>("overview");
const status = ref<RuntimeStatus | null>(null);
const loading = ref(false);
const probeText = ref("请帮我总结一下今天的会议纪要。");
const probeBusy = ref(false);
const probeResult = ref<{
  decision: string;
  reasons: string[];
  tev?: { score: number; label: string; latencyMs: number; model: string };
} | null>(null);
const scanBusy = ref(false);

const titles: Record<View, { title: string; hint: string }> = {
  overview: { title: "总览", hint: "守护每一次 Agent 执行，保障安全与可控" },
  agents: { title: "Agents", hint: "已检测到的 Agent 运行时" },
  gate: { title: "Gate Lab", hint: "Tev1 + 策略即时评估" },
  activity: { title: "决策流", hint: "最近安全决策" },
  openshell: { title: "OpenShell", hint: "沙箱网络白名单与文件系统策略" },
  system: { title: "系统", hint: "策略、安装与 OpenShell" },
};

const nav: { id: View; label: string; icon: unknown }[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "gate", label: "Gate Lab", icon: Crosshair },
  { id: "activity", label: "决策流", icon: Activity },
  { id: "openshell", label: "OpenShell", icon: LucideBox },
  { id: "system", label: "系统", icon: Settings },
];

const protectedOk = computed(() => {
  const mods = status.value?.modules.filter((m) => m.enabled) ?? [];
  return mods.length > 0 && mods.every((m) => m.healthy || m.id === "sensitiveData");
});

const runtimeUp = computed(() => status.value != null);

function tagType(decision: string): "success" | "warning" | "danger" | "info" {
  if (decision === "allow" || decision === "healthy" || decision === "on") return "success";
  if (decision === "deny" || decision === "bad") return "danger";
  if (decision === "ask" || decision === "escalate_sandbox" || decision === "degraded")
    return "warning";
  return "info";
}

function alertType(decision: string): "success" | "warning" | "error" | "info" {
  const t = tagType(decision);
  return t === "danger" ? "error" : t;
}

async function refresh() {
  loading.value = true;
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error(`status HTTP ${res.status}`);
    status.value = (await res.json()) as RuntimeStatus;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
  }
}

async function runProbe() {
  probeBusy.value = true;
  probeResult.value = null;
  try {
    const res = await fetch("/api/gate/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "workbench",
        sessionId: "console",
        text: probeText.value,
      }),
    });
    probeResult.value = await res.json();
    await refresh();
  } finally {
    probeBusy.value = false;
  }
}

async function runSkillScan() {
  scanBusy.value = true;
  try {
    const res = await fetch("/api/scan/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as { findings: unknown[]; blocked: boolean };
    ElMessage.success(
      `扫描完成：${data.findings.length} 条命中，阻断=${data.blocked ? "是" : "否"}`,
    );
    await refresh();
  } finally {
    scanBusy.value = false;
  }
}

let timer = 0;
onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 8000);
});
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <div class="console">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"><Shield :size="20" /></span>
        <div class="brand-name">
          <span>Agent Security</span>
          <span>Runtime</span>
        </div>
      </div>
      <nav class="side-nav">
        <button
          v-for="item in nav"
          :key="item.id"
          type="button"
          class="nav-btn"
          :class="{ active: view === item.id }"
          @click="view = item.id"
        >
          <component :is="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="side-foot">
        <span class="status-dot" :class="{ warn: !protectedOk }" />
        <div>
          <strong>{{ !runtimeUp ? "连接中" : protectedOk ? "运行正常" : "部分降级" }}</strong>
          <small>v{{ status?.version ?? "—" }}</small>
        </div>
      </div>
    </aside>

    <section class="workspace">
      <header class="page-head">
        <div>
          <h1>{{ titles[view].title }}</h1>
          <p>{{ titles[view].hint }}</p>
        </div>
        <div class="top-actions">
          <button type="button" class="icon-btn" title="刷新" :disabled="loading" @click="refresh">
            <RefreshCw :size="16" />
          </button>
          <span class="runtime-pill" :class="{ warn: !runtimeUp }">
            <span class="status-dot" :class="{ warn: !runtimeUp }" />
            {{ runtimeUp ? "运行中" : "未连接" }}
          </span>
          <el-popover placement="bottom-end" :width="320" trigger="click">
            <template #reference>
              <button type="button" class="help-btn">
                <BookOpen :size="16" />
                <span>帮助文档</span>
              </button>
            </template>
            <div class="help-pop">
              <strong>{{ status?.product ?? "Agent Security Runtime" }}</strong>
              <p>
                总览展示模块健康与最近决策。Gate Lab 用 Tev1 和策略做即时评估。OpenShell 页可编辑沙箱网络白名单。系统页可查看策略文件、扫描 Skills，并重新进入安装向导。
              </p>
              <p class="mono">{{ status?.policyPath || "策略文件尚未加载" }}</p>
              <p>当前版本 v{{ status?.version ?? "—" }}</p>
            </div>
          </el-popover>
          <span class="ver-badge">v{{ status?.version ?? "—" }}</span>
        </div>
      </header>

      <div class="workspace-main" v-loading="loading && !status">
        <OverviewPanel
          v-if="view === 'overview'"
          :status="status"
          @navigate="(target) => (view = target)"
        />

        <OpenShellPanel
          v-if="view === 'openshell'"
          :sandboxes="status?.openshell.sandboxes"
        />

        <el-row v-if="view === 'system'" :gutter="16" class="kpi-row">
          <el-col :span="6">
            <el-card shadow="hover" class="stat-card">
              <div class="stat-top">
                <span class="label">姿态</span>
                <el-icon class="stat-ico ok"><Lock /></el-icon>
              </div>
              <div class="value">{{ protectedOk ? "受保护" : status ? "降级" : "—" }}</div>
              <div class="detail">档位 {{ status?.setup.profile ?? "—" }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover" class="stat-card">
              <div class="stat-top">
                <span class="label">Tev1</span>
                <el-icon class="stat-ico cpu"><Cpu /></el-icon>
              </div>
              <div class="value">
                {{ status?.tev.reachable && !status.tev.error ? "在线" : "离线" }}
              </div>
              <div class="detail">{{ status?.tev.model ?? "tev1:0.8b" }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover" class="stat-card">
              <div class="stat-top">
                <span class="label">OpenShell</span>
                <el-icon class="stat-ico box"><Box /></el-icon>
              </div>
              <div class="value">{{ status?.openshell.gatewayConnected ? "已连接" : "未连接" }}</div>
              <div class="detail">{{ status?.openshell.version ?? "未安装" }}</div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover" class="stat-card">
              <div class="stat-top">
                <span class="label">Agents</span>
                <el-icon class="stat-ico agent"><Avatar /></el-icon>
              </div>
              <div class="value">
                {{ status?.agents.filter((a) => a.detected).length ?? 0 }}
                / {{ status?.agents.length ?? 0 }}
              </div>
              <div class="detail">已检测运行时</div>
            </el-card>
          </el-col>
        </el-row>

        <el-card v-if="view === 'agents'" shadow="never">
          <template #header>
            <span class="card-title"><el-icon><Avatar /></el-icon>已检测 Agent</span>
          </template>
          <el-table :data="status?.agents ?? []">
            <el-table-column prop="name" label="名称" width="160" />
            <el-table-column prop="kind" label="类型" width="120" />
            <el-table-column label="路径">
              <template #default="{ row }">
                <span class="mono">{{ row.path || "—" }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.detected ? 'success' : 'info'">
                  {{ row.detected ? "已检测" : "未安装" }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-row v-if="view === 'gate'" :gutter="16">
          <el-col :span="14">
            <el-card shadow="never">
              <template #header>
                <span class="card-title"><el-icon><Aim /></el-icon>Prompt Gate</span>
              </template>
              <div class="gate-box">
                <el-input
                  v-model="probeText"
                  type="textarea"
                  :rows="6"
                  placeholder="粘贴 Agent 提示词或工具意图"
                />
                <div>
                  <el-button type="primary" :icon="Cpu" :loading="probeBusy" @click="runProbe">
                    用 Tev1 + 策略评估
                  </el-button>
                </div>
                <el-alert
                  v-if="probeResult"
                  :title="`决策 ${probeResult.decision}`"
                  :type="alertType(probeResult.decision)"
                  :description="[
                    probeResult.reasons.join('；'),
                    probeResult.tev
                      ? `score ${probeResult.tev.score.toFixed(3)} · ${probeResult.tev.label} · ${probeResult.tev.latencyMs}ms`
                      : '',
                  ].filter(Boolean).join(' · ')"
                  show-icon
                  :closable="false"
                />
              </div>
            </el-card>
          </el-col>
          <el-col :span="10">
            <el-card shadow="never">
              <template #header>
                <span class="card-title"><el-icon><Cpu /></el-icon>感知栈</span>
              </template>
              <el-descriptions :column="1" border>
                <el-descriptions-item label="Tev1">
                  {{ status?.tev.model }}
                  <div class="mono">{{ status?.tev.endpoint }}</div>
                  <div class="mono">{{ status?.tev.error || (status?.tev.reachable ? "systemone 就绪" : "离线") }}</div>
                </el-descriptions-item>
                <el-descriptions-item label="OpenShell">
                  {{ status?.openshell.gatewayConnected ? "Gateway 已连接" : "Gateway 未连接" }}
                  <div class="mono">{{ status?.openshell.version || status?.openshell.error || "—" }}</div>
                </el-descriptions-item>
                <el-descriptions-item label="策略">
                  {{ status?.setup.profile }}
                  <div class="mono">{{ status?.policyPath }}</div>
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
        </el-row>

        <el-card v-if="view === 'activity'" shadow="never">
          <template #header>
            <span class="card-title"><el-icon><DataLine /></el-icon>决策活动</span>
          </template>
          <el-table :data="status?.recentDecisions ?? []" empty-text="暂无决策">
            <el-table-column label="时间" width="180">
              <template #default="{ row }">{{ new Date(row.at).toLocaleString() }}</template>
            </el-table-column>
            <el-table-column label="事件" width="160">
              <template #default="{ row }">{{ row.kind }} · {{ row.agentId }}</template>
            </el-table-column>
            <el-table-column prop="summary" label="摘要" />
            <el-table-column label="分数" width="90">
              <template #default="{ row }">
                {{ typeof row.score === "number" ? row.score.toFixed(3) : "—" }}
              </template>
            </el-table-column>
            <el-table-column label="决策" width="140">
              <template #default="{ row }">
                <el-tag :type="tagType(row.decision)">{{ row.decision }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="view === 'system'" shadow="never" class="panel-gap">
          <template #header>
            <span class="card-title"><el-icon><Setting /></el-icon>运行时</span>
          </template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="产品">
              {{ status?.product }} · v{{ status?.version }}
            </el-descriptions-item>
            <el-descriptions-item label="安装旅途">
              {{ status?.setup.installCompleted ? `已完成 ${status.setup.completedAt ?? ""}` : "未完成" }}
              <el-button :icon="Search" :loading="scanBusy" style="margin-left: 12px" @click="runSkillScan">扫描 Skills</el-button>
              <el-button :icon="Refresh" @click="emit('reinstall')">重新安装向导</el-button>
            </el-descriptions-item>
            <el-descriptions-item label="策略文件">
              <span class="mono">{{ status?.policyPath }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="沙箱">
              {{
                status?.openshell.sandboxes.length
                  ? status.openshell.sandboxes.map((s) => `${s.name}:${s.phase}`).join(", ")
                  : "无"
              }}
              <el-button style="margin-left: 12px" @click="view = 'openshell'">配置 OpenShell 策略</el-button>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </div>
    </section>
  </div>
</template>
