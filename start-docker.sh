#!/usr/bin/env bash
# One-command start for the presentation viewer (Pop!_OS / Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DATA_DEFAULT="$HOME/Workspace/safecollapse-viewer-data"
DATA="${SAFECOLLAPSE_DATA:-$DATA_DEFAULT}"
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}/"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim() { printf '\033[2m%s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  red "Docker is not installed. On Pop!_OS: sudo apt install docker.io docker-compose-v2"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  red "Cannot talk to the Docker daemon."
  echo "Try:  sudo systemctl start docker"
  echo "And make sure your user is in the docker group:  sudo usermod -aG docker \"\$USER\"  (then log out/in)"
  exit 1
fi

if [[ ! -d "$DATA" ]]; then
  red "Data folder not found: $DATA"
  echo "Set SAFECOLLAPSE_DATA to your safecollapse-viewer-data path."
  exit 1
fi

if [[ ! -f "$DATA/EXPORTED_AT" ]]; then
  red "That folder does not look like the study export (missing EXPORTED_AT): $DATA"
  exit 1
fi

# Free the port if a previous non-docker serve.py is still running.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi

export SAFECOLLAPSE_DATA="$DATA"

echo "Building / starting safecollapse-viewer…"
dim "  data:  $DATA (read-only)"
dim "  cache: $ROOT/.cache"
dim "  url:   $URL"

docker compose up --build -d

echo "Waiting for health…"
for _ in $(seq 1 60); do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    green "Ready → $URL"
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$URL" >/dev/null 2>&1 || true
    fi
    echo
    echo "Stop with:  ./stop-docker.sh"
    exit 0
  fi
  sleep 1
done

red "Container did not become healthy in time. Last logs:"
docker compose logs --tail=80
exit 1
