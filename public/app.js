(() => {
  'use strict';

  const themeToggle = document.getElementById('themeToggle');
  const urlForm = document.getElementById('urlForm');
  const urlInput = document.getElementById('urlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = submitBtn.querySelector('.btn-text');
  const spinner = submitBtn.querySelector('.spinner');
  const statusMessage = document.getElementById('statusMessage');
  const resultSection = document.getElementById('resultSection');
  const resultContainer = document.getElementById('resultContainer');

  // Tema
  const html = document.documentElement;
  const savedTheme = localStorage.getItem('theme') || 'dark';
  html.setAttribute('data-theme', savedTheme);

  themeToggle.addEventListener('click', () => {
    const newTheme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });

  // Tempel
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text;
        showMessage('Tautan ditempel.', 'success');
      } else {
        showMessage('Clipboard kosong.', 'error');
      }
    } catch (err) {
      showMessage('Izin clipboard ditolak.', 'error');
    }
  });

  function showMessage(text, type = '') {
    statusMessage.textContent = text;
    statusMessage.className = `message ${type}`;
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    pasteBtn.disabled = isLoading;
    btnText.textContent = isLoading ? 'Proses' : 'Unduh';
    spinner.hidden = !isLoading;
    if(isLoading) spinner.classList.add('spinner-light');
  }

  // Render Hasil
  function renderResult(data) {
    if (!data.medias || data.medias.length === 0) {
      resultSection.classList.add('active');
      resultContainer.innerHTML = `<p class="empty-state" style="text-align:center; padding:24px; color:var(--text-muted); font-size:14px;">Maaf, tautan tidak dapat diproses.</p>`;
      return;
    }

    const thumbStyle = data.thumbnail ? `style="background-image:url('${data.thumbnail}')"` : '';
    const author = data.author ? data.author : 'Unknown';
    const platform = data.platform ? data.platform.label : 'Media';

    const downloadsHTML = data.medias.map(media => {
      const safeTitle = (data.title || 'Zyxell_Download').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const ext = media.extension || 'mp4';
      const filename = `${safeTitle}.${ext}`;
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(media.url)}&filename=${encodeURIComponent(filename)}`;

      return `
        <div class="download-item">
          <div class="item-info">
            <span class="item-title">${media.label}</span>
            <span class="item-sub">${media.size ? media.size : 'Kualitas terbaik'}</span>
          </div>
          <button class="btn-dl" data-url="${proxyUrl}" data-filename="${filename}">
            Unduh
          </button>
        </div>
      `;
    }).join('');

    resultContainer.innerHTML = `
      <div class="result-card">
        <div class="card-header">
          <div class="thumbnail" ${thumbStyle}></div>
          <div class="meta">
            <h3>${data.title || 'Tanpa Judul'}</h3>
            <p><span class="badge">${platform}</span> ${author}</p>
          </div>
        </div>
        <div class="download-list">
          ${downloadsHTML}
        </div>
      </div>
    `;

    resultSection.classList.add('active');

    resultContainer.querySelectorAll('.btn-dl').forEach(btn => {
      btn.addEventListener('click', handleDownloadClick);
    });
  }

  // Aksi Unduh
  async function handleDownloadClick(e) {
    const btn = e.currentTarget;
    const url = btn.getAttribute('data-url');
    const filename = btn.getAttribute('data-filename');
    const originalText = btn.innerHTML;

    btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;border-top-color:var(--primary-text);"></span>`;
    btn.disabled = true;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Gagal mengunduh.');
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
      showMessage('File berhasil diunduh.', 'success');
    } catch (error) {
      showMessage('Gagal mengunduh file.', 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // Submit
  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();

    if (!url) return showMessage('Tempel tautan terlebih dahulu.', 'error');

    setLoading(true);
    showMessage('');
    
    resultSection.classList.add('active');
    resultContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:12px; padding:40px;">
        <span class="spinner spinner-light" style="width:24px; height:24px;"></span>
        <p style="color:var(--text-muted); font-size:14px;">Memproses tautan...</p>
      </div>
    `;

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error?.message || 'Gagal memproses tautan.');

      renderResult(json.data);
      showMessage('Siap diunduh.', 'success');

    } catch (error) {
      resultSection.classList.remove('active');
      showMessage(error.message, 'error');
    } finally {
      setLoading(false);
    }
  });

})();