# TRANSUM-IN NEXUS
# 11 — BUSINESS RULES & SYSTEM LOGIC — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN BUSINESS LOGIC BASELINE

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Purpose

Dokumen ini mendefinisikan invariants dan decision logic yang harus tetap benar meskipun implementation detail berubah.

## 2. Decision Hierarchy

```text
RAW / VERSIONED DATA
        ↓
VALIDATION
        ↓
CANONICAL MOBILITY MODEL
        ↓
BASE NETWORK STATE
        ↓
OPTIONAL SCENARIO OVERLAY
        ↓
ROUTING / IMPACT / RECOVERY ALGORITHMS
        ↓
STRUCTURED DECISION
        ↓
AI EXPLANATION
```

LLM berada pada layer penjelasan/orchestration; bukan source of truth.

## 3. Canonical State Logic

### 3.1 Availability

- AVAILABLE — usable.
- WARNING — usable with warning.
- DISRUPTED — service/path terganggu.
- UNAVAILABLE — tidak dapat dipakai.
- UNKNOWN — evidence tidak cukup.

### 3.2 Evidence Type

- SCHEDULED
- OBSERVED
- LIVE
- FORECAST
- SIMULATED
- ESTIMATED

### 3.3 State Resolution

Jika banyak evidence bertentangan, resolution policy harus deterministic dan terdokumentasi. Conflict tidak diselesaikan oleh LLM.

## 4. Formal Business Rule Catalogue

| Rule ID | Name | Rule |
|---|---|---|
| BR-DATA-001 | No fabricated production facts | Jika source tidak mendukung fakta, gunakan UNKNOWN/UNAVAILABLE, bukan asumsi. |
| BR-DATA-002 | Provenance mandatory | Semua imported dataset dan derived intelligence harus traceable ke source/version/run. |
| BR-DATA-003 | Live semantics | Label LIVE hanya untuk source yang memang live. |
| BR-ROUTE-001 | Broken path invalid | Path dengan transfer/edge yang tidak feasible tidak boleh jadi journey valid. |
| BR-ROUTE-002 | Disrupted edge avoidance | Entity DISRUPTED/UNAVAILABLE dikeluarkan atau diberi penalty sesuai scenario policy. |
| BR-ROUTE-003 | Candidate diversity | Journey option praktis-identik harus dideduplicate. |
| BR-TWIN-001 | Overlay isolation | Scenario state tidak boleh menimpa base state permanen. |
| BR-TWIN-002 | State transition trace | Perubahan state wajib memiliki event/reason/time/source. |
| BR-FLOOD-001 | Intersection is not impassability | Spatial overlap hanya candidate impact kecuali rule/scenario menyatakan blocked. |
| BR-FLOOD-002 | Evidence distinction | Observed flood dan simulated flood dibedakan end-to-end. |
| BR-REC-001 | Preserve completed legs | Journey recovery tidak boleh mengubah leg yang telah selesai. |
| BR-REC-002 | No imaginary bridge | System tidak boleh membuat shuttle/perahu/walking gap tanpa configured resource/scenario. |
| BR-REC-003 | No recovery path | Jika tidak ada path feasible, explicit NO_RECOVERY_PATH. |
| BR-OPS-001 | Operator validation | Cut point/turnback belum tervalidasi berstatus REQUIRES_OPERATOR_VALIDATION. |
| BR-OPS-002 | Fleet estimate wording | Fleet count adalah ESTIMATED VEHICLE REQUIREMENT berdasarkan assumption. |
| BR-OPS-003 | Emergency authority boundary | System memberi decision support, bukan perintah operasi darurat. |
| BR-AI-001 | LLM bounded by tools | Copilot hanya menyimpulkan dari authorized tool results/evidence. |
| BR-AI-002 | Factuality validation | Jawaban copilot melewati validator atau deterministic fallback. |
| BR-AI-003 | No hidden mutation | Copilot tidak mengubah network/scenario tanpa explicit authorized action. |
| BR-EXP-001 | Experiment freeze | Test set/baseline/config utama dibekukan sebelum final test. |
| BR-EXP-002 | Reproducibility | Experiment mencatat dataset, engine version, config, scenario, timestamp. |

