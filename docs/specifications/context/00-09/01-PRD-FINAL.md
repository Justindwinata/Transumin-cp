 

# FILE 01 — PRODUCT REQUIREMENT DOCUMENT (PRD) FINAL

Nama file:

```text
01-PRD-FINAL.md
```

Dokumen ini berbeda dengan `00-PROJECT-MASTER-CONTEXT.md`.

Jika file 00 menjawab:

> "Apa itu TRANSUM-IN NEXUS dan kenapa project ini dibuat?"

Maka file 01 menjawab:

> "Apa yang sebenarnya harus dibangun, siapa penggunanya, fitur apa saja, bagaimana sistem bekerja, dan bagaimana menentukan bahwa product ini berhasil."

Dokumen ini akan menjadi referensi utama AI Agent ketika membuat:

- frontend;
- backend;
- database;
- API;
- testing;
- milestone.


---

# TRANSUM-IN NEXUS

# PRODUCT REQUIREMENT DOCUMENT (PRD)

Version:

1.0.0


Status:

FROZEN PRODUCT REQUIREMENT


Audience:

- AI Coding Agent
- Software Engineer
- Research Engineer
- Product Owner
- Capstone Team


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan kebutuhan produk TRANSUM-IN NEXUS secara lengkap.


Dokumen ini menjadi acuan untuk:


- menentukan fitur yang harus dibangun;
- menentukan batasan sistem;
- menentukan perilaku aplikasi;
- menentukan kebutuhan pengguna;
- menentukan evaluasi keberhasilan product.


AI Agent WAJIB memahami seluruh requirement sebelum melakukan implementasi.


AI Agent tidak boleh menambahkan fitur yang tidak memiliki hubungan langsung dengan tujuan product.


---

# 2. PRODUCT OVERVIEW


## Product Name

TRANSUM-IN NEXUS


## Product Definition


TRANSUM-IN NEXUS adalah platform intelligent multimodal mobility berbasis web yang mengintegrasikan data transportasi publik, informasi spasial, digital twin, simulasi gangguan, dan generative AI untuk membantu pengguna mengambil keputusan perjalanan yang lebih adaptif.


---

## Product Statement


> "TRANSUM-IN NEXUS membantu pengguna Jakarta memahami, memilih, dan menjalankan perjalanan transportasi publik multimoda bahkan ketika kondisi jaringan berubah akibat gangguan seperti banjir."


---

# 3. PRODUCT VISION


Membangun sistem transportasi digital yang tidak hanya mengetahui:

> bagaimana seseorang pergi dari titik A ke titik B.


Tetapi juga memahami:


> bagaimana perjalanan tersebut tetap dapat dilakukan ketika kondisi transportasi mengalami perubahan.


---

# 4. PRODUCT OBJECTIVES


## Objective 1

## Unified Multimodal Transportation Intelligence


Sistem mampu menggabungkan informasi berbagai moda:


- TransJakarta;
- Mikrotrans;
- KRL Commuter Line;
- MRT Jakarta;
- LRT Jakarta;
- LRT Jabodebek.


Tujuan:

Memberikan pengalaman perjalanan tanpa pengguna harus berpindah banyak platform.


---

## Objective 2

## Adaptive Journey Decision


Sistem tidak hanya memberikan satu rute.


Sistem memberikan beberapa strategi perjalanan.


Contoh:


User:

```
Mercu Buana → Kota Tua
```


Output:


Pilihan A:

```
Mikrotrans
↓
KRL
↓
TransJakarta

Durasi:
90 menit

Transit:
2 kali

Walking:
500 meter
```


Pilihan B:

```
Bus
↓
MRT

Durasi:
100 menit
```


User dapat memilih berdasarkan kebutuhan.


---

## Objective 3

## Flood-Aware Mobility Intelligence


Sistem mampu memahami dampak banjir terhadap jaringan transportasi.


Contoh:


Kondisi normal:


```
Halte X
|
Bus Route A
|
Stasiun Y

```


Saat banjir:


```
Halte X

DISRUPTED


Route A

TERGANGGU

```


Sistem melakukan analisis.


---

## Objective 4

## Journey Recovery


Jika perjalanan terganggu:


