<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Ban,
  Box,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronRight,
  CircleQuestionMark,
  Download,
  KeyRound,
  ScanSearch,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from "lucide-vue-next";
import type { Decision, RuntimeStatus } from "./types";

const props = defineProps<{ status: RuntimeStatus | null }>();
const emit = defineEmits<{
  navigate: [view: "agents" | "gate" | "activity" | "system" | "openshell"];
}>();

const activeModuleId = ref<string | null>(null);

const moduleIcon: Record<string, unknown> = {
  toolSecurity: ShieldCheck,
  policyEngine: ScrollText,
  riskAssessment: ScanSearch,
  sandboxIsolation: Box,
  sensitiveData: KeyRound,
};

const moduleBlurb: Record<string, string> = {
  toolSecurity: "统一策略管理与工具控制",
  policyEngine: "按策略文件决策允许、询问或拒绝",
  riskAssessment: "理解 Agent 行为及潜在风险",
  sandboxIsolation: "限制 Agent 的执行范围",
  sensitiveData: "保护敏感数据，防止泄漏",
};

const protectedOk = computed(() => {
  const mods = props.status?.modules.filter((m) => m.enabled) ?? [];
  return mods.length > 0 && mods.every((m) => m.healthy || m.id === "sensitiveData");
});

const detectedAgents = computed(
  () => props.status?.agents.filter((agent) => agent.detected).length ?? 0,
);
const agentTotal = computed(() => props.status?.agents.length ?? 0);

const latestRun = computed(() => props.status?.recentDecisions[0] ?? null);

const securityEventCount = computed(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return (props.status?.recentDecisions ?? []).filter((item) => {
    if (item.decision === "allow") return false;
    return new Date(item.at).getTime() >= cutoff;
  }).length;
});

const enabledModules = computed(
  () => props.status?.modules.filter((item) => item.enabled) ?? [],
);

const activeModule = computed(
  () => props.status?.modules.find((item) => item.id === activeModuleId.value) ?? null,
);

type Tone = "allow" | "ask" | "deny" | "info";

interface FeedItem {
  id: string;
  at: string;
  title: string;
  summary: string;
  tone: Tone;
  icon: unknown;
}

const feed = computed<FeedItem[]>(() => {
  const items: FeedItem[] = [];
  const setup = props.status?.setup;
  if (setup?.installCompleted && setup.completedAt) {
    items.push({
      id: "setup-complete",
      at: setup.completedAt,
      title: "安装完成",
      summary: `Agent Security Runtime 安装成功，策略档位 ${setup.profile}`,
      tone: "info",
      icon: Download,
    });
  }
  for (const item of props.status?.recentDecisions ?? []) {
    items.push({
      id: item.id,
      at: item.at,
      title: eventTitle(item.kind, item.decision),
      summary: `${item.agentId} · ${item.summary}`,
      tone: decisionTone(item.decision),
      icon: eventIcon(item.kind, item.decision),
    });
  }
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);
});

const securityCopy = computed(() => {
  if (!props.status) {
    return { value: "—", detail: "正在连接运行时" };
  }
  const degraded = props.status.modules.filter(
    (item) => item.enabled && !item.healthy && item.id !== "sensitiveData",
  );
  if (!enabledModules.value.length) {
    return { value: "未启用", detail: "尚未启用安全模块" };
  }
  if (protectedOk.value) {
    return { value: "已启用", detail: "已启用模块运行正常" };
  }
  if (degraded.length) {
    return {
      value: "已启用",
      detail: `${degraded.map((item) => shortName(item.name)).join("、")}未就绪`,
    };
  }
  return { value: "已启用", detail: "部分模块未启用" };
});

const guardCopy = computed(() => {
  if (protectedOk.value) {
    return {
      title: "安全防护已全面就绪",
      detail: "当前环境下，Agent 的执行行为受到多重安全保护",
    };
  }
  return {
    title: "安全防护尚未全面就绪",
    detail: "部分模块未启用或未就绪，可在系统页检查策略与安装配置",
  };
});

function shortName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*$/, "");
}

function moduleState(module: RuntimeStatus["modules"][number]) {
  if (!module.enabled) return { label: "未启用", tone: "off" as const };
  if (!module.healthy) return { label: "降级", tone: "warn" as const };
  return { label: "已启用", tone: "on" as const };
}

