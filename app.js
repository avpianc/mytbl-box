'use strict';

/* =========================================================================
   STORAGE ABSTRACTION
   Pakai chrome.storage.local kalau jalan sebagai extension, fallback ke
   localStorage kalau dibuka sebagai halaman biasa (memudahkan preview/testing).
   ========================================================================= */
const Storage = {
  isExtension: typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local),

  get(key) {
    if (this.isExtension) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => resolve(result[key]));
      });
    }
    try {
      const raw = localStorage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : undefined);
    } catch (e) {
      return Promise.resolve(undefined);
    }
  },

  set(key, value) {
    if (this.isExtension) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }
    localStorage.setItem(key, JSON.stringify(value));
    return Promise.resolve();
  },
};

const STORAGE_KEY = 'mytbl_manga_data';

/* =========================================================================
   SEED DATA — hanya dipakai saat pertama kali dibuka (storage kosong)
   ========================================================================= */
const SEED_DATA = [
  {
    id: 1,
    title: 'Monster (Premium Edition)',
    author: 'Naoki Urasawa',
    publisher: 'Akasha (Elex)',
    genre: 'Thriller',
    status: 'Sudah Lengkap',
    price: 150000,
    qty: 3,
    desc: 'Kisah thriller psikologis legendaris tentang Dr. Kenzo Tenma, seorang dokter bedah otak asal Jepang di Jerman yang mendapati hidupnya hancur setelah menyelamatkan nyawa Johan Liebert, yang kelak tumbuh menjadi pembunuh berantai sosiopat paling manipulatif.',
    image: 'https://images.tokopedia.net/img/cache/700/VqbcmM/2023/8/16/df0521e1-1c5c-4394-aef7-b0885f80b91d.jpg',
    addedAt: Date.now() - 200000,
  },
  {
    id: 2,
    title: 'Kagurabachi',
    author: 'Takeru Hokazono',
    publisher: 'Elex Media',
    genre: 'Action',
    status: 'On Going',
    price: 45000,
    qty: 1,
    desc: 'Kisah aksi balas dendam fantastis berfokus pada Chihiro, pemuda pandai besi yang memburu kelompok penyihir hitam bersenjatakan pedang katana sihir buatan mendiang ayahnya.',
    image: 'https://images.tokopedia.net/img/cache/700/VqbcmM/2024/11/4/cf5df200-c9a7-4b77-b9f4-1fbc8e37fe57.jpg',
    addedAt: Date.now() - 100000,
  },
];

const STATUS_COLORS = {
  'Wishlist':      { bg: '#FFF6D9', text: '#92660A', border: '#FFC93C' },
  'On Going':      { bg: '#E3ECFF', text: '#1A46E0', border: '#2D5FFF' },
  'Sudah Lengkap': { bg: '#E1F7EC', text: '#158A61', border: '#1FAE7A' },
};
// Palet warna genre — di-assign otomatis per genre pakai hash nama genre,
// jadi genre apapun (termasuk yang baru ditambah ke dropdown) selalu dapat
// warna yang konsisten tanpa perlu didaftarkan manual satu-satu di sini.
const GENRE_PALETTE = [
  { bg: '#EDE6FF', text: '#7139E0' }, // violet
  { bg: '#FFE8E2', text: '#E8431F' }, // coral
  { bg: '#FFF6D9', text: '#92660A' }, // sunny
  { bg: '#E1F7EC', text: '#158A61' }, // mint
  { bg: '#E3ECFF', text: '#1A46E0' }, // cobalt
  { bg: '#FFE3F1', text: '#E22F86' }, // pink
];

function statusStyleAttr(status) {
  const c = STATUS_COLORS[status] || { bg: '#F1F1F1', text: '#555', border: '#999' };
  return `background:${c.bg};color:${c.text};border-color:${c.border};`;
}
function genreColorIndex(genre) {
  let hash = 0;
  const str = String(genre || '');
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % GENRE_PALETTE.length;
}
function genreStyleAttr(genre) {
  const c = GENRE_PALETTE[genreColorIndex(genre)];
  return `background:${c.bg};color:${c.text};border-color:${c.text};`;
}
function allPublishersInUse() {
  return Array.from(new Set(mangaData.map((m) => m.publisher).filter(Boolean))).sort();
}
function renderPublisherFilters() {
  const container = $('publisher-filters');
  const publishers = allPublishersInUse();
  const activePublisher = state.publisher;
  container.innerHTML = `<button data-publisher="all" class="${activePublisher === 'all' ? 'pill-active' : 'pill'}">Semua Penerbit</button>` +
    publishers.map((p) => `<button data-publisher="${escapeHtml(p)}" class="${activePublisher === p ? 'pill-active' : 'pill'}">${escapeHtml(p)}</button>`).join('');
}

/* =========================================================================
   STATE
   ========================================================================= */
let mangaData = [];
let state = {
  publisher: 'all',
  status: 'all',
  search: '',
  sort: 'added-desc',
};
let uploadedImageBase64 = '';
let pendingPdfFile = null;   // File PDF yang lagi dipilih di form, sebelum disimpan
let pendingPdfCleared = false; // flag: user eksplisit hapus PDF yang sebelumnya sudah tersimpan
let readerState = { mangaId: null, paragraphs: [], fontSize: 19, theme: 'light', fontFamily: 'sans' };
let confirmCallback = null;
let selectedIds = new Set();
let genreTouchedByUser = false;
let mangaInfoLookupTimer = null;

/* =========================================================================
   HELPERS
   ========================================================================= */
function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

