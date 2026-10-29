 

# FILE 08 — UI/UX DESIGN GUIDELINE FINAL

Nama file:

```text
08-UI-UX-DESIGN-GUIDELINE-FINAL.md
```

---

Sebelum masuk ke isi dokumen, saya ingin menjelaskan pendekatan pembuatannya.

Dokumen UI/UX ini **bukan dokumen desain biasa** yang hanya menjelaskan:

- warna;
- font;
- tombol;
- layout.


Untuk TRANSUM-IN NEXUS, UI/UX adalah bagian penting dari value product karena produk ini berhadapan langsung dengan masalah manusia:

> "Saya sedang bepergian, saya bingung, saya butuh keputusan cepat."

Maka desain harus menjawab:

- bagaimana pengguna memahami kondisi perjalanan dalam beberapa detik;
- bagaimana pengguna tidak merasa overwhelmed dengan banyak moda transportasi;
- bagaimana informasi kompleks (rute, transit, banjir, recovery) diterjemahkan menjadi pengalaman sederhana;
- bagaimana aplikasi terasa seperti produk teknologi modern, bukan dashboard akademik.


Prinsip utama:

```text
Complex Transportation Intelligence

↓

Simple Human Decision Experience
```


AI Agent harus memahami:

TRANSUM-IN NEXUS bukan dibuat seperti:

❌ dashboard monitoring pemerintah  
❌ aplikasi tabel transportasi  
❌ clone Google Maps  
❌ chatbot dengan peta  


Tetapi:

✅ immersive mobility assistant  
✅ intelligent navigation experience  
✅ human-centered transportation platform


---

# TRANSUM-IN NEXUS

# UI/UX DESIGN GUIDELINE DOCUMENT

Version:

1.0.0


Status:

FROZEN DESIGN FOUNDATION


Audience:

- AI Coding Agent
- Frontend Engineer
- UI/UX Designer
- Product Owner


---

# 1. DOCUMENT PURPOSE


Dokumen ini mendefinisikan standar UI/UX TRANSUM-IN NEXUS.


Tujuan:

- memastikan frontend memiliki kualitas product;
- menjaga konsistensi desain;
- memberikan arahan kepada AI Agent;
- mencegah hasil UI generik;
- memastikan pengalaman pengguna sesuai tujuan aplikasi.


---

AI Agent WAJIB memahami:


UI bukan hanya tampilan.


UI adalah cara pengguna memahami intelligence system.


---

# 2. DESIGN VISION


## Product Experience Statement


TRANSUM-IN NEXUS harus terasa seperti:


> "A personal intelligent mobility companion that guides users through complex urban transportation."


---

Pengguna tidak boleh merasa:

"Saya sedang menggunakan sistem yang rumit."


Tetapi:

"Sistem ini memahami perjalanan saya dan membantu saya mengambil keputusan."


---

# 3. CORE UX PRINCIPLE


# Principle 1

# Map First Experience


Peta adalah elemen utama.


Alasan:


Transportasi adalah masalah spasial.


Pengguna perlu memahami:


- dimana saya berada;
- kemana saya pergi;
- dimana harus berpindah;
- area mana yang terganggu.


---

Layout utama:


```text
+--------------------------------+

| Search Destination             |

+--------------------------------+

|                                |

|                                |

|             MAP                |

|                                |

|                                |

+--------------------------------+

| Journey Information Panel      |

+--------------------------------+

```


---

# Principle 2

# Progressive Disclosure


Jangan menampilkan semua informasi sekaligus.


Informasi diberikan bertahap.


Contoh:


Level 1:


"Gunakan KRL + TransJakarta"


Level 2:


"Transit di Manggarai"


Level 3:


"Keluar Exit B, berjalan 200 meter"


---

# Principle 3

# Decision First


Aplikasi harus membantu keputusan.


Bukan memberikan data mentah.


---

Buruk:


```
Route:
TJ001

Stop:
123

Schedule:
10:30
```


---

Baik:


```
Pilihan terbaik untuk Anda:

TransJakarta + KRL

90 menit

2 transit

Risiko banjir rendah
```


---

# Principle 4

# Trust Through Explanation


Karena sistem menggunakan AI dan intelligence:


Pengguna harus memahami alasan.


Contoh:


"Berdasarkan kondisi jaringan saat ini, rute berubah karena area Manggarai terdampak banjir."


---

# 4. VISUAL DESIGN DIRECTION


## Design Character


TRANSUM-IN NEXUS harus memiliki karakter:


- modern;
- intelligent;
- trustworthy;
- clean;
- professional.


---

Inspirasi:


- Google Maps clarity;
- Apple Maps simplicity;
- Tesla navigation;
- modern SaaS product.


---

Namun:


Tidak boleh melakukan copy design.


---

# 5. COLOR SYSTEM


## Primary Theme


Mobility Intelligence Theme


---

Primary:


Deep Blue


Makna:

- trust;
- technology;
- transportation.


---

Secondary:


Teal / Cyan


Makna:

- intelligence;
- real-time information.


---

Accent:


Amber / Orange


Digunakan untuk:


- warning;
- disruption;
- flood.


---

Danger:


Red


Hanya untuk:


- critical disruption.


---

# 6. TYPOGRAPHY


Principle:


Readable first.


---

Recommended:


Sans-serif modern:


