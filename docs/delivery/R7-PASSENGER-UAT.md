# R7 — Passenger UAT

Status manusia/ponsel: `NOT_VERIFIED`. Bukti Playwright tidak menggantikan penerimaan Product Owner atau uji lapangan. Gunakan prosedur startup [R6](./R6-MANUAL-ACCEPTANCE-GUIDE.md); jangan reset DB atau rebuild graph. Semua jadwal memakai snapshot historis `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`, `2026-10-02`, `Asia/Jakarta`.

## Satu alur penerimaan

1. Buka sesi browser baru di `http://127.0.0.1:3000`. Pada `From`, pilih `Place`, cari `Kelapa Gading`; pada `To`, cari `Gambir`. Pastikan identitas halte/stasiun sebelum memilih. Alamat rumah/nama POI belum didukung; gunakan `Map pin` atau `Coordinates`, bukan hasil pencarian yang dipaksakan.
2. Atur `Depart (Jakarta time)` ke `2026-10-02T08:11`. Pilih `Rank by`, klik `Find journeys`; ulangi `Fewest transfers`, `Least walking`, `Fastest`, `Balanced`. Pemenang sama boleh sah. Bandingkan durasi, transfer, jarak jalan; tidak ada janji realtime.
3. Pilih itinerary. Cocokkan peta dan timeline. Klik `Mulai Perjalanan`.
4. Buka `Lokasi perangkat (opsional)`, klik `Aktifkan Lokasi Langsung` hanya dengan persetujuan. Penolakan izin harus mempertahankan kontrol manual. Uji fisik mengikuti [prosedur GPS](./PHYSICAL-GPS-USER-TEST-WORKFLOW.md); localhost laptop bukan akses HTTPS ponsel.
5. Pada WALK, periksa instruksi dan jarak. Data `OTP_DERIVED_MANEUVER` bukan bukti keselamatan jalan independen. Schematic harus memberi caveat dan tidak mengarang belokan. Gunakan `Manuver berikutnya` bila manual.
6. Untuk transit, gunakan `Saya Sudah Naik`, lalu `Saya Sudah Turun`. Gunakan `Lanjutkan Perjalanan` untuk progres. GPS tidak boleh menyatakan naik/turun otomatis.
7. Pada segmen tersisa, pilih target dan kategori laporan, isi observasi, klik `Kirim laporan`. Pastikan laporan persisten dan `Belum diverifikasi`/`REPORTED_UNVERIFIED`. Laporan biasa tidak menutup layanan.
8. Penguji reviewer berizin menjalankan controlled review melalui endpoint protected; jangan menaruh token di browser, screenshot, atau laporan. Gunakan hanya incident `SIMULATED` yang relevan. Penguji penumpang tanpa akses reviewer harus ditolak.
9. Pastikan alert hanya untuk journey terdampak dan berlabel `SIMULATED`. Klik `Find another way`. Alternatif harus berasal dari OTP; jangan menghilangkan fallback valid demi hasil no-route.
10. Periksa `Recovery option`, lalu `Use this repaired route`. Cocokkan itinerary server, peta, timeline, dan navigasi. Segmen selesai dan original plan tetap utuh.
11. Refresh. Recovery dan progres harus bertahan. Lanjutkan lewat kontrol yang sesuai sampai `Selesaikan Perjalanan`; refresh lagi, status selesai tetap.
12. Buka panel handoff; klik `Salin tujuan` hanya bila setuju berbagi konteks tujuan. Gojek/Grab/Bluebird membuka situs resmi; pemesanan tetap manual di aplikasi penyedia. Tidak ada konfirmasi booking, tarif, ETA, atau availability.
13. Reviewer menutup incident controlled lewat endpoint protected. Jangan menghapus bukti atau DB scratch gagal.

## Catatan hasil manusia

Isi satu record per operator, bukan menyalin verdict otomatis:

- Operator/role (alias), tanggal WIB, commit SHA:
- Perangkat, OS, browser, viewport:
- Langkah 1–13: `PASS` / `FAIL` / `NOT_RUN` / `NOT_VERIFIED`:
- GPS: `SIMULATED` / perangkat fisik; izin, accuracy tier, stop sharing:
- Penyimpangan, langkah reproduksi, screenshot tersanitasi lokal:
- Keputusan Product Owner dan kriteria belum diterima:

Jangan merekam cookie, credential, alamat rumah, atau trace GPS privat.

## Reproduksi otomatis

Jalankan browser serial. Suite yang memutasi DB untuk concurrency/recovery harus memakai harness scratch milik invokasi. Script walkthrough historis memakai journey demo melalui API produk, bukan bukti scratch concurrency atau penerimaan manusia.

```sh
node apps/web/scripts/passenger-r1-full-workflow.mjs
pnpm data:cp2:isolated-browser
pnpm data:cp3:recovery
```

Bukti R7 awal: walkthrough aktual 20/20 `PASS`, log lokal `.release-evidence/r7-r1-full-workflow.log`. Hasil ini mendahului checkpoint kode final R7; jangan melabel ulang sebagai gate final. Uji manusia tetap `NOT_VERIFIED` sampai record di atas diisi penguji nyata.
