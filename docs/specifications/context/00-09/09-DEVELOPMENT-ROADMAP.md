 

# FILE 09 — DEVELOPMENT ROADMAP FINAL

> **LEGACY ROADMAP / SUPERSEDED EXECUTION ORDER.** This historical File 09 is preserved as originally numbered. Its phase overview and detailed phase headings are not a current authorization or a reliable mapping to the Product Owner's accepted Phase 4/5 execution. Do not silently renumber its historical milestones.

## Current execution state (Product Owner decision)

- Phase 4 = PASS; Phase 5 = PASS at accepted HEAD `5e4009a994c2753f45b8bc62778459f7cf0a7dbd`.
- Accepted Phase 5 includes State-Aware Recovery, middle-span repair, valid suffix rejoin, same-state FULL REPLAN, frozen metrics, and reproducible comparison evidence. Final quantitative evaluation is not complete.
- EXP-B1 Recovery Evaluation Pilot is the next recommended **research** milestone, not an authorized run or final benchmark result.
- PRODUCT-P1 Passenger MVP v0.1 is accepted PASS at `98a62772045c4ede3662a437756e936f277fee5f`. The [SCX-0 supervisor extension](../../../reconciliation/SCX-0-SUPERVISOR-SCOPE-EXTENSION.md) is approved for reconciliation only and not implemented. Its unnumbered RND-X1/EXT-X1–X5 sequence is a proposal, not execution authorization. Feature scope is frozen after the approved extension, subject only to correctness, security, deployment, research evaluation, or explicit later supervisor change.
- This document's overview and later detailed headings assign different meanings to the same phase numbers. Any future numbered phase/name or implementation order requires an explicit Product Owner decision. Until then, no numbered post-Phase-5 phase is assigned.

The note above changes current status interpretation only; the historical roadmap below remains intact.

Nama file:

```text
09-DEVELOPMENT-ROADMAP-FINAL.md
```

---

Sebelum masuk ke isi dokumen, saya ingin memastikan arah pembuatannya.

Dokumen ini bukan hanya timeline "minggu 1 buat apa, minggu 2 buat apa".

Untuk project seperti TRANSUM-IN NEXUS, roadmap harus menjadi:

> **Execution Blueprint yang menghubungkan Product Vision → Architecture → Implementation → Testing → Final Demo.**

Karena project ini memiliki banyak komponen:

- frontend;
- backend;
- database;
- GIS;
- transit data;
- mobility twin;
- flood simulation;
- AI copilot.

Risiko terbesar bukan coding, tetapi:

- membangun fitur terlalu cepat tanpa fondasi;
- AI Agent melompat ke fitur kompleks;
- database berubah berkali-kali;
- frontend dibuat sebelum backend siap;
- fitur AI dibuat sebelum data tersedia.

Maka roadmap dibuat berdasarkan **dependency**, bukan hanya urutan waktu.


Prinsip:

```text
Foundation

↓

Data

↓

Core Intelligence

↓

Product Experience

↓

Advanced Intelligence

↓

Evaluation

↓

Final Product
```

---

# TRANSUM-IN NEXUS

# DEVELOPMENT ROADMAP DOCUMENT

Version:

1.0.0


Status:

FROZEN EXECUTION PLAN


Audience:

- AI Coding Agent
- Student A
- Student B
- Capstone Supervisor


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan strategi pembangunan TRANSUM-IN NEXUS dari kondisi awal hingga final product.


Tujuan:


- menentukan urutan implementasi;
- menghindari scope creep;
- memastikan dependency terpenuhi;
- membagi pekerjaan antar mahasiswa;
- menjadi panduan AI Agent selama development.


---

# 2. DEVELOPMENT PHILOSOPHY


TRANSUM-IN NEXUS tidak dibangun dengan pendekatan:


```text
Feature First Development
```


Tetapi:


```text
Foundation First Development
```


---

Artinya:


Tidak boleh membangun:


AI Copilot


sebelum:


- database siap;
- data tersedia;
- intelligence engine berjalan.


---

Tidak boleh membangun:


flood recovery UI


sebelum:


- flood model;
- disruption logic;
- simulation tersedia.


---

# 3. DEVELOPMENT PHASE OVERVIEW


