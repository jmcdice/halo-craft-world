#!/usr/bin/env bash
# Halo Craft: Installation 04 — docker helper.
#   ./run.sh up        Build + start on http://localhost:8091
#   ./run.sh down      Stop and remove the container
#   ./run.sh rebuild   Rebuild the image and restart
#   ./run.sh logs      Tail logs
#   ./run.sh status    Show state + URL
# Env: PORT=9000 ./run.sh up  -> serve on another port
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8091}"
cd "$SCRIPT_DIR"

case "${1:-up}" in
  up)      PORT="$PORT" docker compose up -d --build; echo "▶  Halo Craft: http://localhost:$PORT" ;;
  down)    docker compose down ;;
  rebuild) PORT="$PORT" docker compose up -d --build --force-recreate; echo "▶  Rebuilt: http://localhost:$PORT" ;;
  logs)    docker compose logs -f ;;
  status)  docker compose ps; echo "URL: http://localhost:$PORT" ;;
  *) echo "usage: ./run.sh {up|down|rebuild|logs|status}"; exit 1 ;;
esac
