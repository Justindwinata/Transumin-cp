 

# FILE 05 — MODULE OWNERSHIP & DEVELOPMENT RESPONSIBILITY FINAL

Nama file:

```text
05-MODULE-OWNERSHIP-FINAL.md
```

Saya akan membuat dokumen ini dengan pendekatan **engineering team structure**, bukan sekadar pembagian tugas mahasiswa.

Alasan:

Pada project capstone berkelompok, masalah yang sering terjadi adalah:

- pembagian tugas tidak jelas;
- salah satu mahasiswa hanya membuat fitur kecil;
- kontribusi penelitian sulit dibuktikan saat sidang;
- AI Agent bingung siapa yang bertanggung jawab terhadap modul tertentu;
- terjadi konflik ketika dua orang mengubah bagian sistem yang sama.

Maka dokumen ini harus menjadi:

> **Ownership Contract antara Student A, Student B, dan AI Agent.**

Dokumen ini harus menjawab:

1. Siapa pemilik masing-masing modul?
2. Apa kontribusi teknis masing-masing?
3. Apa kontribusi penelitian masing-masing?
4. Apa batasan pekerjaan?
5. Bagaimana integrasi dilakukan?
6. Bagaimana masing-masing mahasiswa memiliki nilai profesional setelah project selesai?

---

# TRANSUM-IN NEXUS

# MODULE OWNERSHIP & DEVELOPMENT RESPONSIBILITY DOCUMENT

Version:

1.0.0


Status:

FROZEN TEAM STRUCTURE


Audience:

- AI Coding Agent
- Student A Developer
- Student B Developer
- Capstone Supervisor


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan pembagian ownership, tanggung jawab teknis, dan batasan implementasi dalam pembangunan TRANSUM-IN NEXUS.


Tujuan utama:

- memastikan setiap mahasiswa memiliki kontribusi yang jelas;
- mencegah overlap pekerjaan;
- memastikan setiap modul memiliki owner;
- membantu AI Agent memahami siapa bertanggung jawab terhadap setiap bagian sistem.


Dokumen ini bersifat wajib.


AI Agent harus menggunakan dokumen ini sebagai referensi ketika:

- membuat module;
- membuat branch;
- membuat API;
- melakukan refactoring;
- menentukan prioritas implementasi.


---

# 2. PROJECT TEAM STRUCTURE


TRANSUM-IN NEXUS dikembangkan oleh dua mahasiswa:


```text
                    TRANSUM-IN NEXUS


                           |

                           |

                PRODUCT OWNERSHIP


                           |

        +------------------+------------------+

        |                                     |

   STUDENT B                           STUDENT A

 Product Owner                    Mobility Intelligence

 Lead Engineer                    Research Engineer

```

---

# 3. OWNERSHIP PRINCIPLE


## 3.1 Product Ownership


TRANSUM-IN NEXUS memiliki satu product owner:


# Student B — Justin Dwinata


Role:


- Founder Ide Produk
- Product Owner
- Lead Software Engineer
- System Integrator


---

Alasan:


Student B bertanggung jawab menjaga:

- arah product;
- integrasi keseluruhan;
- keputusan architecture;
- user experience;
- final delivery.


---

# 3.2 Research Engineering Ownership


Student A memiliki ownership terhadap:


# Mobility Intelligence Layer


Role:


- Data Engineer;
- GIS Engineer;
- Mobility Intelligence Researcher.


---

Fokus:


Membangun "otak analisis jaringan transportasi".


---

# 4. STUDENT B OWNERSHIP


# Student B — Justin Dwinata


## Role Definition


Student B bertanggung jawab terhadap pembangunan product end-to-end.


Student B memastikan:


- aplikasi dapat digunakan;
- seluruh modul terintegrasi;
- pengalaman pengguna berkualitas;
- product memiliki nilai komersial.


---

# STUDENT B RESPONSIBILITY MAP


```text
Student B


├── Product Architecture

├── Frontend Application

├── Backend Core

├── Journey Intelligence

├── Recovery Engine

├── User Experience

├── AI Copilot

├── Integration

└── Deployment

```


---

# MODULE B1

# Product Architecture


## Responsibility


