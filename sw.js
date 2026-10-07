/* ===================== MyRoom — Service Worker =====================
   Aplikasi ini sudah memanggil navigator.serviceWorker.register('sw.js')
   sejak lama, TETAPI berkasnya tidak pernah ada. Pendaftarannya gagal
   diam-diam (dibungkus .catch), sehingga tidak satu pun berkas tersimpan
   di HP: begitu sinyal hilang, halamannya tidak bisa dibuka sama sekali
   dan karyawan berhenti bekerja. Berkas ini yang menutup lubang itu.

   Aturannya:
   - Berkas aplikasi (index.html, ikon, manifest) disimpan di HP.
   - Halaman dibuka dengan "coba jaringan dulu, maksimal 2,5 detik".
     Kalau sinyal bagus, karyawan selalu dapat versi terbaru. Kalau
     lambat atau mati, langsung dilayani dari simpanan — tidak menunggu.
   - Permintaan ke server data (Supabase) TIDAK PERNAH disimpan di sini.
     Itu urusan antrean di dalam aplikasi: catatan yang dibuat saat
     offline ditahan di HP lalu dikirim sendiri begitu sinyal kembali.
     Kalau balasan server ikut disimpan, angka basi bisa tampil seolah
     data terbaru — jauh lebih berbahaya daripada sekadar tidak update.
   =================================================================== */

const VERSI = 'myroom-v5';
const INTI = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180-apple.png'
];
const BATAS_JARINGAN = 2500;   // ms — setelah ini pakai simpanan di HP

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSI);
    /* satu per satu: kalau ada satu berkas yang hilang, sisanya tetap
       tersimpan (addAll gagal semua bila satu saja meleset) */
    await Promise.all(INTI.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nama = await caches.keys();
    await Promise.all(nama.filter(n => n !== VERSI).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* aplikasi bisa menyuruh SW baru langsung aktif setelah pengguna setuju */
self.addEventListener('message', e => {
  if (e.data === 'pakai-sekarang') self.skipWaiting();
});

function jaringanDulu(req) {
  return new Promise(resolve => {
    let selesai = false;
    const pakaiSimpanan = async () => {
      if (selesai) return;
      selesai = true;
      const c = await caches.open(VERSI);
      const simpan = await c.match(req) || await c.match('./index.html') || await c.match('./');
      resolve(simpan || new Response(
        '<meta charset="utf-8"><body style="font-family:system-ui;padding:24px;text-align:center">' +
        '<h3>MyRoom belum tersimpan di HP ini</h3>' +
        '<p>Buka aplikasi sekali saja saat ada sinyal, setelah itu bisa dipakai offline.</p></body>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    };
    const jam = setTimeout(pakaiSimpanan, BATAS_JARINGAN);
    fetch(req).then(r => {
      clearTimeout(jam);
      if (selesai) {                       // simpanan sudah terlanjur dipakai
        if (r && r.ok) caches.open(VERSI).then(c => c.put(req, r.clone()));
        return;
      }
      selesai = true;
      if (r && r.ok) caches.open(VERSI).then(c => c.put(req, r.clone()));
      resolve(r);
    }).catch(() => { clearTimeout(jam); pakaiSimpanan(); });
  });
}

async function simpananDulu(req) {
  const c = await caches.open(VERSI);
  const simpan = await c.match(req);
  if (simpan) {
    fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); }).catch(() => {});
    return simpan;
  }
  try {
    const r = await fetch(req);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Tidak ada sinyal' });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // kiriman data: biarkan apa adanya

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;        // Supabase dll: langsung ke jaringan
  if (url.pathname.indexOf('/rest/v1/') >= 0) return;     // jaga-jaga bila satu domain

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(jaringanDulu(req));
    return;
  }
  e.respondWith(simpananDulu(req));
});
