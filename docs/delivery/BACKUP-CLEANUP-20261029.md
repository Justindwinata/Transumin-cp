# Backup dan cleanup — 29 Oktober 2026

Repository baru: https://github.com/Justindwinata/Transumin-cp, branch main. Snapshot bersih berisi kode aplikasi, kontrak, migrasi, tes, skrip, manifest, konfigurasi contoh dan dokumen. Riwayat repository lama dan perubahan sumber asli dipertahankan dalam backup privat; remote lama tidak diubah. File rahasia, raw/processed data, graph, dump, dependency, build dan evidence privat tidak dipublikasikan.

## Bukti ekspor
Instalasi offline dengan frozen lockfile, typecheck, lint dan 103 tes web PASS pada salinan ekspor. Pemeriksaan nilai secret environment dan pola key/token pada source ekspor tidak menemukan kecocokan. Tidak dilakukan klaim UAT penuh pada clone kosong tanpa data. Logo pihak ketiga yang izin distribusinya belum diverifikasi tidak dipublikasikan; tautan tetap memiliki fallback nama penyedia. Source app utama di folder TAKEOVER tetap dipertahankan.

## Cadangan privat
Downloads/TRANSUMIN-BACKUP-20261029, sekitar 6 GB: proyek asli (termasuk .git/.env/data/evidence, kecuali build/dependency), 44 arsip volume lama, 117 dump database sumber dan globals role. Tar dibaca penuh, checksum dicatat. Semua dump diverifikasi daftar restore dan hash. Satu database produk dipulihkan ke container terisolasi dan jumlah baris enam tabel cocok. Container/volume verifikasi dibersihkan. Owner/ACL tidak diuji, database lain belum direstore end-to-end. Cadangan ini masih lokal, bukan backup seluruh data di GitHub atau di luar perangkat.

## Pembersihan
Docker sebelum: 61 container berhenti, 46 volume 22,13 GB, lima image 2,276 GB dan cache build 894,8 MB. Sesudah: satu container produk berhenti, dua volume 9,635 GB, satu image produk 894,7 MB, cache build nol. Enam puluh container dan 44 volume lama dibersihkan setelah backup terverifikasi. Volume produk 9,514 GB dan volume tanpa provenance pasti 104,1 MB dipertahankan. Database produk tidak dihapus. Image registry/cache yang tidak dipakai dapat diunduh/build ulang; bukan data unik.

Sebanyak 22 direktori dependency/build terabaikan Git pada salinan Developer dan worktree lama dibersihkan (perkiraan 4,08 GB). Bukti duplikat previous-location sekitar 455 MB dipindahkan ke arsip privat sebelum dihapus dari folder kerja. Source lama, lockfile, data dan pekerjaan tidak dihapus. Dependency instalasi verifikasi pada ekspor juga dibersihkan setelah tes.

Ruang kosong host: sekitar 5,2 GiB sebelum dan sekitar 10 GiB setelah, termasuk sekitar 6 GB backup baru. Angka ruang host dan ukuran logis Docker tidak setara karena sparse disk/APFS. Docker.raw tidak dihapus. Docker sempat berhenti merespons ketika ruang sangat rendah saat percobaan arsip fisik produk; arsip tidak lengkap dibuang, Desktop dipulihkan, lalu backup logis dan restore test lulus. Tidak ada klaim semua percobaan backup berhasil.

## Menjalankan kembali
Ikuti RESTORE-20261029.md. pnpm install diperlukan pada salinan yang dependency-nya dibersihkan. Database produk tetap tersedia pada volume aslinya, dalam keadaan berhenti seperti saat audit awal. Lingkungan UAT memerlukan data/graph dan .env privat. Jadwal aplikasi tetap historis; cleanup tidak mengubah status produksi, GPS, atau ETA.
