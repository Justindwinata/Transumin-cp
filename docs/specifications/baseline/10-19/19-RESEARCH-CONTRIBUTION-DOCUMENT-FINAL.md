# TRANSUM-IN NEXUS
# 19 — RESEARCH CONTRIBUTION & THESIS POSITIONING — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN RESEARCH POSITIONING BASELINE

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Academic Theme

**TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY**

## 2. Research Position

TRANSUM-IN bukan penelitian 'membuat aplikasi transportasi'. Web artifact digunakan untuk menguji metode decision-support pada multimodal network yang mengalami disruption.

## 3. Real-World Problem

Flood disruption can break transit segments, transfers, and passenger journeys; bus services may need temporary partitioning.

Supervisor feedback adds operator-side need: route changes, turnback/cut point, downstream service, temporary bridge, and fleet estimate.

## 4. Research Gap — Bounded Claim

Existing planners, flood maps, digital twins, AI assistants already exist individually. Novelty is not claimed as 'first'.

Investigated integration:

1. heterogeneous multimodal mobility representation
2. explicit scheduled/observed/simulated semantics
3. flood impact propagation
4. state-aware commitment-preserving journey repair
5. TransJakarta split-service recovery analysis
6. grounded tool-using explanation

## 5. Umbrella Research Question

> Bagaimana adaptive multimodal urban mobility decision-support framework yang menggabungkan network state, flood disruption analysis, dan journey recovery dapat membantu mempertahankan feasibility perjalanan dan layanan transportasi saat gangguan?

## 6. Student A Focus

Hybrid Mobility Twin & Flood-Aware Network Impact Simulation.

### Candidate RQ-A

> Bagaimana heterogeneous transit, spatial, dan disruption data dapat dimodelkan untuk mengidentifikasi dampak banjir terhadap connectivity jaringan transportasi multimoda?

### Student A Contributions

- canonical multi-source transit integration
- GIS/spatial model
- hybrid mobility state model
- flood direct/propagated impact
- scenario/replay engine

### Student A Evaluation

- data coverage/validity
- impact precision/recall
- connectivity/OD change
- runtime/reproducibility

## 7. Student B Focus

State-Aware Multimodal Journey Recovery & Product Intelligence.

### Candidate RQ-B

> Apakah state-aware journey repair dapat mempertahankan lebih banyak bagian perjalanan dan menurunkan perubahan perjalanan dibanding full replanning setelah gangguan multimodal?

### Student B Contributions

- journey orchestration
- commitment-preserving repair
- decision-ready comparison
- active journey experience
- operator recovery integration
- grounded agentic explanation
- end-to-end product architecture

### Student B Evaluation

- recovery success
- preserved-leg ratio
- additional time/transfers
- plan-change count
- latency
- AI factuality
- usability

## 8. Operator Recovery Subproblem

TransJakarta flood split-service analysis is applied decision support, not autonomous dispatch.

System estimates:

- affected route portion
- upstream/downstream service
- unresolved gap
- fleet requirement under assumptions
- validation status

## 9. Baselines

### Student A

- normal/static network
- disrupted scenario network
- simple direct impact vs propagated analysis where applicable

### Student B

- B0 full replanning
- proposed state-aware repair

### AI

- deterministic template
- grounded LLM/tool explanation

## 10. Candidate Hypotheses

### H-B1

State-aware repair yields higher preserved-leg ratio than full replanning.

### H-B2

Repair reduces plan-change count without materially harming feasibility.

### H-A1

Spatial/network impact model consistently identifies affected elements on controlled benchmark scenarios.

Exact tests frozen before final evaluation.

## 11. Research Artifact

- versioned multimodal dataset/snapshot
- mobility graph/twin
- scenarios
- impact engine
- journey/recovery engine
- operator recovery analysis
- web/PWA
- evaluation scripts/results
- docs

## 12. Dataset Feasibility

Core research does not depend on citywide photo dataset.

Data categories:

- transit schedule/topology
- OSM/spatial network
- observed/historical environmental events where available
- controlled simulated flood scenarios
- curated validation cases

## 13. Why Not Too Simple

- multi-source integration
- geospatial modeling
- graph/network state
- scenario simulation
- optimization/recovery
- operator service analysis
- grounded GenAI
- comparative experiments

## 14. Why Realistic

Explicitly out of scope:

- full realtime city twin
- 3D city
- autonomous dispatch
- citywide crowd simulation
- proprietary telemetry requirement
- image collection seluruh Jakarta

## 15. Product Value

Passenger: less manual cross-app decision, disruption-aware alternative, understandable recovery.