// PENTING: pakai fungsi ini, bukan `Number(m.qty) || 1` — karena qty=0 itu
// valid (misal status Wishlist yang belum dimiliki sama sekali), dan `0 || 1`
// di JS keliru menghasilkan 1.
function getQty(m) {
  const n = Number(m.qty);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function $(id) { return document.getElementById(id); }

/* =========================================================================
   TOASTS
   ========================================================================= */
function showToast(message, type = 'success') {
  const container = $('toast-container');
  const config = {
    success: { icon: '✓', color: 'text-emerald-400' },
    error:   { icon: '✕', color: 'text-red-400' },
    info:    { icon: 'i', color: 'text-blue-400' },
  }[type] || { icon: '•', color: 'text-neutral-400' };

  const el = document.createElement('div');
  el.className = 'toast pointer-events-auto';
  el.innerHTML = `<span class="${config.color} font-black text-sm w-4 text-center shrink-0">${config.icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity .25s ease, transform .25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

/* =========================================================================
   MODAL HELPERS
   ========================================================================= */
function openOverlay(id) {
  const el = $(id);
  el.classList.remove('hidden');
  el.classList.add('flex');
}
function closeOverlay(id) {
  const el = $(id);
  el.classList.add('hidden');
  el.classList.remove('flex');
}
function topmostOpenOverlay() {
  const ids = ['confirm-modal', 'form-modal', 'detail-modal'];
  return ids.find((id) => !$(id).classList.contains('hidden'));
}

function showConfirm(title, message, onConfirm) {
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  confirmCallback = onConfirm;
  openOverlay('confirm-modal');
}

/* =========================================================================
   PERSISTENCE
   ========================================================================= */
async function loadData() {
  const stored = await Storage.get(STORAGE_KEY);
  if (Array.isArray(stored)) {
    mangaData = stored;
  } else {
    mangaData = SEED_DATA;
    await saveData();
  }
}

async function saveData() {
  await Storage.set(STORAGE_KEY, mangaData);
}

/* =========================================================================
   RENDER: STATS
   ========================================================================= */
function renderStats() {
  $('stat-total').textContent = mangaData.length;
  const totalValue = mangaData.reduce((sum, m) => sum + (Number(m.price) || 0) * getQty(m), 0);
  $('stat-value').textContent = formatRupiah(totalValue);
}

/* =========================================================================
   RENDER: GRID
   ========================================================================= */
function getFilteredSortedData() {
  const q = state.search.trim().toLowerCase();

  let data = mangaData.filter((m) => {
    const matchPublisher = state.publisher === 'all' || m.publisher === state.publisher;
    const matchStatus = state.status === 'all' || m.status === state.status;
    const matchSearch = !q || m.title.toLowerCase().includes(q) || m.author.toLowerCase().includes(q);
    return matchPublisher && matchStatus && matchSearch;
  });

  const sorters = {
    'added-desc': (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    'title-asc': (a, b) => a.title.localeCompare(b.title),
    'title-desc': (a, b) => b.title.localeCompare(a.title),
    'price-desc': (a, b) => ((Number(b.price)||0)*getQty(b)) - ((Number(a.price)||0)*getQty(a)),
    'price-asc': (a, b) => ((Number(a.price)||0)*getQty(a)) - ((Number(b.price)||0)*getQty(b)),
  };
  data = data.sort(sorters[state.sort] || sorters['added-desc']);
  return data;
}

function renderManga() {
  const listContainer = $('manga-list');
  const filteredData = getFilteredSortedData();

  if (filteredData.length === 0) {
    const hasAnyData = mangaData.length > 0;
    listContainer.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-20 text-center">
        <div class="w-16 h-16 rounded-full bg-white border-2 border-ink flex items-center justify-center mb-4 shadow-pop-sm -rotate-3">
          <svg class="w-7 h-7 text-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V17a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        </div>
        <p class="text-ink text-sm font-display font-bold mb-1">${hasAnyData ? 'Tidak ada komik yang cocok' : 'Koleksi kamu masih kosong'}</p>
        <p class="text-ink/50 text-xs">${hasAnyData ? 'Coba ubah filter, pencarian, atau kategori status.' : 'Tekan tombol "Add Comic" di kanan bawah untuk mulai menambah koleksi.'}</p>
      </div>`;
    return;
  }

  listContainer.innerHTML = filteredData.map((manga) => {
    const initials = escapeHtml(manga.title.substring(0, 2).toUpperCase());
    const statusShort = escapeHtml(manga.status.replace('Sudah ', ''));
    const qty = getQty(manga);
    const total = (Number(manga.price) || 0) * qty;
    const priceLabel = qty > 0 ? formatRupiah(total) : 'Belum Dimiliki';
    const totalVol = Number(manga.totalVolumes) || 0;
    const volLabel = totalVol > 0 ? `${qty} / ${totalVol} Vol` : `${qty} Vol`;
    const volPct = totalVol > 0 ? Math.min(100, Math.round((qty / totalVol) * 100)) : 0;
    return `
      <div data-id="${manga.id}" data-action="open-detail" class="card-poster group">
        <div>
          <div class="aspect-[2/3] w-full rounded-2xl overflow-hidden bg-gradient-to-br from-coral-light to-white border-2 border-ink relative mb-3 flex items-center justify-center">
            <img src="${escapeHtml(manga.image)}" alt="${escapeHtml(manga.title)}"
                 loading="lazy"
                 class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
            <span class="sticker-badge" style="${statusStyleAttr(manga.status)}">${statusShort}</span>
            <button type="button" data-action="toggle-select" data-id="${manga.id}"
                    class="select-checkbox ${selectedIds.has(manga.id) ? 'select-checkbox-active' : ''}"
                    aria-label="Pilih ${escapeHtml(manga.title)}">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
            </button>
            <div class="absolute inset-0 hidden flex-col items-center justify-center bg-gradient-to-b from-coral-light via-white to-paper text-center p-2">
              <div class="w-12 h-12 rounded-full bg-white border-2 border-ink flex items-center justify-center text-coral-dark font-display font-extrabold text-base tracking-widest shadow-pop-sm mb-2">${initials}</div>
              <span class="text-[10px] text-ink/60 px-2 font-bold line-clamp-2">${escapeHtml(manga.title)}</span>
            </div>
          </div>
          <h3 class="text-sm font-display font-bold text-ink tracking-tight leading-snug line-clamp-1 mb-0.5 group-hover:text-coral-dark transition">${manga.hasPdf ? '<span title="Bisa dibaca">📖</span> ' : ''}${escapeHtml(manga.title)}</h3>
          <p class="text-[11px] text-ink/50 truncate mb-2">By: ${escapeHtml(manga.author)}</p>
        </div>
        <div class="pt-2.5 border-t-2 border-ink/10 flex flex-col gap-1.5">
          <div class="flex justify-between items-center gap-2">
            <span class="text-[9px] font-display font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border-2 truncate max-w-[55%]" style="${genreStyleAttr(manga.genre)}">${escapeHtml(manga.genre)}</span>
            <span class="text-xs font-display font-black ${qty > 0 ? 'text-coral-dark' : 'text-ink/35'} tracking-tight">${priceLabel}</span>
          </div>
          <div class="flex justify-between items-center gap-2">
            <span class="text-[9px] text-ink/40 font-bold truncate">${escapeHtml(manga.publisher)}</span>
            <span class="text-[9px] text-ink/40 font-semibold shrink-0">${volLabel}</span>
          </div>
          ${totalVol > 0 ? `<div class="w-full h-1.5 bg-ink/10 rounded-full overflow-hidden"><div class="h-full bg-coral rounded-full" style="width:${volPct}%"></div></div>` : ''}
        </div>
      </div>`;
  }).join('');

  renderStats();
}

function renderAll() {
  renderPublisherFilters();
  renderManga();
  renderStats();
}

/* =========================================================================
   FILTER / SORT / SEARCH UI
   ========================================================================= */
function setPublisherFilter(publisher) {
  state.publisher = publisher;
  document.querySelectorAll('#publisher-filters button').forEach((btn) => {
    const match = btn.dataset.publisher === publisher;
    btn.className = match ? 'pill-active' : 'pill';
  });
  renderManga();
}

function setStatusFilter(status) {
  state.status = status;
  document.querySelectorAll('#status-tabs button').forEach((btn) => {
    const match = btn.dataset.status === status;
    btn.className = match ? 'status-tab-active' : 'status-tab';
  });
  renderManga();
}

/* =========================================================================
   DETAIL MODAL
   ========================================================================= */
let activeDetailId = null;