Total roadmap:


```text
PHASE 0

Project Foundation


↓

PHASE 1

System Foundation


↓

PHASE 2

Data & Transit Intelligence


↓

PHASE 3

Mobility Twin


↓

PHASE 4

Flood Intelligence


↓

PHASE 5

Journey Intelligence


↓

PHASE 6

Recovery System


↓

PHASE 7

AI Copilot


↓

PHASE 8

UI/UX Enhancement


↓

PHASE 9

Testing & Evaluation


↓

PHASE 10

Final Product Delivery

```


---

# PHASE 0

# PROJECT FOUNDATION


## Objective


Mempersiapkan environment dan struktur project.


---

## Task


Repository:


- setup monorepo;
- git workflow;
- documentation.


Environment:


- Node.js;
- PostgreSQL;
- PostGIS;
- Docker.


---

## Deliverable


```text
Repository ready

Development environment ready

Documentation loaded

```


---

## Owner


Student B


Support:

Student A


---

# PHASE 1

# SYSTEM FOUNDATION


## Objective


Membangun fondasi software.


---

## Backend


Implement:


- NestJS structure;
- module architecture;
- configuration;
- authentication foundation.


---

## Frontend


Implement:


- Next.js;
- routing;
- design system;
- base components.


---

## Database


Implement:


- PostgreSQL;
- PostGIS;
- migration system.


---

## Deliverable


System dapat berjalan:


```text
Frontend

↓

Backend

↓

Database

```


---

## Owner


Student B


---

# PHASE 2

# TRANSIT DATA FOUNDATION


## Objective


Membangun sumber data transportasi.


---

## Student A Task


Implement:


- dataset collector;
- GTFS parser;
- validator;
- normalization.


---

Input:


```text
GTFS

CSV

GeoJSON

```


---

Output:


Database:


```text
Operator

Route

Station

Stop

Trip

Schedule

```


---

## Student B Task


Membuat:


- transit API;
- frontend integration.


---

## Deliverable


System mengetahui:


- transportasi apa tersedia;
- lokasi;
- hubungan antar moda.


---

# PHASE 3

# MOBILITY TWIN DEVELOPMENT


## Objective


Membangun representasi digital jaringan transportasi.


---

## Student A


Develop:


- mobility entity;
- state management;
- network relationship.


---

## Student B


Develop:


- visualization;
- map layer.


---

## Deliverable


System dapat menampilkan:


```text
Station

Route

Network State

```


---

# PHASE 4

# FLOOD DISRUPTION INTELLIGENCE


## Objective


Menambahkan kemampuan memahami gangguan banjir.


---

## Student A


Develop:


Flood Engine:


- flood event;
- spatial intersection;
- affected entity.


---

Example:


Input:


```text
Flood:

Manggarai

Radius:

500 meter

```


Output:


```text
Affected:

Station Manggarai

Route TJ001

```


---

## Student B


Develop:


- disruption UI;
- visualization.


---

## Deliverable


System memahami:


"Bagian jaringan mana yang terganggu."


---

# PHASE 5

# SIMULATION ENGINE


## Objective


Membuat simulasi kondisi.


---

Example:


Scenario:


```text
Jika Manggarai banjir 3 jam
```


System:


Membandingkan:


Before:


Normal network


After:


Disrupted network


---

## Student A


Develop:


- scenario model;
- simulation calculation.


---

## Student B


Develop:


- simulation interface;
- result visualization.


---

## Deliverable


System dapat melakukan:


"What if analysis."


---

# PHASE 6

# MULTIMODAL JOURNEY INTELLIGENCE


## Objective


Membuat fitur utama pengguna.


---

## Student B Primary Owner


Develop:


Journey Engine:


- route generation;
- ranking;
- preference.


---

Input:


```json
Origin

Destination

Preference

```


---

Output:


```text
Option 1

Bus + Train


Option 2

MRT + Bus

```


---

## Student A Support


Memberikan:


- transit graph;
- network information.


---

# PHASE 7

# RECOVERY ENGINE


## Objective


Memberikan alternatif ketika terjadi gangguan.


---

Example:


Original:


```text
KRL

↓

TransJakarta

```


Problem:


```text
Flood disruption

```


Recovery:


