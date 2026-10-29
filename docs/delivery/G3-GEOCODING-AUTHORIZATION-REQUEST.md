# G3 geocoding authorization request

Status: `BLOCKED_BY_AUTHORIZATION`

No approved address-geocoding provider, credential, source license, cost ceiling, retention rule, or privacy terms exist in the current product configuration. Typed residential-address search must not be marked `PASS` or connected to public Nominatim autocomplete.

## Product Owner decision needed

Approve one provider and record:

1. provider/product and official API documentation URL;
2. Indonesian address coverage and autocomplete permission;
3. license terms for display, caching, and attribution;
4. monthly request and cost ceiling;
5. permitted query logging, retention, region, and deletion terms;
6. whether precise residential queries may leave the device;
7. credential owner, rotation process, and allowed environments.

## Current safe fallback

Users can plan with stops/stations, arbitrary map pins, coordinates, or explicit current-device location consent. No residential query is sent to an unapproved third party.

## Implementation boundary after approval

Use a provider adapter behind one geocoding contract; debounce input, cancel superseded requests, constrain result count and Jakarta-area coordinates, expose loading/empty/degraded/error states, avoid persistent query logs, and preserve map-pin fallback. Provider response must retain source attribution and may not be presented as verified address truth.
