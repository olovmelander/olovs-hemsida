#!/usr/bin/env bash
# Exercise the production build and migrations against an isolated local Worker.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
workdir=$(mktemp -d)
worker_pid=''
cleanup() {
  status=$?
  if [[ -n "$worker_pid" ]]; then kill -- "-$worker_pid" 2>/dev/null || true; fi
  if [[ "$status" != 0 && -f "$workdir/worker.log" ]]; then tail -n 35 "$workdir/worker.log"; fi
  rm -rf "$workdir"
}
trap cleanup EXIT
cd "$root/apps/worker"
wrangler="$PWD/node_modules/wrangler/bin/wrangler.js"
port=${BANVY_TEST_PORT:-8787}
origin="http://127.0.0.1:$port"
node "$wrangler" d1 migrations apply banvy-db --local --persist-to "$workdir/d1"
# These bindings live only in this local process. Production uses Worker secrets.
setsid node "$wrangler" dev --local --ip 127.0.0.1 --port "$port" --persist-to "$workdir/d1" \
  --var ALLOW_DEV_AUTH:true --var "BETTER_AUTH_SECRET:$(openssl rand -hex 32)" --var "BETTER_AUTH_URL:$origin" \
  >"$workdir/worker.log" 2>&1 &
worker_pid=$!
cd "$root"
for attempt in {1..90}; do
  if curl --silent --fail "$origin/api/health" | jq -e '.ok == true and .devAuth == true' >/dev/null; then break; fi
  if ! kill -0 "$worker_pid" 2>/dev/null || [[ $attempt == 90 ]]; then
    echo 'Local Worker with development login did not become ready.' >&2
    exit 1
  fi
  sleep 1
done
node tools/check-release-assets.mjs "$origin/"
# Cloudflare's assets serve /name.html at /name: old bookmarks and the policy pages
# must survive that, with and without the service worker.
echo '::group::Bookmarks and policy pages as the Worker serves them'
node tools/check-legacy-links.mjs --url "$origin/"
echo '::endgroup::'
for journey in hub-journeys lobby-scale club-sorting course-loading session-navigation stats-history play-concurrency play-session map-round map-field-recovery map-offline-first live-handoff; do
  echo "::group::Browser journey $journey"
  node "tools/check-$journey.mjs" "$origin/"
  echo '::endgroup::'
done
echo '::group::Pinned shot card on a short phone screen'
node tools/check-map-hud.mjs --manual-card --url "$origin/" --quality 3
node tools/check-map-hud.mjs --manual-card --url "$origin/" --quality 3 --setting sun-left-large
echo '::endgroup::'
