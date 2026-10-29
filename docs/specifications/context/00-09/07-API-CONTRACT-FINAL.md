 

# FILE 07 — API CONTRACT FINAL

Nama file:

```text
07-API-CONTRACT-FINAL.md
```

Saya akan membuat dokumen ini dengan standar **Software Architecture API Specification**, bukan hanya daftar endpoint.

Alasan:

Dalam TRANSUM-IN NEXUS, API adalah **jembatan utama** antara:

```text
Student A Intelligence Layer

        ↓

Backend Service Layer

        ↓

Student B Product Layer

        ↓

Frontend User Experience
```

Tanpa API contract yang jelas, masalah yang sering terjadi:

- frontend tidak tahu format data backend;
- Student A mengubah struktur data tanpa mempertimbangkan dampak;
- AI Agent membuat endpoint duplikat;
- business logic tersebar;
- integrasi menjadi sulit;
- fitur terlihat berjalan tetapi architecture buruk.


Dokumen ini akan menjadi kontrak bahwa:

- setiap module memiliki tanggung jawab;
- setiap data memiliki format jelas;
- setiap service dapat berkembang secara independen.


---

# TRANSUM-IN NEXUS

# API CONTRACT SPECIFICATION DOCUMENT

Version:

1.0.0


Status:

FROZEN API FOUNDATION


Audience:

- AI Coding Agent
- Backend Engineer
- Frontend Engineer
- Data Engineer
- Research Engineer


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan standar komunikasi antar komponen sistem TRANSUM-IN NEXUS.


API Contract digunakan sebagai acuan untuk:

- backend implementation;
- frontend integration;
- mobility intelligence integration;
- AI integration;
- testing.


---

# 2. API DESIGN PRINCIPLE


TRANSUM-IN NEXUS menggunakan prinsip:


# Domain Driven API Design


Setiap API merepresentasikan domain bisnis.


Bukan:


```text
/random-endpoint

/getEverything

```


Tetapi:


```text
/journey

/mobility

/disruption

/simulation

/copilot

```


---

# 3. API ARCHITECTURE


High level:


```text
                 FRONTEND


                    |

                    |

              API GATEWAY


                    |

    +---------------+---------------+

    |               |               |


 Journey        Mobility        AI


 Service        Service        Service


    |               |

    |               |

 Transit       Simulation

 Data          Engine


```


---

# 4. API STANDARD


## Base URL


Development:


```
http://localhost:3000/api/v1
```


Production:


```
https://api.transumin.com/api/v1
```


---

# 5. RESPONSE STANDARD


Semua API menggunakan format:


```json
{
  "success": true,
  "data": {},
  "message": "",
  "timestamp": ""
}
```


---

# Error Response


```json
{
  "success": false,
  "error": {
    "code": "",
    "message": ""
  },
  "timestamp": ""
}
```


---

# 6. AUTHENTICATION


Metode:


JWT Authentication


---

Protected endpoint:


Menggunakan:


```
Authorization: Bearer TOKEN
```


---

# 7. API MODULE STRUCTURE


API dibagi menjadi:


```text
/v1


/auth

/transit

/journey

/mobility

/disruption

/simulation

/recovery

/copilot

/user

```


---

# 8. AUTH MODULE API


Owner:

Student B


Purpose:

Mengelola pengguna.


---

# POST /auth/register


## Description


Membuat akun baru.


Request:


```json
{
 "email":"user@email.com",
 "password":"password"
}
```


Response:


```json
{
 "userId":"uuid",
 "email":"user@email.com"
}
```


---

# POST /auth/login


## Description


Login user.


Request:


```json
{
 "email":"",
 "password":""
}
```


Response:


```json
{
 "accessToken":"",
 "user":{
   "id":"",
   "email":""
 }
}
```


---

# 9. TRANSIT MODULE API


Owner:

Student A


Purpose:


Menyediakan data transportasi.


---

# GET /transit/operators


Description:


Mengambil daftar operator.


Response:


```json
{
"operators":[
 {
  "id":"TJ",
  "name":"TransJakarta",
  "type":"BUS"
 }
]
}
```


---

# GET /transit/routes


Query:


```
operatorId
```


Response:


```json
{
"routes":[
 {
  "id":"",
  "name":"",
  "operator":""
 }
]
}
```


---

# GET /transit/stops


Description:


Mengambil halte/stasiun.


Query:


```
lat

lon

radius
```


Response:


```json
{
"stops":[
 {
  "id":"",
  "name":"",
  "location":{
   "lat":"",
   "lon":""
  }
 }
]
}
```


---

# 10. JOURNEY MODULE API


Owner:

Student B


Purpose:


Menyediakan perjalanan multimoda.


---

# POST /journey/plan


## Description


Membuat rekomendasi perjalanan.


---

Request:


```json
{
"origin":{
 "lat":-6.2,
 "lon":106.8
},

"destination":{
 "lat":-6.1,
 "lon":106.8
},

"preference":
"fastest"

}
```


---

Process:


```text
Input Location

↓

Find Nearby Transit

↓

Generate Graph

↓

Calculate Journey

↓

Rank Result

↓

Return Options

```


---

Response:


```json
{
"journeys":[

{
"id":"J001",

"duration":90,

"transfers":2,


"segments":[

{
"type":"BUS",
"route":"TJ001"
},

{
"type":"TRAIN",
"route":"KRL"
}

]

}

]
}
```