function openDetailModal(id) {
  const manga = mangaData.find((m) => m.id === id);
  if (!manga) return;
  activeDetailId = id;

  const modalImg = $('modal-img');
  const initials = manga.title.substring(0, 2).toUpperCase();
  const container = $('modal-img-container');
  container.className = 'w-24 h-36 flex-shrink-0 rounded-xl overflow-hidden border-[2.5px] border-ink shadow-pop-sm';
  container.innerHTML = `<img id="modal-img" src="${escapeHtml(manga.image)}" alt="" class="w-full h-full object-cover">`;
  $('modal-img').onerror = function () {
    container.className = 'w-24 h-36 flex-shrink-0 rounded-xl bg-gradient-to-br from-coral-light via-white to-paper flex flex-col items-center justify-center border-[2.5px] border-ink shadow-pop-sm';
    container.innerHTML = `<div class="text-coral-dark font-display font-black text-lg">${escapeHtml(initials)}</div>`;
  };

  $('modal-title').textContent = manga.title;
  $('modal-author').textContent = 'Oleh: ' + manga.author;
  $('modal-publisher').textContent = manga.publisher;
  $('modal-desc').textContent = manga.desc;
  $('modal-genre').textContent = manga.genre;
  $('modal-genre').setAttribute('style', genreStyleAttr(manga.genre));
  const mQty = getQty(manga);
  const totalVol = Number(manga.totalVolumes) || 0;
  $('modal-vol-label').textContent = totalVol > 0 ? `Total (${mQty} / ${totalVol} Vol)` : `Total (${mQty} Vol)`;
  if (mQty > 0) {
    $('modal-price').textContent = formatRupiah((Number(manga.price) || 0) * mQty);
    $('modal-price').className = 'text-xs font-display font-black text-coral-dark';
  } else {
    $('modal-price').textContent = 'Belum Dimiliki';
    $('modal-price').className = 'text-xs font-display font-black text-ink/40';
  }
  $('modal-price-detail').textContent = mQty !== 1 && Number(manga.price) > 0 ? `${formatRupiah(manga.price)} / vol` : '';
  const progWrap = $('modal-vol-progress-wrap');
  if (totalVol > 0) {
    progWrap.classList.remove('hidden');
    $('modal-vol-progress-bar').style.width = `${Math.min(100, Math.round((mQty / totalVol) * 100))}%`;
  } else {
    progWrap.classList.add('hidden');
  }

  const badge = $('modal-status');
  badge.textContent = 'Status: ' + manga.status;
  badge.setAttribute('style', statusStyleAttr(manga.status));

  const readBtn = $('modal-btn-read');
  readBtn.classList.toggle('hidden', !manga.hasPdf);

  openOverlay('detail-modal');
}

function closeDetailModal() {
  closeOverlay('detail-modal');
  activeDetailId = null;
}

/* =========================================================================
   FORM MODAL (Add / Edit)
   ========================================================================= */
function clearFieldErrors() {
  document.querySelectorAll('.field-error-msg').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.input-field').forEach((el) => el.classList.remove('field-error'));
}

function showFieldError(inputId) {
  const input = $(inputId);
  if (input) input.classList.add('field-error');
  const msg = document.querySelector(`[data-error-for="${inputId}"]`);
  if (msg) msg.classList.remove('hidden');
}

function clearUploadedImage() {
  uploadedImageBase64 = '';
  $('form-image-file').value = '';
  $('file-preview-container').classList.add('hidden');
  $('file-preview-container').classList.remove('flex');
  $('drop-zone-text').innerHTML = 'Drag gambar kemari, klik untuk pilih file, atau tekan <span class="text-red-400 font-bold">Ctrl+V</span>';
}

function setUploadedImage(dataUrl) {
  uploadedImageBase64 = dataUrl;
  $('form-image-url').value = '';
  $('file-preview-thumb').src = dataUrl;
  $('file-preview-container').classList.remove('hidden');
  $('file-preview-container').classList.add('flex');
  $('drop-zone-text').innerHTML = '<span class="text-emerald-400 font-bold">✓ Sampul termuat, siap disimpan</span>';
}

/* =========================================================================
   AUTO-LOOKUP INFO MANGA (genre & total volume tamat) LEWAT JIKAN API
   Dipicu otomatis tiap judul/pengarang di form berubah — bukan cuma pas
   import dari Gramedia/Shopee, tapi juga pas nambah/edit manual.
   ========================================================================= */
function resetTotalVolInfo(text) {
  $('total-vol-info').textContent = text;
}

function scheduleMangaInfoLookup() {
  clearTimeout(mangaInfoLookupTimer);
  mangaInfoLookupTimer = setTimeout(autoLookupMangaInfo, 700);
}

/* ---- Lookup Jikan/Google Books LANGSUNG dari halaman (dipakai kalau app
   ini jalan sebagai PWA/halaman biasa, bukan Chrome extension — jadi gak
   ada background service worker buat direlay). Logikanya sama persis
   dengan yang ada di background.js versi extension. ---- */
const JIKAN_TO_APP_GENRE_DIRECT = [
  { match: /psychological/i, genre: 'Psychological' },
  { match: /suspense/i, genre: 'Suspense' },
  { match: /horror/i, genre: 'Horror' },
  { match: /mystery/i, genre: 'Mystery' },
  { match: /isekai/i, genre: 'Isekai' },
  { match: /supernatural/i, genre: 'Supernatural' },
  { match: /mecha/i, genre: 'Mecha' },
  { match: /historical/i, genre: 'Historical' },
  { match: /sports/i, genre: 'Sports' },
  { match: /slice of life/i, genre: 'Slice of Life' },
  { match: /sci-?fi/i, genre: 'Sci-Fi' },
  { match: /fantasy/i, genre: 'Fantasy' },
  { match: /romance/i, genre: 'Romance' },
  { match: /comedy/i, genre: 'Comedy' },
  { match: /adventure/i, genre: 'Adventure' },
  { match: /action/i, genre: 'Action' },
  { match: /^drama$/i, genre: 'Drama' },
];
const GBOOKS_TO_APP_GENRE_DIRECT = [
  { match: /biography|autobiography/i, genre: 'Biography' },
  { match: /self-help/i, genre: 'Self-Help' },
  { match: /business|economics/i, genre: 'Business' },
  { match: /juvenile|children/i, genre: 'Children' },
  { match: /education|study aids/i, genre: 'Education' },
  { match: /science/i, genre: 'Science' },
  { match: /history/i, genre: 'Historical' },
  { match: /humor/i, genre: 'Comedy' },
  { match: /horror/i, genre: 'Horror' },
  { match: /mystery|detective/i, genre: 'Mystery' },
  { match: /romance/i, genre: 'Romance' },
  { match: /fantasy/i, genre: 'Fantasy' },
  { match: /science fiction/i, genre: 'Sci-Fi' },
  { match: /drama/i, genre: 'Drama' },
  { match: /comics? & graphic novels/i, genre: 'Action' },
  { match: /fiction/i, genre: 'Non-Fiction' },
];
function mapTagsDirect(tags, map) {
  const lower = tags.map((t) => String(t).toLowerCase());
  for (const { match, genre } of map) {
    if (lower.some((t) => match.test(t))) return genre;
  }
  return '';
}
function buildSearchCandidatesDirect(title) {
  const candidates = [];
  const push = (t) => { const v = t.trim(); if (v && !candidates.includes(v)) candidates.push(v); };
  push(title);
  const noVolume = title.replace(/\s*(vol\.?|volume|chapter|ch\.?)?\s*#?\d+\s*$/i, '');
  push(noVolume);
  if (noVolume.includes(':')) push(noVolume.split(':').slice(1).join(':'));
  if (noVolume.includes('-') && !noVolume.includes(':')) push(noVolume.split('-').slice(-1)[0]);
  return candidates;
}
function fetchWithTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}
async function lookupBookInfoDirect(title) {
  const candidates = buildSearchCandidatesDirect(title);
  for (const candidate of candidates) {
    try {
      const res = await fetchWithTimeout(fetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(candidate)}&limit=1`), 3000);
      if (!res || !res.ok) continue;
      const json = await res.json();
      const manga = json && json.data && json.data[0];
      if (!manga) continue;
      const tags = [...(manga.genres || []), ...(manga.themes || [])].map((g) => g.name);
      const genre = mapTagsDirect(tags, JIKAN_TO_APP_GENRE_DIRECT);
      const totalVolumes = Number.isInteger(manga.volumes) && manga.volumes > 0 ? manga.volumes : null;
      if (genre || totalVolumes) return { ok: true, genre, totalVolumes, source: 'MyAnimeList' };
    } catch (e) { /* coba kandidat berikutnya */ }
  }
  try {
    const res = await fetchWithTimeout(fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=1`), 3000);
    if (res && res.ok) {
      const json = await res.json();
      const info = json && json.items && json.items[0] && json.items[0].volumeInfo;
      const categories = info && (info.categories || (info.mainCategory ? [info.mainCategory] : []));
      if (categories && categories.length) {
        const genre = mapTagsDirect(categories, GBOOKS_TO_APP_GENRE_DIRECT);
        if (genre) return { ok: true, genre, totalVolumes: null, source: 'Google Books' };
      }
    }
  } catch (e) { /* gagal juga, nyerah */ }
  return { ok: true, genre: '', totalVolumes: null, source: null };
}

