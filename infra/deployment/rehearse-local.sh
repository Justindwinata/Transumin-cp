#!/usr/bin/env bash
# Owned scratch only: production-mode API/web/Postgres/OTP probe plus outage/restart/restore.
# No .env loading, product volume access, public bind, or secret output.
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
EVIDENCE_DIR=${EVIDENCE_DIR:-"$ROOT/.release-evidence"}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG=${REHEARSAL_LOG:-"$EVIDENCE_DIR/deployment-rehearsal-$STAMP.log"}
mkdir -p "$EVIDENCE_DIR"

command -v pnpm >/dev/null 2>&1 || { echo 'FAIL prerequisite: pnpm missing' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo 'FAIL prerequisite: docker missing' >&2; exit 1; }
docker image inspect transum-in-nexus/postgis:17.11-3.6 >/dev/null 2>&1 || {
  echo 'FAIL prerequisite: cached transum-in-nexus/postgis:17.11-3.6 image missing' >&2
  exit 1
}
[ -d "$ROOT/apps/web/.next" ] || {
  echo 'FAIL prerequisite: apps/web/.next missing; run approved production build first' >&2
  exit 1
}

printf '%s\n' "scope=owned scratch; log=$LOG" | tee "$LOG"
cd "$ROOT"
# Compile current API source without touching dist, Next output, or other harnesses.
# Keep dist's directory depth: API manifest paths resolve relative to import.meta.url.
API_OUTPUT=$(mktemp -d "$ROOT/apps/api/.deployment-rehearsal.XXXXXX")
trap 'rm -rf -- "$API_OUTPUT"' EXIT
export REHEARSAL_API_ENTRYPOINT="$API_OUTPUT/main.js"
printf '%s\n' 'api_source=current working tree; compile=isolated tsc; runtime assets=apps/api; web_source=existing .next; next_build=NOT_RUN' | tee -a "$LOG"
pnpm --filter @transum-in/api exec tsc -p tsconfig.build.json --outDir "$API_OUTPUT" 2>&1 | tee -a "$LOG"
if pnpm --filter @transum-in/api exec tsx src/infrastructure/database/deployment-rehearsal.cli.ts 2>&1 | tee -a "$LOG"; then
  :
else
  status=$?
  printf '%s\n' "rehearsal_status=FAIL exit=$status" | tee -a "$LOG" >&2
  exit "$status"
fi
printf '%s\n' 'rehearsal_status=PASS' | tee -a "$LOG"
