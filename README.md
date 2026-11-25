# Agent Security Runtime

Ubuntu 上的 **Agent 安全运行时**：用统一控制面罩住不同用户、不同 Agent（DSH / OpenClaw / Hermes…）。

| 平面 | 实现 |
|------|------|
| 执行 | OpenShell（状态探测 + 策略桥接） |
| 决策 | YAML 策略引擎 |
| 感知 | Skill 扫描 + **Tev1-0.8B**（Ollama `/v1/systemone`） |
| 控制面 | **安装器用户旅途** → WebUI 控制台 |

## 安装方式

### 1. Debian / Ubuntu 包（推荐）

```bash
npm run build:deb
# 产物：dist/deb/agent-security-runtime_0.1.0_all.deb

sudo dpkg -i dist/deb/agent-security-runtime_0.1.0_all.deb
asr-setup    # 打开安装旅途 + 控制面
```

安装后提供：
- `asr` — 启动控制面
- `asr-setup` — 重置并打开用户旅途
- 桌面入口「Agent Security Runtime」

### 2. 源码安装脚本

```bash
bash scripts/install.sh
# 或 npm run install:asr
```

首次打开是 **安装旅途**：欢迎 → 环境检测 → 决策模型 → Agent 发现 → 策略档位 → 完成进入控制台。

控制台地址：http://127.0.0.1:8787

## 开发模式

```bash
npm install
npm run build
npm run start          # → http://127.0.0.1:8787
```

状态文件：`~/.asr/state.json`（决定显示安装向导还是控制台）。

## 仓库结构

```
scripts/install.sh   安装包式 CLI 旅途
apps/server          控制面 API + 托管 WebUI
apps/web             安装向导 + 安全控制台
packages/core        策略 / Tev / Skill / OpenShell / Setup
configs/             示例策略
```

## 适配器

第一期打穿 **DSH**；OpenClaw / Hermes 预留同一 `AgentAdapter` 接口。
