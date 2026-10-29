# R5 GPS device field check — real hardware only

Status: `NOT_VERIFIED` until run on a physical phone with user consent, permission prompt, outdoor location, and HTTPS origin. Browser stubs are `SIMULATED`; accuracy thresholds are software policy, not guaranteed physical accuracy.

1. Open private/local HTTPS passenger runtime on phone. Record browser/OS and build SHA; record no coordinates or residential address in the report.
2. Confirm location sharing is off by default. Start planning with current location; grant permission explicitly. Confirm clear disclosure and visible sharing state.
3. Walk a short, safe public path. Confirm marker follows fixes; note displayed accuracy/freshness and map follow. Pan map; confirm follow pauses. Re-enable follow explicitly.
4. Observe app state at reported accuracy ≤30 m (`NAVIGATION` eligibility), 31–250 m (`MAP_CONTEXT` only), >250 m/invalid (`UNCERTAIN`). These labels classify reported sensor accuracy only; they do not certify true location.
5. During WALK guidance, compare current/next maneuver at stable good fixes. At low/coarse/stale fixes, confirm maneuver does not advance and map remains usable.
6. Toggle pause/stop sharing. Confirm `clearWatch` behavior (no further marker updates after stop). Deny permission in browser settings; confirm manual/pin fallback and no repeated prompt loop.
7. Reload page. Confirm no GPS history is restored or uploaded, no automatic boarding/alighting/completion occurs, and location sharing is off unless the user explicitly opts in again.
8. If recovery is offered, accept only through normal journey controls; confirm the old maneuver is not carried forward. Never use simulated replay as hardware proof.

Record only pass/fail, approximate accuracy band, timestamps rounded to the minute, device/browser versions, and sanitized screenshots without maps that reveal home addresses. Do not capture exact GPS coordinates or credentials.
