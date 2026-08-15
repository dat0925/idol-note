// =====================================================================
// stage.js — こどもモードの背景ステージ（パララックス）
//
// 使い方:
//   Stage.mount()            こどもモードに入ったとき
//   Stage.destroy()          おとなモードへ / ログアウト時
//   Stage.setProgress(d, t)  今日のミッションの達成状況を渡す
//
// ★リーク防止（CLAUDE.md の規約）:
//   rAF・スクロール・ポインタ・リサイズをすべて destroy() で外す。
//   モード切替は何度も起こるので、1回でも外し忘れるとハンドラが積み上がる。
//
// ★描画の考え方:
//   JS がやるのは「--sx / --sy を毎フレーム最大1回書く」ことだけ。
//   奥行きごとの合成は CSS の --depth に任せる（stage.css 参照）。
//   レイヤーごとに style.transform を書きに行くと、レイヤー数ぶん
//   スタイル再計算が走って、古い端末でスクロールが引っかかる。
// =====================================================================

import * as LS from './../storage.js';

// 背景イラストは3種類。娘が気分で選べるようにしてある。
// ファイルは tools/build-hero.py が書き出す（assets/README.md 参照）。
export const HEROES = [1, 2, 3];
const heroSrc = (id) => `./assets/idol-hero-${id}.webp`;
export const heroThumb = (id) => `./assets/idol-hero-${id}-thumb.webp`;

// ★装飾は絵文字ではなくインラインSVGで描く。
//   絵文字はフォント依存で、端末に字が無いと豆腐（□）になる。
//   実際 Windows では 🩷（Unicode 15.0）が四角になった。
//   娘の iPhone では出て親の PC では出ない、という差が起きるのは避けたい。
//   SVG なら全端末で同じ形、追加リクエストも無い。
const SHAPES = {
  // 4方向にとがった、いわゆる「キラッ」
  spark: 'M12 0c1 7 4 10 12 12-8 2-11 5-12 12-1-7-4-10-12-12 8-2 11-5 12-12z',
  star: 'M12 1l3.2 6.9 7.3.9-5.4 5 1.4 7.4L12 17.6 5.5 21.2l1.4-7.4-5.4-5 7.3-.9z',
  heart: 'M12 21S3.6 15.6 3.6 9.9A4.7 4.7 0 0 1 12 6.9a4.7 4.7 0 0 1 8.4 3c0 5.7-8.4 11.1-8.4 11.1z',
};

// 色もトークンではなく直値だが、stage.css の CSS変数から引く（下の COLORS 参照）
const COLORS = ['var(--stage-c1)', 'var(--stage-c2)', 'var(--stage-c3)'];

const STAR_COUNT = 14;
const SPARK_COUNT = 10;

let el = null;            // .stage
let heroLayer = null;
let raf = 0;
let listeners = [];
let reduced = false;

// 目標値と現在値。差を毎フレーム詰めて滑らかにする（イージング）
let target = { x: 0, y: 0 };
let current = { x: 0, y: 0 };

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function on(node, type, fn, opts) {
  node.addEventListener(type, fn, opts);
  listeners.push(() => node.removeEventListener(type, fn, opts));
}

// =====================================================================
// 組み立て
// =====================================================================
/** 1粒ぶんの SVG。viewBox を固定しているので size だけで拡縮できる */
function shape(name, size, color) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" aria-hidden="true">`
       + `<path d="${SHAPES[name]}"/></svg>`;
}

function buildStars() {
  let html = '';
  for (let i = 0; i < STAR_COUNT; i++) {
    const name = Math.random() < 0.35 ? 'star' : 'spark';
    html += `<i style="--x:${rand(2, 94).toFixed(1)}%;--y:${rand(4, 82).toFixed(1)}%;`
          + `--dur:${rand(3.2, 6.5).toFixed(1)}s;--delay:${rand(0, 5).toFixed(1)}s">`
          + shape(name, rand(11, 24).toFixed(0), pick(COLORS))
          + '</i>';
  }
  return html;
}

function buildSparks() {
  let html = '';
  for (let i = 0; i < SPARK_COUNT; i++) {
    const name = Math.random() < 0.3 ? 'heart' : 'spark';
    html += `<i style="--x:${rand(3, 95).toFixed(1)}%;--dur:${rand(7, 13).toFixed(1)}s;`
          + `--delay:${rand(0, 10).toFixed(1)}s;--drift:${rand(-40, 40).toFixed(0)}px">`
          + shape(name, rand(12, 22).toFixed(0), pick(COLORS))
          + '</i>';
  }
  return html;
}

