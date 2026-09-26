#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
if [ ! -x backend/.venv/bin/python ]; then
  echo '请先运行：uv sync --project backend --frozen'
  exit 1
fi
backend/.venv/bin/python -m xhs_content_agent.worker &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' EXIT INT TERM
backend/.venv/bin/python -m uvicorn xhs_content_agent.app:app --host 127.0.0.1 --port 8000
