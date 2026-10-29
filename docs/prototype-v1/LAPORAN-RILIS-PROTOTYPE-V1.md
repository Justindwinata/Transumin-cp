# Laporan Rilis Prototype V1

Tanggal: 2026-10-14. Klasifikasi: `PROTOTYPE_V1_PARTIAL`. Semua status memakai nilai pasti: `PASS`, `FAIL`, `BLOCKED_BY_DATA`, `BLOCKED_BY_AUTHORIZATION`, `BLOCKED_BY_ENVIRONMENT`, `NOT_RUN`, `NOT_VERIFIED`. Tidak ada `PASS` tanpa bukti yang benar-benar dijalankan.

## Ringkasan

- Branch: `prototype-v1` (PRIVATE) di `https://github.com/Justindwinata/TRANSUMIN-NEXUS.git`.
- SHA kode checkpoint G5: `31772e2ddc0ba7815e20a4bc9babab56cd14c922`; bukan SHA rilis dokumentasi.
- SHA rilis dokumentasi R5, lokal = remote saat preflight R6: `b46de42306960d8b6876243833089f6eb3b67d7a`. Commit ini hanya mengubah empat dokumen, tanpa kode executable. Hasil uji sebelumnya tidak diklaim dijalankan pada SHA ini.
- SHA final R6, lokal = remote: `c921fb895154c712de0dbd52c526b6741187e1db`; commit/push tanpa force, repo diverifikasi PRIVATE.
- ZIP source di `/Users/justindwinata/Developer/TRANSUMIN-NEXUS-PRODUCT/.release-evidence/source-release/transum-in-nexus-source-c921fb895154.zip`, SHA-256 `1f117c315da05b6d47f570172bc6c0d90056e86b04ae2626757db62c352512c2`; 376 file tracked, allowlist dan secret scan PASS. Arsip mengikuti commit sebelum metadata final ini; source code sama, dokumen laporan dapat bertambah setelah commit.
- Commit checkpoint ini: `06fa181` (G1 lineage/guard), `a40c19b` (pengerasan G1/G2 + bukti F-03), `31772e2` (G4 LEVEL 1 + rerun terintegrasi G5).
- Pohon kerja bersih setelah push. Tanpa force-push, tanpa tulis ulang riwayat, tanpa penghapusan destruktif.
- Runtime uji: API `127.0.0.1:3001`, proxy web `127.0.0.1:3000`, OTP `2.10.0` `127.0.0.1:8080`, snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`, tanggal layanan `2026-10-02`, zona `Asia/Jakarta`.
- Database produk `127.0.0.1:5435/transum_in_nexus_product` tidak diubah oleh harness isolasi; setiap DB scratch milik invokasi dihapus dengan `DROP_SUCCESS`.

## R6 verification delta

- Runtime aktual di-boot ulang: API health `ready`, DB/PostGIS `up`, web `200`, OTP `2.10.0` sehat. Walkthrough Playwright segar 20/20 (`.release-evidence/r6-walkthrough.log`), pada snapshot yang tercatat, dengan review terkendali `SIMULATED`; hasil tidak mengklaim fisik/realtime.
- Console desktop kosong, request awal berhasil; smoke layar 390×844: `horizontalOverflow=false`, tanpa console error/warning atau request gagal. Active Journey seluler belum diverifikasi visual penuh.
- Regresi final: `pnpm check` exit 0 (API 109/109, web 45/45, lint/typecheck, 11 kontrak, OpenAPI/types, format, API/web build); `pnpm security:scan` PASS; integrasi 9 suite / 31 tes PASS; multi-OD 11 koridor PASS. F01/F02/F04, empat preferensi G2, GPS software, M5 22/22, M6 13/13 (setelah parser harness disesuaikan format cookie), M7 20/20, G4 handoff LEVEL1 PASS. CP2 PASS; CP3 final rerun PASS dengan scratch `DROP_SUCCESS`. Rerun CP3 sebelumnya gagal `500` pada aktivasi konteks kedua; DB scratch milik invokasi tetap retained, akar sebab `NOT_VERIFIED`.
- Tambahan G1: malformed/missing walk step → skematik tanpa turn/progres GPS parsial; perubahan struktur leg memakai suffix aktif; respons R1 stale tidak menimpa R2. Tier A memperketat lineage R1/R2/R3 dan PASS 12/12. Browser dua-recovery dan expired-session Active Journey tetap `NOT_VERIFIED`.
- Paket source dibatasi ke tracked allowlist, tidak berisi `.env`, cache, dataset, screenshot/log atau runtime. ZIP/checksum saat ini lokal dan belum merepresentasikan SHA setelah perubahan working tree; harus dibuat ulang dari commit final.
- Panduan demo: `docs/delivery/R6-MANUAL-ACCEPTANCE-GUIDE.md`. Prosedur GPS fisik: `docs/delivery/PHYSICAL-GPS-USER-TEST-WORKFLOW.md`. Keputusan A–E + perbandingan provider: `docs/delivery/R6-PRODUCT-OWNER-DECISIONS.md`, `docs/delivery/R6-GEOCODER-COMPARISON.md`.

## Status per gate

| Gate                                            | Status                     | Bukti yang dijalankan                                           | Kode keluar / jumlah                      |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| G1-B lineage/konkurensi/expiry (Tier A isolasi) | `PASS` (subset)            | `pnpm --filter @transum-in/api data:lightweight-acceptance`     | exit 0; 12/12; `DROP_SUCCESS`             |
| G1-D peta/timeline/navigasi + stale race        | `PASS` (subset)            | `pnpm --filter @transum-in/api data:cp3:recovery`               | exit 0; `DROP_SUCCESS`                    |
| G1-C sesi bertanda tangan                       | `PASS`                     | `g1-session-security.test.mjs` + `g1-recovery-guards.test.mjs`  | exit 0; 11/11                             |
| G1 matriks tepi penuh                           | `NOT_VERIFIED`             | —                                                               | —                                         |
| G2 preferensi (4 preferensi)                    | `PASS`                     | `node apps/web/scripts/passenger-g2-preferences-acceptance.mjs` | exit 0; 3 kandidat; `distinct_winners: 2` |
| G2 siklus GPS                                   | `PASS`                     | `node apps/web/scripts/passenger-gps-browser-acceptance.mjs`    | exit 0                                    |
| G3 alamat ketik                                 | `BLOCKED_BY_AUTHORIZATION` | `docs/delivery/G3-GEOCODING-AUTHORIZATION-REQUEST.md`           | —                                         |
| G3 fallback pin/insiden                         | `PASS`                     | `r4-f01-f02`, `passenger-report-m5-acceptance.mjs`              | exit 0; 22/22 (m5)                        |
| G4 handoff LEVEL 0/1 + salin tujuan             | `PASS`                     | `node apps/web/scripts/passenger-r4-f06-handoff-acceptance.mjs` | exit 0; `coordinates_in_dom=false`        |
| G5 alur penuh 20 langkah (V20/S14)              | `PASS`                     | `node apps/web/scripts/passenger-r1-full-workflow.mjs`          | exit 0; 20/20                             |
| G5 terintegrasi M7                              | `PASS`                     | `node apps/web/scripts/passenger-integrated-m7-acceptance.mjs`  | exit 0; 20/20                             |
| Gerbang mutu                                    | `PASS`                     | `pnpm check`                                                    | exit 0                                    |
| Pemindaian rahasia                              | `PASS`                     | `pnpm security:scan`                                            | exit 0; 369 terlacak, 13 klien            |

Bukti tambahan seri ini: integrasi standar 9 suite / 31 tes exit 0; unit web 40/40; unit API 109/109 (seri sebelumnya 106/106); navigasi R4-F04 exit 0.

## G1 — detail yang diverifikasi

- Lineage generasi: `baseRecoveryId` disimpan saat proposal dibuat dan `predecessorRecoveryId` disimpan sebagai garis keturunan penerimaan; `recoveryId` stabil memuat sumber generasi.
- `accept()` atomik: serialisasi lewat kunci baris, penjaga `accepted_recovery_id` = basis proposal, penjaga `progress.revision`, tanpa `COALESCE`, `progress.revision` tidak naik buta.
- Ketahanan browser: proposal terlambat diabaikan setelah remount (tanpa mutasi), respons penerimaan yang hilang direkonsiliasi dari baca server otoritatif dengan tepat satu POST, riwayat WALK selesai tidak berubah, paritas digest peta dan urutan/sidik jari timeline antar generasi eksak.
- Sesi: format `owner.expiry.HMAC`, batas TTL, perbandingan konstan-waktu, gagal-tertutup sebelum permintaan ke hulu; umur kedaluwarsa yang dirusak, format lama, dan pergantian pemilik ditolak.
- Sisa: varian struktur sisa-perjalanan lain, fallback hanya skematis, `walking_steps` rusak, kedaluwarsa sesi pasca-rotasi di jalur browser, dan koridor browser dua-recovery: `NOT_VERIFIED`.

## G2 — detail yang diverifikasi

- `FASTEST` memilih durasi minimum, `LEAST_WALKING` jarak jalan minimum, `FEWEST_TRANSFERS` jumlah transit minimum; `BALANCED` dihitung ulang persis min-max 0.5/0.3/0.2 dengan pemenang = argmin.
- Perpindahan cepat berakhir pada preferensi terakhir (`FASTEST`); permintaan identik berulang menghasilkan peringkat identik.
- Keragaman tidak direkayasa: kasus pemenang identik dan kandidat tunggal dicatat apa adanya.

## G4 — detail yang diverifikasi

- Tautan resmi hanya beranda (HTTPS, `noopener noreferrer`, host statis, tanpa query/path pengalihan); tidak ada tautan dalam/API mitra, tidak ada klaim ketersediaan/tarif/pemesanan.
- Tombol "Salin tujuan" menyalin konteks tujuan (nama + koordinat) ke papan klip hanya setelah aksi pengguna; koordinat tidak pernah tampil di DOM; ada pesan jujur bila penyalinan diblokir.

## Blocker jujur (tidak diubah)

- Alamat ketik: `BLOCKED_BY_AUTHORIZATION` (tanpa penyedia/geocoder resmi; tanpa Nominatim publik).
- Integrasi penyedia pihak ketiga (ketersediaan/tarif/ETA/pemesanan/deep link): `BLOCKED_BY_DATA`/`BLOCKED_BY_AUTHORIZATION`.
- POI bernama Kemang Village/Lippo Mall Kemang (V01/S01): `BLOCKED_BY_DATA`.
- Validasi pejalan kaki V15/S11 dan handoff penuh V16/S12: `BLOCKED_BY_DATA`.
- Snapshot penuh Tier B: `BLOCKED_BY_ENVIRONMENT`.
- GPS perangkat nyata: `NOT_VERIFIED` (geolokasi otomatis `SIMULATED`).
- S09 `NO_PATH`/`NO_VALID_ALTERNATIVE`: `NOT_VERIFIED` (exit 1; OTP mengembalikan alternatif jalan + TransJakarta asli).

## Batas keselamatan dan kepatuhan

- Build sumber-sumber saja: `.env`, `.next*`, `dist`, cache, data, dan artefak runtime tidak pernah diunggah. Cocok cache dev Turbopack yang terabaikan (`CONTROLLED_REVIEW_TOKEN`, `POSTGRES_PASSWORD`) dieksklusi dan tidak boleh dipublikasikan.
- Sesi prototipe dan isolasi pemilik bukan penerimaan autentikasi produksi.
- Data bersintetis/terkendali selalu berlabel `SIMULATED`; laporan penumpang tetap `REPORTED_UNVERIFIED` sampai tinjauan terkendali (`≠` VERIFIED).

## Perintah reproduksi

```sh
pnpm check
pnpm security:scan
pnpm --filter @transum-in/api data:lightweight-acceptance
pnpm --filter @transum-in/api data:cp3:recovery
node apps/web/scripts/passenger-g2-preferences-acceptance.mjs
node apps/web/scripts/passenger-gps-browser-acceptance.mjs
node apps/web/scripts/passenger-r4-f01-f02-acceptance.mjs
node apps/web/scripts/passenger-r4-f06-handoff-acceptance.mjs
node apps/web/scripts/passenger-report-m5-acceptance.mjs
node apps/web/scripts/passenger-r1-full-workflow.mjs
node apps/web/scripts/passenger-integrated-m7-acceptance.mjs
```

## Langkah berikutnya yang diotorisasi

1. Jalankan matriks tepi G1 penuh pada scratch isolasi bila diotorisasi (varian struktur, fallback skematis, langkah rusak, kedaluwarsa sesi pasca-rotasi, koridor dua-recovery).
2. Sediakan keputusan penyedia geocoding (G3) dan penyedia mobilitas (G4/V16) sebelum memperluas.
3. Pertahankan branch `prototype-v1` PRIVATE; setiap perubahan berikutnya lewat commit kecil terverifikasi tanpa force-push.
