# TRANSUM-IN NEXUS
# 10 — FUNCTIONAL REQUIREMENT SPECIFICATION (FRS) — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN IMPLEMENTATION BASELINE

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Document Purpose

Dokumen ini adalah kontrak fungsional resmi untuk pembangunan TRANSUM-IN NEXUS. Dokumen ini menerjemahkan visi produk, masukan dosen, arsitektur, dan research scope menjadi requirement yang dapat diimplementasikan dan diuji.

AI Agent wajib menggunakan identifier requirement di dokumen ini ketika membuat issue, branch, test, perubahan database, API, maupun UI.

## 2. Product Boundary

TRANSUM-IN NEXUS bukan Google Maps clone, bukan dashboard banjir, bukan chatbot transportasi, dan bukan autonomous transport control.

Produk final adalah adaptive multimodal urban mobility decision-support platform yang menggabungkan journey planning, mobility twin, flood disruption analysis, passenger journey recovery, operator-oriented TransJakarta service recovery analysis, dan grounded agentic explanation.

## 3. Core Product Outcomes

1. Pengguna dapat merencanakan perjalanan multimoda.
2. Sistem dapat membedakan kondisi normal, observed, scheduled, simulated, estimated, dan unknown.
3. Gangguan banjir dapat diproyeksikan ke network secara spasial.
4. Dampak gangguan terhadap connectivity dan journey dapat dihitung.
5. Perjalanan aktif dapat diperbaiki secara state-aware.
6. Skenario pemutusan trayek TransJakarta dapat dianalisis untuk split-service dan estimasi fleet requirement.
7. AI hanya menjelaskan/menjalankan bounded tools berdasarkan evidence.

## 4. Requirement Priority

| Priority | Meaning |
|---|---|
| CRITICAL | Harus selesai agar research/product core dianggap selesai |
| HIGH | Sangat penting untuk value/demo/evaluation |
| MEDIUM | Pendukung profesionalisasi product |

## 5. Global Actors

- Passenger
- Researcher/Operator
- Admin
- Routing Engine
- Mobility Twin
- Scenario Engine
- Recovery Engine
- Copilot

## 6. Global Data Semantics

Availability state minimum: `AVAILABLE`, `WARNING`, `DISRUPTED`, `UNAVAILABLE`, `UNKNOWN`.

Evidence type minimum: `SCHEDULED`, `OBSERVED`, `LIVE`, `FORECAST`, `SIMULATED`, `ESTIMATED`.

Availability dan evidence type tidak boleh digabung menjadi satu enum.

---

## 7. Detailed Functional Requirements

### FR-001 — Unified Multimodal Journey Planning

**Priority:** CRITICAL

**Primary Owner:** Student B

#### Objective

Menghasilkan perjalanan end-to-end yang dapat mengombinasikan TransJakarta, Mikrotrans/JakLingko, KRL, MRT Jakarta, LRT Jakarta, LRT Jabodebek, serta walking connection.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- origin coordinates/name
- destination coordinates/name
- departure or arrival time
- journey preference
- current/scenario network state

#### Required Outputs

- candidate journeys
- segment sequence
- duration
- transfer count
- walking distance
- mode/operator information
- source/freshness metadata

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Semua segmen harus tersambung secara spasial dan temporal.
2. Journey dengan broken transfer tidak valid.
3. Routing engine, bukan LLM, menjadi sumber rute.
4. Entity DISRUPTED/UNAVAILABLE tidak boleh dianggap normal.
5. Jika data operator tidak cukup, sistem harus menunjukkan coverage limitation.

#### Exception / Degraded Cases

- Origin di luar coverage
- Destination tidak dapat dicapai
- Schedule source gagal
- Routing provider timeout
- Data stale atau tidak lengkap

#### Data / Database Dependencies

- `operator`
- `route`
- `station`
- `stop`
- `trip`
- `stop_time`
- `transfer`
- `walking_edge`
- `mobility_state`
- `dataset_version`

#### API Dependencies

- `POST /api/v1/journeys/plan`
- `GET /api/v1/transit/operators`
- `GET /api/v1/network/state`

#### Frontend Dependencies

