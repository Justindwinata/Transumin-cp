# CP2 walking navigation delivery

## Scope

- Frontend navigation consumes OTP `walking_steps` only for active `WALK` segment.
- OTP direction enum validated by single direction-label table; unsupported/area/invalid series falls back to `SCHEMATIC_GEOMETRY`.
- Geometry projection uses cumulative haversine intervals, along/cross-track checks, bounded fix progression, freshness/accuracy guards, and device-local state scoped to journey + accepted recovery + geometry identity.
- GPS remains unsnapped for map display; no GPS coordinates persisted. Automatic arrival, boarding, and leg completion remain disabled.
- Indonesian guidance exposes current/next maneuver, destination, next maneuver distance, remaining leg distance, evidence and GPS state; pause/resume/manual advance available.

## Verification evidence

Statuses are exact: `PASS`, `FAIL`, `NOT_VERIFIED`. Raw logs remain in ignored `.release-evidence/`.

- `isolated-browser-final.log`: `pnpm data:cp2:isolated-browser`, exit 0; real OTP itinerary and explicitly `SIMULATED` geolocation on invocation-owned `CP2_ISOLATED_SUBSET`; scratch OID/name/marker/owner verified, source transaction read-only, cleanup `DROP_SUCCESS`.
- CP2 assertions: 4 maneuvers / 22 geometry coordinates; progression after reliable fixes, low-accuracy hold, pause/resume, manual advance, sustained off-route, refresh returns to `ACQUIRING`; denied-GPS R4 path verified.
- Latest unit verification: web 40/40, API 106/106. `pnpm lint`, `pnpm typecheck`, `pnpm data:contracts:check` (11 records), `pnpm security:scan`, `pnpm format:check`, `git diff --check`: PASS.
- `r5-cp2-integration.log`: 9/9 isolated suites, 31 tests, exit 0.
- Earlier failed `isolated-browser-rerun.log` and retained scratch describe superseded attempts; they are not PASS evidence. Persistent-product-runtime browser attempts are withdrawn as isolation proof.
- `.release-evidence/otp-walk-probe.log`: historical real OTP probe, 34 steps / 8674.47m; distinct from shorter presentation itinerary.

## NOT VERIFIED gaps

- Recovery-navigation continuity through the existing M7/V20 harness, restored recovered itinerary after refresh, transit boarding/alighting navigation states, and full journey completion: `NOT_VERIFIED`; no claim from CP2 subfeature evidence.
- Real-device GPS: `NOT_VERIFIED`; automated geolocation remains `SIMULATED`.
- Independent pedestrian validation: `BLOCKED_BY_DATA`.
- Full `pnpm check` production build gate: not rerun in this pass.

## Limitations

- Browser acceptance uses controlled runtime and SIMULATED GPS, not outdoor navigation evidence.
- `CP2_ISOLATED_SUBSET` copies a thin canonical subset of source provenance tables into an invocation-owned scratch DB; it is not a full scientific snapshot.
- Browser acceptance writes active journey state; run only via `pnpm data:cp2:isolated-browser`. Never against the shared product database.
- Read-only source transaction; no product mutation, no new migrations.