Sistem memberikan:


- alternatif rute;
- perubahan moda;
- estimasi dampak;
- langkah perjalanan baru.


---

# 5. TARGET USER


# 5.1 Primary User

## Daily Public Transport Commuter


Karakteristik:


- menggunakan transportasi umum;
- melakukan perjalanan rutin;
- membutuhkan informasi sederhana;
- tidak ingin memahami sistem transportasi secara teknis.


Contoh:


Mahasiswa:


```
Rumah
↓
Kampus

```


Pekerja:


```
Rumah
↓
Kantor

```


---

# 5.2 Secondary User


## Transportation Operator / Analyst


Membutuhkan:


- kondisi jaringan;
- dampak gangguan;
- simulasi perubahan.


---

# 6. USER PROBLEM ANALYSIS


## Problem 1

## Pengguna Bingung Memilih Moda


Saat ini:


User harus memahami sendiri:


- apakah naik bus;
- apakah naik kereta;
- kapan transit;
- dimana pindah.


Dampak:


- perjalanan tidak optimal;
- waktu terbuang;
- meningkatkan kecemasan pengguna.


---

## Problem 2

## Informasi Transportasi Terfragmentasi


Data berada pada:


- aplikasi operator;
- website;
- Google Maps;
- media sosial.


Tidak ada unified mobility intelligence.


---

## Problem 3

## Tidak Ada Adaptasi Gangguan


Contoh:


Banjir menyebabkan:


- halte tidak dapat digunakan;
- jalan terputus;
- kendaraan berubah rute.


Aplikasi biasa hanya memberikan informasi.


TRANSUM-IN NEXUS memberikan solusi adaptasi.


---

# 7. PRODUCT FEATURE REQUIREMENT


---

# FEATURE GROUP 1

# Multimodal Journey Planner


## Description


Fitur utama untuk mencari perjalanan.


---

## Input


User memasukkan:


Origin:

```
lokasi awal
```


Destination:

```
tujuan
```


Preference:


- fastest;
- least transfer;
- least walking;
- simplest.


---

## System Process


```text

Input Location

↓

Find Nearby Transit

↓

Generate Possible Journey

↓

Calculate Cost

↓

Rank Result

↓

Display Options

```


---

## Output


Berisi:


- moda transportasi;
- urutan perjalanan;
- waktu;
- jumlah transit;
- jarak berjalan;
- estimasi biaya.


---

# FEATURE GROUP 2

# Interactive Mobility Map


## Description


Peta interaktif yang menjadi pusat pengalaman aplikasi.


---

Menampilkan:


- halte;
- stasiun;
- rute;
- posisi pengguna;
- area gangguan.


---

Requirement:


Map harus:


- responsive;
- smooth;
- mudah dipahami.


---

# FEATURE GROUP 3

# Active Journey Guidance


## Description


Membantu pengguna menjalankan perjalanan.


---

Contoh:


Step:


```
1.
Berjalan menuju halte A


2.
Naik TransJakarta Koridor 1


3.
Turun di Stasiun B


4.
Transfer ke KRL
```


---

Future capability:


GPS tracking.


---

# FEATURE GROUP 4

# Mobility Twin


## Description


Representasi digital jaringan transportasi.


---

Setiap objek memiliki:


```json
{
"id":"",
"type":"",
"location":"",
"state":"",
"timestamp":""
}

```


---

Contoh:


Station:


```
Manggarai

State:
NORMAL

```


atau:


```
Manggarai

State:
DISRUPTED

Reason:
Flood

```


---

# FEATURE GROUP 5

# Flood Impact Intelligence


## Description


Menganalisis pengaruh banjir terhadap transportasi.


---

Input:


```
Flood location

Radius

Severity

Duration

```


---

Process:


```
Flood Event

↓

Spatial Intersection

↓

Affected Transit Entity

↓

Network Impact

```


---

Output:


```
Affected Route:

TJ001


Affected Station:

Manggarai


Impact:

HIGH

```


---

# FEATURE GROUP 6

# Transit Recovery Recommendation


## Description


Memberikan solusi ketika perjalanan terganggu.


---

Example:


Original:


```
KRL

↓

TransJakarta

```


