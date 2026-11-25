<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  ArrowRight,
  Avatar,
  CircleCheck,
  Cpu,
  House,
  Monitor,
  Refresh,
  Setting,
} from "@element-plus/icons-vue";
import type { PolicyProfile, SetupCheck, SetupState, SetupStepId } from "./types";

const emit = defineEmits<{ finished: [] }>();

const STEPS: { id: SetupStepId; title: string; icon: unknown }[] = [
  { id: "welcome", title: "欢迎", icon: House },
  { id: "environment", title: "环境", icon: Monitor },
  { id: "model", title: "模型", icon: Cpu },
  { id: "agents", title: "Agent", icon: Avatar },
  { id: "policy", title: "策略", icon: Setting },
  { id: "finish", title: "完成", icon: CircleCheck },
];

const PROFILES: { id: PolicyProfile; name: string; desc: string }[] = [
  { id: "observe", name: "观察", desc: "几乎只记录与提示，适合先摸清流量。" },
  { id: "balanced", name: "均衡（推荐）", desc: "规则 + Tev1 初筛；危险工具 ask，高风险 deny。" },
  { id: "strict", name: "严格", desc: "更低阈值，更易升级到 OpenShell 沙箱。" },
];

const state = ref<SetupState | null>(null);
const checks = ref<SetupCheck[]>([]);
const model = ref("tev1:0.8b");
const busy = ref(false);
const pullLog = ref("");
const profile = ref<PolicyProfile>("balanced");

const stepIndex = computed(() => {
  if (!state.value) return 0;
  const i = STEPS.findIndex((s) => s.id === state.value!.currentStep);
  return Math.max(0, i);
});
const current = computed(() => STEPS[stepIndex.value] ?? STEPS[0]!);
const requiredOk = computed(() => checks.value.filter((c) => !c.optional).every((c) => c.ok));
const modelOk = computed(() => checks.value.find((c) => c.id === "tev_model")?.ok ?? false);

async function refresh() {
  const res = await fetch("/api/setup");
  if (!res.ok) throw new Error(`setup HTTP ${res.status}`);
  const data = (await res.json()) as { state: SetupState; checks: SetupCheck[]; model: string };
  state.value = data.state;
  checks.value = data.checks;
  model.value = data.model;
  profile.value = data.state.profile;
}

async function advance(step: SetupStepId, extra?: { profile?: PolicyProfile }) {
  busy.value = true;
  try {
    const res = await fetch("/api/setup/advance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, ...extra }),
    });
    if (!res.ok) throw new Error(`advance HTTP ${res.status}`);
    const data = (await res.json()) as { state: SetupState };
    state.value = data.state;
    if (data.state.installCompleted) emit("finished");
    await refresh();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function complete() {
  busy.value = true;
  try {
    const res = await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: profile.value }),
    });
    if (!res.ok) throw new Error(`complete HTTP ${res.status}`);
    emit("finished");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

async function pullModel() {
  busy.value = true;
  pullLog.value = "开始拉取…\n";
  try {
    const res = await fetch("/api/setup/pull-model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: model.value }),
    });
    const { jobId } = (await res.json()) as { jobId: string };
    for (;;) {
      await new Promise((r) => setTimeout(r, 800));
      const jr = await fetch(`/api/setup/pull-model/${jobId}`);
      const job = (await jr.json()) as { status: string; log: string };
      pullLog.value = job.log.slice(-1200);
      if (job.status !== "running") {
        if (job.status === "error") throw new Error("模型拉取失败");
        break;
      }
    }
    await refresh();
    ElMessage.success("模型已就绪");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refresh().catch((e) => ElMessage.error(e instanceof Error ? e.message : String(e)));
});
</script>