- `JourneySearch`
- `JourneyOptionList`
- `JourneyOptionCard`
- `JourneyTimeline`
- `MobilityMap`
- `NetworkStatusIndicator`

#### Evaluation Metrics

- journey validity
- routing latency
- transfer validity
- coverage by operator

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-001 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-001`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-002 — Decision-Ready Journey Comparison

**Priority:** HIGH

**Primary Owner:** Student B

#### Objective

Menyajikan sedikit alternatif perjalanan yang berbeda secara keputusan, bukan sekadar banyak path yang hampir sama.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- candidate journeys
- duration
- transfer count
- walking distance
- disruption exposure
- journey complexity

#### Required Outputs

- ranked options
- labels FASTEST/FEWEST_TRANSFERS/LEAST_WALKING
- reason for each label
- trade-off summary

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Label harus berasal dari metric nyata.
2. Alternatif praktis-identik harus dideduplicate.
3. Ranking tidak boleh menghilangkan perjalanan valid hanya karena bukan tercepat.
4. Trade-off harus dapat dijelaskan.

#### Exception / Degraded Cases

- Semua kandidat identik
- Hanya satu kandidat feasible
- Metric tertentu tidak tersedia

#### Data / Database Dependencies

- `journey`
- `journey_segment`
- `mobility_state`

#### API Dependencies

- `POST /api/v1/journeys/plan`
- `GET /api/v1/journeys/{id}/comparison`

#### Frontend Dependencies

- `DecisionReadyComparison`
- `RouteLabel`
- `TradeoffSummary`

#### Evaluation Metrics

- option diversity
- duplicate candidate rate
- decision latency

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-002 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-002`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-003 — Hybrid Operational Mobility Twin

**Priority:** CRITICAL

**Primary Owner:** Student A

#### Objective

Merepresentasikan state operasional jaringan transportasi yang versioned, temporal, dan memiliki provenance.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- canonical transit entities
- spatial network
- state events
- scenario overlays
- source metadata

#### Required Outputs

- current/base state
- scenario state
- state history
- entity availability
- evidence type

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Availability state dan evidence type harus dipisahkan.
2. Simulation overlay tidak boleh merusak base state.
3. Setiap transition harus memiliki reason/source/timestamp.
4. LIVE hanya digunakan bila sumber benar-benar live.
5. UNKNOWN lebih baik daripada mengarang kondisi.

#### Exception / Degraded Cases

- Conflicting sources
- Missing timestamp
- Expired event
- Unknown entity

#### Data / Database Dependencies

- `mobility_entity`
- `mobility_state`
- `mobility_state_history`
- `network_snapshot`
- `dataset_version`

#### API Dependencies

- `GET /api/v1/network/state`
- `GET /api/v1/network/entities/{id}`
- `GET /api/v1/network/snapshots/{id}`

#### Frontend Dependencies

- `NetworkStateLayer`
- `EvidenceTypeBadge`
- `StateHistoryDrawer`

#### Evaluation Metrics

- state coverage
- state transition correctness
- snapshot reproducibility

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-003 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-003`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-004 — Flood Event Ingestion and Spatial Impact Intelligence

**Priority:** CRITICAL

**Primary Owner:** Student A

#### Objective

Mengubah event banjir observed/historical/simulated menjadi kandidat dampak spasial pada road/transit network.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- flood geometry or center+radius
- severity
- validity interval
- evidence type
- source

#### Required Outputs

- intersecting roads
- intersecting transit segments
- affected stops/stations
- impact confidence/status

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Spatial intersection tidak otomatis berarti confirmed impassable.
2. Observed dan simulated event harus dibedakan.
3. Radius input harus dikonversi menjadi geometry eksplisit.
4. Semua impact harus memiliki evidence status.

#### Exception / Degraded Cases

- Geometry invalid
- Flood outside study area
- Source unavailable
- No intersection

#### Data / Database Dependencies

- `flood_event_detail`
- `disruption_event`
- `road_segment`
- `transit_shape`
- `disruption_impact`

#### API Dependencies

- `POST /api/v1/disruptions/flood`
- `GET /api/v1/disruptions/{id}/impact`

#### Frontend Dependencies

- `FloodScenarioEditor`
- `FloodPolygonLayer`
- `AffectedEntityPanel`

#### Evaluation Metrics

- spatial match correctness
- affected entity precision/recall
- processing latency

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-004 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-004`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-005 — Network Disruption Impact Analysis

