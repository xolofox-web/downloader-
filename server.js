/* server.js — Backend Tarik Downloader */
'use strict';

require('dotenv').config();

const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const API_BASE = process.env.DOWNLOADER_API_BASE || 'https://apikayz.clutch.web.id/download/aio';
const API_KEY = process.env.DOWNLOADER_API_KEY || '';
const UPSTREAM_TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS) || 25000;
const MAX_URL_LENGTH = 2048;

if (!API_KEY) {
  console.warn('[warn] DOWNLOADER_API_KEY belum di-set. Endpoint /api/ akan menolak permintaan.');
}

/* ------------------------------------------------------------------ */
/*  Keamanan dasar                                                     */
/* ------------------------------------------------------------------ */

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        mediaSrc: ["'self'", 'https:', 'http:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(express.json({ limit: '8kb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan. Coba lagi dalam satu menit.' } },
});

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan unduhan. Tunggu sebentar lalu coba lagi.' } },

app.use('/api/', apiLimiter);

/* ------------------------------------------------------------------ */
/*  Platform                                                           */
/* ------------------------------------------------------------------ */

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { id: 'instagram', label: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
  { id: 'spotify', label: 'Spotify', hosts: ['spotify.com', 'spotify.link'] },
  { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
  { id: 'twitter', label: 'X (Twitter)', hosts: ['twitter.com', 'x.com', 't.co'] },
  { id: 'pinterest', label: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
];

function detectPlatform(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { id: 'unknown', label: 'Tautan' };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const p of PLATFORMS) {
    if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) {
      return { id: p.id, label: p.label };
    }
  }
  return { id: 'unknown', label: host };
}

/* ------------------------------------------------------------------ */
/*  Proteksi SSRF                                                      */
/* ------------------------------------------------------------------ */

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true;
  if (v.startsWith('fe80')) return true;
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return false;
}

async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error('Format tautan tidak valid.'), { code: 'INVALID_URL' });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('Hanya tautan http/https yang didukung.'), { code: 'INVALID_PROTOCOL' });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('Tautan tidak boleh mengandung kredensial.'), { code: 'INVALID_URL' });
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw Object.assign(new Error('Alamat tujuan tidak diizinkan.'), { code: 'BLOCKED_HOST' });
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('Alamat IP internal tidak diizinkan.'), { code: 'BLOCKED_HOST' });
    return u;
  }
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) throw Object.assign(new Error('Alamat tujuan tidak diizinkan.'), { code: 'BLOCKED_HOST' });
    }
  } catch (err) {
    if (err.code === 'BLOCKED_HOST') throw err;
    // DNS gagal — biarkan upstream yang memutuskan (server tidak melakukan fetch langsung)
  }
  return u;
}

/* ------------------------------------------------------------------ */
/*  Normalisasi respons upstream                                       */
/* ------------------------------------------------------------------ */

const TYPE_LABEL = { video: 'Video', audio: 'Audio', image: 'Gambar', file: 'File' };

