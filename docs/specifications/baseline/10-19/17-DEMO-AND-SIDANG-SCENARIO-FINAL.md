# TRANSUM-IN NEXUS
# 17 — DEMO & CAPSTONE DEFENSE SCENARIO — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FINAL DEMO BLUEPRINT

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Purpose

Demo membuktikan research/product value, bukan sekadar halaman cantik.

## 2. Core Narrative

Normal → Disruption → Impact → Passenger Recovery → Operator Recovery → Grounded Explanation.

## 3. Preflight Checklist

- frozen demo dataset
- sources/version visible
- scenario prepared
- runtime tested
- backup recorded demo
- no fake LIVE label
- map centered
- fallback tested

## 4. Scene-by-Scene Plan

### Scene 1 — Product Context

**Primary screen:** Passenger home/map.

**Goal:** Explain in <30s: multimodal + disruption intelligence.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 2 — Normal Multimodal Journey

**Primary screen:** Fixed valid origin/destination.

**Goal:** Show 2–3 alternatives, trade-offs, select one.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 3 — Activate Flood Scenario

**Primary screen:** Scenario Lab.

**Goal:** Show polygon, SIMULATED label, time window, run.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 4 — Network Impact

**Primary screen:** Operator map.

**Goal:** Show affected segment, broken transfer/service, metrics.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 5 — Passenger Recovery

**Primary screen:** Active/selected journey.

**Goal:** Show preserved vs changed legs, additional time/transfers.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 6 — TransJakarta Recovery

**Primary screen:** Operator recovery view.

**Goal:** Show split, cut/restart points, gap, estimated fleet, assumptions.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 7 — Copilot Explanation

**Primary screen:** Copilot contextual.

**Goal:** Explain scenario, journey recovery, operator recovery, uncertainty.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

### Scene 8 — Research Evidence

**Primary screen:** Experiment view.

**Goal:** Show baseline vs proposed metrics and provenance.

**Presenter must prove:**

- this result comes from engine/data, not hardcoded UI;
- evidence semantics are visible;
- limitation is stated if applicable;

**Failure fallback:**

- explain expected result from stored verified run;
- never fabricate live result during presentation;

## 5. Student A Defense Boundary

- dataset integration
- GIS/spatial network
- mobility twin
- flood impact
- scenario/network simulation
- A metrics

## 6. Student B Defense Boundary

- product/system architecture
- journey planning/orchestration
- state-aware repair
- passenger UX
- operator recovery integration
- copilot
- deployment/integration
- B metrics

## 7. Likely Examiner Questions

### Q1: Ini bukannya Google Maps?

Answer: research focus is disruption impact + journey repair + operator service recovery, not generic navigation coverage.

### Q2: Data banjir realtime dari mana?

Answer: system distinguishes observed/live/simulated; thesis does not claim full realtime if unavailable.

### Q3: AI-nya di mana?

Answer: bounded explanation/tool layer; route/impact/recovery facts from structured engines.

### Q4: Kalau turnback recommendation salah?

Answer: candidate carries REQUIRES_OPERATOR_VALIDATION; system is DSS, not autonomous safety authority.

### Q5: Dataset semua operator lengkap?

Answer: show coverage matrix; do not overclaim beyond validated snapshot.

## 8. Demo Failure Plan

- LLM fail → deterministic explanation
- scenario fail → stored verified evidence + disclose runtime issue
- internet fail → local validated snapshot
- map tiles fail → backup visual if prepared

## 9. Demo Definition of Done

Normal + disruption + passenger recovery + operator recovery + explanation + experiment evidence repeatable from clean startup.

## 10. Detailed Presenter Script Outline

### Opening
Problem: fragmented multimodal journey + flood disruption causes route/service breakdown.

### Transition to Product
TRANSUM-IN shifts from static route planning to disruption analysis and recovery.

### During Normal Journey
Point out multiple operators and decision-ready trade-offs.

### During Flood Scenario
State clearly that the demonstration event is SIMULATED unless source is observed/live.

### During Passenger Recovery
Explain preserved journey legs versus full replanning.

### During Operator Recovery
Explain split-service is recommendation with validation status.

### During AI
Explain AI does not invent routes; it calls bounded system tools.

## 11. Evidence the Examiner Should See

- dataset/version/source marker
- scenario ID
- affected geometry
- journey before/after
- recovery metrics
- route split
- fleet assumptions
- AI evidence/semantic label
- experiment result

## 12. Anti-Demo-Smoke Rules

Do not:
- preload a screenshot and pretend it is calculated live
- hide that scenario is simulated
- use fake fleet count
- claim all Jakarta coverage if study snapshot is smaller
- claim prediction if only simulation

## 13. Timing Plan

Suggested 7–10 minute product demo:
- 0:00–0:45 context
- 0:45–2:00 normal journey
- 2:00–3:00 flood scenario
- 3:00–4:15 network impact
- 4:15–5:30 passenger recovery
- 5:30–6:45 operator recovery
- 6:45–7:30 copilot
- 7:30–8:30 research metrics

Adjust to actual defense allocation.

## 14. Q&A Evidence Pack

Prepare offline:
- architecture diagram
- data-source matrix
- dataset checksum/version
- API spec
- ERD
- experiment table
- screenshots of failure/degraded states
- limitation list

## 15. Rehearsal Checklist

- [ ] cold-start test
- [ ] database reset/reload path known
- [ ] scenario reproducible
- [ ] exact demo OD valid
- [ ] AI fallback works
- [ ] no secrets visible
- [ ] mobile/desktop layout checked
- [ ] presenter knows where metrics came from
