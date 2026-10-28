# Zyxell — All-in-One Media Downloader

Tarik adalah website downloader modern, minimalis, dan responsif yang dibangun dengan arsitektur frontend dan backend terpisah. Website ini memungkinkan pengguna untuk mengunduh konten (video, audio, gambar) dari berbagai platform seperti TikTok, Instagram, YouTube, Spotify, dan lainnya dalam satu tempat.

## ✨ Fitur Utama
- **Auto-Detect Platform**: Mengenali platform secara otomatis dari URL yang ditempel.
- **Pilihan Format**: Menampilkan opsi format dan kualitas yang tersedia.
- **Riwayat Lokal**: Menyimpan riwayat unduhan di perangkat pengguna (localStorage) yang bisa dihapus kapan saja.
- **Dark/Light Mode**: Tampilan tema yang bisa disesuaikan.
- **Responsif**: Nyaman digunakan di HP, tablet, maupun PC.
- **Aman**: API key disimpan di backend (environment variables) dan dilengkapi proteksi SSRF serta Rate Limiting.

## 🛠️ Teknologi yang Digunakan
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **API**: [APlKayz Downloader](https://apikayz.clutch.web.id/)

## 🚀 Cara Menjalankan Secara Lokal

1. **Clone repositori ini:**
   ```bash
   git clone https://github.com/usernamekamu/downloader.git
   cd downloader
