# TRANSUM-IN NEXUS

# PROJECT MASTER CONTEXT DOCUMENT

Version:
1.0.0

Status:
FROZEN PRODUCT FOUNDATION

Audience:
AI Coding Agent,
Software Engineer,
Research Engineer,
Capstone Developer Team


---

# 1. DOCUMENT PURPOSE


Dokumen ini merupakan dokumen konteks utama (Master Context) untuk project TRANSUM-IN NEXUS.

AI Agent WAJIB membaca dan memahami dokumen ini sebelum melakukan:

- analisis project;
- perancangan sistem;
- pembuatan repository;
- implementasi kode;
- pembuatan database;
- pembuatan frontend;
- pembuatan backend;
- integrasi AI.


Dokumen ini berfungsi sebagai:

"Single Source of Truth"

yang menjelaskan:

- visi produk;
- tujuan penelitian;
- masalah yang diselesaikan;
- ruang lingkup sistem;
- batasan pengembangan;
- prinsip engineering;
- arah implementasi.


AI Agent TIDAK BOLEH langsung melakukan coding sebelum memahami seluruh konteks yang dijelaskan pada dokumen ini.


---

# 2. PROJECT IDENTITY


## Product Name

TRANSUM-IN NEXUS


## Full Product Name


Hybrid Mobility Twin for Flood-Aware Multimodal Transit Recovery Intelligence


## Product Category


Intelligent Transportation System (ITS)


## Platform


Web-Based Intelligent Mobility Platform


## Primary Domain


Project ini menggabungkan beberapa bidang teknologi:


- Natural Language Processing
- Computer Science
- Geographic Information System (GIS)
- Big Data Engineering
- Cloud Computing
- Generative AI
- Digital Twin
- Intelligent Transportation System


---

# 3. PROJECT BACKGROUND


Jakarta dan wilayah Jabodetabek memiliki sistem transportasi publik yang besar namun sangat terfragmentasi.


Transportasi publik terdiri dari banyak operator:


## Bus


- TransJakarta
- Mikrotrans


## Rail


- KRL Commuter Line
- MRT Jakarta
- LRT Jakarta
- LRT Jabodebek


Masing-masing operator memiliki:

- sistem informasi sendiri;
- aplikasi sendiri;
- format data berbeda;
- mekanisme perjalanan berbeda.


Akibatnya pengguna menghadapi masalah:


"Saya harus naik transportasi apa dari titik A ke titik B?"


dan masalah yang lebih besar:


"Jika terjadi gangguan di tengah perjalanan, apa yang harus saya lakukan?"


---

# 4. EXISTING PROBLEM


## Problem 1 — Fragmented Transportation Information


Saat ini pengguna harus menggunakan banyak platform:


Contoh:


Google Maps:

untuk lokasi.


Aplikasi operator:

untuk jadwal.


Media sosial:

untuk mengetahui gangguan.


Website:

untuk informasi layanan.


Tidak ada satu platform yang memahami keseluruhan perjalanan multimoda.


---

## Problem 2 — Route Planning Tidak Cukup


Aplikasi transportasi umum umumnya hanya menjawab:


"Dari A ke B gunakan rute ini."


Namun tidak menjawab:


- bagaimana jika halte tidak bisa digunakan?
- bagaimana jika stasiun terdampak?
- bagaimana jika banjir memutus perjalanan?
- bagaimana alternatif terbaik?


---

## Problem 3 — Gangguan Banjir Jakarta


Banjir merupakan permasalahan nyata yang dapat menyebabkan:


- halte tidak dapat digunakan;
- jalan tidak dapat dilewati;
- bus harus memutar;
- penumpukan penumpang;
- keterlambatan perjalanan.


Masalah utama:

Sistem transportasi saat ini belum memberikan adaptasi perjalanan berbasis kondisi jaringan.


---

# 5. FINAL PRODUCT VISION


TRANSUM-IN NEXUS bukan hanya aplikasi pencarian transportasi.


TRANSUM-IN NEXUS adalah:


"Platform intelligent mobility yang memahami kondisi jaringan transportasi dan membantu pengguna serta operator mengambil keputusan ketika kondisi berubah."


---

# 6. PRODUCT OBJECTIVE


Tujuan utama sistem:


## Objective 1

Menyatukan informasi transportasi multimoda Jakarta.


Sistem memahami:


- rute;
- halte;
- stasiun;
- transfer;
- jadwal;
- hubungan antar moda.


---

## Objective 2

Membangun representasi digital jaringan transportasi.


Sistem memiliki pemahaman:


- node transportasi;
- koneksi;
- kondisi jaringan;
- gangguan.


---

## Objective 3

Menganalisis dampak gangguan.


Contoh:


Jika banjir terjadi:


Sistem mengetahui:


- rute terdampak;
- halte terdampak;
- perjalanan yang terganggu.


---

## Objective 4

Memberikan adaptive journey recommendation.


Sistem tidak hanya memberikan rute awal.


Tetapi:


"Bagaimana pengguna tetap mencapai tujuan ketika kondisi berubah."


---

# 7. FINAL PRODUCT CONCEPT


TRANSUM-IN NEXUS memiliki dua kemampuan utama:


---

# PART 1

# DECIDE


## "Saya harus memilih perjalanan yang mana?"


Contoh:


User:


Dari:

Mercu Buana


Ke:

Kota Tua


System:


Memberikan pilihan:


Option 1:

Mikrotrans

↓

KRL

↓

TransJakarta


Durasi:

90 menit


---

Option 2:


Bus

↓

