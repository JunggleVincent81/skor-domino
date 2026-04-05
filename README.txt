Domino Round Analyzer
=====================

Isi paket:
- index.html
- styles.css
- app.js
- domino-analyzer-standalone.html

Cara pakai:
1. Extract file ZIP.
2. Buka index.html di browser.
3. Atur nama pemain, jumlah pemain, ukuran tangan awal, lalu klik "Terapkan roster & reset skor".
4. Pilih kartu di tanganmu pada bagian "Kelola tangan saya".
5. Saat ronde berjalan, catat setiap kartu yang keluar dan setiap pemain yang pass.
6. Lihat bagian analisa untuk mengetahui:
   - angka berapa yang sudah keluar berapa kali
   - angka berapa yang masih belum terlihat
   - estimasi kandidat kartu lawan
   - rekomendasi kartu yang cocok dijadikan serangan
   - kartu yang layak disimpan dulu
7. Setelah ronde selesai, klik tombol "+ kalah" pada pemain yang kalah.
   Sistem akan:
   - menambah poin kalah
   - menyimpan history ronde
   - menghitung streak kalah beruntun
   - otomatis membuka ronde baru

Catatan penting:
- Aplikasi ini memakai asumsi domino double-six standar (0-0 sampai 6-6, total 28 kartu).
- Estimasi kartu lawan bersifat perkiraan berdasarkan:
  - kartu yang sudah keluar
  - kartu yang kamu tandai ada di tanganmu
  - catatan pass / tidak bisa jalan
- Semakin lengkap kamu mengisi tanganmu dan log pass, semakin tajam analisanya.
- Data tersimpan otomatis di browser melalui localStorage.
- Kamu juga bisa export/import data JSON untuk backup.

Versi standalone:
- Kalau mau satu file saja, buka domino-analyzer-standalone.html.
