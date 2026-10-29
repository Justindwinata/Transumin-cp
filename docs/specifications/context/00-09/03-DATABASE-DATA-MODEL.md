 
# FILE 03 — DATABASE & DATA MODEL FINAL

Nama file:

```text
03-DATABASE-DATA-MODEL-FINAL.md
```

Sebelum saya memberikan isi dokumen, saya ingin menjelaskan pendekatan yang saya gunakan.

Dokumen database ini **tidak boleh dibuat hanya sebagai daftar tabel**.

Untuk TRANSUM-IN NEXUS, database adalah fondasi utama karena:

- aplikasi ini bergantung pada kualitas data transportasi;
- fitur mobility twin bergantung pada representasi entity yang benar;
- flood intelligence bergantung pada hubungan spasial;
- simulation engine bergantung pada kemampuan membuat kondisi jaringan sebelum dan sesudah gangguan;
- AI Copilot hanya dapat memberikan jawaban jika sumber datanya terstruktur.

Jadi desain database harus mendukung:

```
REAL WORLD TRANSPORT SYSTEM

↓

DIGITAL REPRESENTATION

↓

ANALYSIS

↓

SIMULATION

↓

USER DECISION
```

Saya juga mempertimbangkan beberapa hal:

1. **GTFS Standard**
   
Karena transportasi publik seperti TransJakarta, MRT, KRL, dan operator lain banyak menggunakan konsep GTFS.

2. **GIS Requirement**

Karena aplikasi membutuhkan:
- lokasi halte;
- stasiun;
- jalur;
- area banjir;
- hubungan spasial.

Maka PostgreSQL + PostGIS tetap menjadi keputusan final.

3. **Digital Twin Requirement**

Database tidak hanya menyimpan data statis, tetapi juga:

- kondisi entity;
- perubahan state;
- history;
- timestamp.

4. **Simulation Requirement**

Database harus mampu menyimpan:

- scenario;
- input;
- hasil simulasi;
- impact analysis.

5. **AI Requirement**

AI tidak menyimpan knowledge sendiri.

AI mengambil informasi dari structured data.

---

Berikut dokumen finalnya.

---

# TRANSUM-IN NEXUS

# DATABASE & DATA MODEL SPECIFICATION

Version:

1.0.0


Status:

FROZEN DATABASE FOUNDATION


Audience:

- AI Coding Agent
- Backend Engineer
- Data Engineer
- Research Engineer


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan rancangan database dan data model TRANSUM-IN NEXUS.


Tujuan dokumen:

- menentukan struktur penyimpanan data;
- menentukan hubungan antar entity;
- memastikan data dapat mendukung seluruh fitur;
- menjadi blueprint implementasi PostgreSQL + PostGIS.


AI Agent WAJIB membaca dokumen ini sebelum:

- membuat migration;
- membuat schema;
- membuat ORM model;
- membuat API database.


---

# 2. DATABASE ARCHITECTURE DECISION


## Primary Database


# PostgreSQL


Alasan:


PostgreSQL dipilih karena:

- mature;
- relational consistency;
- cocok untuk data transportasi;
- mendukung query kompleks.


---

## Spatial Extension


# PostGIS


PostGIS digunakan karena TRANSUM-IN NEXUS membutuhkan:


- geographic coordinate;
- spatial relationship;
- distance calculation;
- intersection query;
- area analysis.


---

# 3. DATABASE DESIGN PRINCIPLE


## Principle 1

## Real World Representation


Database harus merepresentasikan objek nyata.


Contoh:


Dunia nyata:

```
Stasiun Manggarai
```


Database:


```
station

id:
STA001

name:
Manggarai

location:
POINT(...)
```


---

# Principle 2

## Data Provenance


Setiap data eksternal wajib memiliki informasi:


- sumber;
- versi;
- waktu update;
- tingkat kepercayaan.


Contoh:


```
Source:
TransJakarta Official GTFS

Version:
2026

Confidence:
HIGH
```


---

# Principle 3

## Separation Between Static and Dynamic Data


Data dibagi:


## Static Data

Data yang jarang berubah:

- operator;
- route;
- station;
- schedule.


## Dynamic Data

Data yang berubah:


- disruption;
- flood event;
- mobility state;
- simulation result.


---

# 4. HIGH LEVEL DATABASE STRUCTURE


Database memiliki 6 domain utama:


