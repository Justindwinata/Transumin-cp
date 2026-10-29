# TRANSUM-IN NEXUS
# 16 — TESTING & RESEARCH EVALUATION PLAN — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN EVALUATION FOUNDATION

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Purpose

Memisahkan software verification dari research evaluation.

## 2. Testing Pyramid

1. Static checks
2. Unit tests
3. Integration tests
4. Contract tests
5. E2E
6. Research experiments

## 3. Metric Catalogue

| ID | Metric | Definition | Owner |
|---|---|---|---|
| DATA-01 | Transit ingestion validity | % records passing schema/topology validation | Student A |
| DATA-02 | Coverage | operators/routes/stops represented vs declared scope | Student A |
| TWIN-01 | State transition correctness | expected vs observed state | Student A |
| FLOOD-01 | Affected-entity precision | TP/(TP+FP) | Student A |
| FLOOD-02 | Affected-entity recall | TP/(TP+FN) | Student A |
| NET-01 | OD reachability delta | reachable OD before vs after | Student A |
| NET-02 | Broken transfer count | count under scenario | Student A |
| REC-01 | Recovery success | % disrupted journeys with feasible repaired path | Student B |
| REC-02 | Preserved-leg ratio | preserved valid original legs / eligible original legs | Student B |
| REC-03 | Additional travel time | repaired - original remaining duration | Student B |
| REC-04 | Additional transfers | repaired transfers - original remaining | Student B |
| REC-05 | Plan change count | number of changed legs/actions | Student B |
| REC-06 | Recovery latency | processing time | Student B |
| OPS-01 | Service coverage retained | served route/stops after split | Shared |
| OPS-02 | Estimated fleet requirement | formula-derived under assumptions | Shared |
| AI-01 | Unsupported claim rate | unsupported atomic claims / all claims | Student B |
| AI-02 | Required fact coverage | required facts stated / available | Student B |
| AI-03 | Tool-call success | successful authorized calls / attempted | Student B |
| UX-01 | Task completion | users completing test task | Student B |
| UX-02 | SUS | System Usability Scale if included | Student B |

## 4. Student A Experiments

### EXP-A1 Flood Spatial Impact

Controlled benchmark scenarios; report precision/recall/F1/runtime/error categories.

### EXP-A2 Network Impact

Frozen OD set; compare baseline vs disruption reachability, broken transfers, alternatives.

### EXP-A3 Scenario Reproducibility

Repeat same dataset/scenario/config.

## 5. Student B Experiments

### EXP-B1 Full Replanning vs State-Aware Repair

Baseline B0 = full replanning. Proposed = commitment-preserving repair.

Metrics REC-01..REC-06.

### EXP-B2 Copilot Factuality

Atomic claim verification against structured evidence.

### EXP-B3 Product Usability

Tasks: plan journey, interpret disruption, understand recovery, run scenario where appropriate.

## 6. Operator Recovery Evaluation

Evaluate internal consistency, retained service coverage, assumptions, topology feasibility, validation-status correctness, fleet formula reproducibility.

## 7. Test Dataset Governance

- separate dev/final cases
- freeze final benchmark
- record dataset versions/checksums
- avoid leakage

## 8. Controlled Scenario Set

1. single road blockage
2. single stop access blockage
3. transit segment blockage
4. station/transfer closure
5. multiple adjacent blockage
6. no-impact polygon
7. fully disconnected journey

## 9. Unit Test Matrix

### UT-STATE-001

- Goal: insufficient evidence returns UNKNOWN.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-SPATIAL-001

- Goal: geometry intersection edge/touch handling.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-REC-001

- Goal: completed segment locked.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-REC-002

- Goal: no path returns NO_RECOVERY_PATH.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-OPS-001

- Goal: invalid headway rejected.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-OPS-002

- Goal: fleet formula deterministic.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-AI-001

- Goal: unsupported duration rejected.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

### UT-AI-002

- Goal: SIMULATED remains labelled simulated.
- Add positive and negative case.
- Test must reference relevant FR/BR ID.

## 10. Integration Tests

- GTFS import → canonical DB
- scenario create → run → impacts
- journey plan → disruption → recovery
- route split → fleet estimate
- copilot → tool → validator → answer

## 11. E2E Tests

### E2E-01 Normal Passenger
Search → compare → select → detail.

### E2E-02 Passenger Disruption
Active journey → scenario → alert → repair.

### E2E-03 Operator Flood Recovery
Route → blockage → split → cut points → fleet estimate.

### E2E-04 Evidence Semantics
SIMULATED remains simulated end-to-end.

## 12. Performance Targets

Targets are hypotheses/engineering targets; final report must use measured results.

- route response target ~<5s where provider permits
- scenario impact target ~<10s for bounded graph where feasible
- UI remains interactive during map updates

## 13. Failure Injection

Provider outage, DB unavailable, invalid scenario, LLM unavailable, stale dataset, missing GPS permission.

## 14. Statistical Reporting

Report sample size, distribution, median/mean where appropriate, variability, confidence intervals where justified.

## 15. Reproducibility Package

Store dataset manifest, scenario manifest, code commit, config, environment notes, output metrics, raw artifacts.

## 16. Final PASS Criteria

- all CRITICAL E2E demonstrated
- no critical correctness bug
- experiment scripts reproducible
- baseline/proposed results available
- AI factuality measured
- limitations documented

## 17. Traceability Matrix Requirements

Every CRITICAL FR must map to:
- at least one unit/integration test
- at least one E2E or experiment evidence path
- one documented expected failure case

Recommended naming:
`TEST-<FRID>-<DOMAIN>-NNN`
`EXP-<STUDENT>-<TOPIC>-NNN`

## 18. Final Benchmark Freeze Procedure

1. Define study area/network snapshot.
2. Define scenario set.
3. Define journey/OD cases.
4. Define metrics.
5. Define baseline.
6. Record version/checksum.
7. Freeze before final measurement.

After freeze, bug fixes are allowed but require re-running all affected baseline/proposed experiments.

## 19. Error Analysis Framework

Classify failures:
- data coverage error
- topology error
- spatial matching error
- routing infeasibility
- recovery scoring error
- provider failure
- UI interpretation error
- LLM unsupported claim

Final thesis must discuss major error categories, not only aggregate score.

## 20. Usability Evaluation Guidance

If human study is conducted:
- keep tasks concrete
- avoid leading participants
- record task completion/time/errors
- use SUS only if appropriate sample/method
- document participant criteria and consent process

Do not overgeneralize small convenience sample to all Jakarta commuters.

## 21. Copilot Evaluation Protocol

Build question set across:
- normal route explanation
- simulated flood explanation
- no-data case
- no-recovery case
- operator recovery explanation
- provenance/freshness question

Annotate required facts and prohibited unsupported facts before running final evaluation.

## 22. Performance Test Protocol

Record hardware/runtime.
Warm-up if relevant.
Report p50/p95 for repeated API calls where meaningful.
Separate routing-provider latency from local orchestration if possible.

## 23. Regression Gate

Any change to route/state/recovery algorithm requires re-running:
- associated unit tests
- representative E2E
- affected experiment subset

Final release runs complete regression suite.

## 24. Evaluation Artifact Structure

```text
artifacts/evaluation/
  manifests/
  raw/
  summaries/
  figures/
  logs/
```

Generated charts/tables must be reproducible from raw results.

## 25. Result Interpretation Rules

- Statistical significance is not automatically practical significance.
- Better one metric may worsen another; report trade-off.
- No cherry-picking only favorable scenarios.
- Missing/failed runs reported.
- Keep simulated results explicitly simulated.
