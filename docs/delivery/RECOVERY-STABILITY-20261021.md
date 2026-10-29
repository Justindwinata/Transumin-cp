# Verifikasi stabilitas lokal — 21 Oktober 2026

## Lingkup dan status
Perbaikan pencarian berulang, pemulihan perjalanan setelah refresh, dan kejelasan informasi. PASS terbatas pada pengujian lokal dengan OTP 2.10.0 dan jadwal historis 2 Oktober 2026. Ini bukan bukti operasi lapangan, jadwal terkini, atau kesiapan publik.

## Akar masalah dan perubahan
- Waktu progres saat pemulihan halaman memakai tanggal perangkat. Frontend sekarang memulihkan waktu dari progres tersimpan, dengan fallback waktu mulai perjalanan.
- Recovery menolak dua timestamp ISO yang mewakili waktu sama karena perbandingan string. Perbandingan sekarang memakai instant yang valid; pemeriksaan pemilik, revisi dan status tetap berlaku.
- Error routing pada endpoint recovery tidak dipetakan sehingga menjadi error 500 generik. Controller sekarang mengembalikan kegagalan terstruktur 422 atau 503; pesan pengguna berbahasa Indonesia.
- Penolakan kandidat karena satu layanan terblokir turut mengecualikan layanan lain yang tidak terdampak. Pengecualian sekarang hanya berasal dari leg yang terikat entitas terblokir.
- Kandidat jalan kaki dapat menghentikan pencarian terlalu dini. Retry yang sudah dibatasi dua percobaan sekarang tetap dijalankan bila hasil pertama hanya berjalan dan layanan terdampak perlu dikecualikan.
- Penjelasan handoff disingkat; tombol penyedia dan aksi error dipisahkan. Tidak ada pemesanan otomatis atau klaim tarif/ketersediaan kendaraan.

## Bukti yang dijalankan
Runtime akhir: a34df66d-e8a9-4bf3-9832-da4730b2a265, database scratch dengan pemeriksaan identitas dan hak akses. Database sumber hanya dibaca untuk kloning.

- Web: 102 tes lulus; API: 146 tes dan 3 tes skrip lulus. Typecheck, lint, build runtime dan git diff --check lulus.
- RECOVERY_CLOCK: tanggal rusak ditolak dengan 422 terstruktur; progres valid menghasilkan pengganti WALK–TRANSJAKARTA–WALK (5.403 detik, jalan 1.270 m), diterima dan tetap tersimpan sesudah reload, satu tahap selesai dipertahankan. Gangguan SIMULATED dibatasi admin SAMPLE dan dicabut pada cleanup.
- CP2 navigasi simulasi GPS dan R4 lulus; ini bukan uji sensor fisik.
- ROUTING_CORE: 30 pencarian pada tiga viewport; pergantian cepat empat ranking lulus.
- Matriks routing: 28 kasus lulus, 19 multimoda; mencakup WALK, TransJakarta, Mikrotrans, KRL, MRT Jakarta, LRT Jakarta dan LRT Jabodebek. Tidak berarti semua titik atau semua kombinasi tersedia.
- Sesi: empat kasus cookie kedaluwarsa/kunci lama lulus, setiap kasus mencoba empat preferensi dan memeriksa penolakan akses perjalanan lama.
- Chrome pengguna: pencarian Gambir–Pejaten menghasilkan tiga kombinasi berbeda; aktivasi 6H, pembaruan satu tahap pada 08.05 WIB, refresh tetap mempertahankan tanggal 2 Oktober dan progres 1/3. Kembali ke planner kosong tidak menampilkan rute aktif.
- Readiness: web, API, admin review dan planning proxy HTTP 200; OTP tersedia. Pemindaian 514 berkas source, 27 aset klien dan 5 aset publik tidak menemukan tujuh nilai runtime yang dilindungi.

Log privat berada di .release-evidence/recovery-outage-integration-final.log, recovery-outage-extra-final.log, recovery-outage-api.log, recovery-stability-web-final.log, recovery-outage-types.log, recovery-outage-lint.log dan final-readiness.json. Log gagal saat investigasi tetap disimpan dan tidak dihitung lulus.

## Jadwal operator: belum lengkap
Panel opsional memeriksa keterjangkauan tiga situs resmi MRT, KRL dan LRT Jabodebek, dengan timeout, cache dan single-flight. Pemeriksaan HEAD situs bukan pengambilan jadwal atau estimasi kedatangan. arrival_status tetap NOT_CONNECTED dan arrivals kosong. Adapter jadwal/ETA terkini yang tervalidasi belum tersedia. Jangan menyebut fitur ini ETA realtime atau monitoring kendaraan.

## Batasan yang masih terbuka
Runtime aktif adalah UAT terisolasi sementara; penghentian normal membersihkan database scratch miliknya. Ini belum runtime harian dengan penyimpanan permanen. Backup UAT sebelumnya disimpan privat sebelum pergantian runtime. GPS lapangan, akses berjalan/titik jemput, data produksi dan hak distribusi masih belum tervalidasi. Salah satu constraint hazard bawaan sumber berstatus NOT VALID dan tidak diubah pada pekerjaan ini. Empat ranking boleh berbagi pemenang bila metriknya memang sama, sesuai keputusan Product Owner; tidak ada duplikasi buatan agar tampak berbeda.
