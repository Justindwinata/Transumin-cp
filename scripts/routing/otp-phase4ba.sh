#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_ROOT="$REPOSITORY_ROOT/data/processed/routing/phase4b-a"
INPUT_DIRECTORY="$OUTPUT_ROOT/input"
RUNTIME_DIRECTORY="$OUTPUT_ROOT/runtime"
JRE_ARCHIVE="$RUNTIME_DIRECTORY/temurin25-jre-macos-aarch64.tar.gz"
JAVA_BINARY="$RUNTIME_DIRECTORY/temurin25/Contents/Home/bin/java"
OTP_JAR="$RUNTIME_DIRECTORY/otp-shaded-2.10.0.jar"
PID_FILE="$RUNTIME_DIRECTORY/router.pid"
LOG_FILE="$RUNTIME_DIRECTORY/router.log"
OTP_URL="${OTP_URL:-http://127.0.0.1:8080/otp/gtfs/v1}"

JRE_URL='https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_aarch64_mac_hotspot_25.0.4.1_1.tar.gz'
JRE_SHA256='5b02bcc908da092e7e00b9772d4f9bbb87f44a60b7c90f7cf5a91a1d98f37e1b'
OTP_URL_RELEASE='https://github.com/opentripplanner/OpenTripPlanner/releases/download/v2.10.0/otp-shaded-2.10.0.jar'
OTP_SHA256='8acd28081f859cfbb4a18a7979789fc02d472f229ce656167f3da5971eea7990'

checksum() { shasum -a 256 "$1" | awk '{print $1}'; }
assert_checksum() {
  local file="$1" expected="$2"
  [[ "$(checksum "$file")" == "$expected" ]] || {
    echo "Checksum mismatch: $file" >&2
    exit 1
  }
}

install_runtime() {
  mkdir -p "$RUNTIME_DIRECTORY"
  if [[ ! -f "$JRE_ARCHIVE" ]]; then
    curl -fL --retry 3 -o "$JRE_ARCHIVE" "$JRE_URL"
  fi
  assert_checksum "$JRE_ARCHIVE" "$JRE_SHA256"
  if [[ ! -x "$JAVA_BINARY" ]]; then
    mkdir -p "$RUNTIME_DIRECTORY/temurin25"
    /usr/bin/tar -xzf "$JRE_ARCHIVE" -C "$RUNTIME_DIRECTORY/temurin25" --strip-components=1
  fi
  if [[ ! -f "$OTP_JAR" ]]; then
    curl -fL --retry 3 -o "$OTP_JAR" "$OTP_URL_RELEASE"
  fi
  assert_checksum "$OTP_JAR" "$OTP_SHA256"
}

preflight() {
  install_runtime
  [[ "$(uname -m)" == 'arm64' ]] || {
    echo 'RUN 4B-A requires native arm64 on this macOS target.' >&2
    exit 1
  }
  "$JAVA_BINARY" -XshowSettings:properties -version 2>&1 | grep -q 'os.arch = aarch64'
  "$JAVA_BINARY" -version 2>&1 | grep -q '25.0.4.1'
  "$JAVA_BINARY" -jar "$OTP_JAR" --version | grep -q 'Version: 2.10.0'
  printf '%s\n' 'OTP=2.10.0' 'JAVA=Temurin-25.0.4.1+1' 'ARCH=arm64/aarch64' "MACOS=$(sw_vers -productVersion)"
}

prepare() {
  cd "$REPOSITORY_ROOT"
  pnpm data:phase4ba:prepare
}

build_graph() {
  preflight
  prepare
  node -e "require('fs').rmSync(process.argv[1], {force:true})" "$INPUT_DIRECTORY/graph.obj"
  /usr/bin/time -p "$JAVA_BINARY" -Xmx6G -jar "$OTP_JAR" --build --save "$INPUT_DIRECTORY" 2>&1 \
    | tee "$RUNTIME_DIRECTORY/build.log"
}

health() {
  curl -fsS -H 'Content-Type: application/json' \
    -d '{"query":"{ __typename }"}' "$OTP_URL"
}

start_router() {
  preflight
  [[ -f "$INPUT_DIRECTORY/graph.obj" ]] || {
    echo 'graph.obj is missing; run build first.' >&2
    exit 1
  }
  local expected_graph
  expected_graph=$(node -p 'require(process.argv[1]).graph.sha256' "$REPOSITORY_ROOT/data/manifests/PHASE-4B-A-OTP-RUNTIME.json")
  [[ "$expected_graph" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid manifested graph checksum' >&2; exit 1; }
  assert_checksum "$INPUT_DIRECTORY/graph.obj" "$expected_graph"
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo 'OTP router is already running.' >&2
    exit 1
  fi
  nohup "$JAVA_BINARY" -Xmx5G -jar "$OTP_JAR" --load --serve --bindAddress 127.0.0.1 "$INPUT_DIRECTORY" >"$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  local started now
  started=$(date +%s)
  for _ in $(seq 1 90); do
    if health >/dev/null 2>&1; then
      now=$(date +%s)
      echo "READY_SECONDS=$((now - started))"
      return
    fi
    sleep 1
  done
  tail -80 "$LOG_FILE" >&2
  exit 1
}

stop_router() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    ps -p "$pid" -o command= | grep -q 'otp-shaded-2.10.0.jar' || {
      echo "Refusing to stop unexpected PID $pid" >&2
      exit 1
    }
    kill "$pid"
    wait "$pid" 2>/dev/null || true
  fi
  node -e "require('fs').rmSync(process.argv[1], {force:true})" "$PID_FILE"
}

case "${1:-}" in
  preflight) preflight ;;
  prepare) prepare ;;
  build) build_graph ;;
  start) start_router ;;
  health) health ;;
  stop) stop_router ;;
  restart) stop_router; start_router ;;
  routeability)
    cd "$REPOSITORY_ROOT"
    pnpm --filter @transum-in/api data:phase4ba:routeability
    ;;
  *)
    echo 'Usage: otp-phase4ba.sh preflight|prepare|build|start|health|stop|restart|routeability' >&2
    exit 2
    ;;
esac