Contoh:

- Inter
- Geist
- SF Pro style


---

Hierarchy:


## Heading


Untuk:


- destination;
- journey title.


---

## Body


Untuk:


- explanation;
- instruction.


---

## Metadata


Untuk:


- duration;
- distance;
- confidence.


---

# 7. MAIN APPLICATION STRUCTURE


TRANSUM-IN NEXUS memiliki halaman utama:


---

# PAGE 1

# Landing Page


Purpose:


Menjelaskan product value.


---

Content:


Hero:


```
Navigate Jakarta Smarter.

Even When The City Changes.
```


---

Feature highlights:


- multimodal journey;
- flood-aware routing;
- intelligent recovery.


---

CTA:


"Plan My Journey"


---

# PAGE 2

# Mobility Planner


CORE EXPERIENCE


---

Layout:


```text
--------------------------------

Search

--------------------------------


              MAP


--------------------------------

Route Options

--------------------------------

```


---

Components:


- origin input;
- destination input;
- preference selector.


---

# PAGE 3

# Route Selection


Menampilkan beberapa strategi.


---

Card:


```
Fastest

90 Minutes

2 Transfers

Low Flood Risk


[Choose]
```


---

Badge:


- Fastest;
- Least Walking;
- Simplest;
- Recommended.


---

# PAGE 4

# Journey Detail


Menampilkan perjalanan lengkap.


---

Timeline:


```
START

 |

Walk 300m

 |

TransJakarta

 |

Transit

 |

KRL

 |

ARRIVE

```


---

# PAGE 5

# Active Journey


Mode navigasi.


---

Menampilkan:


- current location;
- next action;
- progress.


---

Contoh:


```
Next:

Exit Station

Walk 200m

```


---

# PAGE 6

# Flood Intelligence View


Halaman khusus gangguan.


---

Menampilkan:


- flood area;
- affected route;
- alternative.


---

Example:


```
⚠ Manggarai affected

Original route unavailable

Alternative available

```


---

# PAGE 7

# AI Mobility Copilot


Chat interface.


---

Namun:


Bukan chatbot utama.


AI muncul sebagai assistant.


---

Example:


User:


"Kenapa saya harus pindah rute?"


AI:


"Karena jalur sebelumnya mengalami gangguan banjir."


---

# 8. MAP DESIGN GUIDELINE


Map adalah core component.


---

Map harus mendukung:


## Normal State


Menampilkan:


- route;
- station;
- user location.


---

## Disruption State


Menampilkan:


- flood zone;
- blocked route;
- alternative path.


---

Visual:


Normal:


Blue route


Warning:


Orange


Critical:


Red


---

# 9. ANIMATION GUIDELINE


Animation digunakan untuk membantu pemahaman.


Bukan dekorasi.


---

Allowed:


## Route Transition


Ketika user memilih rute.


---

## Vehicle Movement


Untuk simulasi.


---

## State Change


Normal:


↓

Disrupted


---

Forbidden:


❌ excessive animation

❌ loading animation tanpa fungsi

❌ efek berlebihan


---

# 10. RESPONSIVE DESIGN


Platform utama:


Web.


Tetapi harus responsive.


---

Desktop:


Memanfaatkan:


- sidebar;
- large map.


---

Tablet:


Balanced layout.


---

Mobile:


Map dominant.


---

# 11. COMPONENT DESIGN SYSTEM


Komponen harus reusable.


---

Contoh:


## Journey Card


Dipakai:


- route selection;
- recommendation.


---

## Status Badge


Dipakai:


- normal;
- warning;
- disruption.


---

## Timeline Component


Dipakai:


- journey detail.


---

## Map Layer Component


Dipakai:


- route;
- flood;
- simulation.


---

# 12. ACCESSIBILITY REQUIREMENT


UI harus mempertimbangkan:


- readable text;
- sufficient contrast;
- keyboard navigation;
- clear icons.


---

# 13. AI AGENT FRONTEND RULE


AI Agent wajib:


Sebelum membuat UI:


1. memahami user flow;
2. memahami information hierarchy;
3. membuat component structure.


---

AI Agent dilarang:


❌ membuat template dashboard

❌ menggunakan terlalu banyak card

❌ membuat UI berdasarkan prompt visual saja

❌ menghasilkan design generik AI


---

# 14. UI QUALITY CHECKLIST


Sebelum halaman dianggap selesai:


Checklist:


```
[ ] Responsive

[ ] Tidak terlihat template

[ ] User flow jelas

[ ] Informasi prioritas jelas

[ ] Animation memiliki tujuan

[ ] Component reusable

[ ] Error state tersedia

```


---

# 15. FINAL UI/UX OBJECTIVE


TRANSUM-IN NEXUS harus memberikan pengalaman:


Dari:


"Transportasi Jakarta itu membingungkan."


Menjadi:


"Sistem memahami kondisi perjalanan saya dan memberikan keputusan terbaik."


---

# FINAL STATEMENT


UI/UX TRANSUM-IN NEXUS bukan hanya lapisan visual.


UI adalah jembatan antara:


```text
Complex Mobility Intelligence

↓

Human Understanding

↓

Better Travel Decision
```


Desain harus selalu mendukung tujuan utama:


# Making Urban Mobility Simple, Adaptive, and Intelligent.


END OF DOCUMENT
```

---

 