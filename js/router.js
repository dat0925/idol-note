// =====================================================================
// router.js — ハッシュルーター
//
// 責務: URL を見て、ガード（未ログイン/モード/ロール/PIN）を通し、
//       該当 view を mount する。views 側にガードを書かない。
//
// ★secure: true のルートは「親アカウント かつ PIN解錠済み」でないと入れない。
//   ただしこれは UI 上の導線制御でしかない。
//   本当の防御は RLS（子アカウントではそもそもデータが返らない）。
// =====================================================================
import * as Store from './store.js';
import { isUnlocked } from './pin.js';

/**
 * ルート定義
 *   public : 未ログインでも入れる
 *   modes  : 表示を許可するモード
 *   secure : 親 + PIN解錠 が必要
 */
export const ROUTES = [
  { path: '/login',     view: 'auth-view', public: true },
  { path: '/signup',    view: 'auth-view', public: true },
  { path: '/join',      view: 'auth-view', public: true },
  { path: '/setup',     view: 'auth-view' },                       // 家族の作成/参加

  { path: '/home',      view: 'home',      modes: ['kid', 'adult'] },
  { path: '/practice',  view: 'practice',  modes: ['kid', 'adult'] },
  { path: '/goals',     view: 'goals',     modes: ['kid', 'adult'] },
  { path: '/album',     view: 'album',     modes: ['kid', 'adult'] },
  { path: '/messages',  view: 'messages',  modes: ['kid', 'adult'] },
  { path: '/rewards',   view: 'rewards',   modes: ['kid', 'adult'] },

  { path: '/auditions', view: 'auditions', modes: ['adult'], secure: true },
  { path: '/calendar',  view: 'calendar',  modes: ['adult'], secure: true },
  { path: '/body',      view: 'body',      modes: ['adult'], secure: true },
  { path: '/settings',  view: 'settings',  modes: ['adult'], secure: true },
];

const viewLoaders = {
  'auth-view': () => import('./views/auth-view.js'),
  home:        () => import('./views/home.js'),
  practice:    () => import('./views/practice.js'),
  goals:       () => import('./views/goals.js'),
  album:       () => import('./views/album.js'),
  messages:    () => import('./views/messages.js'),
  rewards:     () => import('./views/rewards.js'),
  auditions:   () => import('./views/auditions.js'),
  calendar:    () => import('./views/calendar.js'),
  body:        () => import('./views/body.js'),
  settings:    () => import('./views/settings.js'),
};

let current = null;      // { module, path }
let mountEl = null;
let onSecureBlocked = null;   // PINモーダルを開くコールバック（app.js が渡す）

export function init(el, { onSecureBlocked: cb } = {}) {
  mountEl = el;
  onSecureBlocked = cb;
  window.addEventListener('hashchange', handle);
}

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === hash) { handle(); return; }
  if (replace) location.replace(hash);
  else location.hash = hash;
}

/** 現在のハッシュを { path, params } に分解する */
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/home';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path: '/' + segments.join('/'), segments, params };
}

/** '/auditions/xxx' → '/auditions' 定義 + params.id */
function matchRoute(path, segments) {
  const exact = ROUTES.find((r) => r.path === path);
  if (exact) return { route: exact, id: null };
  if (segments.length >= 2) {
    const base = '/' + segments[0];
    const r = ROUTES.find((x) => x.path === base);
    if (r) return { route: r, id: segments[1] };
  }
  return { route: null, id: null };
}

async function handle() {
  const { path, segments, params } = parseHash();
  const { route, id } = matchRoute(path, segments);

  // 未定義パス
  if (!route) { navigate('/home', { replace: true }); return; }

  const user = Store.get('user');
  const member = Store.get('member');

  // ── ガード1: 認証 ──
  if (!route.public && !user) {
    sessionStorage.setItem('idol:returnTo', location.hash);
    navigate('/login', { replace: true });
    return;
  }
  // ログイン済みなのに認証画面 → ホームへ
  if (route.public && user && member) { navigate('/home', { replace: true }); return; }

  // ── ガード2: 家族に未所属なら家族作成/参加へ ──
  if (user && !member && path !== '/setup') {
    navigate('/setup', { replace: true });
    return;
  }

  // ── ガード3: モード ──
  const mode = Store.get('mode');
  if (route.modes && !route.modes.includes(mode)) {
    navigate('/home', { replace: true });
    return;
  }

  // ── ガード4: 親 + PIN解錠（機密画面）──
  if (route.secure) {
    if (Store.get('role') !== 'parent') {
      navigate('/home', { replace: true });
      return;
    }
    if (!isUnlocked()) {
      const ok = await onSecureBlocked?.();
      if (!ok) { navigate('/home', { replace: true }); return; }
    }
  }

  await mount(route, { ...params, id });
}

async function mount(route, params) {
  // 前の view を必ず破棄する（購読リークを防ぐ）
  try { current?.module?.default?.destroy?.(); }
  catch (e) { console.error('[router] destroy に失敗', e); }
  current = null;

  mountEl.innerHTML = '';
  Store.set({ route: route.path });

  let module;
  try {
    module = await viewLoaders[route.view]();
  } catch (e) {
    console.error('[router] view の読み込みに失敗', route.view, e);
    mountEl.innerHTML = `<div class="empty">
      <div class="empty__ico">😵</div>
      <p class="empty__msg">画面を読み込めませんでした。<br>通信状態をご確認のうえ、再読み込みしてください。</p>
      <button class="btn btn--primary" onclick="location.reload()">再読み込み</button>
    </div>`;
    return;
  }

  current = { module, path: route.path };
  try {
    await module.default.mount(mountEl, params);
  } catch (e) {
    console.error('[router] mount に失敗', route.view, e);
    mountEl.innerHTML = `<div class="empty">
      <div class="empty__ico">😵</div>
      <p class="empty__msg">画面の表示中に問題が起きました。</p>
      <pre style="text-align:left;font-size:11px;white-space:pre-wrap;opacity:.7">${String(e.message || e)}</pre>
    </div>`;
  }
  mountEl.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

/** 最初の1回。ハッシュがなければホームへ */
export function start() {
  if (!location.hash) {
    const back = sessionStorage.getItem('idol:returnTo');
    sessionStorage.removeItem('idol:returnTo');
    location.replace(back || '#/home');
    if (!back) handle();
  } else {
    handle();
  }
}

/** 現在の view を再マウントする（モード切替時など） */
export function refresh() {
  handle();
}
