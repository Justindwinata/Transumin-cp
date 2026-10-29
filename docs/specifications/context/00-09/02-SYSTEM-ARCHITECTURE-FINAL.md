 
# FILE 02 — SYSTEM ARCHITECTURE FINAL

Nama file:

```text
02-SYSTEM-ARCHITECTURE-FINAL.md
```

---

```md
# TRANSUM-IN NEXUS

# SYSTEM ARCHITECTURE DOCUMENT

Version:
1.0.0


Status:
FROZEN ARCHITECTURE FOUNDATION


Audience:
AI Coding Agent,
Software Engineer,
Research Engineer,
Capstone Development Team



---

# 1. DOCUMENT PURPOSE


Dokumen ini menjelaskan arsitektur teknis final TRANSUM-IN NEXUS.


Dokumen ini menjadi panduan utama untuk:

- pembangunan frontend;
- pembangunan backend;
- perancangan database;
- integrasi GIS;
- integrasi mobility intelligence;
- integrasi simulation engine;
- integrasi Generative AI.


AI Agent WAJIB memahami architecture ini sebelum melakukan implementasi.


AI Agent TIDAK BOLEH:

- mengganti struktur utama;
- menggabungkan modul yang memiliki tanggung jawab berbeda;
- membuat implementasi yang bertentangan dengan architecture.



---

# 2. ARCHITECTURE VISION


TRANSUM-IN NEXUS dibangun menggunakan prinsip:


# DATA → INTELLIGENCE → DECISION → ACTION



Artinya:


## DATA

Sistem menerima:

- data transportasi;
- data geografis;
- data gangguan;
- data pengguna.



↓

## INTELLIGENCE

Sistem melakukan:

- network modeling;
- mobility twin;
- disruption analysis;
- simulation.



↓

## DECISION

Sistem menghasilkan:

- pilihan perjalanan;
- recovery route;
- rekomendasi.



↓

## ACTION

Pengguna:

- memilih perjalanan;
- mengikuti arahan;
- menerima adaptasi.



---

# 3. HIGH LEVEL SYSTEM OVERVIEW



                    USER


                      |

                      |

              WEB APPLICATION


                      |

                      |

              APPLICATION API


                      |

        +-------------+-------------+

        |             |             |

   Journey      Intelligence     AI Layer

   Service      Service          Copilot


        |             |

        |             |

        |       Mobility Twin

        |             |

        |       Simulation

        |

   Recovery Engine


                      |

                      |

              DATA PLATFORM


                      |

        +-------------+-------------+

        |             |             |

 PostgreSQL      PostGIS       Dataset Storage



---

# 4. ARCHITECTURE PRINCIPLE


## 4.1 Modular Domain Architecture


Setiap bagian sistem memiliki domain sendiri.


Contoh:


Journey Module:

Bertanggung jawab terhadap perjalanan user.


Mobility Twin:

Bertanggung jawab terhadap kondisi jaringan.


AI Copilot:

Bertanggung jawab terhadap komunikasi manusia.



AI tidak boleh mengambil tanggung jawab domain lain.



---

## 4.2 Separation of Intelligence and Presentation


Logic penting tidak boleh berada di frontend.


Contoh:


SALAH:


Frontend menentukan:


"Rute ini terkena banjir."


BENAR:


Backend intelligence:


"Route TJ001 terkena disruption."



Frontend hanya menampilkan.



---

## 4.3 Data Provenance First


Semua informasi harus memiliki:


- sumber;
- waktu;
- versi;
- confidence.



Contoh:


```json

{
 "source":"TransJakarta GTFS",
 "version":"2026",
 "confidence":"HIGH"
}

```



---

# 5. FINAL TECHNOLOGY STACK


# 5.1 Frontend Layer


Framework:


## Next.js


Language:


## TypeScript



Purpose:


Membangun passenger experience.



---

Technology:


## React


Untuk:


- component system;
- interactive UI.



---

## Tailwind CSS


Untuk:


- design consistency;
- responsive layout.



---

## Framer Motion


Untuk:


- transition;
- interaction;
- immersive experience.



---

## MapLibre GL


Untuk:


- interactive map;
- route visualization;
- disruption visualization.



---

# 5.2 Backend Layer


Framework:


## NestJS



Language:


## TypeScript



Reason:


- modular;
- scalable;
- enterprise friendly.



---

Backend bertanggung jawab:


- API;
- business logic;
- authentication;
- integration.



---

# 5.3 Database Layer


Database utama:


## PostgreSQL



Spatial extension:


## PostGIS



Digunakan untuk:


- koordinat;
- spatial query;
- distance calculation;
- flood intersection.



---

# 5.4 AI Layer


Architecture:


## Agentic AI Layer



AI digunakan sebagai:


- explanation engine;
- conversational interface;
- assistant.



AI TIDAK digunakan sebagai:


- routing engine utama;
- sumber fakta;
- pengganti simulation.



---

# 5.5 Infrastructure Layer


Container:


## Docker



Purpose:


- reproducible environment;
- deployment consistency.



---

# 6. SYSTEM COMPONENT BREAKDOWN



TRANSUM-IN NEXUS memiliki 8 domain utama:



---

# MODULE 1

# Authentication Module



Purpose:


Mengelola identitas pengguna.



Responsibilities:


- register;
- login;
- session;
- authorization.



Owner:

Student B



---

# MODULE 2

# Transit Intelligence Module



Purpose:


Mengelola data transportasi multimoda.



Input:


- GTFS;
- operator data;
- route data.



Output:


- route;
- station;
- stop;
- schedule.



Owner:

Student A



---

# MODULE 3

# Journey Planning Module



Purpose:


Menghasilkan perjalanan multimoda.



Input:


Origin:

Destination:

Preference:



Process:


Location

↓

Transit Graph

↓

Route Generation

↓

Ranking

↓

Journey Result



Owner:

Student B



---

# MODULE 4

# GIS Spatial Intelligence Module



Purpose:


Mengelola hubungan geografis.



Responsibilities:


- coordinate;
- distance;
- spatial relation;
- affected area.



Owner:

Student A



---

# MODULE 5

# Hybrid Mobility Twin Module



Purpose:


Membuat representasi digital jaringan transportasi.



Setiap entity mempunyai:


```json