**Priority:** CRITICAL

**Primary Owner:** Student A

#### Objective

Mengukur perubahan connectivity dan availability ketika node/edge/segment tidak tersedia.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- base network snapshot
- scenario overlay
- OD test set
- routing configuration

#### Required Outputs

- affected entities
- broken transfers
- connectivity change
- OD reachability change
- alternative connection availability

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Perhitungan harus reproducible.
2. Direct impact dan propagated impact harus dibedakan.
3. Metric dibekukan sebelum final evaluation.
4. Tidak boleh mengklaim crowd impact tanpa demand data.

#### Exception / Degraded Cases

- Disconnected subgraph
- No OD test set
- Incomplete topology

#### Data / Database Dependencies

- `network_snapshot`
- `simulation_scenario`
- `impact_result`
- `experiment_run`

#### API Dependencies

- `POST /api/v1/simulations/run`
- `GET /api/v1/simulations/{id}/impact`

#### Frontend Dependencies

- `ImpactSummary`
- `ConnectivityDelta`
- `AffectedRouteLayer`

#### Evaluation Metrics

- affected edge count
- broken transfer count
- OD reachability delta
- runtime

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-005 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-005`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-006 — State-Aware Passenger Journey Recovery

**Priority:** CRITICAL

**Primary Owner:** Student B

#### Objective

Memperbaiki perjalanan aktif dengan mempertahankan commitment yang masih valid dibanding full replanning.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- original journey
- completed segments
- current position
- destination
- current/scenario network state

#### Required Outputs

- repaired journey
- preserved segment count
- changed segment count
- additional duration
- additional transfers
- reason

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Completed segment tidak boleh diubah.
2. Valid prefix/suffix yang usable dipertahankan sebisa mungkin.
3. Jika tidak ada recovery path, return NO_RECOVERY_PATH.
4. Recovery harus menghindari disrupted entities.
5. Full replanning baseline tetap tersedia untuk evaluation.

#### Exception / Degraded Cases

- User position unknown
- No feasible path
- Disruption sebelum journey start
- Multiple simultaneous disruptions

#### Data / Database Dependencies

- `journey`
- `journey_segment`
- `journey_state_event`
- `recovery_plan`
- `recovery_segment`
- `mobility_state`

#### API Dependencies

- `POST /api/v1/recoveries`
- `GET /api/v1/recoveries/{id}`

#### Frontend Dependencies

- `RecoveryBanner`
- `BeforeAfterJourney`
- `PreservedSegmentIndicator`
- `RecoveryExplanation`

#### Evaluation Metrics

- recovery success
- preserved-leg ratio
- additional time
- additional transfers
- plan-change count
- latency

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-006 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-006`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-007 — TransJakarta Flood Service Recovery Planning

**Priority:** CRITICAL

**Primary Owner:** Shared: A analysis, B product/integration

#### Objective

Menganalisis pemutusan trayek TransJakarta dan menghasilkan decision-support untuk split service, safe cut point, turnback candidate, temporary bridging, serta estimasi kebutuhan armada.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- affected route
- blocked segment
- road/transit topology
- target headway assumption
- turnaround buffer
- operator-defined bridge resource

#### Required Outputs

- upstream service
- downstream service
- candidate cut point
- candidate restart point
- unresolved gap
- estimated fleet requirement
- validation status

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Recommendation bukan autonomous dispatch command.
2. Turning feasibility tanpa evidence harus REQUIRES_OPERATOR_VALIDATION.
3. Temporary bridge mode harus operator-configured.
4. Fleet output harus disebut ESTIMATED VEHICLE REQUIREMENT.
5. Safety decisions tetap pada operator/authority.

#### Exception / Degraded Cases

- No feasible split point
- No road turnaround evidence
- Insufficient schedule/headway data
- Multiple flood gaps

#### Data / Database Dependencies

- `route`
- `road_segment`
- `operator_recovery_plan`
- `simulation_scenario`
- `impact_result`

