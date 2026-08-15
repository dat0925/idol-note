// =====================================================================
// calendar.js — 月カレンダー（親限定＋PIN解錠が必要）
//   v_idol_calendar（締切・本番・書類期限・レッスンの統合ビュー）と
//   練習実施日のドットを重ねて表示する。
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import { esc, toast, skeleton, emptyState } from './../ui.js';
import { jstToday, longDate, deadlineText, minutesText } from './../format.js';

let root = null;
let state = { ym: '', events: [], logs: [], picked: null, loading: true };

const KIND_COLOR = {
  audition_deadline: '#d9534f',
  audition_event: '#7c8cff',
  audition_task: '#e8a33d',
  lesson: '#59c8a5',
};

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first, last: `${ym}-${String(lastDay).padStart(2, '0')}`, y, m, lastDay };
}

async function load() {
  state.loading = true;
  render();
  const { first, last } = monthRange(state.ym);
  try {
    const [events, logs] = await Promise.all([
      db.listCalendar(first, last),
      db.listLogs({ from: first, to: last }),
    ]);
    state.events = events;
    state.logs = logs;
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(2, 320); return; }

  const { y, m, lastDay } = monthRange(state.ym);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const today = jstToday();

  const evByDate = new Map();
  for (const e of state.events) {
    if (!evByDate.has(e.on_date)) evByDate.set(e.on_date, []);
    evByDate.get(e.on_date).push(e);
  }
  const logByDate = new Map(state.logs.map((l) => [l.log_date, l]));

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal__day cal__day--out"></div>');
  for (let d = 1; d <= lastDay; d++) {
    const key = `${state.ym}-${String(d).padStart(2, '0')}`;
    const evs = evByDate.get(key) || [];
    const log = logByDate.get(key);
    cells.push(`<div class="cal__day ${key === today ? 'cal__day--today' : ''}"
                     data-day="${key}" style="cursor:pointer">
      <div class="cal__num">${d}</div>
      ${log && log.total_minutes > 0 ? '<span class="cal__dot" title="練習した日"></span>' : ''}
      ${evs.slice(0, 3).map((e) => `<span class="cal__ev"
        style="background:${esc(KIND_COLOR[e.kind] || e.color || '#888')}"
        title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}
      ${evs.length > 3 ? `<span style="color:var(--text-sub)">ほか${evs.length - 3}件</span>` : ''}
    </div>`);
  }

  root.innerHTML = `
    <div class="page-head">
      <h1>カレンダー</h1>
      <div class="row">
        <button class="btn btn--outline btn--sm" data-move="-1" aria-label="前の月">${icon('chevronL', { size: 18 })}</button>
        <b style="min-width:110px;text-align:center">${y}年${m}月</b>
        <button class="btn btn--outline btn--sm" data-move="1" aria-label="次の月">${icon('chevronR', { size: 18 })}</button>
        <button class="btn btn--ghost btn--sm" data-move="0">今月</button>
      </div>
    </div>

    <div class="cal" style="margin-bottom:var(--sp-4)">
      ${['日', '月', '火', '水', '木', '金', '土'].map((d) => `<div class="cal__dow">${d}</div>`).join('')}
      ${cells.join('')}
    </div>

    <div class="row" style="gap:var(--sp-4);font-size:var(--fs-xs);color:var(--text-sub);margin-bottom:var(--sp-4)">
      <span><span class="cal__ev" style="background:#d9534f;display:inline-block;width:14px"></span> 応募締切</span>
      <span><span class="cal__ev" style="background:#7c8cff;display:inline-block;width:14px"></span> 本番</span>
      <span><span class="cal__ev" style="background:#e8a33d;display:inline-block;width:14px"></span> 書類期限</span>
      <span><span class="cal__ev" style="background:#59c8a5;display:inline-block;width:14px"></span> レッスン</span>
      <span><span class="cal__dot"></span> 練習した日</span>
    </div>

    ${state.picked ? dayPanel(evByDate.get(state.picked) || [], logByDate.get(state.picked)) : ''}

    <div class="card">
      <p class="card__title">この月の予定</p>
      ${state.events.length === 0
        ? emptyState('📅', 'この月の予定はありません')
        : `<ul>${state.events.map((e) => `<li class="row row--between"
             style="padding:var(--sp-2) 0;border-bottom:1px solid var(--border)">
            <span>${esc(e.title)}</span>
            <span style="color:var(--text-sub);font-size:var(--fs-sm)">
              ${esc(e.on_date)}${e.at_time ? ' ' + esc(e.at_time.slice(0, 5)) : ''}
              ・${deadlineText(e.on_date)}
            </span>
          </li>`).join('')}</ul>`}
    </div>
  `;
}

function dayPanel(evs, log) {
  return `<div class="card">
    <div class="row row--between">
      <p class="card__title" style="margin:0">${longDate(state.picked)}</p>
      <button class="btn btn--ghost btn--sm" data-close-day>×</button>
    </div>
    ${log && log.total_minutes > 0
      ? `<p style="margin-top:var(--sp-2)">✏️ 練習 ${minutesText(log.total_minutes)}
          ${log.note ? '<br><small style="color:var(--text-sub)">' + esc(log.note) + '</small>' : ''}</p>`
      : '<p style="margin-top:var(--sp-2);color:var(--text-sub)">練習の記録はありません</p>'}
    ${evs.length
      ? `<ul style="margin-top:var(--sp-2)">${evs.map((e) =>
          `<li style="padding:4px 0">${esc(e.title)}
            ${e.at_time ? '<small>' + esc(e.at_time.slice(0, 5)) + '</small>' : ''}</li>`).join('')}</ul>`
      : ''}
  </div>`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default {
  async mount(el) {
    root = el;
    state = { ym: jstToday().slice(0, 7), events: [], logs: [], picked: null, loading: true };

    root.addEventListener('click', async (ev) => {
      const move = ev.target.closest('[data-move]');
      if (move) {
        const d = Number(move.dataset.move);
        state.ym = d === 0 ? jstToday().slice(0, 7) : shiftMonth(state.ym, d);
        state.picked = null;
        await load();
        return;
      }
      if (ev.target.closest('[data-close-day]')) { state.picked = null; render(); return; }
      const day = ev.target.closest('[data-day]');
      if (day) { state.picked = day.dataset.day; render(); }
    });

    await load();
  },

  destroy() { root = null; },
};