## 5. Journey Planning Logic

### 5.1 Candidate Validity

Journey valid hanya jika seluruh leg terhubung secara spasial/temporal dan tidak melanggar hard disruption constraint.

### 5.2 Ranking Features

- total duration
- walking duration/distance
- transfer count
- disruption exposure
- route complexity
- preservation score untuk recovery

Weight harus versioned/configured; tidak boleh tersebar sebagai magic numbers.

### 5.3 Decision-Ready Deduplication

Dua journey yang hanya berbeda trip minor tetapi memberi keputusan moda/transfer sama dapat dikelompokkan satu decision family.

## 6. Flood Impact Logic

### 6.1 Event Validation

Flood event minimal memiliki geometry, validity time, evidence type, source/scenario owner.

### 6.2 Direct Impact

Direct impact adalah intersection dengan entity sesuai configured spatial policy.

### 6.3 Blockage Policy

Intersection != confirmed blockage. Blockage berasal dari confirmed source atau explicit scenario rule.

### 6.4 Propagated Impact

Propagated impact adalah consequence pada route/transfer/journey yang bergantung pada direct-impact entity.

## 7. Passenger Journey Recovery Logic

### 7.1 Completed Legs

Completed leg immutable.

### 7.2 Valid Commitment Preservation

Planned leg yang masih feasible dipertahankan jika sesuai scoring/policy.

### 7.3 Recovery Search

Search dimulai dari current logical position/state.

### 7.4 Recovery Failure

Jika tidak ada path, explicit failure; jangan invent route/shuttle.

## 8. TransJakarta Operator Recovery Logic

### 8.1 Route Split

Blocked route dapat dipartisi menjadi upstream/downstream service jika subroute connectivity feasible.

### 8.2 Candidate Turnback

Tanpa turning evidence, status tetap REQUIRES_OPERATOR_VALIDATION.

### 8.3 Temporary Bridge

Bridge resource harus configured; tidak diimajinasikan.

### 8.4 Fleet Estimation

```text
cycle_time = outbound_time + return_time + turnaround_buffer
estimated_vehicles = ceil(cycle_time / target_headway)
```

Semua assumption harus muncul bersama hasil.

## 9. Scenario & Replay Logic

- Base snapshot immutable selama run.
- Overlay isolated.
- Failed run tidak dipresentasikan sebagai final success.
- Replay menunjuk exact dataset/scenario/engine version.

## 10. Copilot Logic

```text
USER QUESTION
    ↓
INTENT / TOOL SELECTION
    ↓
AUTHORIZED TOOL CALL
    ↓
STRUCTURED RESULT
    ↓
FACT VALIDATION
    ↓
ANSWER OR DETERMINISTIC FALLBACK
```

## 11. Business Logic Anti-Patterns

- Hardcoded metrics untuk demo.
- Random risk score tanpa formula.
- Mengubah schedule agar route tampak tersedia.
- LLM menentukan apakah jalan banjir dapat dilewati.
- UI state menjadi source of truth.
- Menghapus UNKNOWN agar dashboard terlihat lengkap.

## 12. Rule Change Governance

Rule CRITICAL hanya berubah jika alasan, impact, approval, document version, dan regression test tersedia.

## 13. Definition of Done

Setiap CRITICAL rule memiliki automated test atau experiment assertion.

## 14. Rule-to-Test Matrix

### BR-DATA-001

**Rule:** Jika source tidak mendukung fakta, gunakan UNKNOWN/UNAVAILABLE, bukan asumsi.

**Minimum verification:**

- Unit/integration test membuktikan `BR-DATA-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-DATA-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-DATA-002

**Rule:** Semua imported dataset dan derived intelligence harus traceable ke source/version/run.

**Minimum verification:**

- Unit/integration test membuktikan `BR-DATA-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-DATA-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-DATA-003

**Rule:** Label LIVE hanya untuk source yang memang live.

**Minimum verification:**

