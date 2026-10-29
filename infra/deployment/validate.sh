#!/bin/sh
# Validation only: never starts services or requests certificates.
set -eu
: "${STAGING_DOMAIN:?Set approved DNS hostname before validation}"
if [ "${#STAGING_DOMAIN}" -gt 253 ] || ! printf '%s\n' "$STAGING_DOMAIN" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'; then
  echo 'STAGING_DOMAIN must be a DNS hostname without scheme, path, wildcard, or port' >&2
  exit 1
fi
export STAGING_DOMAIN
cd "$(dirname "$0")"
caddy adapt --config Caddyfile --adapter caddyfile --validate > /dev/null
systemd-analyze verify transum-api.service transum-web.service transum-otp.service