---

# Journey Preference


Allowed:


```text
fastest

fewest_transfer

least_walking

simplest
```


---

# 11. MOBILITY TWIN API


Owner:

Student A


Purpose:


Mengakses kondisi digital network.


---

# GET /mobility/entities


Description:


Mengambil entity jaringan.


Response:


```json
{

"entities":[

{

"id":"STA001",

"type":"STATION",

"state":"NORMAL"

}

]

}
```


---

# GET /mobility/state/{id}


Description:


Melihat kondisi entity tertentu.


Response:


```json
{

"id":"STA001",

"state":"DISRUPTED",

"reason":"Flood"

}
```


---

# 12. DISRUPTION MODULE API


Owner:

Student A


Purpose:


Mengelola gangguan.


---

# POST /disruption/flood


Description:


Membuat event banjir.


Request:


```json
{

"location":{
"lat":"",
"lon":""
},

"radius":500,

"severity":"HIGH"

}
```


---

Response:


```json
{

"id":"F001",

"status":"ACTIVE"

}
```


---

# GET /disruption/active


Description:


Mengambil gangguan aktif.


Response:


```json
{

"events":[

{

"id":"F001",

"type":"FLOOD",

"severity":"HIGH"

}

]

}
```


---

# 13. FLOOD IMPACT API


Owner:

Student A


Purpose:


Melihat dampak gangguan.


---

# GET /disruption/{id}/impact


Response:


```json
{

"affectedRoutes":[

"TJ001"

],

"affectedStations":[

"Manggarai"

],

"impactLevel":

"HIGH"

}
```


---

# 14. SIMULATION MODULE API


Owner:

Student A


Purpose:


Melakukan simulasi kondisi.


---

# POST /simulation/run


Request:


```json
{

"name":

"Manggarai Flood Scenario",


"event":

{

"type":"FLOOD",

"location":""

}

}
```


---

Response:


```json
{

"simulationId":"SIM001",

"result":

{

"affectedNodes":20,

"affectedRoutes":5

}

}
```


---

# 15. RECOVERY MODULE API


Owner:

Student B


Purpose:


Memberikan alternatif perjalanan.


---

# POST /recovery/generate


Request:


```json
{

"journeyId":"J001",

"disruptionId":"F001"

}
```


---

Response:


```json
{

"original":

"TJ001",

"alternative":

"MRT + BUS",

"additionalTime":

20

}
```


---

# 16. AI COPILOT API


Owner:

Student B


Purpose:


Memberikan penjelasan.


---

# POST /copilot/chat


Request:


```json
{

"question":

"Kenapa rute berubah?",


"contextId":

"J001"

}
```


---

Internal flow:


```text
User Question

↓

Retrieve System Result

↓

Generate Explanation

↓

Return Answer

```


---

Response:


```json
{

"answer":

"Rute berubah karena area terdampak banjir."


}
```


---

# 17. API DATA OWNERSHIP


| API Domain | Owner |
|-|-|
| Auth | Student B |
| Transit | Student A |
| Journey | Student B |
| Mobility Twin | Student A |
| Flood | Student A |
| Simulation | Student A |
| Recovery | Student B |
| Copilot | Student B |


---

# 18. API DEPENDENCY RULE


Dependency:


```text
Transit

↓

Mobility Twin

↓

Disruption

↓

Simulation

↓

Recovery

↓

Copilot

```


---

AI Agent tidak boleh membuat:


Recovery sebelum ada:


- Journey model;
- disruption model.


---

# 19. VERSIONING RULE


API menggunakan:


```
/api/v1
```


Jika perubahan besar:


```
/api/v2
```


---

# 20. VALIDATION RULE


Semua request wajib:


- schema validation;
- type validation;
- error handling.


---

Contoh:


Location:


Tidak boleh:


```json
{
"lat":"abc"
}
```


---

# 21. LOGGING RULE


API penting harus memiliki:


- request log;
- error log;
- execution time.


---

# 22. TESTING REQUIREMENT


Setiap API wajib memiliki:


## Unit Test


Untuk:


service logic.


---

## Integration Test


Untuk:


API + database.


---

## Contract Test


Untuk:


frontend/backend compatibility.


---

# 23. AI AGENT IMPLEMENTATION RULE


Sebelum membuat endpoint:


AI Agent wajib:


1. cek ownership;
2. cek dependency;
3. cek database model;
4. buat DTO;
5. buat validation;
6. buat test.


---

AI Agent dilarang:


❌ membuat endpoint tanpa kebutuhan product

❌ membuat response tidak konsisten

❌ memasukkan business logic di controller

❌ membuat AI menjadi sumber keputusan utama


---

# 24. FINAL API OBJECTIVE


API TRANSUM-IN NEXUS harus menjadi:


# Communication Layer Between Mobility Intelligence and Human Experience


Menghubungkan:


```text
Real Transportation Data

↓

Intelligence Engine

↓

Application Backend

↓

User Interface

↓

Human Decision

```


---

# FINAL STATEMENT


API TRANSUM-IN NEXUS bukan hanya kumpulan endpoint.


API merupakan kontrak antara:


- data;
- intelligence;
- product;
- user.


Dengan API architecture yang baik, TRANSUM-IN NEXUS dapat berkembang menjadi platform mobility intelligence yang scalable.


END OF DOCUMENT
```
 