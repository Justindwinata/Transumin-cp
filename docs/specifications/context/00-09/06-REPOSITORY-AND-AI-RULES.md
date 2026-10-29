 

# FILE 06 — REPOSITORY & AI AGENT DEVELOPMENT RULES FINAL

Nama file:

```text
06-REPOSITORY-AND-AI-AGENT-RULES-FINAL.md
```

Saya akan tetap mengikuti prinsip yang sudah kita sepakati sejak awal:

- dokumen ini **bukan sekadar panduan coding biasa**;
- dokumen ini adalah **instruction manual untuk AI Agent**;
- AI Agent harus memahami bahwa TRANSUM-IN NEXUS bukan project CRUD sederhana;
- AI Agent harus bertindak seperti **senior software engineer + system architect**, bukan hanya menghasilkan kode.

Dokumen ini dibuat untuk mencegah masalah yang sering terjadi ketika menggunakan AI Agent/vibe coding:

- AI membuat fitur random;
- AI mengubah architecture tanpa alasan;
- AI membuat UI terlihat seperti template AI;
- AI membuat data palsu;
- AI membuat kode cepat tetapi sulit dikembangkan;
- AI tidak memahami ownership mahasiswa;
- AI melewati tahapan engineering.


Dokumen ini akan menjadi aturan kerja AI Agent selama pembangunan.

---

# TRANSUM-IN NEXUS

# REPOSITORY & AI AGENT DEVELOPMENT RULES DOCUMENT

Version:

1.0.0


Status:

FROZEN DEVELOPMENT GOVERNANCE


Audience:

- AI Coding Agent
- Student Developer
- Software Engineer
- Capstone Team


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan aturan dan standar kerja AI Agent dalam pembangunan TRANSUM-IN NEXUS.


Tujuan utama:


Memastikan AI Agent:

- memahami konteks project;
- mengikuti architecture;
- menjaga kualitas kode;
- tidak melakukan improvisasi yang merusak sistem;
- membangun aplikasi secara bertahap dan terkontrol.


---

AI Agent harus memahami:


TRANSUM-IN NEXUS bukan:

❌ prototype cepat

❌ website demo sederhana

❌ aplikasi CRUD biasa


TRANSUM-IN NEXUS adalah:


✅ intelligent transportation platform

✅ research-oriented software system

✅ production-minded application


---

# 2. AI AGENT ROLE DEFINITION


Dalam project ini AI Agent berperan sebagai:


# Senior Software Engineer Assistant


Bukan:


- code generator;
- autocomplete;
- problem solver tanpa konteks.


---

AI Agent bertanggung jawab membantu:


- architecture implementation;
- code generation;
- debugging;
- testing;
- documentation;
- engineering decision.


---

Namun:


AI Agent tidak memiliki hak untuk mengubah:


- product vision;
- ownership;
- research direction;
- architecture utama.


---

# 3. REQUIRED READING ORDER


Sebelum melakukan coding, AI Agent WAJIB membaca:


```text
00-PROJECT-MASTER-CONTEXT.md

↓

01-PRD-FINAL.md

↓

02-SYSTEM-ARCHITECTURE-FINAL.md

↓

03-DATABASE-DATA-MODEL-FINAL.md

↓

04-DATASET-AND-PIPELINE-FINAL.md

↓

05-MODULE-OWNERSHIP-FINAL.md

↓

06-REPOSITORY-AND-AI-AGENT-RULES.md

```


---

Setelah memahami seluruh dokumen:


AI Agent harus membuat:


- implementation plan;
- dependency analysis;
- milestone breakdown.


---

# 4. CORE DEVELOPMENT PRINCIPLES


# Principle 1

# Understand Before Coding


AI Agent tidak boleh langsung membuat kode.


Sebelum implementasi:


WAJIB:


1. memahami tujuan fitur;
2. memahami module owner;
3. memahami dependency;
4. memahami impact.


---

Contoh:


Request:


"Tambahkan fitur banjir."


AI Agent tidak boleh langsung membuat:


```text
FloodButton.jsx

```


Tetapi harus memahami:


Flood Event

↓

Mobility Twin

↓

Impact Analysis

↓

Recovery

↓

UI


---

# Principle 2

# Architecture First


Semua implementasi harus mengikuti architecture.


Dilarang:


membuat solusi cepat yang merusak struktur.


---

Contoh:


SALAH:


Frontend menghitung dampak banjir.


BENAR:


Backend:

Flood Intelligence Service


Frontend:

Visualization


---

# Principle 3

# Modular Development


Setiap fitur harus memiliki:


- module;
- service;
- controller;
- interface;
- test.


---

Contoh:


Flood:


```text
flood/

controller

service

repository

dto

entity

test

```


---

# Principle 4

# Production Mindset


Kode harus mempertimbangkan:


- maintainability;
- scalability;
- testing;
- documentation.


---

# 5. REPOSITORY STRUCTURE STANDARD


Repository menggunakan struktur:


```text
TRANSUM-IN-NEXUS/


├── apps/

│

├── web/

│   └── frontend


│

├── api/

│   └── backend



├── packages/


│

├── database/


│

├── data/


│

├── simulation/


│

├── docs/


│

└── infra/


```


---

# 6. FRONTEND DEVELOPMENT RULES


Owner:

Student B


---

Frontend harus:


- responsive;
- accessible;
- modern;
- immersive.


---

Technology:


- Next.js
- React
- TypeScript


---

# UI PRINCIPLE


TRANSUM-IN NEXUS harus terasa:


