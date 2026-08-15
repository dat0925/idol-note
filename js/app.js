// =====================================================================
// app.js — エントリポイント
//   1. Service Worker 登録と更新バー
//   2. 認証ブート（セッション復元 → 家族の解決）
//   3. モード適用とヘッダ/ナビの描画
//   4. ルーター起動
// =====================================================================
import { supabase } from './config.js';
import * as Store from './store.js';
import * as Auth from './auth.js';
import * as Pin from './pin.js';
import * as LS from './storage.js';
import * as Router from './router.js';
import * as Nav from './components/nav.js';
import { requestUnlock, setupPin } from './components/pin-modal.js';
import * as Stage from './components/stage.js';
import { toast, $ } from './ui.js';
import { flushOutbox } from './sync.js';

// =====================================================================
// 1. Service Worker
// =====================================================================
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;   // file:// では登録できない

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // 起動時と6時間ごとに更新を確認する
    reg.update().catch(() => {});
    setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // 既に制御中のSWがある＝これは「更新」であって初回インストールではない
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBar(reg);
        }
      });
    });
  }).catch((e) => console.warn('[sw] 登録に失敗', e));

  // 自動リロードはしない（記録の入力中に画面が飛ぶ事故を防ぐ）。
  // ユーザーが「更新」を押したときだけ、1回だけリロードする。
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdateBar(reg) {
  const bar = $('#updateBar');
  if (!bar) return;
  bar.hidden = false;
  $('#updateLater').onclick = () => { bar.hidden = true; };
  $('#updateNow').onclick = () => {
    bar.hidden = true;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
}

// =====================================================================
// 2. モード切替
// =====================================================================
function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'adult' ? '#6c63c7' : '#ff6fa5');
  LS.setMode(mode);
  Store.set({ mode });

  // 背景ステージはこどもモードだけ。
  // おとなモードは「作業する画面」なので、動くものを置かない。
  // ★モード切替は何度も起こるので、必ず destroy を通す（ハンドラの積み上がり防止）
  if (mode === 'kid') Stage.mount();
  else Stage.destroy();
}

async function toggleMode() {
  const next = Store.get('mode') === 'kid' ? 'adult' : 'kid';

  if (next === 'adult') {
    // 子アカウントはそもそもトグルが描画されないが、二重に守っておく
    if (Store.get('role') !== 'parent') return;
    const ok = await requestUnlock();
    if (!ok) return;
    applyMode('adult');
  } else {
    // おとな → こども は即時。解錠状態も落とす
    Pin.lock();
    applyMode('kid');
  }
  Nav.renderAll();
  Router.refresh();
}

// =====================================================================
// 3. 起動
// =====================================================================
async function boot() {
  initServiceWorker();
  applyMode(LS.getMode());
  Pin.startAutoLock();

  // オンライン/オフライン
  const setOnline = () => {
    const online = navigator.onLine;
    Store.set({ online });
    const bar = $('#offlineBar');
    if (bar) bar.hidden = online;
    if (online) flushOutbox().catch(() => {});
  };
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);

  // セッション復元
  let status = 'no-session';
  try {
    status = await Auth.loadSession();
  } catch (e) {
    console.error('[app] セッション復元に失敗', e);
    toast(e.message || '読み込みに失敗しました', 'error');
  }

  // 子アカウントは常にこどもモード（おとなモードのデータはRLSで返らない）
  if (Store.get('role') !== 'parent' && Store.get('mode') === 'adult') {
    applyMode('kid');
  }

  // 画面を出す
  $('#boot').hidden = true;
  $('#shell').hidden = false;
  Store.set({ booting: false });
  setOnline();

  Nav.renderAll();
  Router.init($('#app'), { onSecureBlocked: requestUnlock });
  Router.start();

  if (status === 'no-session') Router.navigate('/login', { replace: true });
  else if (status === 'no-family') Router.navigate('/setup', { replace: true });

  // PIN リセットのための Google 再ログインから戻ってきた場合はここで拾う。
  // （pin-modal.js の recoverPin から遷移した経路。印は1回きりで消える）
  if (status === 'ok' && Store.get('role') === 'parent') {
    try {
      if (await Auth.consumePinReauth()) {
        await Pin.clearPin();
        await setupPin();
      }
    } catch (e) {
      console.error('[app] PIN の再設定に失敗', e);
      toast('番号の再設定に失敗しました', 'error');
    }
  }

  // 溜まっていたオフライン書き込みを送る
  flushOutbox().catch(() => {});
}

// =====================================================================
// 4. グローバルなイベント配線
// =====================================================================
function wireGlobals() {
  $('#modeToggle')?.addEventListener('click', toggleMode);

  $('#userMenu')?.addEventListener('click', () => {
    // おとなモードなら設定画面、こどもモードならログアウト確認だけ
    if (Store.get('mode') === 'adult') Router.navigate('/settings');
    else Router.navigate('/messages');
  });

  document.querySelector('.hdr__brand')?.addEventListener('click', () => Router.navigate('/home'));

  // ナビ/ヘッダの再描画が必要な状態が変わったとき
  Store.subscribe(['route', 'mode', 'role', 'streak', 'member', 'members'], () => Nav.renderAll());

  // PIN が施錠されたら、機密画面にいる場合はホームへ戻す
  window.addEventListener('idol:locked', () => {
    const secure = ['/auditions', '/calendar', '/body', '/settings'];
    if (secure.includes(Store.get('route'))) {
      toast('じどうロックしました');
      Router.navigate('/home', { replace: true });
    }
  });

  // 認証状態の変化（別タブでのログアウト、トークン失効など）
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      LS.clearAll();
      Store.resetSession();
      applyMode('kid');
      Nav.renderAll();
      Router.navigate('/login', { replace: true });
    }
  });

  // 復帰時に未送信ぶんを送る
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) flushOutbox().catch(() => {});
  });

  // 想定外のエラーを握りつぶさず気づけるようにする
  window.addEventListener('unhandledrejection', (ev) => {
    console.error('[app] 未処理のPromise拒否', ev.reason);
  });
}

wireGlobals();
boot();
