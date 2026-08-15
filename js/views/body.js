// =====================================================================
// body.js — からだの記録（親限定＋PIN解錠が必要）
//
// ★9歳の子に体重の数値を毎日見せ続けるのは体型意識の面でリスクがあるため、
//   既定では子アカウントに一切見えない（RLSで行ごと返さない）。
//   行ごとに「本人にも見せる」を選べるので、身長だけ共有する運用ができる。
// ★ここで読んだ値は localStorage に保存しない（メモリのみ）。
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import * as Store from './../store.js';
import { esc, toast, skeleton, emptyState, confirmDialog, modal } from './../ui.js';
import { jstToday, shortDate } from './../format.js';

let root = null;
let state = { records: [], metric: 'height_cm', loading: true };

async function load() {
  state.loading = true;
  render();
  try {
    state.records = await db.listBodyRecords();
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

/** 施錠されたらメモリからも捨てる */
function onLocked() {
  state.records = [];
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(3, 120); return; }

  const withValue = state.records.filter((r) => r[state.metric] != null);

  root.innerHTML = `
    <div class="page-head">
      <h1>からだの記録</h1>
      <button class="btn btn--primary btn--sm" data-act="new">＋ 記録する</button>
    </div>

    <div class="notice">
      🔒 この画面はおとなモード専用です。数値は既定ではお子さんのアカウントに表示されません。
      行ごとの「本人にも見せる」を ON にした記録だけが共有されます。
    </div>

    <div class="chips" style="margin-bottom:var(--sp-3)">
      <button class="chip" aria-pressed="${state.metric === 'height_cm'}" data-metric="height_cm">身長</button>
      <button class="chip" aria-pressed="${state.metric === 'weight_kg'}" data-metric="weight_kg">体重</button>
      <button class="chip" aria-pressed="${state.metric === 'shoe_size_cm'}" data-metric="shoe_size_cm">くつのサイズ</button>
    </div>

    <div class="card">
      <p class="card__title">${metricLabel(state.metric)}の推移</p>
      ${withValue.length < 2
        ? emptyState('📈', '2件以上記録するとグラフが表示されます')
        : lineChart(withValue, state.metric)}
    </div>

    <div class="card">
      <p class="card__title">記録一覧</p>
      ${state.records.length === 0
        ? emptyState('📏', 'まだ記録がありません')
        : `<div class="table-wrap"><table class="table">
            <thead><tr><th>日付</th><th class="num">身長</th><th class="num">体重</th>
              <th class="num">くつ</th><th>本人に見せる</th><th>メモ</th><th></th></tr></thead>
            <tbody>${state.records.slice().reverse().map((r) => `<tr>
              <td>${shortDate(r.measured_on)}</td>
              <td class="num">${r.height_cm ?? '—'}</td>
              <td class="num">${r.weight_kg ?? '—'}</td>
              <td class="num">${r.shoe_size_cm ?? '—'}</td>
              <td><input type="checkbox" data-visible="${esc(r.id)}" ${r.visible_to_child ? 'checked' : ''}></td>
              <td style="white-space:normal">${esc((r.note || '').slice(0, 30))}</td>
              <td>
                <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(r.id)}" aria-label="編集">${icon('pencil', { size: 18 })}</button>
                <button class="btn btn--ghost btn--sm" data-act="delete" data-id="${esc(r.id)}" aria-label="削除">${icon('trash', { size: 18 })}</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div>`}
    </div>
  `;
}

function metricLabel(m) {
  return ({ height_cm: '身長(cm)', weight_kg: '体重(kg)', shoe_size_cm: 'くつのサイズ(cm)' })[m] || m;
}

/** 依存ライブラリなしの折れ線グラフ */
function lineChart(records, metric) {
  const W = 640, H = 220, PAD_L = 42, PAD_B = 26, PAD_T = 12, PAD_R = 12;
  const pts = records.map((r) => ({ x: r.measured_on, y: Number(r[metric]) }));
  const ys = pts.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = (max - min) || 1;
  const lo = min - span * 0.15, hi = max + span * 0.15;

  const px = (i) => PAD_L + (i / Math.max(1, pts.length - 1)) * (W - PAD_L - PAD_R);
  const py = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${px(pts.length - 1).toFixed(1)},${H - PAD_B} L${PAD_L},${H - PAD_B} Z`;

  const ticks = [lo, (lo + hi) / 2, hi];
  // ラベルは最大6個まで（詰まりすぎるとPCでも読めない）
  const step = Math.max(1, Math.ceil(pts.length / 6));

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
            aria-label="${esc(metricLabel(metric))}の推移グラフ">
    ${ticks.map((t) => `
      <line class="chart__grid" x1="${PAD_L}" y1="${py(t).toFixed(1)}" x2="${W - PAD_R}" y2="${py(t).toFixed(1)}"></line>
      <text class="chart__axis" x="4" y="${(py(t) + 3).toFixed(1)}">${t.toFixed(1)}</text>`).join('')}
    <path class="chart__area" d="${area}"></path>
    <path class="chart__line" d="${line}"></path>
    ${pts.map((p, i) => `<circle class="chart__dot" cx="${px(i).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3">
      <title>${esc(p.x)}: ${p.y}</title></circle>`).join('')}
    ${pts.map((p, i) => (i % step === 0 || i === pts.length - 1)
      ? `<text class="chart__axis" x="${px(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(p.x.slice(5))}</text>`
      : '').join('')}
  </svg>`;
}

function editModal(rec) {
  const r = rec || {
    measured_on: jstToday(), height_cm: '', weight_kg: '', shoe_size_cm: '',
    note: '', visible_to_child: false,
  };
  const m = modal(`
    <p class="modal__title">${rec ? '記録を編集' : 'からだの記録'}</p>
    <form data-body-form>
      <label class="field"><span class="field__label">日付</span>
        <input class="input" type="date" name="measured_on" value="${esc(r.measured_on)}"
               max="${jstToday()}" required></label>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">身長 (cm)</span>
          <input class="input" type="number" step="0.1" name="height_cm" value="${r.height_cm ?? ''}"></label>
        <label class="field" style="flex:1"><span class="field__label">体重 (kg)</span>
          <input class="input" type="number" step="0.1" name="weight_kg" value="${r.weight_kg ?? ''}"></label>
      </div>
      <label class="field"><span class="field__label">くつのサイズ (cm)</span>
        <input class="input" type="number" step="0.5" name="shoe_size_cm" value="${r.shoe_size_cm ?? ''}"></label>
      <label class="field"><span class="field__label">メモ</span>
        <input class="input" name="note" value="${esc(r.note || '')}"></label>
      <label class="field">
        <span class="field__label">
          <input type="checkbox" name="visible_to_child" ${r.visible_to_child ? 'checked' : ''}>
          この記録を本人にも見せる
        </span>
        <span class="field__hint">「身長が伸びた」は本人の励みになりますが、体重は慎重に。</span>
      </label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);
  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  m.box.querySelector('[data-body-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    const num = (v) => (v === '' ? null : Number(v));
    try {
      await db.upsertBodyRecord({
        ...(rec ? { id: rec.id } : {}),
        subject_user_id: Store.get('talentId'),
        measured_on: fd.measured_on,
        height_cm: num(fd.height_cm),
        weight_kg: num(fd.weight_kg),
        shoe_size_cm: num(fd.shoe_size_cm),
        note: fd.note.trim(),
        visible_to_child: !!fd.visible_to_child,
      });
      m.close();
      await load();
      toast('保存しました', 'ok');
    } catch (e) {
      m.box.querySelector('[data-error]').textContent = e.message;
    }
  };
}

export default {
  async mount(el) {
    root = el;
    state = { records: [], metric: 'height_cm', loading: true };
    window.addEventListener('idol:locked', onLocked);

    root.addEventListener('click', async (ev) => {
      const chip = ev.target.closest('[data-metric]');
      if (chip) { state.metric = chip.dataset.metric; render(); return; }

      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const rec = state.records.find((r) => r.id === btn.dataset.id);
      try {
        if (btn.dataset.act === 'new') editModal(null);
        else if (btn.dataset.act === 'edit' && rec) editModal(rec);
        else if (btn.dataset.act === 'delete' && rec) {
          const ok = await confirmDialog('この記録を削除しますか？', { okLabel: '削除する', danger: true });
          if (!ok) return;
          await db.softDeleteBodyRecord(rec.id);
          await load();
        }
      } catch (e) { toast(e.message, 'error'); }
    });

    root.addEventListener('change', async (ev) => {
      const cb = ev.target.closest('[data-visible]');
      if (!cb) return;
      const rec = state.records.find((r) => r.id === cb.dataset.visible);
      if (!rec) return;
      try {
        await db.upsertBodyRecord({ ...rec, visible_to_child: cb.checked });
        await load();
      } catch (e) { toast(e.message, 'error'); cb.checked = !cb.checked; }
    });

    await load();
  },

  destroy() {
    window.removeEventListener('idol:locked', onLocked);
    root = null;
  },
};
