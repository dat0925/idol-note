// =====================================================================
// nav.js — ヘッダ / サイドバー / ボトムナビの描画
//
// モードとロールでメニュー構成が変わる。
// ・role === 'child' のときは、おとなモードへのトグル自体を描画しない
//   （存在を見せない。押してPINを聞かれる体験を作らない）
// =====================================================================
import * as Store from './../store.js';
import { esc } from './../ui.js';
import { icon } from './../icons.js';

// ★こどもモードの文言は小学5年生を基準にする（漢字を使う）。
//   ひらがなに開きすぎると、かえって読みにくく子ども扱いされている感じになる。
// ★アイコンは絵文字ではなく線画SVG（js/icons.js）。
//   絵文字は端末ごとに絵が変わり、色も太さもバラバラで画面がまとまらない。
const KID_NAV = [
  { path: '/home',     icon: 'home',   label: 'ホーム' },
  { path: '/practice', icon: 'pencil', label: '練習' },
  { path: '/goals',    icon: 'target', label: '目標' },
  { path: '/album',    icon: 'camera', label: 'アルバム' },
  // ★応援は「場所」なのでナビに置く。未読バッジが付くのもここ。
  //   これで5つ。390px の画面ではこれが上限で、6つ目を足すとラベルが潰れる。
  { path: '/messages', icon: 'mail',   label: '応援', badge: 'unreadCheers' },
  // ★6つ目。横に並べるボトムナビでは潰れるので出せないが、
  //   縦に並ぶサイドメニューには入る（renderSide だけが使う）。
  { path: '/rewards',  icon: 'gift',   label: 'ごほうび', sideOnly: true },
];

const ADULT_NAV = [
  { path: '/home',      icon: 'home',     label: 'ホーム' },
  { path: '/practice',  icon: 'pencil',   label: '練習記録' },
  { path: '/goals',     icon: 'target',   label: '目標' },
  { path: '/album',     icon: 'camera',   label: '成長の記録' },
  { path: '/messages',  icon: 'mail',     label: '応援', badge: 'unreadCheers' },
  { sep: true },
  { path: '/auditions', icon: 'film',     label: 'オーディション', secure: true },
  { path: '/calendar',  icon: 'calendar', label: 'カレンダー',     secure: true },
  { path: '/body',      icon: 'ruler',    label: 'からだの記録',   secure: true },
  { path: '/settings',  icon: 'settings', label: '設定',           secure: true },
];

/** ボトムナビ（768px 未満＝スマホ幅のみ。それ以上は CSS で隠してサイドに出す） */
export function renderBottom(root) {
  const mode = Store.get('mode');
  const route = Store.get('route');
  const items = (mode === 'kid' ? KID_NAV : ADULT_NAV)
    .filter((i) => !i.sep && !i.sideOnly)
    .slice(0, 5);   // 横並びは5つが上限。6つ目からラベルが潰れる

  root.innerHTML = items.map((i) => {
    const n = i.badge ? (Store.get(i.badge) || 0) : 0;
    return `
    <a class="bottom__item" href="#${i.path}"
       ${route === i.path ? 'aria-current="page"' : ''}>
      <span class="ico">
        ${icon(i.icon)}
        ${n > 0 ? `<span class="nav-badge">${n > 9 ? '9+' : n}</span>` : ''}
      </span>
      <span>${esc(i.label)}</span>
      ${n > 0 ? `<span class="sr-only">未読${n}件</span>` : ''}
    </a>`;
  }).join('');
}

/**
 * サイドメニュー（768px 以上で表示。こども/おとな両方）。
 * ★こどもモードでも出す。iPad や PC では画面下端は指から遠く、
 *   横幅も余っているので、メニューは左に置くほうが押しやすい。
 */
export function renderSide(root) {
  const route = Store.get('route');
  const items = Store.get('mode') === 'kid' ? KID_NAV : ADULT_NAV;

  root.innerHTML = items.map((i) => {
    if (i.sep) return '<div class="side__sep"></div>';
    const n = i.badge ? (Store.get(i.badge) || 0) : 0;
    return `<a class="side__item" href="#${i.path}"
              ${route === i.path ? 'aria-current="page"' : ''}>
      <span class="ico">
        ${icon(i.icon, { size: 20 })}
        ${n > 0 ? `<span class="nav-badge">${n > 9 ? '9+' : n}</span>` : ''}
      </span>
      <span>${esc(i.label)}</span>
      ${n > 0 ? `<span class="sr-only">未読${n}件</span>` : ''}
      ${i.secure ? `<span class="spacer"></span><span class="ico ico--dim">${icon('lock', { size: 14 })}</span>` : ''}
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

  // ★ヘッダにはアプリ名だけを置く。
  //   「きょうかの」のような個人名はパーソナライズ＝コンテンツであって識別ではない。
  //   一番狭い場所に置くと右のボタン群を押し出すし、ニックネームが長くなれば必ず破綻する。
  //   挨拶はホーム画面（余白がある場所）に移した（views/home.js）。
  const title = document.getElementById('hdrTitle');
  if (title) title.textContent = 'アイドルノート';

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
    toggle.textContent = mode === 'kid' ? 'おとな' : 'こども';
    toggle.setAttribute('aria-label',
      mode === 'kid' ? 'おとなモードに切り替える' : 'こどもモードに切り替える');
  }

  // 背景えらびはこどもモードだけ。おとなモードは作業する画面なので出さない
  const heroBtn = document.getElementById('heroPick');
  if (heroBtn) heroBtn.hidden = mode !== 'kid' || !member;

  // アバターは「設定への入口」。★こどもモードでは出さない。
  //   こどもモードでは応援画面へ飛ぶだけで、応援はボトムナビにあるので完全な重複。
  //   おとなモードのスマホでは、ナビが5つで設定が入らないため
  //   ここが設定への唯一の入口になる。だから残す。
  const avatar = document.getElementById('userMenu');
  if (avatar) {
    avatar.hidden = !member || mode !== 'adult';
    if (member) avatar.textContent = (member.nickname || member.display_name || '設').slice(0, 1);
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