MRT


Durasi:

100 menit


---

# PART 2

# EXECUTE


## "Bagaimana saya menjalankan perjalanan tersebut?"


Ketika perjalanan berlangsung:


System memberikan:


- lokasi saat ini;
- langkah berikutnya;
- arah perpindahan;
- informasi gangguan.


---

Contoh:


Turun di Stasiun Manggarai.


System:


"Keluar melalui Exit B."

"Berjalan 210 meter menuju halte TransJakarta."

"Namun area tersebut terdampak banjir."

"Alternatif perjalanan tersedia."


---

# 8. CORE TECHNOLOGY CONCEPT


TRANSUM-IN NEXUS terdiri dari beberapa intelligence layer.


---

# Layer 1

# Multimodal Transit Data Layer


Mengelola:


- operator;
- route;
- station;
- stop;
- schedule.


---

# Layer 2

# GIS Spatial Intelligence Layer


Mengelola:


- lokasi;
- jarak;
- hubungan geografis;
- area gangguan.


---

# Layer 3

# Hybrid Mobility Twin


Membangun representasi digital transportasi.


Setiap elemen memiliki:


- identitas;
- lokasi;
- hubungan;
- kondisi.


Contoh:


Normal:


Route TJ-001

State:

NORMAL


---

Saat banjir:


Route TJ-001

State:

DISRUPTED


---

# Layer 4

# Flood Disruption Intelligence


Mengubah kejadian banjir menjadi analisis transportasi.


Input:


- lokasi banjir;
- radius;
- severity.


Output:


- route terdampak;
- station terdampak;
- konektivitas hilang.


---

# Layer 5

# Simulation Engine


Melakukan simulasi:


"Jika kondisi ini terjadi, apa dampaknya?"


Contoh:


Scenario:


Banjir Manggarai.


System:


Membandingkan:


Before:

jaringan normal.


After:

jaringan terganggu.


---

# Layer 6

# Journey Recovery Intelligence


Menghasilkan:


- alternatif perjalanan;
- recovery route;
- rekomendasi adaptasi.


---

# Layer 7

# Generative AI Mobility Copilot


AI digunakan untuk:


- menjelaskan hasil;
- membantu user memahami kondisi.


AI BUKAN:

- pengganti routing engine;
- sumber keputusan utama.


Semua jawaban AI harus berasal dari data sistem.


---

# 9. TARGET USER


## Primary User


# Daily Commuter


Contoh:


- mahasiswa;
- pekerja;
- masyarakat pengguna transportasi umum.


---

## Secondary User


# Transport Operator


Membantu memahami:


- gangguan;
- dampak jaringan;
- simulasi.


---

# 10. PRODUCT DIFFERENTIATION


TRANSUM-IN NEXUS berbeda dari aplikasi transportasi biasa.


Bukan hanya:


Route Finder


Tetapi:


Mobility Intelligence Platform.


---

Perbedaan utama:


Existing:


User mencari rute.


TRANSUM-IN NEXUS:


User mendapatkan keputusan perjalanan berdasarkan kondisi jaringan.


---

Existing:


Gangguan diinformasikan.


TRANSUM-IN NEXUS:


Gangguan dianalisis dan diberikan recovery.


---

# 11. RESEARCH VALUE


Kontribusi penelitian:


Membangun sistem yang menggabungkan:


- multimodal transportation;
- GIS;
- digital twin;
- disruption simulation;
- generative AI.


---

# 12. STUDENT OWNERSHIP


## Student B — Justin Dwinata


Role:


Founder

Product Owner

Lead Software Engineer


Ownership:


- product architecture;
- frontend;
- backend core;
- journey engine;
- recovery engine;
- AI copilot;
- UI/UX;
- integration;
- deployment.


---

## Student A


Role:


Mobility Intelligence Research Engineer


Ownership:


- transit data pipeline;
- GIS model;
- mobility twin;
- flood impact;
- simulation engine.


---

# 13. ENGINEERING PRINCIPLES


AI Agent WAJIB mengikuti:


## Principle 1

Data First


Semua keputusan berdasarkan data.


---

## Principle 2

Modular Architecture


Setiap module memiliki tanggung jawab jelas.


---

## Principle 3

Explainable Intelligence


Sistem harus dapat menjelaskan alasan keputusan.


---

## Principle 4

Production Mindset


Bangun seperti produk nyata, bukan prototype sederhana.


---

# 14. DEVELOPMENT GOAL


Target akhir:


Sebuah web application yang:


- dapat dijalankan;
- memiliki data nyata;
- memiliki arsitektur profesional;
- memiliki fitur intelligence;
- memiliki evaluasi penelitian;
- siap dipresentasikan sebagai capstone.


---

# 15. AI AGENT FINAL INSTRUCTION


Sebelum melakukan apapun:


WAJIB:


1. Membaca seluruh dokumen project.
2. Memahami product vision.
3. Memahami ownership.
4. Memahami architecture.
5. Membuat plan sebelum coding.


---

AI Agent DILARANG:


- membuat aplikasi transportasi sederhana;
- membuat clone Google Maps;
- membuat chatbot biasa;
- membuat dashboard generik;
- membuat fitur tanpa tujuan.


---

# FINAL STATEMENT


TRANSUM-IN NEXUS harus dibangun sebagai:

A serious intelligent transportation product.

Bukan sekadar:

- tugas kuliah;
- prototype;
- aplikasi pencarian rute.


Setiap keputusan engineering harus mendukung visi:


"Helping people and transportation systems adapt when mobility conditions change."
