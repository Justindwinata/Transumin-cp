# Map Data Semantics

This contract defines meaning, not visual styling. File 13, File 08, accessibility requirements, and the approved frontend craft process govern later presentation.

| Approx. order | Layer | Purpose and source | Evidence semantics | Visibility/interaction | Required non-map representation |
|---:|---|---|---|---|---|
| 10 | Base Network | Spatial context from versioned basemap/network snapshot | Source attribution and freshness; never operational truth by itself | Default context; inspect source/coverage | Named area and coverage summary |
| 20 | Walking Connections | Validated walking edges via `spatial.network_node` | Dataset evidence; accessibility limitations explicit | Show at relevant zoom/journey context; inspect endpoints | Ordered walking instructions and distance |
| 30 | Transit Routes | Routes/shapes/segments from selected dataset version | Usually SCHEDULED unless another evidence source applies | Filter by mode/operator/route; select route | Route, direction, stops, service metadata |
| 40 | Flood Event Geometry | Observed/forecast/simulated event geometry | Exactly OBSERVED, FORECAST, or SIMULATED with time/source | Visible for active event/scenario; inspect evidence | Event extent, timing, source, uncertainty |
| 50 | Directly Affected Entity | Spatial candidate plus explicit blockage/impact rule result | Evidence inherited from event plus derivation rule | Distinguish candidate intersection from confirmed restriction | Entity list, rule, status, evidence |
| 55 | Propagated Impact | Connectivity/service effects derived from direct impact | ESTIMATED/SIMULATED unless verified otherwise | Reveal propagation path and limitations | Affected connections and reason chain |
| 60 | Simulation Overlay | Run-specific override over immutable snapshot | SIMULATED only | Visible only in selected run; clear scenario/run identity | Override table and base-vs-effective values |
| 70 | Selected Journey | Chosen candidate with ordered segments | Per-segment evidence and snapshot context | Emphasize selection; inspect segments | Ordered itinerary, times, transfers, evidence |
| 75 | Recovery Journey | Repaired path and preserved/changed segments | Derived evidence with recovery/run/algorithm references | Compare original and repaired segments | Before/after itinerary and metric changes |
| 80 | Operator Split Service | Upstream/downstream temporary service and gap | ESTIMATED/SIMULATED plus validation status | Only in analysis context; inspect assumptions | Structured service segments and unresolved gap |
| 85 | Cut / Restart Points | Candidate operational boundaries | Requires validation unless evidence proves feasibility | Select candidate; expose reason/validation | Coordinates/names, route sequence, assumptions |

Z-order is semantic guidance, not a CSS constant. Flood geometry must not obscure journeys, status cannot rely on color, and every map-only decision needs keyboard-accessible textual equivalence. Tooltips are supplementary; critical evidence, warning, time, and validation state must remain visible in structured content. UI must never relabel simulation as live or spatial intersection as confirmed blockage.
