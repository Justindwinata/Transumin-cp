# Penyederhanaan UI penumpang — 22 Oktober 2026

Lingkup: APP-001 pencarian/ranking, perjalanan aktif, laporan gangguan dan recovery. Tidak ada perubahan skema database, kontrak API, otoritas verifikasi admin, atau metrik ranking pada milestone ini.

## Perubahan
Form laporan hanya terlihat di halaman Gangguan. Perjalanan aktif menyediakan satu tombol Ada masalah yang membuka halaman tersebut; fallback tombol tersedia bila panduan peta belum tersedia. Informasi gangguan tidak menumpuk pada panel perjalanan aktif.

Tautan Gojek, Grab, dan Bluebird memakai logo dari situs resmi. Nama dan tujuan tautan tetap tersedia lewat accessible label dan tooltip. Tombol pusatkan lokasi dan jeda/lanjut panduan memakai ikon dengan label aksesibilitas. Target minimum tombol 48 piksel; fokus keyboard terlihat. Opsi salin tujuan/titik jemput/perjalanan dipindahkan ke detail yang bisa dibuka. Tidak ada transfer lokasi otomatis, pemesanan otomatis, atau klaim ketersediaan kendaraan.

Penjelasan laporan, status kosong dan handoff disingkat. Detail sumber data, verifikasi dan keterbatasan tetap tersedia. Informasi bahwa jadwal adalah historis tetap terlihat; penyederhanaan tidak mengubahnya menjadi informasi realtime.

## Verifikasi
Typecheck, lint, 102 tes web dan smoke build produksi lokal lulus. Manual Chrome: aktivasi perjalanan dan tombol Ada masalah membuka form, logo ketiga penyedia tampil, opsi penyalinan bisa dibuka. Pengujian selesai perjalanan melalui UI lulus di lebar 390 dan 1280: lima tindakan, status selesai tetap tersimpan setelah reload.

Hasil akhir: ROUTING_CORE lulus 30 pencarian pada tiga viewport serta pergantian cepat empat ranking. Matriks 28 kasus lulus, 19 multimoda mencakup ketujuh kategori moda. Empat kasus sesi lama/kedaluwarsa lulus. SIMPLE_UI lulus pada 390 dan 1280: satu pintu laporan, status belum terverifikasi sebelum admin, pembatasan admin, usulan recovery diterima dan dipulihkan setelah reload, ketiga logo termuat, dan nol pageerror pada kedua skenario. Pembatasan uji dicabut setelah setiap skenario. Bukti: ui-simple-routing-final.log, ui-simple-workflow-pass.log, ui-simple-completion-final.log. Percobaan pengembangan test yang gagal tetap disimpan, tidak dihitung PASS. Perbaikan test meliputi membuka panel contoh, selector label yang membungkus pilihan dropdown, memilih status sukses dari dua notifikasi, serta menyertakan keputusan RETRACTED pada cleanup pembatasan. Batas login tetap dihormati dengan retry terbatas, tanpa reset data atau menonaktifkan pembatasan.

Runtime UAT: 1377a858-9d3d-47b7-b0e9-559565be9573, loopback HTTPS 3302; database scratch terisolasi. Database sumber hanya dibaca. Gangguan uji berlabel SIMULASI dan pembatasan dicabut setelah pengujian. Bukti privat berada di .release-evidence/ui-simple-*.log dan exact-runtime-1377a858-9d3d-47b7-b0e9-559565be9573/.

## Batasan
PASS hanya untuk skenario yang dijalankan, bukan jaminan tidak ada bug di semua titik/kondisi. Jadwal terkini, ETA live, sensor GPS lapangan dan penyimpanan harian permanen belum tervalidasi. Runtime sekarang masih UAT sementara. Logo untuk identifikasi tautan uji lokal; sumber dan checksum tercatat dalam apps/web/public/providers/sources.json. Izin redistribusi publik belum diverifikasi, dan tidak ada afiliasi penyedia yang diklaim.