#### API Dependencies

- `POST /api/v1/operator-recovery/analyze`
- `GET /api/v1/operator-recovery/{id}`

#### Frontend Dependencies

- `RouteSplitMap`
- `CutPointCandidatePanel`
- `FleetEstimateCard`
- `ValidationStatusBadge`

#### Evaluation Metrics

- service coverage retained
- estimated fleet count
- unserved gap length
- scenario runtime

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-007 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-007`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-008 — What-If Scenario Simulation

**Priority:** CRITICAL

**Primary Owner:** Student A

#### Objective

Menjalankan controlled scenario tanpa menunggu kejadian nyata dan membandingkan baseline vs disrupted state.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- scenario type
- target entities/geometry
- time interval
- severity/closure policy
- base snapshot

#### Required Outputs

- simulation run
- scenario snapshot
- impact metrics
- recoverability metrics

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Scenario harus isolated dari base state.
2. Scenario definition harus versioned.
3. Result harus reproducible.
4. Simulation state harus ditandai SIMULATED.

#### Exception / Degraded Cases

- Invalid scenario
- Unknown entity
- Simulation timeout
- No baseline snapshot

#### Data / Database Dependencies

- `simulation_scenario`
- `simulation_run`
- `network_snapshot`
- `impact_result`

#### API Dependencies

- `POST /api/v1/simulations`
- `POST /api/v1/simulations/{id}/run`
- `GET /api/v1/simulations/{id}`

#### Frontend Dependencies

- `ScenarioBuilder`
- `ScenarioRunPanel`
- `BaselineVsScenario`

#### Evaluation Metrics

- runtime
- reproducibility
- result completeness

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-008 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-008`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-009 — Active Journey Monitoring

**Priority:** HIGH

**Primary Owner:** Student B

#### Objective

Mengubah planned journey menjadi journey state yang dapat dipantau dan diberi next action.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- selected journey
- foreground location
- network state
- time

#### Required Outputs

- current phase
- next action
- progress
- risk/disruption alert
- recovery trigger

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Baseline menggunakan foreground PWA geolocation.
2. Tidak menjanjikan background tracking saat browser ditutup.
3. Location permission harus explicit.
4. No location = degraded/manual progress mode.

#### Exception / Degraded Cases

- Permission denied
- GPS unavailable
- User deviates from path
- No internet

#### Data / Database Dependencies

- `journey`
- `journey_state_event`
- `journey_segment`
- `mobility_state`

#### API Dependencies

- `POST /api/v1/journeys/{id}/activate`
- `PATCH /api/v1/journeys/{id}/progress`
- `GET /api/v1/journeys/{id}/status`

#### Frontend Dependencies

- `ActiveJourneyMap`
- `NextActionCard`
- `JourneyProgressTimeline`
- `DisruptionAlert`

#### Evaluation Metrics

- state transition correctness
- task completion
- recovery trigger correctness

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-009 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-009`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-010 — Grounded Agentic Mobility Copilot

**Priority:** HIGH

**Primary Owner:** Student B

#### Objective

Menyediakan natural-language interface yang menggunakan bounded tools untuk menjelaskan route, scenario, impact, dan recovery berdasarkan evidence.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- user question
- authorized context
- tool results

#### Required Outputs

- grounded answer
- tool trace metadata
- evidence references
- uncertainty statement

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. LLM tidak boleh membuat route sendiri.
2. LLM tidak boleh mengubah network state.
3. Observed/scheduled/simulated/estimated harus dibedakan.
4. Factuality validator wajib.
5. Fallback deterministic template digunakan jika validator gagal.

#### Exception / Degraded Cases

- LLM unavailable
- Tool fails
- Insufficient evidence
- Unsupported operational request

#### Data / Database Dependencies

- `copilot_session`
- `tool_execution_log`
- `journey`
- `simulation_run`
- `recovery_plan`

#### API Dependencies

- `POST /api/v1/copilot/messages`
- `GET /api/v1/copilot/sessions/{id}`

#### Frontend Dependencies

- `CopilotDrawer`
- `EvidenceChip`
- `ToolStatus`
- `UncertaintyNotice`

#### Evaluation Metrics

- unsupported claim rate
- required fact coverage
- tool-call success
- response latency

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-010 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-010`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-011 — Research and Operator Intelligence Dashboard

