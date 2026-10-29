# Physical GPS user test workflow (F01)

Status: `NOT_VERIFIED` for real-device GPS. Automated browser geolocation is `SIMULATED`; this document is the Product Owner procedure to obtain real-device evidence. No public tunnel, no exposed credentials, no cloud deployment.

## What can be verified today (software, no phone)

Already executed and passing:

- Permission prompt is opt-in: GPS starts only after the passenger taps the location action (`GPS_OFF` → `GPS_REQUESTING_PERMISSION`).
- Permission denied and unsupported-geolocation contexts fall back to manual progression (`passenger-gps-browser-acceptance.mjs`, exit 0).
- Accuracy tiers: `NAVIGATION` ≤ 30 m, `MAP_CONTEXT` 31–250 m, `UNCERTAIN`; only navigation-grade fixes drive walking navigation and off-route checks.
- Stale fix handling, off-route tolerance with N-sample confirmation, marker/follow-camera toggle, "stop sharing" (`device.stop()`), and no automatic boarding/alighting (`auto_boarding: false`, `location_network_requests: 0`, `location_persistence: false`).

## What requires a physical phone

Real fix acquisition, real accuracy/heading values, real walking along the OTP-derived maneuver line, off-route confirmation on the street, and battery/OS backgrounding behavior.

## Safe local procedure (same Wi-Fi, no public exposure)

1. Keep the product database, OTP, API, and web runtime local: API `127.0.0.1:3001`, web `127.0.0.1:3000`, OTP `127.0.0.1:8080`, DB `127.0.0.1:5435`.
2. Geolocation requires a secure context. On the phone, expose the local web server over **LAN HTTPS without port forwarding to the internet**:
   - Option 1 (simplest, still local): use a local HTTPS dev proxy from a trusted tool already installed, bound to the laptop's LAN IP, with a locally generated certificate the phone explicitly trusts for that one session. Never reuse production credentials or the product `.env` values in the proxy.
   - Option 2: `next dev --experimental-https` (Next.js local HTTPS) bound to the LAN interface, certificate trusted per-device.
   - Do **not** use a public tunnel (ngrok, Cloudflare Tunnel, localtunnel) or any public DNS entry without Product Owner approval.
3. Keep the API upstream URL loopback-only (`127.0.0.1:3001`). The phone accesses only the HTTPS web origin and its same-origin passenger proxy; do not expose API, OTP, or PostgreSQL on the LAN. HTTPS setup and firewall changes require a separately reviewed command plan before execution.
4. Passengers opt in on-device: tap the location action, grant permission, and confirm the marker follows the device. Deny once to confirm the manual fallback and the honest degraded copy.
5. Walk the first WALK leg of a real OTP plan and record: fix accuracy (m), whether the tier shown matches ≤ 30 m / 31–250 m, the current maneuver text, the distance to next maneuver, whether off-route was detected only after sustained deviation, and whether boarding/alighting stayed manual.
6. Stop sharing and confirm the marker stops and the UI returns to manual mode.

## Evidence to capture (avoid private addresses)

- Screenshots that show only the map frame and navigation card, blurred or cropped to exclude home/residential addresses.
- The exact device model, OS version, browser, date/time (WIB), and the corridor used.
- Accuracy values and tier per fix; number of fixes; whether `NAVIGATION` grade was ever reached.
- Any deviation between displayed distance and actual distance, marked as observation, not validated accuracy.

## Honesty rules

- Do not mark F01 real-device `PASS` from the simulated stream.
- Do not publish raw traces with home coordinates; keep them local and uncommitted.
- A single walk is a usability observation, not a validated pedestrian-accuracy study (that remains `BLOCKED_BY_DATA`, Decision C).