Menentukan:


- system direction;
- architecture decision;
- technology selection;
- integration strategy.


---

Deliverable:


- architecture document;
- technical decision;
- implementation plan.


---

# MODULE B2

# Frontend Application


## Ownership


FULL OWNER


---

Technology:


- Next.js
- React
- TypeScript
- Tailwind CSS
- MapLibre


---

Responsibility:


Membangun:


## Passenger Interface


Meliputi:


### Landing Experience


- product introduction;
- mobility concept;
- user onboarding.


---

### Journey Planner UI


User dapat:


- memilih lokasi awal;
- memilih tujuan;
- memilih preferensi perjalanan.


---

### Interactive Map


Menampilkan:


- route;
- station;
- vehicle path;
- disruption area.


---

### Active Journey Interface


Menampilkan:


- langkah perjalanan;
- progress;
- perubahan kondisi.


---

### Flood Awareness Interface


Menampilkan:


- area terdampak;
- alternatif perjalanan.


---

Deliverable:


- responsive web application;
- production-quality UI.


---

# MODULE B3

# Journey Intelligence Engine


## Purpose


Mengubah data jaringan menjadi pengalaman perjalanan.


---

Responsibility:


Mengembangkan:


- route request;
- journey ranking;
- preference system.


---

Input:


Dari:


Student A:


- transit graph;
- network data.


---

Output:


Untuk user:


- route option;
- estimated duration;
- transfer information.


---

# MODULE B4

# Recovery Engine


## Purpose


Menangani perjalanan yang mengalami gangguan.


---

Problem:


Jika rute awal tidak dapat digunakan.


---

System harus menjawab:


"Bagaimana pengguna tetap sampai tujuan?"


---

Input:


- current journey;
- disruption state.


---

Process:


```text
Current Journey

↓

Check Network State

↓

Detect Problem

↓

Generate Alternative

↓

Return Recovery Plan

```


---

Output:


```json
{
"alternative_route":"",
"additional_time":"",
"reason":""
}

```


---

# MODULE B5

# Generative AI Mobility Copilot


## Purpose


Memberikan penjelasan natural language.


---

Contoh:


User:


"Kenapa rute saya berubah?"


AI:


"Rute berubah karena area Manggarai terdampak banjir berdasarkan kondisi jaringan."


---

AI Responsibility:


- explanation;
- conversation;
- summarization.


---

AI Limitation:


AI tidak boleh:


- membuat route sendiri;
- memberikan informasi tanpa sumber;
- menggantikan algorithm.


---

# MODULE B6

# System Integration


Student B bertanggung jawab menggabungkan:


```text
Student A Intelligence Layer

+

Student B Product Layer

=

TRANSUM-IN NEXUS

```


---

# MODULE B7

# Deployment


Responsibility:


- application deployment;
- environment;
- production preparation.


---

# 5. STUDENT A OWNERSHIP


# Student A


## Role Definition


Student A bertanggung jawab membangun:


# Mobility Intelligence Layer


---

Tujuan:


Membuat fondasi data dan analisis yang memungkinkan TRANSUM-IN NEXUS memahami kondisi jaringan transportasi.


---

# STUDENT A RESPONSIBILITY MAP


```text
Student A


├── Transit Data Pipeline

├── GIS Spatial Model

├── Mobility Twin

├── Flood Intelligence

├── Simulation Engine

└── Intelligence API

```


---

# MODULE A1

# Transit Data Pipeline


## Responsibility


Mengumpulkan dan mengolah dataset transportasi.


---

Input:


- GTFS;
- schedule;
- route;
- station data.


---

Process:


```text
Raw Dataset

↓

Parser

↓

Validation

↓

Normalization

↓

Database

```


---

Deliverable:


- ingestion pipeline;
- data validation;
- normalized transit schema.


---

# MODULE A2

# GIS Spatial Intelligence


## Responsibility


Mengelola aspek geografis.


---

Meliputi:


- coordinate;
- geometry;
- spatial query;
- distance calculation.


---

Contoh:


Menentukan:


"Apakah halte berada dalam area banjir?"


---

Deliverable:


- PostGIS implementation;
- spatial service.


---

