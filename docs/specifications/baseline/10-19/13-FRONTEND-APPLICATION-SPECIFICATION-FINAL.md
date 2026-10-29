# TRANSUM-IN NEXUS
# 13 — FRONTEND APPLICATION SPECIFICATION — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN FRONTEND IMPLEMENTATION BASELINE

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Experience Goal

Frontend menyederhanakan intelligence kompleks menjadi keputusan manusia yang cepat. UI tidak boleh tampak seperti generic AI/admin dashboard.

## 2. Stack

- Next.js App Router
- React + TypeScript strict
- Tailwind CSS
- MapLibre GL
- TanStack Query
- Zustand untuk small shared client state
- Motion library untuk purposeful transition

## 3. Information Architecture

```text
Passenger
  /
  /journeys
  /journeys/[id]
  /journeys/[id]/active
  /recoveries/[id]
  /copilot

Research/Operator
  /ops/network
  /ops/scenarios
  /ops/scenarios/[id]
  /ops/operator-recovery/[id]
  /ops/experiments
```

## 4. Design Principles

1. Map-first, not card-first.
2. Decision-first.
3. Progressive disclosure.
4. Evidence-aware.
5. Calm during disruption.
6. Passenger mobile-first; operator desktop-first.

## 5. Page Specifications

### APP-001 — Passenger Home / Journey Search

**Primary Actor:** Passenger

**Purpose:** Search-first map experience; origin/destination; network status; recent/saved optional.

**Core Components:**

- `JourneySearchBar`
- `MapCanvas`
- `NetworkStatusPill`
- `RecentJourney`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-002 — Journey Results

**Primary Actor:** Passenger

**Purpose:** Decision-ready alternatives and trade-offs.

**Core Components:**

- `JourneyOptionCard`
- `RouteLabel`
- `TradeoffStrip`
- `MapRoutePreview`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-003 — Journey Detail

**Primary Actor:** Passenger

**Purpose:** Segment-by-segment actionable plan.

**Core Components:**

- `JourneyTimeline`
- `TransferInstruction`
- `EvidenceFreshness`
- `MapLayer`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-004 — Active Journey

**Primary Actor:** Passenger

**Purpose:** Foreground GPS journey state, next action, disruption alert.

**Core Components:**

- `ActiveJourneyMap`
- `NextActionCard`
- `ProgressTimeline`
- `RecoveryBanner`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-005 — Recovery Comparison

**Primary Actor:** Passenger

**Purpose:** Original vs full-replan vs NEXUS repair.

**Core Components:**

- `BeforeAfterJourney`
- `PreservedLegIndicator`
- `RecoveryMetrics`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-006 — Copilot

**Primary Actor:** Passenger/Researcher

**Purpose:** Contextual tool-grounded assistant.

**Core Components:**

- `CopilotDrawer`
- `EvidenceChip`
- `ToolStatus`
- `SuggestedPrompt`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-007 — Operator/Research Network View

**Primary Actor:** Researcher/Operator

**Purpose:** Map-first network status + affected layers.

**Core Components:**

- `NetworkCommandMap`
- `LayerControl`
- `ImpactMetricStrip`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-008 — Scenario Lab

**Primary Actor:** Researcher/Operator

**Purpose:** Create and run controlled disruption scenario.

**Core Components:**

- `ScenarioBuilder`
- `GeometryEditor`
- `ScenarioRunPanel`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-009 — TransJakarta Recovery View

**Primary Actor:** Researcher/Operator

**Purpose:** Route split, cut points, bridge gap, fleet estimate.

**Core Components:**

- `RouteSplitMap`
- `CutPointPanel`
- `FleetEstimate`
- `AssumptionDrawer`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

### APP-010 — Experiment View

**Primary Actor:** Researcher

**Purpose:** Baseline vs proposed metrics, run provenance.

**Core Components:**

- `ExperimentSelector`
- `MetricTable`
- `RunMetadata`
- `Export`

**Required UI states:**

- initial/idle
- loading
- success
- empty/no-result
- degraded/partial-data
- error
- offline/no-network where relevant

**Responsive rule:**

- Mobile: prioritize map + bottom sheet/next action.
- Desktop: map + side panel or contextual split pane.

**Accessibility:**

- keyboard/focus semantics
- sufficient contrast
- text alternative for non-map critical information
- color is never the only status cue

**Data integrity:**

- Do not display fake live metrics.
- Evidence label must match backend evidence type.
- Unknown data remains unknown, not silently hidden.

---

## 6. Passenger Journey Visual Language

Journey timeline should emphasize NEXT ACTION, THEN, TRANSFER, ARRIVAL. Operator/mode icon + text; never color alone.

## 7. Disruption Visual Language

- Amber: warning.
- Red: unavailable/critical confirmed in context.
- Purple/blue distinct styling: simulated scenario.
- Dashed/transparent segment: blocked/unavailable.
- Recovery path visually distinct.

## 8. TransJakarta Split-Service UX

```text
UPSTREAM SERVICE
      ↓
CUT POINT A
      X FLOOD GAP X
RESTART POINT B
      ↓
DOWNSTREAM SERVICE
```

Panel wajib menampilkan blocked segment, cut/restart candidate, validation status, bridge assumption, estimated fleet, limitations.

## 9. Responsive Behaviour

### Mobile passenger

- full-height map
- bottom sheet
- next action always reachable
- alert not permanently covering map

### Operator desktop

- command-map dominant
- scenario controls side panel
- compact metric strip, not 20 random cards

## 10. Motion Rules

Allowed: route selection, overlay activation, active progress, before/after recovery, panel hierarchy.

Forbidden: excessive gradients, blobs, meaningless parallax, pulsing AI icons, ornamental glass everywhere.

## 11. Design Tokens

Use semantic tokens: surface, text, border, accent, warning, danger, simulated, success.

## 12. Component Boundaries

- Map does not calculate routing.
- Journey card does not calculate metrics.
- Copilot UI does not own truth.
- Shared API types used across pages.

## 13. Frontend Folder Guideline

```text
apps/web/src/
  app/
  features/
    journey/
    map/
    active-journey/
    recovery/
    disruption/
    scenario/
    operator-recovery/
    copilot/
  components/
  lib/
  hooks/
```

## 14. Performance

- lazy load heavy research panels
- avoid thousands of React geometry nodes
- cache server state
- virtualize long tables

## 15. Anti AI-Slop Checklist

- no generic gradient hero
- no fake KPIs
- no inconsistent iconography
- no decorative map
- no excessive glassmorphism
- no placeholder production text

## 16. Frontend Definition of Done

- journey planning from UI works
- selected journey visible on map
- simulated vs actual state distinguishable
- passenger recovery understandable without raw JSON
- operator split visible
- responsive mobile/desktop
- error/loading/degraded states implemented
- no fake production metric