Operator/research: what-if analysis, route fragmentation visibility, conceptual temporary service planning, reproducible experiments.

## 16. Novelty Guardrails

Never claim:

- first in world/Indonesia without evidence
- AI predicts floods if not implemented
- realtime when simulated/scheduled
- production optimization without operator validation

Preferred bounded claim:

> This study investigates a Jakarta/Jabodetabek-specific adaptive multimodal mobility decision-support framework combining explicit network-state semantics, flood disruption analysis, passenger journey repair, and operator-oriented service recovery analysis.

## 17. Thesis Evidence Required

- problem evidence
- literature/prior art
- data feasibility/source table
- method/system architecture
- algorithm definition
- baseline definition
- experiment protocol
- quantitative results
- error analysis
- limitations
- reproducibility info

## 18. Research Success Condition

Success requires measured evidence, not screenshots, that the framework models disruption and produces traceable recovery outputs within defined scope.

## 19. One-Sentence Defense Position

> TRANSUM-IN studies how a multimodal mobility system can move from static route recommendation to evidence-grounded disruption analysis and recovery for both passengers and temporary transit service planning.

## 20. Research-to-Product Traceability

| Research Concern | Product Capability | Evidence |
|---|---|---|
| Multimodal fragmentation | Journey Planner | route validity/coverage |
| Flood impact | Flood/Network Impact | precision/recall, OD change |
| Passenger adaptation | Journey Recovery | preserved-leg, time, transfers |
| Service continuity | Operator Recovery | retained coverage, fleet estimate |
| Explainability | Copilot | factuality/coverage |

## 21. Six-Point Foundation Audit

### 1. Realistic to build
Uses established web/GIS/routing/database components; explicitly excludes full realtime city twin and autonomous dispatch.

### 2. Sufficient depth
Combines data engineering, geospatial modeling, graph state, simulation, recovery algorithm, grounded GenAI, and evaluation.

### 3. High value
Targets disruption-resilient urban mobility decisions for passengers and service-planning analysis.

### 4. Tangible problem solving
Addresses multimodal confusion, flood-induced broken journeys, route fragmentation, and explanation.

### 5. Research update/innovation
Bounded contribution is integration of explicit network-state semantics + flood disruption + commitment-preserving recovery + operator-oriented split-service analysis.

### 6. Dataset feasibility
Core does not depend on unavailable citywide imagery; can use transit/spatial data and reproducible scenarios with clear coverage claims.

## 22. Claim Discipline Matrix

| Claim Type | Allowed Wording | Avoid |
|---|---|---|
| Realtime | live only if source live | 'realtime' for simulation |
| Novelty | investigates/proposes framework | 'first in Indonesia/world' |
| Operator | decision-support estimate | 'optimal real dispatch' |
| Flood | scenario/observed impact | 'AI flood prediction' if absent |
| AI | grounded explanation/tool use | 'AI decides route' |

## 23. Literature Review Themes Needed

Final literature map should cover:
- multimodal transit routing
- disruption-aware routing
- transport network resilience
- flood impact on urban mobility
- digital/mobility twin
- journey replanning/repair
- bus short-turn/split-service recovery
- explainable/grounded GenAI for decision support

Literature must be used to define baselines and gaps, not merely describe technology.

## 24. Methodology Skeleton

1. Define study scope and datasets.
2. Build canonical multimodal network.
3. Build base mobility state/snapshot.
4. Define flood scenario representation.
5. Compute network impacts.
6. Generate passenger baseline/proposed recovery.
7. Generate operator recovery analysis.
8. Produce grounded explanation.
9. Evaluate quantitative and usability/factuality metrics.

## 25. Threats to Validity

### Internal validity
Scenario assumptions may drive result; freeze and disclose assumptions.

### External validity
Study-area/network coverage may not generalize to all Jakarta.

### Construct validity
Preserved-leg ratio is not identical to user satisfaction; use multiple metrics.

### Data validity
Schedule/topology freshness differs by operator.

### AI validity
LLM evaluation depends on prompt/model/version; record provider/model/config.

## 26. Expected Thesis Chapters Mapping

- Chapter 1: problem, objectives, scope
- Chapter 2: prior work/theory
- Chapter 3: data, method, architecture, algorithms
- Chapter 4: implementation and experiments
- Chapter 5: results, limitations, conclusion

## 27. Final Research Freeze Checklist

- [ ] title/theme approved
- [ ] Student A/B RQs distinct
- [ ] study scope frozen
- [ ] data sources validated
- [ ] baselines frozen
- [ ] metrics frozen
- [ ] final test cases frozen
- [ ] novelty wording bounded
- [ ] demo claims match evidence