- Unit/integration test membuktikan `BR-DATA-003` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-DATA-003`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-ROUTE-001

**Rule:** Path dengan transfer/edge yang tidak feasible tidak boleh jadi journey valid.

**Minimum verification:**

- Unit/integration test membuktikan `BR-ROUTE-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-ROUTE-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-ROUTE-002

**Rule:** Entity DISRUPTED/UNAVAILABLE dikeluarkan atau diberi penalty sesuai scenario policy.

**Minimum verification:**

- Unit/integration test membuktikan `BR-ROUTE-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-ROUTE-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-ROUTE-003

**Rule:** Journey option praktis-identik harus dideduplicate.

**Minimum verification:**

- Unit/integration test membuktikan `BR-ROUTE-003` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-ROUTE-003`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-TWIN-001

**Rule:** Scenario state tidak boleh menimpa base state permanen.

**Minimum verification:**

- Unit/integration test membuktikan `BR-TWIN-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-TWIN-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-TWIN-002

**Rule:** Perubahan state wajib memiliki event/reason/time/source.

**Minimum verification:**

- Unit/integration test membuktikan `BR-TWIN-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-TWIN-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-FLOOD-001

**Rule:** Spatial overlap hanya candidate impact kecuali rule/scenario menyatakan blocked.

**Minimum verification:**

- Unit/integration test membuktikan `BR-FLOOD-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-FLOOD-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-FLOOD-002

**Rule:** Observed flood dan simulated flood dibedakan end-to-end.

**Minimum verification:**

- Unit/integration test membuktikan `BR-FLOOD-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-FLOOD-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-REC-001

**Rule:** Journey recovery tidak boleh mengubah leg yang telah selesai.

**Minimum verification:**

- Unit/integration test membuktikan `BR-REC-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-REC-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-REC-002

**Rule:** System tidak boleh membuat shuttle/perahu/walking gap tanpa configured resource/scenario.

**Minimum verification:**

- Unit/integration test membuktikan `BR-REC-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-REC-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-REC-003

**Rule:** Jika tidak ada path feasible, explicit NO_RECOVERY_PATH.

**Minimum verification:**

- Unit/integration test membuktikan `BR-REC-003` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-REC-003`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-OPS-001

**Rule:** Cut point/turnback belum tervalidasi berstatus REQUIRES_OPERATOR_VALIDATION.

**Minimum verification:**

- Unit/integration test membuktikan `BR-OPS-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-OPS-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-OPS-002

**Rule:** Fleet count adalah ESTIMATED VEHICLE REQUIREMENT berdasarkan assumption.

**Minimum verification:**

- Unit/integration test membuktikan `BR-OPS-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-OPS-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-OPS-003

**Rule:** System memberi decision support, bukan perintah operasi darurat.

**Minimum verification:**

- Unit/integration test membuktikan `BR-OPS-003` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-OPS-003`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-AI-001

**Rule:** Copilot hanya menyimpulkan dari authorized tool results/evidence.

**Minimum verification:**

- Unit/integration test membuktikan `BR-AI-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-AI-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-AI-002

**Rule:** Jawaban copilot melewati validator atau deterministic fallback.

**Minimum verification:**

- Unit/integration test membuktikan `BR-AI-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-AI-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-AI-003

**Rule:** Copilot tidak mengubah network/scenario tanpa explicit authorized action.

**Minimum verification:**

- Unit/integration test membuktikan `BR-AI-003` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-AI-003`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-EXP-001

**Rule:** Test set/baseline/config utama dibekukan sebelum final test.

**Minimum verification:**

- Unit/integration test membuktikan `BR-EXP-001` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-EXP-001`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.

### BR-EXP-002

**Rule:** Experiment mencatat dataset, engine version, config, scenario, timestamp.

**Minimum verification:**

- Unit/integration test membuktikan `BR-EXP-002` pada normal case.
- Negative test membuktikan sistem menolak pelanggaran `BR-EXP-002`.
- Jika rule menyangkut UI semantics, UI/E2E test memastikan label/status tidak menyesatkan.
