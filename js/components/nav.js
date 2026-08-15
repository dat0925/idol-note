// =====================================================================
// nav.js — ヘッダ / サイドバー / ボトムナビの描画
//
// モードとロールでメニュー構成が変わる。
// ・role === 'child' のときは、おとなモードへのトグル自体を描画しない
//   （存在を見せない。押してPINを聞かれる体験を作らない）
// =====================================================================
import * as Store from './../store.js';
import { esc } from './../ui.js';

const KID_NAV = [
  { path: '/home',     icon: '🏠', label: 'ホーム' },
  { path: '/practice', icon: '✏️', label: 'れんしゅう' },
  { path: '/goals',    icon: '🎯', label: 'もくひょう' },
  { path: '/album',    icon: '📷', label: 'アルバム' },
];

const ADULT_NAV = [
  { path: '/home',      icon: '🏠', label: 'ホーム' },
  { path: '/practice',  icon: '✏️', label: '練習記録' },
  { path: '/goals',     icon: '🎯', label: '目標' },
  { path: '/album',     icon: '📷', label: '成長の記録' },
  { path: '/messages',  icon: '💌', label: '応援' },
  { sep: true },
  { path: '/auditions', icon: '🎬', label: 'オーディション', secure: true },
  { path: '/calendar',  icon: '📅', label: 'カレンダー',     secure: true },
  { path: '/body',      icon: '📏', label: 'からだの記録',   secure: true },
  { path: '/settings',  icon: '⚙️', label: '設定',           secure: true },
];

/** ボトムナビ（スマホ、およびこどもモードのPC） */
export function renderBottom(root) {
  const mode = Store.get('mode');
  const route = Store.get('route');
  const items = mode === 'kid' ? KID_NAV : ADULT_NAV.filter((i) => !i.sep).slice(0, 5);

  root.innerHTML = items.map((i) => `
    <a class="bottom__item" href="#${i.path}"
       ${route === i.path ? 'aria-current="page"' : ''}>
      <span class="ico" aria-hidden="true">${i.icon}</span>
      <span>${esc(i.label)}</span>
    </a>`).join('');
}

/** サイドバー（PC + おとなモードのみ表示される） */
export function renderSide(root) {
  const route = Store.get('route');
  root.innerHTML = ADULT_NAV.map((i) => {
    if (i.sep) return '<div class="side__sep"></div>';
    return `<a class="side__item" href="#${i.path}"
              ${route === i.path ? 'aria-current="page"' : ''}>
      <span aria-hidden="true">${i.icon}</span>
      <span>${esc(i.label)}</span>
      ${i.secure ? '<span class="spacer"></span><span aria-hidden="true" style="opacity:.5">🔒</span>' : ''}
    </a>`;
  }).join('');
}

/** ヘッダ（タイトル・連続日数バッジ・モードトグル） */
export function renderHeader() {
  const mode = Store.get('mode');
  const role = Store.get('role');
  const member = Store.get('member');
  const streak = Store.get('streak');
  const talent = Store.get('members').find((m) => m.is_talent);

  const title = document.getElementById('hdrTitle');
  if (title) {
    const name = talent?.nickname || talent?.display_name;
    title.textContent = (mode === 'kid' && name) ? `${name}のアイドルノート` : 'アイドルノート';
  }

  const badge = document.getElementById('streakBadge');
  if (badge) {
    const n = streak?.current_streak || 0;
    badge.hidden = n <= 0;
    badge.querySelector('b').textContent = String(n);
  }

  const toggle = document.getElementById('modeToggle');
  if (toggle) {
    // 子アカウントにはモードトグルを見せない
    toggle.hidden = role !== 'parent';
    toggle.textContent = mode === 'kid' ? '👩 おとな' : '🎀 こども';
    toggle.setAttribute('aria-label',
      mode === 'kid' ? 'おとなモードに切り替える' : 'こどもモードに切り替える');
  }

  const avatar = document.getElementById('userMenu');
  if (avatar) {
    avatar.hidden = !member;
    if (member) avatar.textContent = (member.nickname || member.display_name || '👤').slice(0, 1);
  }
}

/** すべて描き直す。家族に所属していない間（ログイン前・初期設定中）はナビを出さない */
export function renderAll() {
  renderHeader();
  const ready = !!Store.get('member');
  const bottom = document.getElementById('bottomNav');
  const side = document.getElementById('sideNav');
  if (bottom) { if (ready) renderBottom(bottom); else bottom.innerHTML = ''; }
  if (side) { if (ready) renderSide(side); else side.innerHTML = ''; }
}