// Titik masuk tunggal buat auto-lookup: lewat extension messaging kalau ada
// background service worker, atau fetch langsung kalau jalan sebagai PWA.
function requestBookInfo(title, callback) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && Storage.isExtension) {
    chrome.runtime.sendMessage({ type: 'MYTBL_LOOKUP_MANGA_INFO', title }, (response) => {
      if (chrome.runtime.lastError || !response) { callback(null); return; }
      callback(response);
    });
  } else {
    lookupBookInfoDirect(title).then(callback).catch(() => callback(null));
  }
}

function autoLookupMangaInfo() {
  const title = $('form-title').value.trim();
  if (!title) { resetTotalVolInfo('Isi judul dulu buat cek otomatis.'); return; }

  resetTotalVolInfo('Mencari data buku/manga...');
  requestBookInfo(title, (response) => {
    if (!response) {
      resetTotalVolInfo('Gagal mengecek otomatis — isi manual kalau tau.');
      return;
    }
    if (response.totalVolumes) {
      if (!$('form-total-volumes').value) $('form-total-volumes').value = response.totalVolumes;
      resetTotalVolInfo(`Ditemukan: seri ini tamat di volume ${response.totalVolumes} (dari ${response.source || 'MyAnimeList'}).`);
    } else if (response.genre) {
      resetTotalVolInfo(`Genre ketemu dari ${response.source} — kalau ini bagian dari satu set/seri, isi manual jumlahnya di sini.`);
    } else {
      resetTotalVolInfo('Belum ketemu datanya (manga masih ongoing, atau bukan buku manga) — isi manual kalau tau.');
    }
    if (response.genre && !genreTouchedByUser) {
      $('form-genre').value = response.genre;
      $('form-genre')._syncCustomSelect?.();
    }
  });
}

function openAddModal() {
  $('manga-form').reset();
  $('form-id').value = '';
  $('form-total-volumes').value = '';
  genreTouchedByUser = false;
  $('form-genre')._syncCustomSelect?.();
  $('form-status')._syncCustomSelect?.();
  clearUploadedImage();
  resetPdfFormState();
  clearFieldErrors();
  resetTotalVolInfo('Otomatis dicek dari judul & pengarang...');
  $('form-modal-title').textContent = 'Tambah Komik Baru';
  $('form-submit-btn').textContent = 'Simpan Koleksi';
  openOverlay('form-modal');
  setTimeout(() => $('form-title').focus(), 50);
}

function openEditModal(id) {
  const manga = mangaData.find((m) => m.id === id);
  if (!manga) return;

  clearFieldErrors();
  genreTouchedByUser = false;
  $('form-id').value = manga.id;
  $('form-title').value = manga.title;
  $('form-author').value = manga.author;
  $('form-publisher').value = manga.publisher;
  $('form-price').value = manga.price;
  $('form-qty').value = getQty(manga);
  $('form-total-volumes').value = manga.totalVolumes || '';
  $('form-genre').value = manga.genre;
  $('form-genre')._syncCustomSelect?.();
  $('form-status').value = manga.status;
  $('form-status')._syncCustomSelect?.();
  $('form-desc').value = manga.desc;

  if (manga.image && manga.image.startsWith('data:image')) {
    setUploadedImage(manga.image);
  } else {
    clearUploadedImage();
    $('form-image-url').value = manga.image || '';
  }

  resetPdfFormState();
  if (manga.hasPdf) {
    $('pdf-drop-zone-text').textContent = '✓ Sudah ada file PDF tersimpan (pilih file baru buat ganti)';
    $('pdf-clear-row').classList.remove('hidden');
    $('pdf-clear-row').classList.add('flex');
  }

  $('form-modal-title').textContent = 'Edit Detail Komik';
  $('form-submit-btn').textContent = 'Simpan Perubahan';
  openOverlay('form-modal');
  setTimeout(() => $('form-title').focus(), 50);

  if (manga.totalVolumes) {
    resetTotalVolInfo(`Tamat di volume ${manga.totalVolumes} (tersimpan).`);
  } else {
    resetTotalVolInfo('Mengecek ulang total volume...');
    scheduleMangaInfoLookup();
  }
}

function closeFormModal() {
  closeOverlay('form-modal');
}

