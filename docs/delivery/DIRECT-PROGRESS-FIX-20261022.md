# Lanjutkan Perjalanan dan penyederhanaan Gangguan — 22 Oktober 2026

## Perbaikan
Jam progres dipulihkan tanpa membuang detik/milidetik. Serializer waktu WIB menerima ketelitian yang sama dan input memakai step 0.001. Aktivasi tidak lagi menimpa progres server dengan waktu mulai yang dibulatkan. Pemeriksaan waktu monoton, pemilik, urutan segmen, konfirmasi naik/turun dan identitas recovery di server tidak dilonggarkan.

Cacat yang ditemukan pada kode lama: timestamp server dapat lebih teliti dari menit, tetapi formatter frontend membulatkan waktu ke menit. Mengirim hasil pembulatan dapat menghasilkan waktu lebih awal daripada progres tersimpan. Tes unit sekarang memeriksa roundtrip sampai milidetik. Sesi manual yang dilaporkan pengguna sudah tidak aktif ketika investigasi dimulai; respons error dari sesi tersebut tidak direkam langsung, sehingga tidak ada klaim bahwa semua kemungkinan error memiliki satu sebab ini.

## UI
Keterangan progres dan jadwal disingkat; riwayat laporan berada dalam Laporan saya yang dapat dibuka. Teks penting Gangguan dan penanda jadwal memakai 16px. Panel navigasi disembunyikan ketika perjalanan telah selesai. Logo penyedia dan ikon navigasi dari milestone sebelumnya tetap dipakai, dengan nama aksesibel dan tanpa transfer lokasi/pemesanan otomatis. Fakta jadwal historis dan status laporan belum terverifikasi tetap terlihat.

## Verifikasi
103 tes web lulus, termasuk regresi detik/milidetik melalui serializer yang dipakai mutasi. Typecheck dan lint lulus. Pada build sebelum polesan panel selesai, enam perjalanan (tiga pilihan rute × ponsel/desktop) lulus tanpa mengedit waktu tahapan; total 38 konfirmasi. Setiap perjalanan di-refresh setelah langkah pertama dan setelah selesai, lalu status tetap benar. Workflow laporan–pembatasan admin–usulan recovery–penerimaan–reload juga lulus pada 390 dan 1280, dengan nol pageerror. Laporan/pembatasan hanya SIMULASI di scratch dan dicabut setelah tes.

Build penyerahan: 2135a042-5586-4724-905b-c2d06a4e1d49. Keenam skenario direct-click diulang dan lulus pada build ini (38 tindakan; tanpa mengedit jam). Bukti: .release-evidence/direct-progress-delivery-completion.log. Log gagal saat investigasi tetap disimpan; tidak dihitung PASS. Dump milik scratch disimpan sebelum pergantian runtime, termasuk before-direct-progress-final.dump dan before-completion-ui-final.dump. Database sumber tetap hanya dibaca.

## Batasan
Lingkungan lokal UAT sementara, memakai OTP nyata dan jadwal historis. Bukan bukti navigasi GPS fisik atau operasi publik/ETA terkini. Tidak ada jaminan nol bug untuk semua kondisi. Runtime sementara bukan penyimpanan harian permanen. Chrome pengguna tidak sedang aktif saat inventaris pemeriksaan terakhir; alur browser diverifikasi melalui Chrome headless dan unit/integrasi, bukan klaim sesi manual pengguna.

Workflow Gangguan pada build penyerahan juga PASS untuk ponsel dan desktop: laporan awal belum terverifikasi, pembatasan SAMPLE admin, recovery diterima, reload mempertahankan hasil, logo termuat, pageerror nol. Pembatasan uji dicabut pada cleanup. Bukti: direct-progress-delivery-recovery.log. Readiness web/API/admin/planning HTTP 200; pemindaian rahasia PASS. Pemeriksaan diff bebas whitespace error.