// =====================================================================
// 入力（スクロール / ポインタ）
// =====================================================================
function readScroll() {
  // 画面1つぶんスクロールしたら 1.0 になる正規化値
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const p = Math.min(1, Math.max(0, window.scrollY / max));
  // 上下方向にゆっくり流す。振れ幅は控えめにする（酔わせない）
  target.y = -p * 48;
}

function readPointer(ev) {
  // 中心からのずれを ±1 に正規化して左右に振る。
  // タッチ端末では pointermove が来ないので、実質デスクトップ専用。
  const nx = (ev.clientX / window.innerWidth) * 2 - 1;
  target.x = nx * 18;
}

// =====================================================================
// 毎フレーム: 目標値へ滑らかに寄せる
// =====================================================================
function tick() {
  raf = requestAnimationFrame(tick);
  if (!el) return;

  // 12%ずつ詰める。スクロールを止めた瞬間にピタッと止まらず、少し残る
  current.x += (target.x - current.x) * 0.12;
  current.y += (target.y - current.y) * 0.12;

  // 0.01px 未満の差でスタイル更新を続けない（無駄な再描画を止める）
  if (Math.abs(target.x - current.x) < 0.01 && Math.abs(target.y - current.y) < 0.01) {
    current.x = target.x;
    current.y = target.y;
  }

  el.style.setProperty('--sx', `${current.x.toFixed(2)}px`);
  el.style.setProperty('--sy', `${current.y.toFixed(2)}px`);
}

// =====================================================================
// 公開API
// =====================================================================
export function mount() {
  if (el) return;                                  // 二重マウント防止
  reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  el = document.createElement('div');
  el.className = 'stage';
  // 装飾なので支援技術からは完全に隠す
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="stage__layer stage__glow"></div>
    <div class="stage__layer stage__stars">${buildStars()}</div>
    <div class="stage__layer stage__hero"></div>
    <div class="stage__layer stage__sparks">${buildSparks()}</div>
  `;
  // #shell より前（背面）に置く
  document.body.insertBefore(el, document.body.firstChild);

  heroLayer = el.querySelector('.stage__hero');
  setHero(LS.getHeroId());

  if (reduced) return;   // 動かさない設定なら、ここで終わり（静止した装飾として残る）

  on(window, 'scroll', readScroll, { passive: true });
  on(window, 'resize', readScroll, { passive: true });
  // タッチ端末では発火しない。デスクトップだけのおまけ
  on(window, 'pointermove', readPointer, { passive: true });

  readScroll();
  raf = requestAnimationFrame(tick);
}

export function destroy() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  listeners.forEach((off) => off());
  listeners = [];
  el?.remove();
  el = null;
  heroLayer = null;
  target = { x: 0, y: 0 };
  current = { x: 0, y: 0 };
}

/**
 * 今日のミッションの達成状況を反映する。
 * 全部終わった日は2人が前に出て喜ぶ ＝ 「終わらせたくなる」動機にする。
 */
export function setProgress(done, total) {
  if (!el) return;
  el.classList.toggle('is-cheering', total > 0 && done >= total);
}

/**
 * 背景イラストを切り替えて記憶する。
 *
 * 差し替えは新しい img を作ってから入れ替える。
 * 同じ img の src を書き換えると、読み込み中に一瞬なにも表示されない。
 * 娘が続けてタップしたときにチカチカさせない。
 */
export function setHero(id) {
  LS.setHeroId(id);
  if (!heroLayer) return;

  const next = new Image();
  next.alt = '';
  next.decoding = 'async';
  next.addEventListener('load', () => {
    if (!heroLayer) return;                 // 読み込み中に destroy された
    heroLayer.classList.remove('is-missing');
    heroLayer.replaceChildren(next);
  }, { once: true });
  // 画像が無い/読めないときはこの層だけ畳む。ほかの層は残るので画面は壊れない
  next.addEventListener('error', () => {
    heroLayer?.classList.add('is-missing');
  }, { once: true });
  next.src = heroSrc(LS.getHeroId());
}

/** いま選ばれている番号 */
export function currentHero() {
  return LS.getHeroId();
}
