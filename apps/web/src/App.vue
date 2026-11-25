<script setup lang="ts">
import { onMounted, ref } from "vue";
import SetupWizard from "./SetupWizard.vue";
import Workbench from "./Workbench.vue";
import type { SetupState } from "./types";

const mode = ref<"loading" | "setup" | "console">("loading");
const bootError = ref<string | null>(null);

async function boot() {
  try {
    const res = await fetch("/api/setup");
    if (!res.ok) throw new Error(`setup HTTP ${res.status}`);
    const data = (await res.json()) as { state: SetupState };
    mode.value = data.state.installCompleted ? "console" : "setup";
  } catch (e) {
    bootError.value = e instanceof Error ? e.message : String(e);
    mode.value = "setup";
  }
}

async function reinstall() {
  await fetch("/api/setup/reset", { method: "POST" });
  mode.value = "setup";
}

onMounted(() => {
  void boot();
});
</script>

<template>
  <div v-if="mode === 'loading'" class="setup-wrap">
    <el-result icon="info" title="正在打开工作台" :sub-title="bootError ?? '连接控制面…'" />
  </div>
  <SetupWizard v-else-if="mode === 'setup'" @finished="mode = 'console'" />
  <Workbench v-else @reinstall="reinstall" />
</template>