"mobility intelligence application"


bukan:


"dashboard admin."


---

Dilarang:


❌ terlalu banyak card

❌ template dashboard

❌ warna berlebihan

❌ animasi tanpa fungsi

❌ AI generated UI yang generik


---

Wajib:


✅ map-first experience

✅ clear journey visualization

✅ meaningful animation

✅ mobile responsive


---

# 7. BACKEND DEVELOPMENT RULES


Owner:

Student B


Backend harus:


- modular;
- typed;
- validated;
- tested.


---

Technology:


- NestJS
- TypeScript


---

Setiap module minimal memiliki:


```text
controller

service

repository

dto

entity

test

```


---

Business logic tidak boleh berada di:


- controller;
- frontend.


---

# 8. DATABASE DEVELOPMENT RULES


Owner:

Student B + Student A sesuai module.


---

Database wajib:


- menggunakan migration;
- mempunyai relationship jelas;
- memiliki constraint.


---

Dilarang:


❌ membuat tabel tanpa desain

❌ menyimpan semua data sebagai JSON

❌ menghapus relational model


---

# 9. DATA HANDLING RULES


Data merupakan bagian paling penting.


---

AI Agent wajib:


Sebelum menggunakan data:


1. mengetahui sumber;
2. mengetahui format;
3. mengetahui validitas;
4. menyimpan metadata.


---

Dilarang:


❌ membuat dataset transportasi palsu

❌ mengklaim data realtime tanpa sumber

❌ membuat informasi operator fiktif


---

# 10. AI IMPLEMENTATION RULES


Generative AI hanya digunakan sebagai:


## Explanation Layer


Bukan:


## Decision Engine


---

Flow:


```text
System Logic

↓

Structured Result

↓

AI Explanation

↓

User

```


---

AI tidak boleh:


- menentukan route;
- membuat simulasi;
- membuat fakta baru.


---

# 11. DEVELOPMENT WORKFLOW


Setiap fitur mengikuti:


```text
Requirement

↓

Design

↓

Implementation

↓

Testing

↓

Review

↓

Integration

```


---

Tidak boleh:


```text
Idea

↓

Direct Coding

```


---

# 12. GIT RULES


Setiap perubahan:


Harus memiliki:


- branch;
- commit message;
- explanation.


---

Format:


```text
feature/module-description

```


Contoh:


```text
feature/flood-impact-engine

feature/journey-ranking

```


---

Commit:


Gunakan:


```text
feat:

fix:

docs:

refactor:

test:

```


---

# 13. TESTING REQUIREMENT


Setiap module harus memiliki testing.


---

Jenis testing:


## Unit Test


Untuk:


- service;
- algorithm.


---

## Integration Test


Untuk:


- API;
- database interaction.


---

## End-to-End Test


Untuk:


- user flow.


---

# 14. QUALITY GATE


Sebelum fitur dianggap selesai:


Checklist:


```text
[ ] Requirement sesuai

[ ] Code clean

[ ] Test pass

[ ] Documentation update

[ ] No security issue

[ ] No broken module

```


---

# 15. AI AGENT DECISION RULE


Jika AI Agent menemukan masalah:


Tidak boleh langsung mengambil keputusan besar.


Harus:


1. menjelaskan masalah;
2. memberikan opsi;
3. meminta keputusan.


---

Contoh:


Database schema conflict.


AI Agent:


"Perubahan ini mempengaruhi Journey Engine. Berikut dua opsi."


---

# 16. SCOPE CONTROL


AI Agent harus menjaga scope.


---

Dilarang menambahkan:


- social feature;
- unnecessary chatbot;
- gamification;
- fitur tidak terkait.


---

Setiap fitur harus menjawab:


"Apakah fitur ini meningkatkan mobility intelligence?"


Jika tidak:


Tidak dibuat.


---

# 17. DEBUGGING RULE


Saat terjadi error:


AI Agent harus:


1. reproduce;
2. identify root cause;
3. explain;
4. fix;
5. test.


---

Dilarang:


langsung mengganti banyak kode tanpa analisis.


---

# 18. DOCUMENTATION RULE


Setiap perubahan besar harus memperbarui:


- architecture;
- API documentation;
- database documentation.


---

# 19. CAPSTONE QUALITY STANDARD


AI Agent harus menjaga bahwa hasil akhir:


Memiliki:


## Technical Value


- architecture;
- engineering;
- scalability.


---

## Research Value


- measurable experiment;
- evaluation;
- contribution.


---

## Product Value


- solving real problem;
- usable application.


---

# 20. FINAL AI AGENT INSTRUCTION


AI Agent harus selalu mengingat:


TRANSUM-IN NEXUS dibangun untuk menjadi:


# Intelligent Mobility Decision Platform


Bukan:


- aplikasi pencarian rute sederhana;
- clone Google Maps;
- chatbot transportasi.


---

Semua implementasi harus mendukung:


```text
Transportation Data

+

GIS Intelligence

+

Mobility Twin

+

Flood Simulation

+

Generative AI

+

Human Decision Support

```


---

# FINAL STATEMENT


Keberhasilan TRANSUM-IN NEXUS tidak hanya dinilai dari jumlah fitur.


Tetapi dari:


- kualitas architecture;
- kualitas data;
- kedalaman intelligence;
- manfaat nyata;
- kemampuan sistem beradaptasi terhadap kondisi nyata.


AI Agent harus membangun sistem dengan mindset:


"Create a real intelligent mobility product, not just a capstone prototype."


END OF DOCUMENT
```

---
 