async function handleFormSubmit(event) {
  event.preventDefault();
  clearFieldErrors();

  const title = $('form-title').value.trim();
  const author = $('form-author').value.trim();
  const publisher = $('form-publisher').value.trim();
  const priceRaw = $('form-price').value;
  const qtyRaw = $('form-qty').value;
  const desc = $('form-desc').value.trim();

  let hasError = false;
  if (!title) { showFieldError('form-title'); hasError = true; }
  if (!author) { showFieldError('form-author'); hasError = true; }
  if (!publisher) { showFieldError('form-publisher'); hasError = true; }
  if (!desc) { showFieldError('form-desc'); hasError = true; }
  if (priceRaw === '' || isNaN(priceRaw) || Number(priceRaw) < 0) { showFieldError('form-price'); hasError = true; }
  if (qtyRaw === '' || isNaN(qtyRaw) || Number(qtyRaw) < 0 || !Number.isInteger(Number(qtyRaw))) { showFieldError('form-qty'); hasError = true; }

  if (hasError) {
    showToast('Lengkapi dulu data yang wajib diisi.', 'error');
    return;
  }

  let finalImage = 'https://placehold.co/240x360/161824/cccccc?text=No+Cover';
  if (uploadedImageBase64) finalImage = uploadedImageBase64;
  else if ($('form-image-url').value.trim()) finalImage = $('form-image-url').value.trim();

  const qtyVal = Number(qtyRaw);
  const status = $('form-status').value;
  let totalVolumesRaw = $('form-total-volumes').value;
  let totalVolumes = totalVolumesRaw !== '' && !isNaN(totalVolumesRaw) ? Math.max(0, parseInt(totalVolumesRaw, 10)) : null;
  // Kalau status-nya "Sudah Lengkap" tapi total volume belum diisi (mis. seri
  // lawas yang gak ketemu di MyAnimeList), anggap jumlah yang dimiliki = total,
  // karena "Lengkap" berarti seluruh serinya sudah ada di tangan kamu.
  if (status === 'Sudah Lengkap' && !totalVolumes && qtyVal > 0) totalVolumes = qtyVal;

  const idVal = $('form-id').value;
  const payload = {
    title, author, publisher,
    genre: $('form-genre').value,
    status,
    price: Number(priceRaw),
    qty: qtyVal,
    totalVolumes,
    desc,
    image: finalImage,
  };

  let finalId;
  if (idVal) {
    finalId = parseInt(idVal, 10);
    const index = mangaData.findIndex((m) => m.id === finalId);
    if (index !== -1) mangaData[index] = { ...mangaData[index], ...payload };
    showToast('Perubahan berhasil disimpan.', 'success');
  } else {
    finalId = mangaData.length > 0 ? Math.max(...mangaData.map((m) => m.id)) + 1 : 1;
    mangaData.push({ id: finalId, addedAt: Date.now(), hasPdf: false, ...payload });
    showToast('Komik baru ditambahkan ke koleksi.', 'success');
  }

  // Simpan/hapus file PDF di IndexedDB sesuai aksi user di form
  const targetIndex = mangaData.findIndex((m) => m.id === finalId);
  try {
    if (pendingPdfFile) {
      await savePdfRecord(finalId, { blob: pendingPdfFile, fileName: pendingPdfFile.name, parsedParagraphs: null });
      if (targetIndex !== -1) mangaData[targetIndex].hasPdf = true;
    } else if (pendingPdfCleared) {
      await deletePdfRecord(finalId);
      if (targetIndex !== -1) mangaData[targetIndex].hasPdf = false;
    }
  } catch (e) {
    showToast('Gagal menyimpan file PDF (ukuran mungkin terlalu besar).', 'error');
  }

  await saveData();
  renderAll();
  closeFormModal();
}

/* =========================================================================
   DELETE
   ========================================================================= */
function requestDelete(id) {
  const manga = mangaData.find((m) => m.id === id);
  if (!manga) return;
  showConfirm(
    'Hapus komik ini?',
    `"${manga.title}" akan dihapus permanen dari koleksi kamu. Tindakan ini tidak bisa dibatalkan.`,
    async () => {
      mangaData = mangaData.filter((m) => m.id !== id);
      selectedIds.delete(id);
      if (manga.hasPdf) deletePdfRecord(id).catch(() => {});
      await saveData();
      renderAll();
      closeOverlay('detail-modal');
      showToast('Komik dihapus dari koleksi.', 'info');
    }
  );
}

/* =========================================================================
   SELEKSI & HAPUS MASSAL
   ========================================================================= */
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderManga();
  updateBulkBar();
}

function updateBulkBar() {
  const bar = $('bulk-bar');
  const count = selectedIds.size;
  bar.classList.toggle('hidden', count === 0);
  bar.classList.toggle('flex', count > 0);
  $('bulk-count').textContent = count;

  const visible = getFilteredSortedData();
  const allVisibleSelected = visible.length > 0 && visible.every((m) => selectedIds.has(m.id));
  $('bulk-select-all-btn').textContent = allVisibleSelected ? 'Batalkan semua yang tampil' : 'Pilih semua yang tampil';
}

function bulkSelectAllVisible() {
  const visible = getFilteredSortedData();
  const allSelected = visible.length > 0 && visible.every((m) => selectedIds.has(m.id));
  if (allSelected) visible.forEach((m) => selectedIds.delete(m.id));
  else visible.forEach((m) => selectedIds.add(m.id));
  renderManga();
  updateBulkBar();
}

function bulkCancelSelection() {
  selectedIds.clear();
  renderManga();
  updateBulkBar();
}

function bulkDeleteSelected() {
  const count = selectedIds.size;
  if (count === 0) return;
  const sampleTitles = mangaData.filter((m) => selectedIds.has(m.id)).slice(0, 3).map((m) => m.title);
  const preview = sampleTitles.join(', ') + (count > 3 ? `, dan ${count - 3} lainnya` : '');
  showConfirm(
    `Hapus ${count} komik?`,
    `${preview} akan dihapus permanen dari koleksi kamu. Tindakan ini tidak bisa dibatalkan.`,
    async () => {
      const idsWithPdf = mangaData.filter((m) => selectedIds.has(m.id) && m.hasPdf).map((m) => m.id);
      mangaData = mangaData.filter((m) => !selectedIds.has(m.id));
      selectedIds.clear();
      idsWithPdf.forEach((id) => deletePdfRecord(id).catch(() => {}));
      await saveData();
      renderAll();
      updateBulkBar();
      showToast(`${count} komik dihapus dari koleksi.`, 'info');
    }
  );
}

/* =========================================================================
   IMAGE INPUT: drag & drop, paste, file picker, kompresi otomatis
   ========================================================================= */
function compressImage(file, maxWidth = 640, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Bukan file gambar')); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Gagal memuat gambar'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

async function processFile(file) {
  try {
    const compressed = await compressImage(file);
    setUploadedImage(compressed);
  } catch (err) {
    showToast('Gagal memuat gambar: ' + err.message, 'error');
  }
}

/* =========================================================================
   CUSTOM DROPDOWN (pengganti tampilan <select> native yang gak bisa di-style)
   Elemen <select> ASLI tetap ada di DOM (disembunyikan) supaya semua kode lain
   yang baca/tulis `.value` tetap jalan seperti biasa — cuma tampilannya diganti.
   ========================================================================= */
function enhanceSelect(selectEl) {
  if (!selectEl || selectEl.dataset.enhanced) return;
  selectEl.dataset.enhanced = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);
  selectEl.classList.add('hidden');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = selectEl.dataset.btnClass ? `custom-select-btn ${selectEl.dataset.btnClass}` : 'custom-select-btn';
  btn.innerHTML = `<span class="truncate"></span>
    <svg class="w-3.5 h-3.5 text-ink/40 shrink-0 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>`;

  const list = document.createElement('div');
  list.className = 'custom-select-list hidden';

  function sync() {
    const opts = Array.from(selectEl.options);
    list.innerHTML = opts.map((o) =>
      `<button type="button" data-value="${escapeHtml(o.value)}" class="${o.value === selectEl.value ? 'custom-select-option custom-select-option-active' : 'custom-select-option'}">${escapeHtml(o.textContent)}</button>`
    ).join('');
    btn.querySelector('span').textContent = opts[selectEl.selectedIndex]?.textContent || '';
  }
  sync();
  selectEl._syncCustomSelect = sync;

  function closeList() {
    list.classList.add('hidden');
    btn.querySelector('svg').style.transform = '';
  }
  function toggleList(e) {
    e.stopPropagation();
    const isOpening = list.classList.contains('hidden');
    document.querySelectorAll('.custom-select-list').forEach((l) => l.classList.add('hidden'));
    if (isOpening) {
      list.classList.remove('hidden');
      btn.querySelector('svg').style.transform = 'rotate(180deg)';
    }
  }
  btn.addEventListener('click', toggleList);
  list.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-value]');
    if (!opt) return;
    selectEl.value = opt.dataset.value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    closeList();
  });
  document.addEventListener('click', closeList);

  wrapper.appendChild(btn);
  wrapper.appendChild(list);
}