```text
MRT

↓

Bus

```


---

## Student B Owner


Develop:


- recovery logic;
- user recommendation.


---

## Student A Support


Provide:


- affected network.


---

# PHASE 8

# GENERATIVE AI COPILOT


## Objective


Memberikan komunikasi natural language.


---

Important:


AI bukan decision maker.


---

Flow:


```text
System Result

↓

AI Explanation

↓

User

```


---

Student B:


Owner.


---

Deliverable:


User dapat bertanya:


"Kenapa rute saya berubah?"


---

# PHASE 9

# UI/UX POLISH


## Objective


Mengubah prototype menjadi product.


---

Improve:


- animation;
- interaction;
- responsiveness;
- accessibility.


---

Focus:


Map experience.


Journey experience.


Disruption experience.


---

Owner:


Student B.


---

# PHASE 10

# TESTING & EVALUATION


## Objective


Membuktikan kualitas sistem.


---

# Technical Evaluation


Test:


- API performance;
- database query;
- reliability.


---

# Intelligence Evaluation


Measure:


## Journey


- route correctness;
- alternative quality.


---

## Flood


Measure:


- affected detection;
- simulation consistency.


---

## AI


Measure:


- factuality;
- response correctness.


---

# 11. DEVELOPMENT PRIORITY MATRIX


| Feature | Priority | Reason |
|-|-|-|
| Database Foundation | Critical | Semua fitur bergantung |
| Transit Data | Critical | Core intelligence |
| Mobility Twin | High | Research value |
| Flood Engine | High | Main novelty |
| Journey Planner | Critical | User value |
| Recovery Engine | High | Differentiator |
| AI Copilot | Medium | Explanation layer |
| Advanced UI | Medium | Product quality |


---

# 12. MVP DEFINITION


Jika waktu terbatas:


MVP wajib:


```text
1.

Transit Data


2.

GIS Map


3.

Multimodal Journey


4.

Mobility Twin Basic


5.

Flood Simulation


6.

Recovery Recommendation


7.

AI Explanation

```


---

# 13. SCOPE CONTROL RULE


AI Agent harus menjaga:


Jika fitur tidak meningkatkan:


- mobility intelligence;
- user benefit;
- research contribution;


maka fitur tidak dibuat.


---

Tidak membuat:


❌ social network

❌ unnecessary gamification

❌ unrelated AI feature

❌ decorative feature


---

# 14. DEMO SCENARIO FINAL


Demo utama:


## Scenario


User:


"Dari Mercu Buana ke Kota Tua."


---

System:


Menampilkan:


Normal journey:


```text
Mikrotrans

↓

KRL

↓

TransJakarta

```


---

Kemudian:


Flood event:


```text
Manggarai affected

```


---

System:


Mengubah kondisi:


```text
Route disrupted

```


---

Recovery:


```text
Alternative route generated

```


---

AI:


Menjelaskan:


"Rute berubah karena jalur sebelumnya terdampak banjir."


---

# 15. FINAL DELIVERY CHECKLIST


Sebelum sidang:


## Product


✅ Web application berjalan

✅ Responsive UI

✅ Real dataset

✅ End-to-end flow


---

## Technical


✅ Architecture document

✅ Database schema

✅ API documentation

✅ Testing report


---

## Research


✅ Problem definition

✅ Methodology

✅ Evaluation

✅ Contribution


---

# 16. AI AGENT FINAL INSTRUCTION


AI Agent harus mengikuti:


```text
DO NOT RUSH FEATURES

BUILD FOUNDATION FIRST

KEEP ARCHITECTURE CLEAN

RESPECT OWNERSHIP

USE REAL DATA

DOCUMENT EVERYTHING

```


---

# FINAL STATEMENT


TRANSUM-IN NEXUS harus dikembangkan sebagai:


# A Real Intelligent Transportation Product


dengan proses:


```text
Data

↓

Intelligence

↓

Simulation

↓

Decision

↓

Human Impact

```


Tujuan akhirnya bukan hanya membuat aplikasi yang berjalan.


Tujuannya adalah membangun sistem yang mampu membantu manusia mengambil keputusan mobilitas dalam kondisi kota yang dinamis.


END OF DOCUMENT
```

---