**Priority:** HIGH

**Primary Owner:** Student B UI, A/B data

#### Objective

Menyediakan map-first workspace untuk scenario, network impact, recovery plan, dan research metrics.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- network snapshot
- scenario run
- impact metrics
- operator recovery result

#### Required Outputs

- map layers
- scenario comparison
- network health indicators
- experiment result

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Bukan CRUD/admin dashboard generik.
2. Metric harus berasal dari engine.
3. Tidak boleh menampilkan fake live KPIs.
4. Map menjadi primary visualization.

#### Exception / Degraded Cases

- No scenario
- No data coverage
- Experiment failed

#### Data / Database Dependencies

- `simulation_run`
- `impact_result`
- `operator_recovery_plan`
- `experiment_run`

#### API Dependencies

- `GET /api/v1/dashboard/network`
- `GET /api/v1/dashboard/simulations/{id}`

#### Frontend Dependencies

- `NetworkCommandMap`
- `ScenarioWorkbench`
- `ImpactMetricStrip`
- `RecoveryInspector`

#### Evaluation Metrics

- dashboard task completion
- render latency
- metric traceability

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-011 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-011`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-012 — Data Provenance and Freshness Semantics

**Priority:** CRITICAL

**Primary Owner:** Shared

#### Objective

Menjamin seluruh data dan recommendation dapat ditelusuri ke source/version/evidence state.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- source metadata
- dataset version
- retrieval time
- validity time
- evidence type

#### Required Outputs

- provenance metadata
- freshness label
- confidence/quality indicator

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. LIVE hanya untuk live source.
2. SCHEDULED/OBSERVED/SIMULATED/ESTIMATED harus terlihat berbeda.
3. Missing source membuat record invalid untuk production intelligence.
4. Version/checksum wajib untuk research dataset.

#### Exception / Degraded Cases

- Source missing
- Timestamp missing
- Conflicting version

#### Data / Database Dependencies

- `dataset_source`
- `dataset_version`
- `ingestion_run`

#### API Dependencies

- `GET /api/v1/data-sources`
- `GET /api/v1/data-sources/{id}/versions`

#### Frontend Dependencies

- `SourceBadge`
- `FreshnessIndicator`
- `EvidenceDetails`

#### Evaluation Metrics

- provenance completeness
- stale-data detection

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-012 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-012`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-013 — Historical and Controlled Scenario Replay

**Priority:** HIGH

**Primary Owner:** Student A

#### Objective

Mengulang scenario terhadap snapshot/version tertentu untuk research reproducibility.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- dataset version
- scenario definition
- routing config
- experiment config

#### Required Outputs

- replay run
- metrics
- comparison artifact

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Same input/config harus menghasilkan comparable result.
2. Experiment config harus tersimpan.
3. Replay tidak boleh diam-diam memakai dataset terbaru.

#### Exception / Degraded Cases

- Dataset version missing
- Scenario incompatible
- Engine version mismatch

#### Data / Database Dependencies

- `experiment_run`
- `dataset_version`
- `simulation_scenario`

#### API Dependencies

- `POST /api/v1/experiments/replay`
- `GET /api/v1/experiments/{id}`

#### Frontend Dependencies

- `ExperimentReplayForm`
- `RunComparison`

#### Evaluation Metrics