function enhanceAllSelects() {
  document.querySelectorAll('select').forEach(enhanceSelect);
}

function initImageInputs() {
  const dropZone = $('drop-zone');
  const fileInput = $('form-image-file');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    if (this.files.length > 0) processFile(this.files[0]);
  });

  ['dragenter', 'dragover'].forEach((name) => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.add('border-red-500/60', 'bg-red-500/5');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-red-500/60', 'bg-red-500/5');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0]);
  });

  document.addEventListener('paste', (e) => {
    if ($('form-modal').classList.contains('hidden')) return;
    const items = (e.clipboardData || window.clipboardData).items;
    for (const item of items) {
      if (item.kind === 'file' && item.type.indexOf('image/') !== -1) {
        processFile(item.getAsFile());
        break;
      }
    }
  });
}

/* =========================================================================
   EXPORT / IMPORT BACKUP
   ========================================================================= */
function exportBackup() {
  const payload = {
    app: 'MyTBL Box',
    exportedAt: new Date().toISOString(),
    data: mangaData,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `mytbl-box-backup-${dateStr}.json`;
  a.click();
  showToast('Backup koleksi berhasil diunduh.', 'success');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const incoming = Array.isArray(parsed) ? parsed : parsed.data;
      if (!Array.isArray(incoming)) throw new Error('Format file tidak dikenali.');

      showConfirm(
        'Impor backup?',
        `Ditemukan ${incoming.length} judul di file ini. Data akan ditambahkan ke koleksi kamu saat ini (bukan menimpa).`,
        async () => {
          let nextId = mangaData.length > 0 ? Math.max(...mangaData.map((m) => m.id)) + 1 : 1;
          const cleaned = incoming.map((item) => ({
            id: nextId++,
            title: String(item.title || 'Tanpa Judul'),
            author: String(item.author || '-'),
            publisher: String(item.publisher || '-'),
            genre: String(item.genre || 'Action'),
            status: ['Wishlist', 'On Going', 'Sudah Lengkap'].includes(item.status) ? item.status : 'Wishlist',
            price: Number(item.price) || 0,
            qty: Number.isInteger(item.qty) && item.qty >= 0 ? item.qty : 1,
            totalVolumes: Number.isInteger(item.totalVolumes) && item.totalVolumes > 0 ? item.totalVolumes : null,
            desc: String(item.desc || ''),
            image: String(item.image || 'https://placehold.co/240x360/161824/cccccc?text=No+Cover'),
            hasPdf: false, // file PDF (kalau ada) gak ikut ke-backup di JSON, cuma metadata-nya
            addedAt: Date.now(),
          }));
          mangaData = mangaData.concat(cleaned);
          await saveData();
          renderAll();
          showToast(`${cleaned.length} judul berhasil diimpor.`, 'success');
        }
      );
    } catch (err) {
      showToast('Gagal membaca file backup: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
function initEventListeners() {
  // Genre filter
  $('publisher-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-publisher]');
    if (btn) setPublisherFilter(btn.dataset.publisher);
  });

  // Status filter
  $('status-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (btn) setStatusFilter(btn.dataset.status);
  });

  // Sort
  $('sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderManga();
  });

  // Search (debounced)
  $('search-input').addEventListener('input', debounce((e) => {
    state.search = e.target.value;
    renderManga();
  }, 200));

  // Grid: checkbox seleksi (dicek duluan), baru fallback buka detail
  $('manga-list').addEventListener('click', (e) => {
    const checkbox = e.target.closest('[data-action="toggle-select"]');
    if (checkbox) {
      e.stopPropagation();
      toggleSelect(parseInt(checkbox.dataset.id, 10));
      return;
    }
    const card = e.target.closest('[data-action="open-detail"]');
    if (card) openDetailModal(parseInt(card.dataset.id, 10));
  });

  // Fallback saat gambar sampul gagal dimuat (error tidak bubble, jadi pakai capture phase)
  $('manga-list').addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.closest('.card-poster')) {
      img.style.display = 'none';
      if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    }
  }, true);

  // Settings menu toggle
  $('btn-settings').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('settings-menu');
    const isHidden = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    $('btn-settings').setAttribute('aria-expanded', String(isHidden));
  });
  document.addEventListener('click', () => $('settings-menu').classList.add('hidden'));

  // Delegated data-action clicks (buttons across modals/menu)
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;

    switch (action) {
      case 'open-add': openAddModal(); break;
      case 'close-detail': closeDetailModal(); break;
      case 'close-form': closeFormModal(); break;
      case 'clear-image': clearUploadedImage(); break;
      case 'clear-pdf': clearPdfSelection(); break;
      case 'open-reader': {
        if (activeDetailId == null) break;
        const idToRead = activeDetailId;
        closeDetailModal();
        openReader(idToRead);
        break;
      }
      case 'close-reader': closeReader(); break;
      case 'reader-font-inc': changeReaderFontSize(1); break;
      case 'reader-font-dec': changeReaderFontSize(-1); break;
      case 'reader-theme-cycle': cycleReaderTheme(); break;
      case 'reader-font-family-cycle': cycleReaderFontFamily(); break;
      case 'open-edit': {
        const idToEdit = activeDetailId;
        closeDetailModal();
        openEditModal(idToEdit);
        break;
      }
      case 'delete-from-detail': if (activeDetailId != null) requestDelete(activeDetailId); break;
      case 'confirm-ok': {
        const cb = confirmCallback;
        confirmCallback = null;
        closeOverlay('confirm-modal');
        if (cb) cb();
        break;
      }
      case 'confirm-cancel':
        confirmCallback = null;
        closeOverlay('confirm-modal');
        break;
      case 'export':
        $('settings-menu').classList.add('hidden');
        exportBackup();
        break;
      case 'import':
        $('settings-menu').classList.add('hidden');
        $('import-file-input').click();
        break;
      case 'bulk-select-all-visible': bulkSelectAllVisible(); break;
      case 'bulk-cancel': bulkCancelSelection(); break;
      case 'bulk-delete': bulkDeleteSelected(); break;
    }
  });

  $('import-file-input').addEventListener('change', function () {
    if (this.files.length > 0) importBackup(this.files[0]);
    this.value = '';
  });

  // Close modal when clicking the dark backdrop (not the panel itself)
  ['detail-modal', 'form-modal'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target.id === id) {
        if (id === 'form-modal') closeFormModal(); else closeDetailModal();
      }
    });
  });

  // Form submit
  $('manga-form').addEventListener('submit', handleFormSubmit);

  // Auto-lookup genre & total volume tiap judul/pengarang berubah
  $('form-title').addEventListener('input', scheduleMangaInfoLookup);
  $('form-author').addEventListener('input', scheduleMangaInfoLookup);
  $('form-genre').addEventListener('change', () => { genreTouchedByUser = true; });

  // Escape key closes topmost modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('reader-modal').classList.contains('hidden')) { closeReader(); return; }
    const top = topmostOpenOverlay();
    if (!top) return;
    if (top === 'confirm-modal') { confirmCallback = null; closeOverlay('confirm-modal'); }
    else if (top === 'form-modal') closeFormModal();
    else if (top === 'detail-modal') closeDetailModal();
  });
}