```
TRANSIT DOMAIN

+

SPATIAL DOMAIN

+

MOBILITY TWIN DOMAIN

+

DISRUPTION DOMAIN

+

SIMULATION DOMAIN

+

USER DOMAIN

```


---

# 5. ENTITY RELATIONSHIP OVERVIEW


```
                 OPERATOR

                    |

                    |

                  ROUTE

                    |

        +-----------+-----------+

        |                       |

      STOP                  TRIP


        |

     LOCATION



```


Mobility:


```
TRANSIT ENTITY

        |

        |

MOBILITY STATE

        |

        |

DISRUPTION EVENT

```


Simulation:


```
FLOOD EVENT

      |

      |

SCENARIO

      |

      |

SIMULATION RESULT

```


---

# 6. TRANSIT DOMAIN


Domain ini menyimpan seluruh data transportasi publik.


---

# TABLE 1

# operator


## Purpose


Menyimpan operator transportasi.


Contoh:


- TransJakarta
- KRL
- MRT
- LRT


---

Schema:


| Column | Type | Description |
|-|-|-|
| id | UUID | Primary key |
| name | VARCHAR | Nama operator |
| code | VARCHAR | Kode operator |
| type | VARCHAR | BUS/RAIL |
| source_id | UUID | Dataset source |
| created_at | TIMESTAMP | waktu dibuat |


---

Example:


```
id:

TJ001


name:

TransJakarta


type:

BUS

```


---

# TABLE 2

# route


## Purpose


Menyimpan jalur transportasi.


---

Schema:


| Column | Type |
|-|-|
| id | UUID |
| operator_id | UUID |
| route_code | VARCHAR |
| route_name | VARCHAR |
| route_type | VARCHAR |


---

Relationship:


```
operator

1

|

N

route

```


---

# TABLE 3

# station


## Purpose


Menyimpan stasiun atau hub.


Contoh:


- Manggarai
- Sudirman
- Dukuh Atas


---

Schema:


| Column | Type |
|-|-|
| id | UUID |
| name | VARCHAR |
| location | GEOMETRY(Point) |
| parent_station_id | UUID |
| source_id | UUID |


---

Spatial:


```
location:

POINT(latitude longitude)

```


---

# TABLE 4

# stop


## Purpose


Menyimpan titik pemberhentian.


Contoh:


- halte;
- shelter;
- stop point.


---

Schema:


| Column | Type |
|-|-|
| id | UUID |
| station_id | UUID |
| name | VARCHAR |
| location | GEOMETRY(Point) |


---

Relationship:


```
station

1

|

N

stop

```


---

# TABLE 5

# trip


## Purpose


Representasi perjalanan kendaraan.


---

Schema:


| Column | Type |
|-|-|
| id | UUID |
| route_id | UUID |
| service_id | UUID |


---

# TABLE 6

# stop_time


## Purpose


Menyimpan jadwal kendaraan.


Schema:


| Column | Type |
|-|-|
| trip_id | UUID |
| stop_id | UUID |
| arrival_time | TIME |
| departure_time | TIME |


---

# 7. SPATIAL DOMAIN


Domain GIS.


---

# TABLE 7

# geometry_entity


## Purpose


Menyimpan informasi geografis.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| entity_type | VARCHAR |
| geometry | GEOMETRY |
| source_id | UUID |


---

Entity:


- station;
- route;
- road;
- flood area.


---

# TABLE 8

# road_segment


## Purpose


Menyimpan jaringan jalan.


Digunakan untuk:


- walking;
- accessibility;
- flood impact.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| geometry | LINESTRING |
| road_name | VARCHAR |


---

# 8. MOBILITY TWIN DOMAIN


Ini adalah komponen utama penelitian.


---

# TABLE 9

# mobility_entity


## Purpose


Representasi digital setiap objek transportasi.


Contoh:


```
Station Manggarai

Route TJ001

Road Segment X

```


Schema:


| Column | Type |
|-|-|
| id | UUID |
| entity_type | VARCHAR |
| reference_id | UUID |
| current_state | VARCHAR |
| updated_at | TIMESTAMP |


---

State:


```
NORMAL

DISRUPTED

SIMULATED

UNKNOWN

```


---

# TABLE 10

# mobility_state_history


## Purpose


Menyimpan perubahan kondisi.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| entity_id | UUID |
| previous_state | VARCHAR |
| new_state | VARCHAR |
| reason | TEXT |
| timestamp | TIMESTAMP |