- reproducibility
- run completeness

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-013 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-013`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

### FR-014 — Authentication and Role Separation

**Priority:** MEDIUM

**Primary Owner:** Student B

#### Objective

Menyediakan authentication secukupnya tanpa membebani core research.

#### User / System Value

Requirement ini harus memberi dampak yang dapat diamati terhadap keputusan pengguna, analisis jaringan, atau kualitas penelitian. Implementasi yang hanya menghasilkan halaman/response tanpa fungsi domain tidak dianggap memenuhi requirement.

#### Inputs

- credential/provider identity

#### Required Outputs

- session
- role
- authorized feature access

#### Main Processing Flow

1. Validasi request dan pre-condition.
2. Resolve dataset/network/scenario context.
3. Jalankan domain service yang menjadi source of truth.
4. Validasi result dan provenance.
5. Persist result jika requirement membutuhkan audit/replay.
6. Expose hasil melalui API contract dan UI semantics yang benar.

#### Core Business Rules

1. Role minimum PASSENGER, RESEARCHER_OPERATOR, ADMIN.
2. Scenario/admin mutation harus protected.
3. Passenger read flow tidak boleh dibuat terlalu berat.

#### Exception / Degraded Cases

- Invalid credential
- Expired session
- Forbidden action

#### Data / Database Dependencies

- `user_account`
- `role_assignment`

#### API Dependencies

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

#### Frontend Dependencies

- `LoginView`
- `RoleAwareNavigation`

#### Evaluation Metrics

- auth success
- unauthorized access prevention

#### Acceptance Criteria

- **Given** required input dan dependencies untuk FR-014 valid, **when** feature dijalankan, **then** output wajib mengikuti contract dan provenance.
- **Given** exception case terjadi, **when** system tidak dapat menghasilkan hasil yang valid, **then** system wajib mengembalikan explicit degraded/error state dan tidak mengarang data.
- **Given** evidence type bukan LIVE, **when** hasil ditampilkan, **then** UI/API tidak boleh mempresentasikannya sebagai live.

#### AI Agent Implementation Notes

- Setiap code change untuk requirement ini harus menyebut `FR-014`.
- Jangan membuat mock production result untuk membuat demo terlihat lengkap.
- Jika dependency Student A belum tersedia, Student B boleh memakai validated simulation/sample adapter yang secara eksplisit dilabeli sebagai fallback development/demo.

---

## 8. Cross-Feature Invariants

1. LLM tidak menjadi authoritative routing engine.
2. Simulation tidak boleh dipresentasikan sebagai observed fact.
3. Missing data tidak boleh diganti fakta fiktif.
4. Broken connectivity menghasilkan invalid journey.
5. Operator recovery output wajib memiliki validation status.
6. Semua recommendation harus traceable ke network/scenario evidence.
7. Semua experiment harus reproducible melalui dataset version + scenario config.
8. Student B application harus tetap bisa berjalan dengan simulated/local intelligence adapter saat Student A module belum terintegrasi.

## 9. System-Level Edge Cases

- Tidak ada internet: degraded state; jangan fabricate network status.
- Salah satu operator tidak memiliki usable data: tampilkan coverage limitation.
- Multiple simultaneous disruptions: process overlay atau explicit unsupported status.
- Destination unreachable: return `NO_FEASIBLE_JOURNEY`.
- GPS permission ditolak: manual/degraded tracking mode.
- LLM unavailable: deterministic explanation template.
- Scenario run gagal: base network tidak boleh berubah.

## 10. Definition of Done for Functional Requirements

Suatu FR hanya berstatus DONE jika:

- implementation tersedia;
- relevant tests PASS;
- API contract sesuai;
- database migration aman jika ada;
- UI loading/error/empty/degraded state tersedia jika ada UI;
- provenance tersedia;
- documentation diperbarui;
- tidak ada known critical blocker;
- demo evidence tersedia untuk requirement CRITICAL;

## 11. Traceability Convention

- Issue: `FR-006 Implement state-aware recovery scoring`
- Test: `TEST-FR006-RECOVERY-004`
- Experiment: `EXP-FR006-B0-VS-REPAIR-001`

## 12. Final End-to-End Acceptance Flow

```text
PLAN NORMAL JOURNEY
        ↓
CREATE/LOAD FLOOD SCENARIO
        ↓
APPLY SCENARIO OVERLAY
        ↓
ANALYZE NETWORK IMPACT
        ↓
REPAIR PASSENGER JOURNEY
        ↓
ANALYZE TRANSJAKARTA SERVICE SPLIT
        ↓
ESTIMATE TEMPORARY SERVICE/FLEET NEED
        ↓
EXPLAIN RESULT WITH GROUNDED COPILOT
```

Project core belum dianggap selesai apabila flow tersebut belum dapat didemokan end-to-end dengan data yang jelas statusnya.
