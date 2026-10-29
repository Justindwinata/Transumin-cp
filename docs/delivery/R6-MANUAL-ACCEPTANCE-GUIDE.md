# R6 — Panduan demo penerimaan manual

Runtime: web `http://127.0.0.1:3000`, API `127.0.0.1:3001`, OTP `127.0.0.1:8080`, DB `127.0.0.1:5435/transum_in_nexus_product`. Gunakan snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`, tanggal `2026-10-02`, `Asia/Jakarta`.

UI saat R6 campuran Inggris/Indonesia. Panduan mempertahankan label aktual; tidak mengklaim semua UI sudah berbahasa Indonesia.

## Startup

1. Pastikan `.env` lokal terisi menurut `.env.example`; jangan salin credential ke laporan.
2. Jalankan Docker dan mulai container produk yang sudah tersedia; jangan `db:reset`, jangan hapus volume.
3. Jalankan `pnpm otp:start` untuk graph yang sudah tersedia, bukan `otp:build`.
4. Jalankan `pnpm dev`. Biarkan proses berjalan selama demo.
5. Periksa `curl http://127.0.0.1:3001/health/ready` (`ready`, database `up`, PostGIS `available`) dan `pnpm otp:health`.

Untuk mesin baru: ikuti `docs/prototype-v1/DATABASE-AND-RUNTIME-BOOTSTRAP.md`. Source release tidak memuat database atau OTP graph.

## Planning, preferensi, peta

1. Buka web dengan sesi browser baru. Di `From`, pilih `Place`, cari halte/stasiun. Di `To`, pilih `Map pin`, lalu klik peta; koordinat adalah fallback alamat, bukan hasil geocoding.
2. Atur `Depart (Jakarta time)` ke `2026-10-02` dalam jadwal historis. Klik `Find journeys`.
3. Ubah `Rank by`: `Fastest`, `Balanced`, `Least walking`, `Fewest transfers`. Bandingkan durasi, transfer, dan jarak jalan aktual. Pemenang sama dapat sah; `Easiest among shown` hanya membandingkan kandidat yang dikembalikan.
4. Klik kandidat; periksa timeline dan rute peta sesuai kandidat. Bila walking schematic, caveat tetap tampil.
5. Demo cepat tanpa pencarian: `Load presentation scenario (Gambir → Pejaten, route 6H)` memuat skenario terkontrol historis, bukan realtime.

## Active Journey, laporan, recovery

1. Klik `Mulai Perjalanan`. Aktifkan lokasi hanya dengan persetujuan. GPS otomatis browser tetap `SIMULATED`; GPS ponsel nyata mengikuti panduan terpisah.
2. Periksa kartu navigasi: instruksi WALK hanya dari OTP steps; kualitas GPS tidak cukup berarti tidak ada progres otomatis. Boarding/alighting tetap konfirmasi manual.
3. Selesaikan segmen melalui kontrol progress yang sesuai. Buat laporan insiden untuk segmen tersisa; hasil harus `REPORTED_UNVERIFIED`, bukan penutupan resmi.
4. Review terkendali memerlukan operator/endpoint protected; token tidak ditampilkan dan tidak dimasukkan ke UI penumpang. Output review/alert demo berlabel `SIMULATED`.
5. Minta alternatif, terima proposal valid. Periksa completed history tetap, itinerary baru tampil pada peta/timeline/kartu navigasi. Refresh, lanjutkan, selesaikan, refresh lagi; status selesai harus bertahan.
6. Buka panel penyedia; klik `Salin tujuan` dengan sengaja. Tautan Gojek/Grab/Bluebird hanya beranda resmi. Tidak ada booking, ETA, tarif, atau availability yang dikonfirmasi.

## Reproduksi otomatis yang dapat diulang

Jalankan browser serial, bukan bersamaan. Harness dapat membuat journey/report demo; tidak melakukan reset database produk. CP2/CP3 menggunakan scratch milik invokasi dan harus melaporkan `DROP_SUCCESS`.

```sh
node apps/web/scripts/passenger-r4-f01-f02-acceptance.mjs
node apps/web/scripts/passenger-g2-preferences-acceptance.mjs
node apps/web/scripts/passenger-gps-browser-acceptance.mjs
pnpm data:cp2:isolated-browser
pnpm data:cp3:recovery
node apps/web/scripts/passenger-r1-full-workflow.mjs
node apps/web/scripts/passenger-r4-f06-handoff-acceptance.mjs
```

R6 walkthrough baru: `.release-evidence/r6-walkthrough.log`, 20/20, snapshot sama; screenshot lokal `.release-evidence/R6/walkthrough/`. Log/screenshot tidak termasuk source package. Browser R2, hardware GPS, dan S09 tetap `NOT_VERIFIED` hingga bukti khusus tersedia.
