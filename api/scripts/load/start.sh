#!/bin/sh
# Starts the API container for a load run: start.sh <memory, e.g. 512m> <cpus, e.g. 0.5> <job concurrency> [time scale]
# Render Starter is 512 MB and 0.5 CPU. Needs `run.ts setup` first (api/.load/jwks.json, container.env).
set -e
cd "$(dirname "$0")/../.."
docker rm -f booktrap-load >/dev/null 2>&1 || true
docker run -d --name booktrap-load \
  --memory "$1" --memory-swap "$1" --cpus "$2" -p 8787:8787 \
  --env-file .load/container.env \
  -e LOAD_TEST=true -e LOAD_TEST_JWKS_FILE=/load/jwks.json -e LOAD_TEST_TIME_SCALE="${4:-0.25}" \
  -e JOB_CONCURRENCY="$3" -e DAILY_LINK_CAP_PER_IP=100000 -e TRUST_PROXY_HOPS=1 -e LOG_LEVEL=warn \
  -v "$PWD/.load/jwks.json:/load/jwks.json:ro" booktrap-api-load >/dev/null
for i in $(seq 1 120); do
  if curl -fs http://localhost:8787/health >/dev/null; then echo "API up ($1, $2 CPU, concurrency $3)"; exit 0; fi
  sleep 1
done
docker logs booktrap-load | tail -20
exit 1
