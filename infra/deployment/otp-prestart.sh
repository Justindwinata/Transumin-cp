#!/bin/sh
# Provisioned Linux artifacts only. No downloads, graph builds, or secret output.
set -eu
fail() { echo "OTP prestart: $1" >&2; exit 1; }
JAVA=/opt/transum-in/java25/bin/java
JAR=/opt/transum-in/otp/otp-shaded-2.10.0.jar
[ -x "$JAVA" ] || fail 'provision Linux Java 25 first'
"$JAVA" -version 2>&1 | grep -Eq 'version "25([."]|-)' || fail 'Java 25 required'
printf '%s  %s\n' '8acd28081f859cfbb4a18a7979789fc02d472f229ce656167f3da5971eea7990' "$JAR" | sha256sum --check --status || fail 'pinned OTP 2.10.0 jar checksum mismatch'
cd /srv/transum-in/otp
# Approved digest must come from retained graph-build/release evidence, not startup.
[ "$(wc -l < /etc/transum-in/otp-graph.sha256)" -eq 1 ] || fail 'one approved graph checksum required'
grep -Eq '^[0-9a-f]{64}  graph\.obj$' /etc/transum-in/otp-graph.sha256 || fail 'invalid graph checksum manifest'
sha256sum --check --status /etc/transum-in/otp-graph.sha256 || fail 'graph checksum mismatch'
# Minimal serving config only; never trust embedded graph router configuration.
[ "$(tr -d '[:space:]' < router-config.json)" = '{}' ] || fail 'review router config; example requires empty object'