function decisionTone(decision: Decision): Tone {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  return "ask";
}

function eventTitle(kind: string, decision: Decision) {
  if (kind === "prompt") return "Agent 运行";
  if (kind === "skill") return "策略命中";
  if (kind === "tool" && decision === "deny") return "工具拦截";
  if (kind === "tool" && (decision === "ask" || decision === "escalate_sandbox")) return "用户审批";
  if (kind === "tool") return "工具调用";
  return kind;
}

function eventIcon(kind: string, decision: Decision) {
  if (kind === "skill") return ScrollText;
  if (kind === "tool" && decision === "deny") return Ban;
  if (kind === "tool" && (decision === "ask" || decision === "escalate_sandbox")) return CircleQuestionMark;
  if (kind === "tool") return Wrench;
  return Shield;
}

function relativeTime(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

function stamp(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clock(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === new Date().toDateString()) return `今天 ${time}`;
  return stamp(iso);
}

function openModule(id: string) {
  activeModuleId.value = id;
}

function configureTarget(id: string) {
  if (id === "riskAssessment") return "gate";
  if (id === "sandboxIsolation") return "openshell";
  return "system";
}

function goConfigure() {
  const id = activeModule.value?.id;
  if (!id) return;
  activeModuleId.value = null;
  emit("navigate", configureTarget(id));
}
</script>

<template>
  <div class="overview">
    <section class="kpi-grid">
      <article class="kpi kpi-security">
        <div class="kpi-label">
          <span class="kpi-ico"><Shield :size="16" /></span>
          安全状态
        </div>
        <div class="kpi-value">
          {{ securityCopy.value }}
          <span v-if="protectedOk" class="ok-check" aria-hidden="true"><Check :size="14" /></span>
        </div>
        <p>{{ securityCopy.detail }}</p>
      </article>

      <article class="kpi kpi-agents">
        <div class="kpi-label">
          <span class="kpi-ico"><Box :size="16" /></span>
          已保护 Agent
        </div>
        <div class="kpi-value">{{ detectedAgents }} / {{ agentTotal }}</div>
        <button type="button" class="text-link" @click="emit('navigate', 'agents')">
          查看详情 <ChevronRight :size="14" />
        </button>
      </article>

      <article class="kpi kpi-recent">
        <div class="kpi-label">
          <span class="kpi-ico"><CalendarDays :size="16" /></span>
          最近运行
        </div>
        <div class="kpi-value">{{ latestRun ? relativeTime(latestRun.at) : "暂无" }}</div>
        <p>{{ latestRun ? stamp(latestRun.at) : "尚无执行记录" }}</p>
      </article>

      <article class="kpi kpi-events">
        <div class="kpi-label">
          <span class="kpi-ico"><ChartColumn :size="16" /></span>
          安全事件
        </div>
        <div class="kpi-value">{{ securityEventCount }}</div>
        <p>近 7 天</p>
      </article>
    </section>

    <section class="split">
      <article class="panel">
        <header class="panel-head">
          <h2>
            <Shield :size="18" />
            安全模块
            <span>按需启用，灵活配置</span>
          </h2>
          <button type="button" class="ghost-btn" @click="emit('navigate', 'system')">
            <SlidersHorizontal :size="15" />
            管理配置
          </button>
        </header>

        <p v-if="!status" class="empty-copy">正在读取模块状态</p>
        <div v-else class="module-list">
          <div
            v-for="module in status.modules"
            :key="module.id"
            class="mod-row"
            role="button"
            tabindex="0"
            @click="openModule(module.id)"
            @keydown.enter="openModule(module.id)"
          >
            <span class="mod-ico" :class="moduleState(module).tone">
              <component :is="moduleIcon[module.id] || Shield" :size="18" />
            </span>
            <span class="mod-text">
              <strong>{{ module.name }}</strong>
              <small>{{ moduleBlurb[module.id] || module.detail || module.id }}</small>
            </span>
            <span class="state-pill" :class="moduleState(module).tone">{{ moduleState(module).label }}</span>
            <button type="button" class="config-link" @click.stop="openModule(module.id)">
              配置 <ChevronRight :size="14" />
            </button>
          </div>
        </div>
      </article>

      <article class="panel">
        <header class="panel-head">
          <h2>最近动态</h2>
          <button type="button" class="text-link" @click="emit('navigate', 'activity')">
            查看全部 <ChevronRight :size="14" />
          </button>
        </header>

        <p v-if="!feed.length" class="empty-copy">暂无记录。在 Gate Lab 评估一次提示词后，决策会显示在这里。</p>
        <ol v-else class="timeline">
          <li v-for="item in feed" :key="item.id" :class="item.tone">
            <span class="tl-mark">
              <component :is="item.icon" :size="14" />
            </span>
            <div class="tl-body">
              <div class="tl-head">
                <strong>{{ item.title }}</strong>
                <time :datetime="item.at">{{ clock(item.at) }}</time>
              </div>
              <p>{{ item.summary }}</p>
            </div>
          </li>
        </ol>
      </article>
    </section>

    <section class="guard-bar">
      <span class="guard-mark" :class="{ ready: protectedOk }">
        <ShieldCheck :size="22" />
      </span>
      <div class="guard-copy">
        <strong>{{ guardCopy.title }}</strong>
        <p>{{ guardCopy.detail }}</p>
      </div>
      <div class="guard-pills">
        <span v-if="!enabledModules.length" class="cap-pill off">暂无已启用模块</span>
        <span v-for="module in enabledModules" :key="module.id" class="cap-pill">
          <component :is="moduleIcon[module.id] || Shield" :size="14" />
          {{ shortName(module.name) }}
          <em>已启用</em>
        </span>
      </div>
      <button type="button" class="use-btn" @click="emit('navigate', 'gate')">
        前往使用 <ChevronRight :size="16" />
      </button>
    </section>

    <el-drawer
      :model-value="activeModule != null"
      :title="activeModule?.name ?? '模块详情'"
      size="420px"
      class="module-drawer"
      @close="activeModuleId = null"
    >
      <template v-if="activeModule">
        <p class="drawer-blurb">{{ moduleBlurb[activeModule.id] || "运行时安全模块" }}</p>
        <dl class="drawer-facts">
          <div>
            <dt>模块</dt>
            <dd>{{ activeModule.id }}</dd>
          </div>
          <div>
            <dt>启用</dt>
            <dd>{{ activeModule.enabled ? "是" : "否" }}</dd>
          </div>
          <div>
            <dt>健康</dt>
            <dd>{{ activeModule.healthy ? "正常" : "未就绪" }}</dd>
          </div>
          <div>
            <dt>详情</dt>
            <dd>{{ activeModule.detail || "—" }}</dd>
          </div>
          <div v-if="status?.policyPath">
            <dt>策略文件</dt>
            <dd>{{ status.policyPath }}</dd>
          </div>
        </dl>
        <p class="drawer-note">
          {{
            activeModule.id === "riskAssessment"
              ? "风险评估的模型与端点可在 Gate Lab 的感知栈中查看，并用提示词做即时评估。"
              : activeModule.id === "sandboxIsolation"
                ? "OpenShell 策略页可查看沙箱生效规则，并编辑网络白名单与文件系统权限。"
                : "策略档位、安装状态和 OpenShell 信息在系统页查看。调整档位会重新进入安装向导。"
          }}
        </p>
        <button type="button" class="use-btn drawer-action" @click="goConfigure">
          {{
            activeModule.id === "riskAssessment"
              ? "前往 Gate Lab"
              : activeModule.id === "sandboxIsolation"
                ? "前往 OpenShell 策略"
                : "前往系统配置"
          }}
          <ChevronRight :size="16" />
        </button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.kpi,
.panel,
.guard-bar {
  background: #fff;
  border: 1px solid #e8eef6;
  border-radius: 18px;
  box-shadow: 0 10px 28px rgba(59, 111, 245, 0.05);
}

.kpi {
  padding: 18px 18px 16px;
  min-width: 0;
}

.kpi-security { background: linear-gradient(180deg, #f5f8ff 0%, #fff 68%); }
.kpi-agents { background: linear-gradient(180deg, #f6f7ff 0%, #fff 68%); }
.kpi-recent { background: linear-gradient(180deg, #f7f6ff 0%, #fff 70%); }
.kpi-events { background: linear-gradient(180deg, #f3fbf7 0%, #fff 68%); }

.kpi-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #7b8798;
  font-size: 13px;
}

.kpi-ico {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: #e8f0ff;
  color: #3b6ff5;
}

.kpi-events .kpi-ico {
  background: #e8f8ef;
  color: #16a34a;
}

.kpi-value {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 28px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: #1e293b;
}

.kpi p,
.empty-copy {
  margin: 8px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.ok-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  background: #22c55e;
  color: #fff;
}

.text-link,
.config-link,
.ghost-btn,
.use-btn {
  font: inherit;
  cursor: pointer;
}

.text-link,
.config-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #3b6ff5;
  font-size: 13px;
}

.config-link {
  margin-top: 0;
  color: #94a3b8;
}

.config-link:hover,
.text-link:hover,
.ghost-btn:hover {
  color: #2457e6;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.9fr);
  gap: 16px;
  align-items: start;
}

.panel {
  padding: 18px 18px 10px;
  min-width: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.panel-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.panel-head h2 span {
  color: #94a3b8;
  font-size: 13px;
  font-weight: 400;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #e6edf5;
  background: #fff;
  color: #64748b;
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 13px;
}

.module-list {
  display: flex;
  flex-direction: column;
}

.mod-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 14px 8px;
  border-radius: 12px;
  cursor: pointer;
}

.mod-row:hover {
  background: #f7faff;
}

.mod-ico {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: #e8f0ff;
  color: #3b6ff5;
}

.mod-ico.off {
  background: #f1f5f9;
  color: #94a3b8;
}

.mod-ico.warn {
  background: #fff7ed;
  color: #ea580c;
}

.mod-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mod-text strong {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.mod-text small {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.45;
}

.state-pill {
  justify-self: end;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  background: #e9f9ef;
  color: #16a34a;
}

.state-pill.off {
  background: #f1f5f9;
  color: #94a3b8;
}

.state-pill.warn {
  background: #fff7ed;
  color: #ea580c;
}

.timeline {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.timeline li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  position: relative;
  padding-bottom: 18px;
}

.tl-mark {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
  z-index: 1;
}

.timeline li:not(:last-child) .tl-mark::after {
  content: "";
  position: absolute;
  left: 13px;
  top: 30px;
  bottom: -16px;
  width: 1px;
  background: #e6edf5;
  z-index: -1;
}

.timeline .allow .tl-mark { background: #e8f8ef; color: #16a34a; }
.timeline .ask .tl-mark { background: #fff7ed; color: #ea580c; }
.timeline .deny .tl-mark { background: #fef2f2; color: #ef4444; }
.timeline .info .tl-mark { background: #e8f0ff; color: #3b6ff5; }

.tl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.tl-head strong {
  font-size: 14px;
  color: #1e293b;
}

.tl-head time,
.tl-body p {
  color: #94a3b8;
  font-size: 12px;
}

.tl-body p {
  margin: 4px 0 0;
  line-height: 1.5;
  word-break: break-word;
}

.guard-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  background: linear-gradient(90deg, #f3fbf6 0%, #f8fbff 48%, #fff 100%);
}

.guard-mark {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex: none;
  background: #fff7ed;
  color: #ea580c;
}

.guard-mark.ready {
  background: #e8f8ef;
  color: #16a34a;
}

.guard-copy {
  min-width: 180px;
}

.guard-copy strong {
  display: block;
  font-size: 15px;
  color: #1e293b;
}

.guard-copy p {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.45;
}

.guard-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  justify-content: flex-end;
}

.cap-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 12px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
}

.cap-pill em {
  font-style: normal;
  color: #16a34a;
  font-weight: 600;
}

.cap-pill.off {
  color: #94a3b8;
}

.use-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  border: 0;
  border-radius: 12px;
  padding: 10px 16px;
  background: #3b6ff5;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

.use-btn:hover {
  background: #2f62ea;
}

.drawer-action {
  margin-top: 18px;
}

@media (max-width: 1180px) {
  .split {
    grid-template-columns: 1fr;
  }
  .guard-bar {
    flex-wrap: wrap;
  }
  .guard-pills {
    justify-content: flex-start;
  }
}

@media (max-width: 860px) {
  .kpi-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .mod-row {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .state-pill,
  .config-link {
    grid-column: 2;
    justify-self: start;
  }
}

@media (max-width: 560px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}
</style>
