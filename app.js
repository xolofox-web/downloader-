/* public/app.js — Tarik Downloader */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================================================================
     Tema
     ================================================================ */
  const THEME_KEY = 'tarik:theme';
  const root = document.documentElement;
  const themeToggle = $('#themeToggle');

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0a0c' : '#ffffff');
  }

  let initialTheme = 'dark';
  try { initialTheme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) {}
  setTheme(initialTheme);

  themeToggle.addEventListener('click', () => {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ================================================================
     Menu mobile
     ================================================================ */
  const menuBtn = $('#menuBtn');
  const navLinks = $('#navLinks');

  function closeMenu() {
    navLinks.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = navLinks.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (e) => {
    if (!navLinks.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
  });

  $$('[data-nav]').forEach((a) => a.addEventListener('click', closeMenu));

  /* ================================================================
     Deteksi platform (mirror dari backend)
     ================================================================ */
  const PLATFORMS = [
    { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
    { id: 'instagram', label: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
    { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
    { id: 'spotify', label: 'Spotify', hosts: ['spotify.com', 'spotify.link'] },
    { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
    { id: 'twitter', label: 'X (Twitter)', hosts: ['twitter.com', 'x.com', 't.co'] },
    { id: 'pinterest', label: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
    { id: 'soundcloud', label: 'SoundCloud', hosts: ['soundcloud.com', 'snd.sc'] },
    { id: 'reddit', label: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
    { id: 'threads', label: 'Threads', hosts: ['threads.net'] },
    { id: 'vimeo', label: 'Vimeo', hosts: ['vimeo.com'] },
    { id: 'snapchat', label: 'Snapchat', hosts: ['snapchat.com'] },
  ];

  function isValidHttpUrl(value) {
    let u;
    try { u = new URL(String(value).trim()); } catch { return false; }
    return u.protocol === 'http:' || u.protocol === 'https:';
  }

  function detectPlatform(value) {
    let u;
    try { u = new URL(value); } catch { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const p of PLATFORMS) {
      if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) return p;
    }
    return null;
  }

  /* ================================================================
     Elemen utama
     ================================================================ */
  const form = $('#urlForm');
  const input = $('#urlInput');
  const clearBtn = $('#clearBtn');
  const pasteBtn = $('#pasteBtn');
  const submitBtn = $('#submitBtn');
  const submitLabel = $('.btn-label', submitBtn);
  const submitSpinner = $('.spinner', submitBtn);
  const hint = $('#formHint');
  const resultSection = $('#resultSection');
  const resultEl = $('#result');
  const historySection = $('#historySection');
  const historyList = $('#historyList');
  const historyEmpty = $('#historyEmpty');
  const historyClear = $('#historyClear');

  let busy = false;

  /* ================================================================
     Hint helper
     ================================================================ */
  function setHint(message, type = '') {
    hint.textContent = message || '';
    hint.className = 'hint' + (type ? ' ' + type : '');
  }

  function setBusy(state) {
    busy = state;
    submitBtn.disabled = state;
    pasteBtn.disabled = state;
    submitSpinner.hidden = !state;
    submitLabel.textContent = state ? 'Memproses' : 'Download';
    submitBtn.setAttribute('aria-busy', String(state));
  }

  /* ================================================================
     Input: clear & paste
     ================================================================ */
  function syncClearBtn() {
    clearBtn.hidden = input.value.trim().length === 0;
  }

  input.addEventListener('input', () => {
    syncClearBtn();
    if (hint.classList.contains('error')) setHint('');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncClearBtn();
    setHint('');
    input.focus();
  });

  pasteBtn.addEventListener('click', async () => {
    // Butuh izin pengguna (clipboard read hanya bekerja di secure context)
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setHint('Perangkat ini tidak mendukung penempelan otomatis. Tempel manual dengan Ctrl/Cmd + V.', 'error');
      input.focus();
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setHint('Clipboard kosong.', 'error');
        return;
      }
      input.value = text.trim().slice(0, 2048);
      syncClearBtn();
      setHint('');
      input.focus();
    } catch (_) {
      setHint('Izin clipboard ditolak. Tempel manual dengan Ctrl/Cmd + V.', 'error');
      input.focus();
    }
  });

  /* ================================================================
     Ikon media
     ================================================================ */
  const ICONS = {
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="3.2"/><path d="M11 9.8l3.6 2.2L11 14.2z" fill="currentColor" stroke="none"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17V6l9-1.6V15"/><circle cx="6.6" cy="17.4" r="2.4"/><circle cx="15.6" cy="15" r="2.4"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.8-4.3a2 2 0 0 1 2.7 0l3.2 3"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  };

  const iconCopy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
  const iconDownload = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v9"/><path d="M8.5 10.5 12 14l3.5-3.5"/><path d="M5 19h14"/></svg>';
  const iconTrash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l.8 12.2A1.6 1.6 0 0 0 8.9 21h6.2a1.6 1.6 0 0 0 1.6-1.8L17.5 7"/></svg>';
  const iconWarn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.5v5"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/><path d="M10.3 4.4 2.9 17.2A1.9 1.9 0 0 0 4.5 20h15a1.9 1.9 0 0 0 1.6-2.8L13.7 4.4a1.9 1.9 0 0 0-3.4 0Z"/></svg>';

  /* ================================================================
     Render hasil
     ================================================================ */
  function skeletonHTML() {
    return `
      <div class="skeleton" aria-label="Memuat">
        <div class="sk sk-thumb"></div>
        <div class="sk-lines">
          <div class="sk sk-line w40"></div>
          <div class="sk sk-line w60"></div>
          <div class="sk sk-line w40"></div>
        </div>
      </div>`;
  }

  function errorHTML(message) {
    return `<div class="alert" role="alert">${iconWarn}<div><strong>Tidak bisa diproses.</strong><br>${esc(message)}</div></div>`;
  }

  function mediaRowHTML(media) {
    const type = ICONS[media.type] ? media.type : 'file';
    const sub = [media.size, media.extension ? media.extension.toUpperCase() : ''].filter(Boolean).join(' · ');
    return `
      <div class="media-row">
        <div class="media-type">${ICONS[type]}</div>
        <div class="media-info">
          <strong>${esc(media.label || 'File')}</strong>
          <span>${esc(sub || 'Siap diunduh')}</span>
        </div>
        <div class="media-actions">
          <button class="icon-mini" type="button" data-copy="${esc(media.url)}" aria-label="Salin tautan">${iconCopy}</button>
          <a class="btn dl" href="${esc(media.url)}" target="_blank" rel="noopener noreferrer" download>
            ${iconDownload} Unduh
          </a>
        </div>
      </div>`;
  }

  function renderResult(data) {
    const thumbStyle = data.thumbnail ? `style="background-image:url('${esc(data.thumbnail)}')"` : '';
    const thumbClass = data.thumbnail ? 'thumb' : 'thumb thumb-fallback';
    const thumbContent = data.thumbnail ? '' : 'No image';

    const subParts = [];
    if (data.author) subParts.push(esc(data.author));
    if (data.duration) subParts.push(esc(data.duration));

    const chips = (data.extra || [])
      .filter((x) => x && x.value)
      .map((x) => `<span class="chip">${esc(x.label)}: ${esc(x.value)}</span>`)
      .join('');

    const body = data.medias && data.medias.length
      ? `<div class="media-list">${data.medias.map(mediaRowHTML).join('')}</div>`
      : `<div class="notice">${esc(data.notice || 'Tidak ada tautan unduhan yang tersedia untuk konten ini.')}</div>`;

    resultEl.innerHTML = `
      <div class="card">
        <div class="card-top">
          <div class="${thumbClass}" ${thumbStyle}>${thumbContent}</div>
          <div class="meta">
            <span class="platform-tag">${esc(data.platform?.label || 'Konten')}</span>
            <h3>${esc(data.title || 'Konten tanpa judul')}</h3>
            ${subParts.length ? `<div class="sub">${subParts.map((s) => `<span>${s}</span>`).join('')}</div>` : ''}
            ${chips ? `<div class="chips">${chips}</div>` : ''}
          </div>
        </div>
        ${body}
      </div>`;

    resultSection.hidden = false;

    // salin tautan
    $$('[data-copy]', resultEl).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.getAttribute('data-copy');
        try {
          await navigator.clipboard.writeText(url);
          setHint('Tautan disalin ke clipboard.', 'success');
        } catch (_) {
          setHint('Gagal menyalin tautan. Salin manual dari tombol Unduh.', 'error');
        }
      });
    });
  }

  /* ================================================================
     Riwayat (localStorage)
     ================================================================ */
  const HISTORY_KEY = 'tarik:history';
  const HISTORY_MAX = 20;

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function writeHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (_) {}
  }

  function addHistory(data) {
    const list = readHistory().filter((h) => h.url !== data.sourceUrl);
    list.unshift({
      url: data.sourceUrl,
      title: data.title,
      platform: data.platform?.label || 'Konten',
      thumbnail: data.thumbnail || '',
      at: Date.now(),
    });
    writeHistory(list);
    renderHistory();
  }

  function renderHistory() {
    const list = readHistory();

    if (!list.length) {
      historyList.innerHTML = '';
      historyEmpty.hidden = false;
      historySection.hidden = true;
      return;
    }

    historySection.hidden = false;
    historyEmpty.hidden = true;

    historyList.innerHTML = list
      .map((item, index) => {
        const thumb = item.thumbnail
          ? `<div class="h-thumb" style="background-image:url('${esc(item.thumbnail)}')"></div>`
          : `<div class="h-thumb">${esc((item.platform || '?').slice(0, 2).toUpperCase())}</div>`;
        const date = new Date(item.at).toLocaleString('id-ID', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        return `
          <li>
            ${thumb}
            <div class="h-info" data-index="${index}" role="button" tabindex="0" title="Tempel ulang tautan ini">
              <strong>${esc(item.title || 'Konten tanpa judul')}</strong>
              <span>${esc(item.platform)} · ${esc(date)}</span>
            </div>
            <button class="icon-mini" type="button" data-remove="${index}" aria-label="Hapus dari riwayat">${iconTrash}</button>
          </li>`;
      })
      .join('');

    $$('[data-remove]', historyList).forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove'));
        const list2 = readHistory();
        list2.splice(idx, 1);
        writeHistory(list2);
        renderHistory();
      });
    });

    $$('.h-info', historyList).forEach((el) => {
      const reuse = () => {
        const idx = Number(el.getAttribute('data-index'));
        const item = readHistory()[idx];
        if (!item) return;
        input.value = item.url;
        syncClearBtn();
        setHint('Tautan dimuat dari riwayat. Tekan Download untuk memproses ulang.', '');
        input.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      el.addEventListener('click', reuse);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reuse(); }
      });
    });
  }

  historyClear.addEventListener('click', () => {
    writeHistory([]);
    renderHistory();
    setHint('Riwayat dihapus.', 'success');
  });

  /* ================================================================
     Submit
     ================================================================ */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const value = input.value.trim();

    if (!value) {
      setHint('Tempel tautan terlebih dahulu.', 'error');
      input.focus();
      return;
    }

    if (!isValidHttpUrl(value)) {
      setHint('Format tautan tidak valid. Pastikan dimulai dengan http:// atau https://', 'error');
      input.focus();
      return;
    }

    const platform = detectPlatform(value);
    setBusy(true);
    setHint(platform ? `Mengambil konten dari ${platform.label}…` : 'Mengambil informasi konten…', '');
    resultSection.hidden = false;
    resultEl.innerHTML = skeletonHTML();
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });

      let json = null;
      try { json = await res.json(); } catch (_) {}

      if (!res.ok || !json || json.ok !== true) {
        const msg = json?.error?.message || `Permintaan gagal (${res.status}). Coba lagi.`;
        throw new Error(msg);
      }

      renderResult(json.data);
      addHistory(json.data);

      if (json.data.medias && json.data.medias.length) {
        setHint('Berhasil. Pilih format lalu tekan Unduh.', 'success');
      } else {
        setHint('Informasi konten ditemukan, tetapi tidak ada tautan unduhan.', '');
      }
    } catch (err) {
      const message = err && err.message ? err.message : 'Terjadi kesalahan. Coba lagi.';
      resultEl.innerHTML = errorHTML(message);
      setHint(message, 'error');
    } finally {
      setBusy(false);
    }
  });

  /* ================================================================
     Init
     ================================================================ */
  $('#year').textContent = String(new Date().getFullYear());
  syncClearBtn();
  renderHistory();

  // PWA-lite: kalau dibuka dengan ?url=... langsung isi kolom
  try {
    const preset = new URLSearchParams(location.search).get('url');
    if (preset && isValidHttpUrl(preset)) {
      input.value = preset.slice(0, 2048);
      syncClearBtn();
    }
  } catch (_) {}
})();