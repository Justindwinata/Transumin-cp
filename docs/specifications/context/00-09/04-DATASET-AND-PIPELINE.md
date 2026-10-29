 

# FILE 04 — DATASET & DATA PIPELINE STRATEGY FINAL

Nama file:

```text
04-DATASET-AND-PIPELINE-FINAL.md
```

---

Sebelum masuk ke dokumen, saya ingin menegaskan bahwa file ini adalah salah satu dokumen **paling krusial untuk TRANSUM-IN NEXUS** karena sebelumnya dosen Anda memberikan concern terbesar pada:

> "Jika aplikasi sangat tergantung kepada ketersediaan data, maka perolehan dataset menjadi penentu utama."

Maka dokumen ini tidak boleh hanya berisi:

- daftar dataset;
- link sumber;
- cara download.

Tetapi harus menjawab pertanyaan akademik dan engineering:

1. Apakah dataset benar-benar tersedia?
2. Apakah dataset cukup untuk membangun sistem?
3. Bagaimana jika satu operator tidak memiliki data lengkap?
4. Bagaimana menggabungkan dataset yang berbeda format?
5. Bagaimana memastikan data berkualitas?
6. Bagaimana data mentah berubah menjadi intelligence?
7. Bagaimana AI Agent harus membangun pipeline?


Pendekatan yang digunakan:

```text
DATA SOURCE

↓

DATA INGESTION

↓

DATA VALIDATION

↓

DATA NORMALIZATION

↓

SPATIAL PROCESSING

↓

MOBILITY TWIN

↓

INTELLIGENCE ENGINE

↓

USER EXPERIENCE
```

---

# TRANSUM-IN NEXUS

# DATASET & DATA PIPELINE STRATEGY DOCUMENT

Version:

1.0.0


Status:

FROZEN DATA FOUNDATION


Audience:

- AI Coding Agent
- Data Engineer
- Backend Engineer
- Research Engineer
- Capstone Team


---

# 1. DOCUMENT PURPOSE


Dokumen ini menjelaskan strategi data TRANSUM-IN NEXUS mulai dari:

- sumber data;
- proses akuisisi;
- validasi;
- transformasi;
- penyimpanan;
- penggunaan data untuk intelligence system.


Dokumen ini menjadi pedoman AI Agent dalam membangun:

- data ingestion pipeline;
- database population;
- mobility intelligence;
- simulation engine.


---

# 2. DATA PHILOSOPHY


TRANSUM-IN NEXUS adalah sistem yang bergantung pada kualitas data.


Oleh karena itu:


> Data bukan hanya input aplikasi, tetapi merupakan fondasi utama intelligence system.


Semua keputusan sistem harus dapat ditelusuri kembali kepada sumber data.


---

# 3. DATA REQUIREMENT


TRANSUM-IN NEXUS membutuhkan beberapa kategori data:


```text
1. Transit Data

2. Geographic Data

3. Road Network Data

4. Disruption Data

5. Simulation Data

6. User Interaction Data

```


---

# 4. TRANSIT DATA STRATEGY


## 4.1 Purpose


Transit data digunakan untuk membangun:

- jaringan transportasi;
- route planning;
- multimodal connection;
- mobility twin.


---

# 5. PRIMARY TRANSIT DATA FORMAT


## GTFS (General Transit Feed Specification)


TRANSUM-IN NEXUS menggunakan GTFS sebagai standar utama.


Alasan:


GTFS merupakan format standar internasional untuk:


- public transportation;
- schedule;
- stop;
- route;
- trip.


---

GTFS terdiri dari:


```text
agency.txt

routes.txt

stops.txt

trips.txt

stop_times.txt

calendar.txt

shapes.txt

```


---

# 6. TRANSIT DATA SOURCE STRATEGY


## Tier 1 — Official Data


Prioritas utama:


Data resmi operator.


Contoh:


## TransJakarta


Data:


- route;
- stop;
- schedule;
- shape.


Confidence:

HIGH


---

## KRL Commuter Line


Prioritas:


- official schedule;
- station data.


---

## MRT Jakarta


Prioritas:


- official route;
- station;
- schedule.


---

## LRT


Prioritas:


- official route;
- station;
- schedule.


---

# 7. DATA AVAILABILITY PRINCIPLE


AI Agent harus memahami:


Tidak semua operator memiliki tingkat keterbukaan data yang sama.


Maka architecture harus:


BUKAN:


```text
Semua operator harus tersedia sejak awal.
```


Tetapi:


```text
System harus siap menerima operator baru ketika dataset tersedia.
```


---

# 8. DATA INGESTION ARCHITECTURE


Pipeline:


```text
External Dataset

        |

        |

Dataset Collector

        |

        |

Raw Storage

        |

        |

Parser

        |

        |

Validator

        |

        |

Normalizer

        |

        |

Database

        |

        |

Mobility Twin

```


---

# 9. DATA PIPELINE COMPONENT


# Component 1

# Data Collector


Purpose:


Mengambil dataset dari sumber.


Input:


- GTFS ZIP;
- CSV;
- API;
- GeoJSON.


Output:


Raw Dataset.


---

Example:


```text
transjakarta_gtfs.zip

```


---

# Component 2

# Raw Data Storage


Purpose:


Menyimpan data asli tanpa perubahan.


Tujuan:


- audit;
- reproducibility;
- debugging.


Structure:


```text
data/

raw/

transjakarta/

2026/

gtfs.zip

```


---

# Component 3

# Parser


Purpose:


Mengubah format mentah menjadi object internal.


Example:


GTFS:


```csv
stop_id,name,lat,lon

```


menjadi:


```json
{
"id":"STOP001",
"name":"Halte A",
"lat":-6.2,
"lon":106.8
}

```


