// QURANA v0.1 — Sumber data: api.alquran.cloud (teks Uthmani, terjemahan Kemenag/Indonesian,
// transliterasi, audio Mishary Alafasy) dan api.aladhan.com (jadwal salat, metode Kemenag).
const API = 'https://api.alquran.cloud/v1';
const $ = s => document.querySelector(s);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let surahs = [], current = null, audio = new Audio(), playingIdx = -1, repeat = false;
let state = { theme: store.get('theme', 'light'), last: store.get('last', null), bm: store.get('bm', []),
  days: store.get('days', 30), city: store.get('city', 'Jakarta') };

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return (await r.json()).data; }

/* ---------- Navigasi ---------- */
function go(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === 'page-' + p));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === p));
  if (p === 'quran') { $('#listView').hidden = false; $('#readView').hidden = true; stopAudio(); }
  if (p === 'bookmarks') renderBookmarks();
  scrollTo(0, 0);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

/* ---------- Tema ---------- */
function applyTheme() { document.documentElement.dataset.theme = state.theme; $('#themeBtn').textContent = state.theme === 'dark' ? '☀️' : '🌙'; }
$('#themeBtn').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; store.set('theme', state.theme); applyTheme(); };

/* ---------- Beranda ---------- */
function header() {
  const d = new Date(), h = d.getHours();
  $('#greeting').textContent = `Assalamu'alaikum — ${h < 11 ? 'selamat pagi' : h < 15 ? 'selamat siang' : h < 18 ? 'selamat sore' : 'selamat malam'}`;
  $('#hijri').textContent = new Intl.DateTimeFormat('id-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  $('#masehi').textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
async function dailyVerse() {
  const d = new Date(), seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  const n = (seed * 7919) % 6236 + 1;
  try {
    const [ar, id] = await getJSON(`${API}/ayah/${n}/editions/quran-uthmani,id.indonesian`);
    $('#vArab').textContent = ar.text; $('#vId').textContent = id.text;
    $('#vRef').textContent = `QS ${ar.surah.englishName} (${ar.surah.number}): ${ar.numberInSurah}`;
  } catch { $('#vArab').textContent = ''; $('#vId').textContent = 'Tidak dapat memuat ayat. Periksa koneksi internet.'; }
}
async function prayers() {
  const box = $('#prayers'); $('#cityBtn').textContent = state.city;
  try {
    const r = await getJSON(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(state.city)}&country=Indonesia&method=20`);
    const names = [['Fajr', 'Subuh'], ['Dhuhr', 'Zuhur'], ['Asr', 'Asar'], ['Maghrib', 'Magrib'], ['Isha', 'Isya']];
    const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
    const mins = t => { const [h, m] = t.slice(0, 5).split(':'); return +h * 60 + +m; };
    let next = names.findIndex(([k]) => mins(r.timings[k]) > cur); if (next < 0) next = 0;
    box.innerHTML = names.map(([k, n], i) => `<div class="${i === next ? 'next' : ''}">${n}<b>${r.timings[k].slice(0, 5)}</b></div>`).join('');
    $('#nextPrayer').textContent = `Berikutnya: ${names[next][1]} ${r.timings[names[next][0]].slice(0, 5)}`;
  } catch { box.textContent = 'Tidak dapat memuat jadwal. Coba ubah kota atau periksa koneksi.'; }
}
$('#cityBtn').onclick = () => { const c = prompt('Nama kota di Indonesia (contoh: Bandung):', state.city); if (c && c.trim()) { state.city = c.trim(); store.set('city', state.city); prayers(); } };
function khatam() {
  $('#khatamSel').value = state.days;
  const done = state.last ? state.last.global : 0, per = Math.ceil(6236 / state.days);
  $('#khatamBar').style.width = (done / 6236 * 100).toFixed(1) + '%';
  $('#khatamTxt').textContent = `${done} dari 6.236 ayat (${(done / 6236 * 100).toFixed(1)}%) · target ${per} ayat/hari`;
  $('#continueBtn').textContent = state.last ? `Lanjutkan: ${state.last.name} ayat ${state.last.ayah}` : 'Mulai membaca';
}
$('#khatamSel').onchange = e => { state.days = +e.target.value; store.set('days', state.days); khatam(); toast(`Target khatam ${state.days} hari`); };
$('#continueBtn').onclick = () => openSurah(state.last ? state.last.surah : 1, state.last ? state.last.ayah : 1);

/* ---------- Daftar surah ---------- */
function renderList(q = '') {
  q = q.toLowerCase().trim();
  const list = surahs.filter(s => !q || String(s.number) === q || s.englishName.toLowerCase().includes(q) || s.englishNameTranslation.toLowerCase().includes(q));
  $('#surahList').innerHTML = list.length ? list.map(s => `<button class="surah" data-s="${s.number}"><span class="num">${s.number}</span>
    <span class="grow"><b>${s.englishName}</b><br><small class="muted">${s.englishNameTranslation} · ${s.numberOfAyahs} ayat · ${s.revelationType === 'Meccan' ? 'Makkiyah' : 'Madaniyyah'}</small></span><span class="ar">${s.name.replace('سُورَةُ ', '')}</span></button>`).join('')
    : '<p class="muted">Surah tidak ditemukan.</p>';
}
$('#search').oninput = e => renderList(e.target.value);
$('#surahList').onclick = e => { const b = e.target.closest('[data-s]'); if (b) openSurah(+b.dataset.s); };

/* ---------- Pembaca ---------- */
async function openSurah(n, ayah = 1) {
  go('quran'); stopAudio();
  $('#listView').hidden = true; $('#readView').hidden = false;
  $('#ayahs').innerHTML = '<p class="muted">Memuat…</p>';
  try {
    const [ar, id, tr, au] = await getJSON(`${API}/surah/${n}/editions/quran-uthmani,id.indonesian,en.transliteration,ar.alafasy`);
    current = { n, name: ar.englishName, ayahs: ar.ayahs.map((a, i) => ({ no: a.numberInSurah, global: a.number, ar: a.text, id: id.ayahs[i].text, tr: tr.ayahs[i].text, audio: au.ayahs[i].audio })) };
    $('#rName').textContent = `${ar.englishName} — ${ar.name}`; $('#rMeta').textContent = `${ar.numberOfAyahs} ayat`;
    $('#ayahs').innerHTML = current.ayahs.map((a, i) => `<article class="ayah" id="a${a.no}"><div class="tools"><span class="num">${a.no}</span><span class="sp"></span>
      <button class="chip" data-play="${i}">▶ Putar</button><button class="chip" data-bm="${i}">${isBm(n, a.no) ? '🔖' : '🏷️'}</button><button class="chip" data-last="${i}">📍</button></div>
      <p class="arab" dir="rtl">${a.ar}</p><p class="translit">${a.tr}</p><p>${a.id}</p></article>`).join('');
    document.getElementById('a' + ayah)?.scrollIntoView({ block: 'start' });
  } catch { $('#ayahs').innerHTML = '<p class="muted">Gagal memuat surah. Periksa koneksi internet lalu coba lagi.</p>'; }
}
$('#backBtn').onclick = () => { stopAudio(); $('#listView').hidden = false; $('#readView').hidden = true; };
$('#ayahs').onclick = e => {
  const p = e.target.closest('[data-play]'), b = e.target.closest('[data-bm]'), l = e.target.closest('[data-last]');
  if (p) playAyah(+p.dataset.play);
  if (b) toggleBm(+b.dataset.bm, b);
  if (l) setLast(+l.dataset.last, true);
};
function setLast(i, say) {
  const a = current.ayahs[i]; state.last = { surah: current.n, name: current.name, ayah: a.no, global: a.global };
  store.set('last', state.last); khatam(); if (say) toast(`Penanda bacaan: ${current.name} ayat ${a.no}`);
}

/* ---------- Bookmark ---------- */
const isBm = (s, a) => state.bm.some(b => b.s === s && b.a === a);
function toggleBm(i, btn) {
  const a = current.ayahs[i];
  if (isBm(current.n, a.no)) { state.bm = state.bm.filter(b => !(b.s === current.n && b.a === a.no)); btn.textContent = '🏷️'; toast('Bookmark dihapus'); }
  else { state.bm.push({ s: current.n, a: a.no, name: current.name }); btn.textContent = '🔖'; toast('Ayat disimpan'); }
  store.set('bm', state.bm);
}
function renderBookmarks() {
  $('#bmList').innerHTML = state.bm.length ? state.bm.map(b => `<button class="surah" data-bs="${b.s}" data-ba="${b.a}"><span class="num">${b.a}</span><span class="grow"><b>${b.name}</b><br><small class="muted">Ayat ${b.a}</small></span></button>`).join('')
    : '<div class="card soon">Belum ada bookmark. Buka sebuah surah lalu ketuk 🏷️ pada ayat.</div>';
}
$('#bmList').onclick = e => { const b = e.target.closest('[data-bs]'); if (b) openSurah(+b.dataset.bs, +b.dataset.ba); };

/* ---------- Audio ---------- */
function playAyah(i) {
  if (playingIdx === i && !audio.paused) { audio.pause(); markPlaying(); return; }
  if (playingIdx === i && audio.paused) { audio.play(); markPlaying(); return; }
  playingIdx = i; audio.src = current.ayahs[i].audio; audio.play().catch(() => toast('Audio gagal diputar')); markPlaying();
  setLast(i, false);
}
function markPlaying() {
  document.querySelectorAll('.ayah').forEach((el, i) => {
    el.classList.toggle('playing', i === playingIdx);
    const b = el.querySelector('[data-play]'); b.textContent = (i === playingIdx && !audio.paused) ? '⏸ Jeda' : '▶ Putar';
  });
}
function stopAudio() { audio.pause(); playingIdx = -1; if (current) markPlaying(); }
audio.onended = () => {
  if (repeat) { audio.currentTime = 0; audio.play(); return; }
  const nx = playingIdx + 1;
  if (current && nx < current.ayahs.length) { playingIdx = -1; playAyah(nx); document.getElementById('a' + current.ayahs[nx].no).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else stopAudio();
};
$('#repeatBtn').onclick = e => { repeat = !repeat; e.target.textContent = '🔁 ' + (repeat ? 'On' : 'Off'); };

/* ---------- Mulai ---------- */
(async function init() {
  applyTheme(); header(); khatam(); dailyVerse(); prayers();
  try { surahs = await getJSON(`${API}/surah`); renderList(); }
  catch { $('#surahList').innerHTML = '<p class="muted">Gagal memuat daftar surah. Periksa koneksi internet.</p>'; }
})();