Problem:


```
Station flooded

```


Recovery:


```
Alternative:

MRT

↓

Bus


Additional time:

+20 minutes

```


---

# FEATURE GROUP 7

# Generative AI Mobility Copilot


## Description


Asisten AI yang menjelaskan kondisi perjalanan.


---

Example:


User:


"Kenapa rute saya berubah?"


AI:


"Stasiun Manggarai mengalami gangguan banjir berdasarkan data jaringan. Sistem menemukan alternatif menggunakan MRT dengan estimasi tambahan waktu 15 menit."


---

Constraint:


AI tidak boleh:


- menentukan rute sendiri;
- membuat informasi palsu;
- menggantikan engine.


AI hanya menjelaskan hasil sistem.


---

# 8. USER FLOW


# FLOW 1

## Normal Journey


```text

User membuka aplikasi

↓

Input tujuan

↓

System mencari perjalanan

↓

User memilih rute

↓

System memberikan navigasi

↓

Perjalanan selesai

```


---

# FLOW 2

## Flood Disruption


```text

User sedang perjalanan

↓

Flood Event terjadi

↓

Mobility Twin berubah

↓

System melakukan impact analysis

↓

Recovery engine berjalan

↓

User menerima alternatif

```


---

# FLOW 3

## Operator Simulation


```text

Operator memasukkan gangguan

↓

Simulation engine berjalan

↓

System menghitung dampak

↓

Hasil divisualisasikan

```


---

# 9. FUNCTIONAL REQUIREMENT


## FR-001

System harus dapat menyimpan data operator transportasi.


Priority:

HIGH


---

## FR-002

System harus dapat mencari perjalanan multimoda.


Priority:

HIGH


---

## FR-003

System harus dapat memvisualisasikan jaringan transportasi.


Priority:

HIGH


---

## FR-004

System harus dapat menerima event gangguan banjir.


Priority:

HIGH


---

## FR-005

System harus dapat menghitung dampak gangguan.


Priority:

HIGH


---

## FR-006

System harus dapat memberikan recovery recommendation.


Priority:

HIGH


---

## FR-007

System harus dapat memberikan penjelasan menggunakan AI.


Priority:

MEDIUM


---

# 10. NON FUNCTIONAL REQUIREMENT


## Performance


System harus mampu:


- memproses query perjalanan dengan cepat;
- melakukan spatial query efisien.


---

## Scalability


Architecture harus memungkinkan:


- operator baru;
- dataset baru;
- wilayah baru.


---

## Reliability


System harus:


- memiliki validation;
- memiliki error handling;
- memiliki logging.


---

## Security


Harus menjaga:


- authentication;
- API security;
- environment secrets.


---

# 11. MVP SCOPE


Untuk capstone:


Wajib:


✅ Transit data integration

✅ Multimodal route planning

✅ GIS map

✅ Mobility Twin basic

✅ Flood impact simulation

✅ Recovery recommendation

✅ AI explanation


---

# 12. FUTURE DEVELOPMENT


Tidak menjadi fokus utama:


- nationwide coverage;
- commercial deployment;
- real-time operator API penuh;
- autonomous vehicle.


---

# 13. SUCCESS CRITERIA


Product dianggap berhasil jika:


1.

User dapat mencari perjalanan multimoda.


2.

System dapat memahami kondisi jaringan transportasi.


3.

System dapat mensimulasikan gangguan banjir.


4.

System dapat menghasilkan alternatif perjalanan.


5.

AI dapat menjelaskan hasil secara factual.


6.

Seluruh proses menggunakan data yang dapat dipertanggungjawabkan.


---

# 14. FINAL PRODUCT DEFINITION


TRANSUM-IN NEXUS bukan:


❌ aplikasi peta biasa

❌ aplikasi jadwal transportasi

❌ chatbot transportasi


TRANSUM-IN NEXUS adalah:


## Intelligent Mobility Decision Platform


yang menggabungkan:


Transportation Data

+

GIS

+

Digital Twin

+

Simulation

+

Generative AI


untuk membantu manusia dan sistem transportasi beradaptasi terhadap perubahan kondisi.


---

END OF DOCUMENT
```

---