---

# Component 4

# Validation Engine


Sebelum masuk database:


Data harus diperiksa.


---

Validation:


## Schema Validation


Apakah format sesuai?


Contoh:


STOP wajib memiliki:


- ID;
- nama;
- koordinat.


---

## Geographic Validation


Memastikan:


- latitude valid;
- longitude valid;
- lokasi masuk wilayah Indonesia.


---

## Relationship Validation


Contoh:


Trip harus memiliki:


Route.


Stop harus memiliki:


Location.


---

## Duplicate Detection


Mencegah:


- stop ganda;
- route ganda.


---

# Component 5

# Normalization Engine


Masalah:


Setiap operator memiliki format berbeda.


Contoh:


Operator A:


```text
station_name

```


Operator B:


```text
stop_name

```


System harus mengubah menjadi:


```text
canonical_station_name

```


---

# 10. CANONICAL DATA MODEL


TRANSUM-IN NEXUS menggunakan:


# Unified Mobility Schema


Semua operator dikonversi menjadi model:


```text
Operator

Route

Station

Stop

Trip

Schedule

Geometry

Transfer

```


---

Contoh:


Sebelum:


```text
TJ_Stop

KRL_Station

MRT_Stop

```


Sesudah:


```text
Transit_Stop

```


---

# 11. DATA QUALITY MANAGEMENT


Setiap dataset memiliki:


```json
{
"source":"",
"version":"",
"import_date":"",
"confidence":"",
"checksum":""
}

```


---

Confidence Level:


## HIGH


Data resmi.


Contoh:


Official GTFS.


---

## MEDIUM


Data terpercaya tetapi membutuhkan validasi.


---

## LOW


Data terbatas atau hasil ekstraksi.


---

# 12. GEOGRAPHIC DATA STRATEGY


GIS merupakan komponen utama.


Digunakan untuk:


- lokasi halte;
- jalur;
- jarak;
- area banjir;
- accessibility.


---

# 13. GIS DATA SOURCE


## OpenStreetMap


Digunakan untuk:


- jalan;
- pedestrian network;
- spatial relationship.


---

Format:


- OSM;
- GeoJSON;
- shapefile.


---

# 14. FLOOD DATA STRATEGY


Flood intelligence membutuhkan data gangguan.


Ada dua pendekatan:


---

# Approach 1

## Real Event Data


Menggunakan:


- historical flood information;
- public flood reports.


---

# Approach 2

## Controlled Simulation


Digunakan untuk penelitian.


Contoh:


Scenario:


```text
Flood Event:

Manggarai Area


Radius:

500 meter


Duration:

3 jam

```


---

Kelebihan:


- reproducible;
- dapat diuji;
- tidak tergantung kejadian nyata.


---

# 15. SIMULATION DATA STRATEGY


Simulation tidak membutuhkan data palsu.


Simulation menggunakan:


Real network data.


Kemudian diberikan:


Artificial disruption scenario.


---

Contoh:


Network:


Real TransJakarta route.


Scenario:


Tambahkan banjir.


Output:


Analisis dampak.


---

# 16. DATA STORAGE ARCHITECTURE


Struktur:


```text
data/


raw/

    original dataset


processed/

    cleaned dataset


warehouse/

    analytical data


simulation/

    scenario result

```


---

# 17. DATA PIPELINE FOR MOBILITY TWIN


Flow:


```text
Transit Dataset

↓

Canonical Transit Model

↓

Spatial Mapping

↓

Network Graph

↓

Mobility Entity

↓

Mobility State

↓

Simulation

```


---

# 18. DATASET LIMITATION HANDLING


Masalah:


Tidak semua operator memiliki data lengkap.


Solusi:


Architecture menggunakan:


# Progressive Data Integration


---

Tahap awal:


TransJakarta


+

OpenStreetMap


---

Tahap berikutnya:


Tambah:


- KRL;
- MRT;
- LRT.


---

System tidak perlu dibangun ulang.


---

# 19. DATASET QUALITY CHECKLIST


Sebelum dataset digunakan:


Checklist:


✅ Source diketahui

✅ Format valid

✅ Coordinate valid

✅ Relationship valid

✅ Tidak duplicate

✅ Memiliki metadata

✅ Dapat direproduksi


---

# 20. AI AGENT IMPLEMENTATION RULE


AI Agent WAJIB:


Sebelum menggunakan dataset:


1. Identifikasi sumber.
2. Dokumentasikan provenance.
3. Buat parser.
4. Buat validator.
5. Simpan raw data.
6. Normalisasi.
7. Masukkan database.


---

AI Agent DILARANG:


❌ membuat dataset transportasi palsu

❌ mengisi kekurangan data dengan asumsi

❌ menghapus source metadata

❌ menggunakan scraping tanpa validasi


---

# 21. FINAL DATA PIPELINE OBJECTIVE


Pipeline harus mampu:


1.

Menerima berbagai sumber transportasi.


2.

Mengubah format berbeda menjadi satu model.


3.

Membangun database transportasi terintegrasi.


4.

Menyediakan data untuk mobility twin.


5.

Menyediakan data untuk simulation engine.


6.

Mendukung pengembangan jangka panjang.


---

# 22. FINAL STATEMENT


Kekuatan utama TRANSUM-IN NEXUS bukan hanya pada tampilan aplikasi.


Nilai utama berada pada kemampuan sistem mengubah data transportasi yang terfragmentasi menjadi:


# Unified Mobility Intelligence System


melalui:


Transit Data

+

GIS

+

Digital Twin

+

Simulation


sehingga sistem dapat memahami kondisi transportasi dan memberikan keputusan adaptif.


END OF DOCUMENT
```

---

 