---

Contoh:


```
NORMAL

↓

DISRUPTED

Reason:

Flood Event

```


---

# 9. DISRUPTION DOMAIN


---

# TABLE 11

# flood_event


## Purpose


Menyimpan kejadian banjir.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| location | GEOMETRY(Point) |
| radius | INTEGER |
| severity | VARCHAR |
| start_time | TIMESTAMP |
| end_time | TIMESTAMP |


---

Severity:


```
LOW

MEDIUM

HIGH

CRITICAL

```


---

# TABLE 12

# disruption_impact


## Purpose


Menyimpan dampak gangguan.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| flood_event_id | UUID |
| affected_entity | UUID |
| impact_level | VARCHAR |


---

Contoh:


```
Flood Event:

Manggarai


Impact:

Station affected

```


---

# 10. SIMULATION DOMAIN


---

# TABLE 13

# simulation_scenario


## Purpose


Menyimpan skenario simulasi.


Contoh:


"Jika Manggarai banjir 3 jam"


Schema:


| Column | Type |
|-|-|
| id | UUID |
| name | VARCHAR |
| scenario_type | VARCHAR |
| input_data | JSONB |


---

# TABLE 14

# simulation_result


## Purpose


Menyimpan hasil simulasi.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| scenario_id | UUID |
| affected_routes | JSONB |
| affected_stops | JSONB |
| impact_summary | JSONB |


---

# 11. USER DOMAIN


---

# TABLE 15

# user


Schema:


| Column | Type |
|-|-|
| id | UUID |
| email | VARCHAR |
| password_hash | VARCHAR |
| role | VARCHAR |


---

# TABLE 16

# journey


Menyimpan perjalanan pengguna.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| user_id | UUID |
| origin | JSONB |
| destination | JSONB |
| result | JSONB |


---

# TABLE 17

# recovery_plan


Menyimpan alternatif perjalanan.


Schema:


| Column | Type |
|-|-|
| id | UUID |
| journey_id | UUID |
| reason | TEXT |
| alternative | JSONB |


---

# 12. DATASET MANAGEMENT


Penting untuk menjaga kualitas dataset.


---

# TABLE 18

# dataset_source


Schema:


| Column | Type |
|-|-|
| id | UUID |
| name | VARCHAR |
| url | TEXT |
| license | VARCHAR |


---

# TABLE 19

# dataset_version


Schema:


| Column | Type |
|-|-|
| id | UUID |
| source_id | UUID |
| version | VARCHAR |
| imported_at | TIMESTAMP |


---

# 13. MIGRATION ORDER


AI Agent WAJIB membuat migration dengan urutan:


```
1.

dataset_source


2.

operator


3.

route


4.

station


5.

stop


6.

trip


7.

stop_time


8.

spatial tables


9.

mobility tables


10.

disruption tables


11.

simulation tables


12.

user tables

```


---

# 14. INDEX STRATEGY


Wajib menggunakan index pada:


Spatial:


```
GIST(location)

```


Search:


```
route_code

station_name

operator_name

```


---

# 15. DATABASE SECURITY


Requirement:


- migration controlled;
- no direct production modification;
- backup;
- environment separation.


---

# 16. AI AGENT IMPLEMENTATION RULE


AI Agent harus:


1. Membuat schema berdasarkan dokumen ini.
2. Membuat migration bertahap.
3. Membuat seed hanya untuk development.
4. Menjaga relationship.
5. Menambahkan dokumentasi.


---

AI Agent dilarang:


- membuat database tanpa desain;
- menggunakan JSON untuk seluruh database;
- menghilangkan spatial capability;
- membuat data palsu sebagai production.



---

# 17. FINAL DATABASE OBJECTIVE


Database TRANSUM-IN NEXUS harus mampu menjawab:


1.

Transportasi apa yang tersedia?


2.

Dimana lokasi objek transportasi?


3.

Bagaimana hubungan antar objek?


4.

Apa kondisi jaringan saat ini?


5.

Apa dampak jika terjadi gangguan?


6.

Bagaimana alternatif perjalanan?


---

# FINAL STATEMENT


Database TRANSUM-IN NEXUS bukan hanya tempat menyimpan data.


Database adalah fondasi Digital Mobility Twin yang memungkinkan sistem memahami, menganalisis, dan melakukan adaptasi terhadap perubahan kondisi transportasi.


END OF DOCUMENT

```

---
 