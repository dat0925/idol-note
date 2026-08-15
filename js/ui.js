// =====================================================================
// ui.js — DOM ヘルパ
// Supabase を知らない。純粋に DOM だけを扱う層。
// =====================================================================
import { esc } from './format.js';

export { esc };

/** querySelector の短縮 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML 文字列から要素を作る */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * イベント委譲。root に1回だけリスナを張り、セレクタに一致した祖先を探す。
 * 再描画のたびにリスナを張り直さなくて済む。
 */
export function delegate(root, type, selector, handler) {
  const fn = (ev) => {
    const target = ev.target.closest(selector);
    if (target && root.contains(target)) handler(ev, target);
  };
  root.addEventListener(type, fn);
  return () => root.removeEventListener(type, fn);
}

// ── トースト ─────────────────────────────────────────
export function toast(message, kind = '', ms = 2600) {
  const root = $('#toastRoot');
  if (!root) return;
  const node = el(`<div class="toast ${kind ? 'toast--' + kind : ''}">${esc(message)}</div>`);
  root.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .25s';
    setTimeout(() => node.remove(), 260);
  }, ms);
}

// ── モーダル ─────────────────────────────────────────
let modalCleanup = null;

/**
 * モーダルを開く。
 * @param {string} innerHTML .modal__box の中身
 * @param {{onClose?:Function, dismissible?:boolean}} opts
 * @returns {{box:HTMLElement, close:Function}}
 */
export function modal(innerHTML, opts = {}) {
  closeModal();
  const root = $('#modalRoot');
  const overlay = el(`<div class="modal"><div class="modal__box" role="dialog" aria-modal="true">${innerHTML}</div></div>`);
  root.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    modalCleanup = null;
    opts.onClose?.();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape' && opts.dismissible !== false) close();
  };
  document.addEventListener('keydown', onKey);
  if (opts.dismissible !== false) {
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  }
  modalCleanup = close;

  // 最初のフォーカス可能要素へ
  const first = overlay.querySelector('input, button, textarea, select');
  first?.focus({ preventScroll: true });

  return { box: overlay.querySelector('.modal__box'), overlay, close };
}

export function closeModal() {
  modalCleanup?.();
}

/** 確認ダイアログ。Promise<boolean> を返す（window.confirm は使わない） */
export function confirmDialog(message, { okLabel = 'はい', cancelLabel = 'やめる', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };

    const m = modal(`
      <p class="modal__title">${esc(message)}</p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(okLabel)}</button>
      </div>
    `, { onClose: () => finish(false) });   // 背景クリック / Esc は「やめる」扱い

    m.box.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      finish(act === 'ok');   // 先に確定させてから閉じる（onClose の false に負けない）
      m.close();
    });
  });
}

/** プロンプト（1行入力）。Promise<string|null> */
export function promptDialog(title, { value = '', placeholder = '', type = 'text', okLabel = '決定' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };

    const m = modal(`
      <p class="modal__title">${esc(title)}</p>
      <input class="input" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}">
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="button" class="btn btn--primary" data-act="ok">${esc(okLabel)}</button>
      </div>
    `, { onClose: () => finish(null) });

    const input = m.box.querySelector('.input');
    const done = (ok) => { finish(ok ? input.value : null); m.close(); };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); });
    m.box.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act) done(act === 'ok');
    });
  });
}

// ── 空状態 / ローディング ────────────────────────────
export function emptyState(icon, message, actionHTML = '') {
  return `<div class="empty">
    <div class="empty__ico">${icon}</div>
    <p class="empty__msg">${esc(message)}</p>
    ${actionHTML}
  </div>`;
}

export function skeleton(count = 3, height = 64) {
  return Array.from({ length: count },
    () => `<div class="skeleton" style="height:${height}px;margin-bottom:12px"></div>`).join('');
}

// ── 進捗リング（依存なしSVG）─────────────────────────
export function progressRing(percent, size = 84, stroke = 9) {
  const p = Math.max(0, Math.min(100, Math.round(percent) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - p / 100);
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" aria-hidden="true">
      <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}"
              fill="none" stroke-width="${stroke}"></circle>
      <circle class="ring__fill" cx="${size / 2}" cy="${size / 2}" r="${r}"
              fill="none" stroke-width="${stroke}"
              stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
    </svg>
    <span class="ring__label">${p}<small style="font-size:.6em">%</small></span>
  </div>`;
}

export function progressBar(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent) || 0));
  return `<div class="bar"><div class="bar__fill" style="width:${p}%"></div></div>`;
}

// ── 触覚・演出 ───────────────────────────────────────
export function vibrate(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* noop */ }
}

const CONFETTI_COLORS = ['#ff6fa5', '#ffd36e', '#7ad3ff', '#9ee493', '#c9a7ff'];

/** 紙吹雪。prefers-reduced-motion のときは CSS 側で非表示になる */
export function confetti(count = 60) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const root = $('#fxRoot');
  if (!root) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const node = document.createElement('span');
    node.className = 'confetti';
    node.style.left = Math.random() * 100 + 'vw';
    node.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    node.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
    node.style.animationDelay = (Math.random() * 0.4) + 's';
    frag.appendChild(node);
  }
  root.appendChild(frag);
  setTimeout(() => { root.innerHTML = ''; }, 3600);
}