function str(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function personName(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(personName).filter(Boolean).join(', ');
  if (typeof v === 'object') return str(v, ['name', 'username', 'nickname', 'full_name', 'displayName', 'title']);
  return '';
}

function extFromUrl(url = '') {
  const m = String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

function guessType(url = '') {
  const clean = String(url).split('?')[0].toLowerCase();
  if (/\.(mp4|webm|mkv|mov|m4v|ts)$/.test(clean)) return 'video';
  if (/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/.test(clean)) return 'audio';
  if (/\.(jpg|jpeg|png|webp|gif|avif)$/.test(clean)) return 'image';
  return 'file';
}

function normalizeType(rawType, url) {
  const t = String(rawType || '').toLowerCase();
  if (t.includes('video')) return 'video';
  if (t.includes('audio') || t.includes('music') || t.includes('song')) return 'audio';
  if (t.includes('image') || t.includes('photo') || t.includes('thumb') || t.includes('cover')) return 'image';
  return guessType(url);
}

function formatDuration(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.round(Number(s));
    if (n > 0 && n < 86400) {
      const m = Math.floor(n / 60);
      const sec = n % 60;
      return `${m}:${String(sec).padStart(2, '0')}`;
    }
  }
  return s;
}

function collectMedias(payload, sourceUrl) {
  const raw = [];
  const push = (value, fallbackType) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((v) => push(v, fallbackType));
      return;
    }
    if (typeof value === 'string') {
      raw.push({ item: value, fallbackType });
      return;
    }
    if (typeof value === 'object') {
      const hasUrl = ['url', 'link', 'download', 'downloadUrl', 'src', 'href', 'videoUrl', 'audioUrl', 'play'].some(
        (k) => typeof value[k] === 'string'
      );
      if (hasUrl) {
        raw.push({ item: value, fallbackType });
        return;
      }
      for (const [key, val] of Object.entries(value)) {
        if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
          raw.push({ item: { url: val, quality: key }, fallbackType });
        } else if (val && typeof val === 'object') {
          push(val, fallbackType);
        }
      }
    }
  };

  push(payload.medias, '');
  push(payload.media, '');
  push(payload.links, '');
  push(payload.downloads, '');
  push(payload.formats, '');
  push(payload.urls, '');
  push(payload.url, '');
  push(payload.video, 'video');
  push(payload.videos, 'video');
  push(payload.audio, 'audio');
  push(payload.music, 'audio');
  push(payload.image, 'image');
  push(payload.images, 'image');

  const out = [];
  const seen = new Set();

  for (const { item, fallbackType } of raw) {
    const meta = typeof item === 'string' ? {} : item;
    const url = typeof item === 'string'
      ? item
      : str(meta, ['url', 'link', 'download', 'downloadUrl', 'src', 'href', 'videoUrl', 'audioUrl', 'play']);

    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (url === sourceUrl) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const type = normalizeType(str(meta, ['type', 'mediaType', 'kind']) || fallbackType, url);
    const extension = (str(meta, ['extension', 'ext', 'container']) || extFromUrl(url)).replace(/^\./, '').toLowerCase();
    const quality = str(meta, ['quality', 'qualityLabel', 'resolution', 'label', 'format_note', 'name']);
    const size = str(meta, ['size', 'formattedSize', 'fileSize', 'filesize', 'sizeLabel']);

    out.push({
      id: out.length,
      url,
      type,
      extension,
      quality,
      size,
      label: [TYPE_LABEL[type] || 'File', quality, extension ? extension.toUpperCase() : ''].filter(Boolean).join(' · '),
    });

    if (out.length >= 20) break;
  }

  return out;
}

function normalizeUpstream(responseBody, sourceUrl, platform) {
  const root = responseBody && typeof responseBody === 'object' ? responseBody : {};

  let payload = root.result !== undefined ? root.result : root.data !== undefined ? root.data : root;
  if (Array.isArray(payload)) payload = payload[0] || {};
  if (payload && typeof payload === 'object' && payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)) {
    payload = payload.result;
  }
  if (!payload || typeof payload !== 'object') payload = {};

  const flat = { ...root, ...payload };

  const title =
    str(flat, ['title', 'caption', 'name', 'track', 'song', 'filename', 'text']) ||
    str(flat, ['desc', 'description']).slice(0, 90) ||
    '';

  const thumbnail = str(flat, ['thumbnail', 'thumb', 'thumbnail_url', 'thumbnailUrl', 'cover', 'cover_url', 'image', 'img', 'picture', 'artwork', 'poster']);

  const duration = formatDuration(str(flat, ['duration', 'durationLabel', 'duration_string', 'length', 'formattedDuration']));

  const author = personName(flat.author ?? flat.username ?? flat.uploader ?? flat.channel ?? flat.artist ?? flat.artists ?? flat.creator ?? flat.owner);

  const description = str(flat, ['description', 'desc', 'caption']);

  const extra = [];
  const album = str(flat, ['album', 'album_name', 'albumName']);
  if (album) extra.push({ label: 'Album', value: album });
  const artist = personName(flat.artist ?? flat.artists);
  if (artist && artist !== author) extra.push({ label: 'Artis', value: artist });
  const views = str(flat, ['views', 'viewCount', 'playCount', 'play_count']);
  if (views) extra.push({ label: 'Views', value: views });
  const publishedAt = str(flat, ['publishedAt', 'releaseDate', 'release_date', 'uploadDate', 'date']);
  if (publishedAt) extra.push({ label: 'Tanggal', value: publishedAt });

  const medias = collectMedias(payload, sourceUrl);

  return {
    platform,
    sourceUrl,
    title: title || 'Konten tanpa judul',
    author,
    thumbnail,
    duration,
    description: description && description !== title ? description.slice(0, 400) : '',
    extra,
    medias,
    notice: medias.length
      ? null
      : 'Informasi konten berhasil diambil, tetapi tidak ada tautan unduhan yang tersedia untuk tautan ini. Layanan mungkin sedang tidak tersedia atau konten dilindungi.',
    fetchedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'tarik-downloader', upstreamConfigured: Boolean(API_KEY), time: new Date().toISOString() });
});

