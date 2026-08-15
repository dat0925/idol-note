/* =====================================================================
   Service Worker — アイドルノート

   戦略: アプリシェルは Network First。
     ビルドステップがない＝ファイル名にハッシュが付かないため、
     Cache First にすると古い JS が延々残り続ける。常に最新を優先し、
     取れなかったときだけキャッシュを返す。

   ★リリースのたびに CACHE の版数を上げること（デプロイ手順に含める）。
   ===================================================================== */

const CACHE = 'idol-v7';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/kid.css',
  './css/adult.css',
  './css/stage.css',
  './js/app.js',
  './js/config.js',
  './js/store.js',
  './js/router.js',
  './js/auth.js',
  './js/db.js',
  './js/sync.js',
  './js/storage.js',
  './js/pin.js',
  './js/photos.js',
  './js/ui.js',
  './js/format.js',
  './js/components/nav.js',
  './js/components/pin-modal.js',
  './js/components/stage.js',
  './js/views/auth-view.js',
  './js/views/home.js',
  './js/views/practice.js',
  './js/views/goals.js',
  './js/views/album.js',
  './js/views/messages.js',
  './js/views/rewards.js',
  './js/views/auditions.js',
  './js/views/calendar.js',
  './js/views/body.js',
  './js/views/settings.js',
  './icon-192.png',
  './icon-512.png',
  // 背景イラスト3種＋えらぶボタン用サムネ。
  // install は Promise.allSettled なので、1つ欠けても他は正常にキャッシュされる。
  './assets/idol-hero-1.webp',
  './assets/idol-hero-2.webp',
  './assets/idol-hero-3.webp',
  './assets/idol-hero-1-thumb.webp',
  './assets/idol-hero-2-thumb.webp',
  './assets/idol-hero-3-thumb.webp',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つでも失敗すると addAll 全体が落ちるので個別に入れる
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => {
  // 更新バーの「更新」ボタンから呼ばれる
  if (ev.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ★ここが効かないと Network First が名前倒れになる。

   fetch(req) は既定でブラウザのHTTPキャッシュを経由する。
   このアプリはビルドしない＝ファイル名にハッシュが付かないので、
   一度 HTTPキャッシュに載った style.css / app.js は、サーバー側を
   更新しても max-age が切れるまで古いまま返り続ける。
   （実際に stage.css を直したのに古い値が適用され続ける事故を踏んだ）

   コードとマークアップは毎回ネットワークから取り直す。
   画像は差し替え頻度が低く、4Gで毎回落とすと重いので HTTPキャッシュに任せる
   （差し替え時は CACHE の版数を上げれば precache し直される）。 */
const ALWAYS_FRESH = /\.(?:html|css|js|json|webmanifest)$/i;

function fetchInit(url) {
  const fresh = ALWAYS_FRESH.test(url.pathname) || url.pathname.endsWith('/');
  return fresh ? { cache: 'no-store' } : undefined;
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ── Supabase の API と Storage はキャッシュしない ──
  //   認証・鮮度の問題。署名付きURLはトークンそのものなので特に残さない。
  if (url.hostname.endsWith('.supabase.co')) return;

  // ── ナビゲーション要求（オフライン時は index.html を返す）──
  //   ハッシュルーティングなのでシェルさえ返せば全画面が動く
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // ── 同一オリジンの静的資産: Network First ──
  if (url.origin === self.location.origin) {
    ev.respondWith((async () => {
      try {
        const fresh = await fetch(req, fetchInit(url));
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw new Error('offline and not cached');
      }
    })());
    return;
  }

  // ── CDN（Supabase JS など）: Cache First ──
  //   バージョン固定URLなので中身は変わらない
  if (url.hostname === 'cdn.jsdelivr.net') {
    ev.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
});