/* =========================================================================
   SKELETON LOADING STATE
   ========================================================================= */
function renderSkeleton(count = 6) {
  const grid = $('skeleton-grid');
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="bg-[#131621]/70 border border-white/[0.04] rounded-2xl p-3.5">
        <div class="aspect-[2/3] w-full rounded-xl skeleton mb-3.5"></div>
        <div class="h-3 w-4/5 rounded skeleton mb-2"></div>
        <div class="h-2.5 w-2/5 rounded skeleton mb-3"></div>
        <div class="h-8 w-full rounded-lg skeleton"></div>
      </div>`;
  }
  grid.innerHTML = html;
}

/* =========================================================================
   INIT
   ========================================================================= */
/* =========================================================================
   IMPORT DARI GRAMEDIA / SHOPEE (via content script)
   ========================================================================= */
async function checkPendingImport() {
  if (!Storage.isExtension) return;
  let pending;
  try {
    pending = await new Promise((resolve) => {
      chrome.storage.local.get('mytbl_pending_import', (r) => resolve(r.mytbl_pending_import));
    });
  } catch (e) { return; }
  if (!pending) return;

  chrome.storage.local.remove('mytbl_pending_import');
  applyImportedData(pending);
}

function applyImportedData(data) {
  openAddModal();
  if (data.title) $('form-title').value = data.title;
  if (data.author) $('form-author').value = data.author;
  if (data.publisher) $('form-publisher').value = data.publisher;
  if (data.price) $('form-price').value = data.price;
  if (data.desc) $('form-desc').value = data.desc.slice(0, 2000);
  if (data.image) {
    $('form-image-url').value = data.image;
  }
  if (data.totalVolumes) {
    $('form-total-volumes').value = data.totalVolumes;
    resetTotalVolInfo(`Ditemukan: seri ini tamat di volume ${data.totalVolumes} (dari ${data.source || 'MyAnimeList'}).`);
  } else if (data.genre) {
    resetTotalVolInfo(`Genre ketemu dari ${data.source || 'database'} — kalau ini bagian dari satu set/seri, isi manual jumlahnya di sini.`);
  } else {
    resetTotalVolInfo('Belum ketemu datanya (manga masih ongoing, atau bukan buku manga) — isi manual kalau tau.');
  }

  const genreSelect = $('form-genre');
  const genreMatched = data.genre && Array.from(genreSelect.options).some((o) => o.value === data.genre);
  if (genreMatched) { genreSelect.value = data.genre; genreSelect._syncCustomSelect?.(); }

  const missing = [];
  if (!data.price) missing.push('harga');
  if (!data.desc) missing.push('sinopsis');
  if (!data.publisher) missing.push('penerbit');
  if (!genreMatched) missing.push('genre');
  const note = missing.length
    ? `Data diimpor, tapi ${missing.join(' & ')} tidak ketemu otomatis — isi manual ya.`
    : 'Data berhasil diimpor (genre ditebak otomatis) — cek dulu sebelum disimpan.';
  showToast(note, missing.length ? 'info' : 'success');
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mytbl_pending_import && changes.mytbl_pending_import.newValue) {
      applyImportedData(changes.mytbl_pending_import.newValue);
      chrome.storage.local.remove('mytbl_pending_import');
    }
  });
}

/* =========================================================================
   PENYIMPANAN FILE PDF (IndexedDB — bukan chrome.storage/localStorage,
   karena file PDF bisa besar dan gampang mentok kuota kalau disimpan di
   sana. IndexedDB punya kuota jauh lebih besar dan memang didesain buat
   nyimpen file/blob.)
   ========================================================================= */
const PDF_DB_NAME = 'mytbl_pdf_store';
const PDF_DB_VERSION = 1;

function openPdfDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('pdfs')) req.result.createObjectStore('pdfs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function savePdfRecord(mangaId, record) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(record, mangaId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getPdfRecord(mangaId) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readonly');
    const req = tx.objectStore('pdfs').get(mangaId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deletePdfRecord(mangaId) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').delete(mangaId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================================
   EKSTRAKSI TEKS PDF (via PDF.js) — hasilnya array paragraf siap-reflow
   ========================================================================= */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
}

async function extractPdfParagraphs(arrayBuffer, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const paragraphs = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const lines = [];
    let curY = null, curText = '';
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (curY === null || Math.abs(y - curY) < 2) {
        curText += item.str;
      } else {
        if (curText.trim()) lines.push({ y: curY, text: curText.trim() });
        curText = item.str;
      }
      curY = y;
    }
    if (curText.trim()) lines.push({ y: curY, text: curText.trim() });

    // Gabungkan baris jadi paragraf berdasarkan jarak antar baris — kalau
    // jaraknya jauh lebih lebar dari biasanya, dianggap ganti paragraf.
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const g = Math.abs(lines[i].y - lines[i - 1].y);
      if (g > 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;

    let para = '', prevY = null;
    for (const line of lines) {
      if (prevY !== null && Math.abs(line.y - prevY) > typicalGap * 1.6) {
        if (para.trim()) paragraphs.push(para.trim());
        para = '';
      }
      para += (para ? ' ' : '') + line.text;
      prevY = line.y;
    }
    if (para.trim()) paragraphs.push(para.trim());

    if (onProgress) onProgress(pageNum, pdf.numPages);
  }

  return paragraphs;
}

/* =========================================================================
   UPLOAD PDF DI FORM (drag/drop + klik, disimpan ke IndexedDB pas form
   disubmit — sama pola-nya kayak upload gambar sampul)
   ========================================================================= */
function setPdfSelected(file) {
  pendingPdfFile = file;
  pendingPdfCleared = false;
  $('pdf-drop-zone-text').textContent = `✓ ${file.name}`;
  $('pdf-clear-row').classList.remove('hidden');
  $('pdf-clear-row').classList.add('flex');
}
function clearPdfSelection() {
  pendingPdfFile = null;
  pendingPdfCleared = true;
  $('form-pdf-file').value = '';
  $('pdf-drop-zone-text').textContent = 'Pilih file PDF...';
  $('pdf-clear-row').classList.add('hidden');
  $('pdf-clear-row').classList.remove('flex');
}
function resetPdfFormState() {
  pendingPdfFile = null;
  pendingPdfCleared = false;
  $('form-pdf-file').value = '';
  $('pdf-drop-zone-text').textContent = 'Pilih file PDF...';
  $('pdf-clear-row').classList.add('hidden');
  $('pdf-clear-row').classList.remove('flex');
}
function initPdfInput() {
  const zone = $('pdf-drop-zone');
  const input = $('form-pdf-file');
  input.addEventListener('change', function () {
    if (this.files.length > 0 && this.files[0].type === 'application/pdf') setPdfSelected(this.files[0]);
  });
  ['dragenter', 'dragover'].forEach((name) => {
    zone.addEventListener(name, (e) => { e.preventDefault(); zone.classList.add('border-coral'); });
  });
  ['dragleave', 'drop'].forEach((name) => {
    zone.addEventListener(name, (e) => { e.preventDefault(); zone.classList.remove('border-coral'); });
  });
  zone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') setPdfSelected(files[0]);
  });
}

/* =========================================================================
   READER (mode baca ala e-reader, teks reflow)
   ========================================================================= */
function getReaderProgressKey(id) { return `mytbl_reader_progress_${id}`; }

async function openReader(mangaId) {
  const manga = mangaData.find((m) => m.id === mangaId);
  if (!manga) return;

  readerState.mangaId = mangaId;
  $('reader-title').textContent = manga.title;
  $('reader-inner').innerHTML = '<p class="text-sm opacity-60">Membuka buku...</p>';
  openReaderOverlay();

  try {
    const record = await getPdfRecord(mangaId);
    if (!record || !record.blob) {
      $('reader-inner').innerHTML = '<p class="text-sm opacity-60">File PDF tidak ditemukan.</p>';
      return;
    }

    let paragraphs = record.parsedParagraphs;
    if (!paragraphs) {
      $('reader-inner').innerHTML = '<p class="text-sm opacity-60">Mengekstrak teks dari PDF, tunggu sebentar...</p>';
      const arrayBuffer = await record.blob.arrayBuffer();
      paragraphs = await extractPdfParagraphs(arrayBuffer, (page, total) => {
        $('reader-inner').innerHTML = `<p class="text-sm opacity-60">Mengekstrak teks... (halaman ${page}/${total})</p>`;
      });
      record.parsedParagraphs = paragraphs;
      savePdfRecord(mangaId, record); // cache biar gak perlu re-parse tiap buka
    }

    readerState.paragraphs = paragraphs;
    if (paragraphs.length === 0) {
      $('reader-inner').innerHTML = '<p class="text-sm opacity-60">Tidak ada teks yang bisa diekstrak dari PDF ini (kemungkinan hasil scan gambar, bukan teks asli).</p>';
      return;
    }

    $('reader-inner').innerHTML = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    applyReaderFontSize();
    restoreReaderProgress(mangaId);
  } catch (e) {
    $('reader-inner').innerHTML = `<p class="text-sm opacity-60">Gagal membuka PDF: ${escapeHtml(e.message || 'error tidak diketahui')}</p>`;
  }
}

function openReaderOverlay() {
  const modal = $('reader-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}
function closeReader() {
  saveReaderProgress();
  const modal = $('reader-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  readerState.mangaId = null;
  readerState.paragraphs = [];
}

function applyReaderFontSize() {
  $('reader-inner').style.fontSize = readerState.fontSize + 'px';
}
function changeReaderFontSize(delta) {
  readerState.fontSize = Math.min(30, Math.max(14, readerState.fontSize + delta));
  applyReaderFontSize();
  Storage.set('mytbl_reader_fontsize', readerState.fontSize);
}

const READER_THEMES = ['light', 'sepia', 'dark'];
const READER_THEME_ICONS = { light: '☀️', sepia: '📜', dark: '🌙' };
function applyReaderTheme() {
  const modal = $('reader-modal');
  READER_THEMES.forEach((t) => modal.classList.remove(`reader-theme-${t}`));
  modal.classList.add(`reader-theme-${readerState.theme}`);
  $('reader-theme-btn').textContent = READER_THEME_ICONS[readerState.theme];
}
function cycleReaderTheme() {
  const idx = READER_THEMES.indexOf(readerState.theme);
  readerState.theme = READER_THEMES[(idx + 1) % READER_THEMES.length];
  applyReaderTheme();
  Storage.set('mytbl_reader_theme', readerState.theme);
}

const READER_FONT_FAMILIES = ['sans', 'serif'];
const READER_FONT_LABELS = { sans: 'Sans', serif: 'Serif' };
function applyReaderFontFamily() {
  const modal = $('reader-modal');
  READER_FONT_FAMILIES.forEach((f) => modal.classList.remove(`reader-font-${f}`));
  modal.classList.add(`reader-font-${readerState.fontFamily}`);
  $('reader-font-family-btn').title = `Jenis huruf: ${READER_FONT_LABELS[readerState.fontFamily]} (klik untuk ganti)`;
}
function cycleReaderFontFamily() {
  const idx = READER_FONT_FAMILIES.indexOf(readerState.fontFamily);
  readerState.fontFamily = READER_FONT_FAMILIES[(idx + 1) % READER_FONT_FAMILIES.length];
  applyReaderFontFamily();
  Storage.set('mytbl_reader_fontfamily', readerState.fontFamily);
}

function saveReaderProgress() {
  if (!readerState.mangaId) return;
  const el = $('reader-content');
  const max = el.scrollHeight - el.clientHeight;
  const pct = max > 0 ? el.scrollTop / max : 0;
  Storage.set(getReaderProgressKey(readerState.mangaId), pct);
}
async function restoreReaderProgress(mangaId) {
  const pct = await Storage.get(getReaderProgressKey(mangaId));
  const el = $('reader-content');
  requestAnimationFrame(() => {
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = (Number(pct) || 0) * max;
    updateReaderProgressBar();
  });
}
function updateReaderProgressBar() {
  const el = $('reader-content');
  const max = el.scrollHeight - el.clientHeight;
  const pct = max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0;
  $('reader-progress-bar').style.width = pct + '%';
}

function initReader() {
  $('reader-content').addEventListener('scroll', debounce(() => {
    updateReaderProgressBar();
    saveReaderProgress();
  }, 300));
}

/* =========================================================================
   INIT
   ========================================================================= */
async function init() {
  renderSkeleton();
  initEventListeners();
  initImageInputs();
  initPdfInput();
  initReader();
  enhanceAllSelects();

  const savedFontSize = await Storage.get('mytbl_reader_fontsize');
  if (savedFontSize) readerState.fontSize = Number(savedFontSize);
  const savedTheme = await Storage.get('mytbl_reader_theme');
  if (savedTheme && READER_THEMES.includes(savedTheme)) readerState.theme = savedTheme;
  applyReaderTheme();

  const savedFontFamily = await Storage.get('mytbl_reader_fontfamily');
  if (savedFontFamily && READER_FONT_FAMILIES.includes(savedFontFamily)) readerState.fontFamily = savedFontFamily;
  applyReaderFontFamily();

  await loadData();

  $('skeleton-grid').classList.add('hidden');
  $('manga-list').classList.remove('hidden');
  $('manga-list').classList.add('grid');

  renderAll();
  await checkPendingImport();
}

document.addEventListener('DOMContentLoaded', init);