app.post('/api/download', downloadLimiter, async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'Layanan sedang tidak tersedia: API key belum dikonfigurasi di server.' },
    });
  }

  const body = req.body || {};
  const url = typeof body.url === 'string' ? body.url.trim() : '';

  if (!url) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_URL', message: 'Tautan tidak boleh kosong.' } });
  }
  if (url.length > MAX_URL_LENGTH) {
    return res.status(400).json({ ok: false, error: { code: 'URL_TOO_LONG', message: 'Tautan terlalu panjang.' } });
  }

  try {
    await assertSafeUrl(url);
  } catch (err) {
    return res.status(400).json({ ok: false, error: { code: err.code || 'INVALID_URL', message: err.message } });
  }

  const platform = detectPlatform(url);

  let upstream;
  try {
    upstream = await axios.get(API_BASE, {
      params: { apikey: API_KEY, url },
      timeout: UPSTREAM_TIMEOUT,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024,
      validateStatus: () => true,
      headers: { Accept: 'application/json', 'User-Agent': 'TarikDownloader/1.0' },
    });
  } catch (err) {
    const timedOut = err.code === 'ECONNABORTED';
    return res.status(504).json({
      ok: false,
      error: {
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
        message: timedOut
          ? 'Waktu pemrosesan habis. Coba lagi dengan tautan lain.'
          : 'Tidak dapat menghubungi layanan pengunduh saat ini.',
      },
    });
  }

  if (upstream.status === 429) {
    return res.status(429).json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Layanan pengunduh sedang sibuk. Coba lagi nanti.' } });
  }

  const data = upstream.data;
  if (upstream.status < 200 || upstream.status >= 300 || !data) {
    return res.status(502).json({
      ok: false,
      error: { code: 'UPSTREAM_BAD_RESPONSE', message: 'Layanan pengunduh tidak mengembalikan data yang valid.' },
    });
  }

  if (data.status === false || data.success === false || data.ok === false) {
    const msg = str(data, ['message', 'msg', 'error']) || 'Tautan tidak dapat diproses oleh layanan.';
    return res.status(422).json({ ok: false, error: { code: 'UPSTREAM_REJECTED', message: msg } });
  }

  let normalized;
  try {
    normalized = normalizeUpstream(data, url, platform);
  } catch {
    return res.status(502).json({ ok: false, error: { code: 'PARSE_ERROR', message: 'Gagal membaca hasil dari layanan.' } });
  }

  return res.json({ ok: true, data: normalized });
});

/* ------------------------------------------------------------------ */
/*  Proxy Download (Agar bisa langsung terunduh tanpa buka tab baru)  */
/* ------------------------------------------------------------------ */
app.get('/api/proxy', downloadLimiter, async (req, res) => {
  const targetUrl = req.query.url;
  const rawFilename = req.query.filename || 'Tarik_Download';
  const safeFilename = rawFilename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

  if (!targetUrl) return res.status(400).send('URL tidak valid.');

  try {
    await assertSafeUrl(targetUrl);
  } catch (err) {
    return res.status(400).send(err.message);
  }

  try {
    // Ambil origin untuk header Referer/Origin agar tidak diblokir CDN
    let originUrl = '';
    try {
      originUrl = new URL(targetUrl).origin;
    } catch(e) {}

    const response = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      timeout: 30000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': targetUrl,
        'Origin': originUrl
      }
    });

    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    
    // Teruskan Content-Length agar progress bar download di browser berfungsi
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error.message);
    // Cek headersSent agar server tidak crash jika koneksi terputus di tengah jalan
    if (!res.headersSent) {
      res.status(500).send('Gagal mengambil file dari server sumber.');
    }
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
});

/* ------------------------------------------------------------------ */
/*  Static + error handler                                             */
/* ------------------------------------------------------------------ */

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Permintaan terlalu besar.' } });
  }
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server.' } });
});

app.listen(PORT, () => {
  console.log(`Tarik Downloader berjalan di http://localhost:${PORT}`);
});
