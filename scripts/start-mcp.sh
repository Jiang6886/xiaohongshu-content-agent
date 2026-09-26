#!/bin/zsh
set -eu
cd "$(dirname "$0")/.."
mkdir -p data/mcp
chmod 700 data/mcp
docker compose -f deploy/xiaohongshu-mcp/compose.yaml up -d