# MODULE A3

# Hybrid Mobility Twin


## CORE RESEARCH MODULE


Purpose:


Membuat representasi digital jaringan transportasi.


---

Setiap entity memiliki:


```text
ID

Type

Location

Relationship

State

Timestamp

```


---

Contoh:


Normal:


```
Station Manggarai

State:
NORMAL
```


Gangguan:


```
Station Manggarai

State:
DISRUPTED
```


---

Deliverable:


- mobility entity model;
- state management;
- history tracking.


---

# MODULE A4

# Flood Disruption Intelligence


## Purpose


Mengubah kejadian banjir menjadi informasi dampak transportasi.


---

Input:


- flood location;
- radius;
- severity.


---

Process:


```text
Flood Event

↓

Spatial Intersection

↓

Affected Network

↓

Impact Analysis

```


---

Output:


- affected route;
- affected station;
- disruption level.


---

# MODULE A5

# Simulation Engine


## Purpose


Melakukan simulasi perubahan jaringan.


---

Contoh:


Scenario:


"Jika Manggarai banjir selama 3 jam"


---

System:


Membandingkan:


Before:


```
Normal Network
```


After:


```
Disrupted Network
```


---

Output:


- connectivity loss;
- affected route;
- impact summary.


---

# 6. MODULE OWNERSHIP MATRIX


| Module | Owner | Support |
|-|-|-|
| Product Vision | Student B | Student A |
| Frontend | Student B | - |
| Backend Core | Student B | Student A |
| Transit Data | Student A | Student B |
| GIS | Student A | - |
| Mobility Twin | Student A | Student B |
| Flood Engine | Student A | Student B |
| Simulation | Student A | Student B |
| Journey Engine | Student B | Student A |
| Recovery Engine | Student B | Student A |
| AI Copilot | Student B | Student A |
| Deployment | Student B | Student A |


---

# 7. COLLABORATION RULE


## Rule 1

Owner memiliki keputusan teknis utama pada modulnya.


---

## Rule 2

Perubahan lintas modul harus melalui diskusi.


Contoh:


Student A mengubah schema transit.


Maka:


Student B harus mengetahui impact terhadap journey engine.


---

## Rule 3

Tidak boleh mengambil alih ownership mahasiswa lain.


---

# 8. BRANCH OWNERSHIP


Branch:


```text
main

develop

```


Feature:


Student A:


```text
feature/student-a/mobility-twin

feature/student-a/flood-engine

```


Student B:


```text
feature/student-b/frontend

feature/student-b/journey-engine

```


---

# 9. CAPSTONE PRESENTATION VALUE


Dokumen ini memastikan masing-masing mahasiswa memiliki kontribusi akademik.


---

# Student B Contribution


Research/Engineering Focus:


"Development of an intelligent multimodal mobility platform with adaptive journey recovery and generative AI assistance."


Demonstrated Skills:


- Full-stack engineering;
- system architecture;
- AI integration;
- product development.


---

# Student A Contribution


Research/Engineering Focus:


"Development of a GIS-based mobility twin and flood-aware transportation disruption intelligence system."


Demonstrated Skills:


- data engineering;
- GIS;
- digital twin;
- simulation.


---

# 10. AI AGENT INSTRUCTION


AI Agent harus:


Sebelum implementasi:


1. Identifikasi owner module.
2. Jangan membuat perubahan pada module owner lain.
3. Gunakan API contract.
4. Dokumentasikan perubahan.


---

AI Agent dilarang:


❌ menggabungkan semua logic menjadi satu module


❌ membuat Student A hanya sebagai data collector


❌ membuat Student B hanya sebagai frontend developer


❌ menghilangkan research contribution


---

# 11. FINAL TEAM STRUCTURE STATEMENT


TRANSUM-IN NEXUS dibangun dengan dua kontribusi utama:


## Student B

Membangun produk dan pengalaman pengguna.


## Student A

Membangun intelligence foundation yang membuat produk menjadi sistem cerdas.


Keduanya saling melengkapi:


```text
Mobility Intelligence

+

Product Intelligence

=

TRANSUM-IN NEXUS

```


END OF DOCUMENT
```

---

 