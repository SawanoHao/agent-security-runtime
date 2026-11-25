#!/usr/bin/env bash
# Agent Security Runtime — installer journey (CLI)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASR_HOME="${ASR_HOME:-$HOME/.asr}"
OLLAMA_HOME="${OLLAMA_HOME:-$HOME/.local/ollama}"
MODEL="${ASR_TEV_MODEL:-tev1:0.8b}"
PORT="${ASR_PORT:-8787}"
NODE_BIN="${NODE_BIN:-$HOME/.local/node/bin}"

export PATH="$NODE_BIN:$OLLAMA_HOME/bin:$PATH"
if [[ -d "$OLLAMA_HOME/lib/ollama" ]]; then
  export LD_LIBRARY_PATH="$OLLAMA_HOME/lib/ollama:${LD_LIBRARY_PATH:-}"
fi

mkdir -p "$ASR_HOME"

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

cat <<'BANNER'

  ╔══════════════════════════════════════════╗
  ║     Agent Security Runtime  Installer    ║
  ║     OpenShell · Policy · Skill · Tev1    ║
  ╚══════════════════════════════════════════╝

BANNER

step "1/5  检查 Node.js"
if ! command -v node >/dev/null 2>&1; then
  fail "未找到 node。请先安装 Node ≥ 20，或把 $NODE_BIN 加入 PATH。"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || fail "需要 Node ≥ 20，当前 $(node -v)"
ok "Node $(node -v)"

step "2/5  安装依赖并构建控制面"
cd "$ROOT"
npm install --silent
npm run build
ok "core / server / web 已构建"

step "3/5  准备 Ollama + $MODEL"
if ! command -v ollama >/dev/null 2>&1; then
  warn "未检测到 ollama，尝试用户目录安装…"
  if [[ ! -x "$OLLAMA_HOME/bin/ollama" ]]; then
    TMP="$(mktemp -d)"
    curl -fL -o "$TMP/ollama.tar.zst" \
      https://github.com/ollama/ollama/releases/download/v0.40.18/ollama-linux-amd64.tar.zst
    mkdir -p "$OLLAMA_HOME"
    tar --zstd -xf "$TMP/ollama.tar.zst" -C "$OLLAMA_HOME"
    rm -rf "$TMP"
  fi
  export PATH="$OLLAMA_HOME/bin:$PATH"
  export LD_LIBRARY_PATH="$OLLAMA_HOME/lib/ollama:${LD_LIBRARY_PATH:-}"
fi
command -v ollama >/dev/null || fail "Ollama 安装失败"
ok "Ollama $(ollama --version 2>/dev/null | head -1 || echo ok)"

if ! curl -sf "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  mkdir -p "$HOME/.ollama"
  nohup ollama serve >"$HOME/.ollama/serve.log" 2>&1 &
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:11434/api/tags" >/dev/null && break
    sleep 0.4
  done
fi
curl -sf "http://127.0.0.1:11434/api/tags" >/dev/null || fail "无法启动 ollama serve"
ok "Ollama serve 就绪"

if ! ollama list 2>/dev/null | grep -q "^${MODEL}[[:space:]]"; then
  ollama pull "$MODEL"
fi
ok "模型 $MODEL 已就绪"

step "4/5  写入首次安装状态"
STATE="$ASR_HOME/state.json"
if [[ ! -f "$STATE" ]]; then
  cat >"$STATE" <<EOF
{
  "version": 1,
  "installCompleted": false,
  "completedAt": null,
  "currentStep": "welcome",
  "profile": "balanced",
  "steps": {
    "welcome": false,
    "environment": false,
    "model": false,
    "agents": false,
    "policy": false,
    "finish": false
  }
}
EOF
fi
ok "状态文件 $STATE"

step "5/5  启动控制面"
# Stop previous instance on same port if ours
if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  ok "控制面已在 :${PORT} 运行"
else
  nohup env PATH="$PATH" LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" \
    ASR_PORT="$PORT" node "$ROOT/apps/server/dist/index.js" \
    >"$ASR_HOME/server.log" 2>&1 &
  echo $! >"$ASR_HOME/server.pid"
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null && break
    sleep 0.3
  done
  curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null || fail "控制面启动失败，见 $ASR_HOME/server.log"
  ok "控制面已启动 (pid $(cat "$ASR_HOME/server.pid"))"
fi

URL="http://127.0.0.1:${PORT}/"
printf '\n\033[1m安装完成。打开用户旅途：\033[0m\n  %s\n\n' "$URL"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