<template>
  <div class="setup-wrap">
    <el-card shadow="never">
      <template #header>
        <div>
          <strong>Agent Security Runtime</strong>
          <div class="mono">安装旅途 · {{ stepIndex + 1 }} / {{ STEPS.length }}</div>
        </div>
      </template>

      <el-steps :active="stepIndex" finish-status="success" align-center style="margin-bottom: 24px">
        <el-step v-for="s in STEPS" :key="s.id" :title="s.title" :icon="s.icon" />
      </el-steps>

      <template v-if="current.id === 'welcome'">
        <el-result
          icon="success"
          title="欢迎安装"
          sub-title="OpenShell 隔离 · YAML 策略 · Skill 扫描 · Tev1-0.8B 风险初筛。适配 DSH / OpenClaw / Hermes。"
        />
        <div class="setup-actions">
          <el-button type="primary" :icon="ArrowRight" :loading="busy" @click="advance('welcome')">开始安装</el-button>
        </div>
      </template>

      <template v-else-if="current.id === 'environment'">
        <el-table :data="checks" size="small">
          <el-table-column prop="label" label="检查项" />
          <el-table-column label="详情">
            <template #default="{ row }"><span class="mono">{{ row.detail }}</span></template>
          </el-table-column>
          <el-table-column label="结果" width="100">
            <template #default="{ row }">
              <el-tag :type="row.ok ? 'success' : row.optional ? 'warning' : 'danger'">
                {{ row.ok ? "通过" : row.optional ? "可选" : "缺失" }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div class="setup-actions">
          <el-button :icon="Refresh" @click="refresh">重新检测</el-button>
          <el-button type="primary" :disabled="!requiredOk" :loading="busy" @click="advance('environment')">
            {{ requiredOk ? "继续" : "请先满足必需项" }}
          </el-button>
        </div>
      </template>

      <template v-else-if="current.id === 'model'">
        <el-alert
          :title="model"
          :type="modelOk ? 'success' : 'warning'"
          :description="modelOk ? '本机已就绪' : '尚未检测到，可一键拉取（约 833MB）'"
          show-icon
          :closable="false"
        />
        <el-input
          v-if="pullLog"
          :model-value="pullLog"
          type="textarea"
          :rows="6"
          readonly
          style="margin-top: 12px"
        />
        <div class="setup-actions">
          <el-button v-if="!modelOk" type="primary" :loading="busy" @click="pullModel">
            拉取 {{ model }}
          </el-button>
          <el-button type="primary" :disabled="!modelOk" :loading="busy" @click="advance('model')">
            继续
          </el-button>
        </div>
      </template>

      <template v-else-if="current.id === 'agents'">
        <el-table :data="checks.filter((c) => c.id === 'agents' || c.id === 'openshell')">
          <el-table-column prop="label" label="对象" />
          <el-table-column label="详情">
            <template #default="{ row }"><span class="mono">{{ row.detail }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.ok ? 'success' : 'info'">{{ row.ok ? "已检测" : "未发现" }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div class="setup-actions">
          <el-button type="primary" :loading="busy" @click="advance('agents')">继续</el-button>
        </div>
      </template>

      <template v-else-if="current.id === 'policy'">
        <el-radio-group v-model="profile" style="display: flex; flex-direction: column; align-items: stretch">
          <el-radio v-for="p in PROFILES" :key="p.id" :value="p.id" border class="profile-item">
            <strong>{{ p.name }}</strong>
            <small>{{ p.desc }}</small>
          </el-radio>
        </el-radio-group>
        <div class="setup-actions">
          <el-button type="primary" :loading="busy" @click="advance('policy', { profile })">
            应用并继续
          </el-button>
        </div>
      </template>

      <template v-else>
        <el-result
          icon="success"
          title="安装完成"
          sub-title="进入工作台查看模块、决策流，并在 Gate Lab 做即时评估。"
        />
        <div class="setup-actions">
          <el-button type="primary" :icon="ArrowRight" :loading="busy" @click="complete">进入工作台</el-button>
        </div>
      </template>
    </el-card>
  </div>
</template>