{
"id":"",
"type":"",
"location":"",
"state":"",
"timestamp":""

}

```



Example:


Normal:


Station Manggarai


State:

NORMAL



Disrupted:


Station Manggarai


State:

DISRUPTED



Owner:

Student A



---

# MODULE 6

# Flood Disruption Intelligence Module



Purpose:


Menganalisis dampak banjir.



Input:


- lokasi;
- radius;
- severity.



Process:


Flood Event

↓

Spatial Intersection

↓

Affected Entity

↓

Network Impact



Output:


- affected routes;
- affected stations;
- disruption level.



Owner:

Student A



---

# MODULE 7

# Recovery Intelligence Module



Purpose:


Memberikan alternatif ketika perjalanan terganggu.



Input:


- current journey;
- disruption state.



Output:


- alternative journey;
- additional duration;
- explanation.



Owner:

Student B



---

# MODULE 8

# Generative AI Copilot Module



Purpose:


Menjelaskan keputusan sistem menggunakan bahasa manusia.



Flow:


User Question


↓

AI Agent


↓

Call System Data


↓

Generate Explanation



AI tidak boleh memberikan informasi tanpa sumber.



Owner:

Student B



---

# 7. DATA FLOW ARCHITECTURE



## Normal Journey Flow



User

↓

Frontend

↓

Journey API

↓

Transit Intelligence

↓

Route Engine

↓

Journey Result

↓

Map Visualization



---

## Flood Scenario Flow



Flood Event


↓

Flood Intelligence


↓

Mobility Twin Update


↓

Simulation Engine


↓

Recovery Engine


↓

User Notification



---

# 8. STUDENT OWNERSHIP ARCHITECTURE



# Student B


Role:


Founder

Product Owner

Lead Engineer



Owns:


Frontend:

- UI;
- map experience;
- journey interface.



Backend:

- journey;
- recovery;
- AI.



Integration:

- final product.



---

# Student A


Role:


Mobility Intelligence Research Engineer



Owns:


Data:

- transit pipeline.



GIS:

- spatial model.



Intelligence:

- mobility twin.



Simulation:

- flood impact.



---

# 9. DEPLOYMENT ARCHITECTURE



Development:


Developer Machine


↓

Docker


↓

Local Services



Production:


Cloud Environment


↓

Container


↓

Database


↓

Application



---

# 10. SECURITY ARCHITECTURE



Requirement:


Environment:


- secrets tidak masuk repository;
- menggunakan environment variable.



API:


- validation;
- authentication;
- authorization.



Database:


- migration controlled;
- backup strategy.



---

# 11. SCALABILITY CONSIDERATION



Architecture harus memungkinkan:


## Operator Expansion


Hari ini:


TransJakarta


Besok:


+

KRL

+

MRT

+

LRT



---

## Geographic Expansion


Hari ini:


Jakarta


Besok:


Indonesia.



---

## Feature Expansion


Future:


- realtime API;
- crowd prediction;
- operator dashboard.



---

# 12. AI AGENT IMPLEMENTATION RULE



Sebelum coding:


AI Agent harus:


1. Membaca architecture.
2. Memahami module boundary.
3. Membuat implementation plan.
4. Menghindari scope creep.



Saat coding:


AI Agent wajib:


- mengikuti module;
- membuat testing;
- membuat dokumentasi.



---

# 13. ARCHITECTURE CONSTRAINT



AI Agent DILARANG:


❌ membuat monolithic uncontrolled code


❌ membuat database tanpa schema design


❌ membuat fake intelligence


❌ menaruh business logic di frontend


❌ mengganti stack tanpa keputusan



---

# 14. FINAL ARCHITECTURE STATEMENT



TRANSUM-IN NEXUS dibangun sebagai:



# Intelligent Mobility Platform Architecture



yang menggabungkan:



Transportation Data

+

GIS Intelligence

+

Digital Twin

+

Simulation Engine

+

Generative AI



untuk menghasilkan sistem transportasi yang adaptif terhadap perubahan kondisi.



END OF DOCUMENT
```

---
