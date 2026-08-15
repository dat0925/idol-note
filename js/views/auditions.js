// =====================================================================
// auditions.js — オーディション / レッスン管理（親限定＋PIN解錠が必要）
//
// ★合否・講評・親メモ・費用は idol_audition_results（親限定テーブル）にある。
//   子アカウントでは RLS により行そのものが返らない。
//   「娘にも伝える」を ON にすると、DBトリガーが共有してよい範囲だけを
//   idol_auditions.shared_result に転記する。親メモと費用は転記されない。
// =====================================================================
import * as db from './../db.js';
import * as Store from './../store.js';
import { esc, toast, emptyState, skeleton, modal, confirmDialog } from './../ui.js';
import {
  jstToday, shortDate, deadlineText, deadlineLevel, AUDITION_STATUS, RESULT_LABEL,
} from './../format.js';

let root = null;
let state = { auditions: [], lessons: [], filter: 'active', selected: null, tasks: [], result: null, loading: true };

async function load() {
  state.loading = true;
  render();
  try {
    const [auditions, lessons] = await Promise.all([
      db.listAuditions(),
      db.listLessons({ from: '2000-01-01' }),
    ]);
    state.auditions = auditions;
    state.lessons = lessons;
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

async function select(id) {
  state.selected = id;
  state.tasks = [];
  state.result = null;
  render();
  if (!id) return;
  try {
    const [tasks, result] = await Promise.all([
      db.listAuditionTasks(id),
      db.getAuditionResult(id),
    ]);
    state.tasks = tasks;
    state.result = result;
  } catch (e) {
    toast(e.message, 'error');
  }
  render();
}

function filtered() {
  if (state.filter === 'all') return state.auditions;
  if (state.filter === 'done') return state.auditions.filter((a) => ['finished', 'declined'].includes(a.status));
  return state.auditions.filter((a) => !['finished', 'declined'].includes(a.status));
}

// =====================================================================
function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(4, 90); return; }

  root.innerHTML = `
    <div class="page-head">
      <h1>オーディション / レッスン</h1>
      <div class="row">
        <button class="btn btn--outline btn--sm" data-act="new-lesson">＋ レッスン</button>
        <button class="btn btn--primary btn--sm" data-act="new">＋ オーディション</button>
      </div>
    </div>

    <div class="chips" style="margin-bottom:var(--sp-3)">
      <button class="chip" aria-pressed="${state.filter === 'active'}" data-filter="active">進行中</button>
      <button class="chip" aria-pressed="${state.filter === 'done'}"   data-filter="done">終了</button>
      <button class="chip" aria-pressed="${state.filter === 'all'}"    data-filter="all">すべて</button>
    </div>

    <div class="grid grid--2" style="align-items:start">
      <div class="card">
        <p class="card__title">一覧</p>
        ${listTable()}
      </div>
      <div>${state.selected ? detailPanel() : `<div class="card">
        ${emptyState('👈', '案件を選ぶと、書類チェックリストや結果を編集できます')}
      </div>`}</div>
    </div>

    <div class="card">
      <p class="card__title">レッスン記録</p>
      ${lessonTable()}
    </div>
  `;
}

function listTable() {
  const list = filtered();
  if (!list.length) return emptyState('🎬', '登録された案件はありません');
  const today = jstToday();
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>案件</th><th>状態</th><th>応募締切</th><th>本番</th></tr></thead>
    <tbody>${list.map((a) => {
      const lv = deadlineLevel(a.apply_deadline, today);
      const st = AUDITION_STATUS[a.status] || { label: a.status, tag: '' };
      return `<tr class="${lv === 'urgent' || lv === 'over' ? 'is-urgent' : ''}"
                  data-select="${esc(a.id)}" style="cursor:pointer">
        <td><b>${esc(a.title)}</b><br><small style="color:var(--text-sub)">${esc(a.organizer)}</small></td>
        <td><span class="tag ${st.tag}">${esc(st.label)}</span></td>
        <td>${a.apply_deadline
          ? esc(a.apply_deadline) + `<br><small>${deadlineText(a.apply_deadline, today)}</small>` : '—'}</td>
        <td>${a.event_date ? esc(a.event_date) : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function detailPanel() {
  const a = state.auditions.find((x) => x.id === state.selected);
  if (!a) return '';
  const r = state.result;
  const docs = state.tasks.filter((t) => t.kind === 'document');
  const items = state.tasks.filter((t) => t.kind === 'belonging');
  const todos = state.tasks.filter((t) => t.kind === 'todo');

  return `<div class="card">
    <div class="row row--between">
      <p class="card__title" style="margin:0">${esc(a.title)}</p>
      <div class="row">
        <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(a.id)}">✏️</button>
        <button class="btn btn--ghost btn--sm" data-act="delete" data-id="${esc(a.id)}">🗑</button>
      </div>
    </div>
    <dl style="display:grid;grid-template-columns:auto 1fr;gap:4px var(--sp-3);font-size:var(--fs-sm);margin:var(--sp-3) 0">
      ${row('主催', a.organizer)}
      ${row('応募締切', a.apply_deadline ? `${a.apply_deadline}（${deadlineText(a.apply_deadline)}）` : '')}
      ${row('書類期限', a.document_due)}
      ${row('本番', [a.event_date, a.event_time].filter(Boolean).join(' '))}
      ${row('会場', a.venue)}
      ${row('URL', a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">開く</a>` : '', true)}
      ${row('持ち物メモ', a.belongings)}
      ${row('メモ', a.memo)}
    </dl>

    ${checklist('📄 提出書類', 'document', docs, a.id)}
    ${checklist('🎒 持ち物', 'belonging', items, a.id)}
    ${checklist('✅ やること', 'todo', todos, a.id)}

    <hr style="border:none;border-top:1px solid var(--border);margin:var(--sp-4) 0">

    <p class="card__title">結果（この欄はお子さんのアカウントには表示されません）</p>
    <div class="notice">
      🔒 合否・講評・費用・親メモは親アカウントだけが読めます。
      「娘にも伝える」を ON にすると、結果と伝える言葉だけが共有されます。
    </div>
    <form data-result-form>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1">
          <span class="field__label">結果</span>
          <select class="select" name="result">
            ${Object.entries(RESULT_LABEL).map(([k, v]) =>
              `<option value="${k}" ${r?.result === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </label>
        <label class="field" style="flex:1">
          <span class="field__label">結果日</span>
          <input class="input" type="date" name="result_date" value="${esc(r?.result_date || '')}">
        </label>
      </div>
      <label class="field">
        <span class="field__label">講評・落選理由</span>
        <textarea class="textarea" name="feedback" style="min-height:64px">${esc(r?.feedback || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">親メモ（絶対に共有されません）</span>
        <textarea class="textarea" name="parent_memo" style="min-height:64px">${esc(r?.parent_memo || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">かかった費用（円）</span>
        <input class="input" type="number" name="fee_yen" value="${r?.fee_yen ?? ''}">
      </label>
      <label class="field">
        <span class="field__label">
          <input type="checkbox" name="reveal_to_child" ${r?.reveal_to_child ? 'checked' : ''}>
          娘にも結果を伝える
        </span>
        <textarea class="textarea" name="child_note" style="min-height:56px"
          placeholder="伝えるときの言葉（例：とてもよくがんばったね！つぎもいこう）">${esc(r?.child_note || '')}</textarea>
      </label>
      <button class="btn btn--primary btn--block" type="submit">結果を保存</button>
    </form>
  </div>`;
}

function row(label, value, raw = false) {
  if (!value) return '';
  return `<dt style="color:var(--text-sub)">${esc(label)}</dt>
          <dd style="margin:0;white-space:pre-wrap">${raw ? value : esc(value)}</dd>`;
}

function checklist(title, kind, tasks, auditionId) {
  const done = tasks.filter((t) => t.done).length;
  return `<div style="margin-bottom:var(--sp-3)">
    <div class="row row--between">
      <b style="font-size:var(--fs-sm)">${title} ${tasks.length ? `(${done}/${tasks.length})` : ''}</b>
      <button class="btn btn--ghost btn--sm" data-act="add-task"
              data-kind="${kind}" data-audition="${esc(auditionId)}">＋</button>
    </div>
    ${tasks.length === 0
      ? '<p style="color:var(--text-sub);font-size:var(--fs-sm)">なし</p>'
      : `<ul>${tasks.map((t) => `<li class="row" style="padding:4px 0">
          <input type="checkbox" ${t.done ? 'checked' : ''} data-task="${esc(t.id)}">
          <span style="flex:1;${t.done ? 'text-decoration:line-through;color:var(--text-sub)' : ''}">
            ${esc(t.title)}${t.due_date ? ` <small class="tag">${esc(t.due_date)}</small>` : ''}
          </span>
          <button class="btn btn--ghost btn--sm" data-del-task="${esc(t.id)}">🗑</button>
        </li>`).join('')}</ul>`}
  </div>`;
}

function lessonTable() {
  if (!state.lessons.length) return emptyState('🩰', 'レッスンの記録はまだありません');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>日付</th><th>内容</th><th>先生</th><th>出欠</th><th>メモ</th><th></th></tr></thead>
    <tbody>${state.lessons.slice(0, 20).map((l) => `<tr>
      <td>${shortDate(l.lesson_date)}</td>
      <td><b>${esc(l.title)}</b><br><small style="color:var(--text-sub)">${esc(l.studio)}</small></td>
      <td>${esc(l.teacher)}</td>
      <td>${l.attended === null ? '<span class="tag">予定</span>'
            : l.attended ? '<span class="tag tag--ok">出席</span>'
            : '<span class="tag tag--danger">欠席</span>'}</td>
      <td style="white-space:normal">${esc((l.memo || '').slice(0, 40))}</td>
      <td><button class="btn btn--ghost btn--sm" data-act="edit-lesson" data-id="${esc(l.id)}">✏️</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// =====================================================================
// 編集モーダル
// =====================================================================
function auditionModal(a) {
  const x = a || {
    title: '', organizer: '', kind: 'audition', url: '',
    apply_deadline: '', document_due: '', event_date: '', event_time: '',
    venue: '', belongings: '', memo: '', status: 'interested',
  };
  const m = modal(`
    <p class="modal__title">${a ? 'オーディションを編集' : 'オーディションを追加'}</p>
    <form data-a-form>
      <label class="field"><span class="field__label">案件名</span>
        <input class="input" name="title" value="${esc(x.title)}" required></label>
      <label class="field"><span class="field__label">主催・事務所</span>
        <input class="input" name="organizer" value="${esc(x.organizer)}"></label>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">種別</span>
          <select class="select" name="kind">
            ${[['audition', 'オーディション'], ['contest', 'コンテスト'], ['workshop', 'ワークショップ'],
               ['interview', '面談'], ['other', 'その他']].map(([k, v]) =>
              `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></label>
        <label class="field" style="flex:1"><span class="field__label">状態</span>
          <select class="select" name="status">
            ${Object.entries(AUDITION_STATUS).map(([k, v]) =>
              `<option value="${k}" ${x.status === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
          </select></label>
      </div>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">応募締切</span>
          <input class="input" type="date" name="apply_deadline" value="${esc(x.apply_deadline || '')}"></label>
        <label class="field" style="flex:1"><span class="field__label">書類期限</span>
          <input class="input" type="date" name="document_due" value="${esc(x.document_due || '')}"></label>
      </div>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">本番日</span>
          <input class="input" type="date" name="event_date" value="${esc(x.event_date || '')}"></label>
        <label class="field" style="flex:1"><span class="field__label">時刻</span>
          <input class="input" type="time" name="event_time" value="${esc(x.event_time || '')}"></label>
      </div>
      <label class="field"><span class="field__label">会場</span>
        <input class="input" name="venue" value="${esc(x.venue)}"></label>
      <label class="field"><span class="field__label">URL</span>
        <input class="input" type="url" name="url" value="${esc(x.url || '')}"></label>
      <label class="field"><span class="field__label">持ち物メモ</span>
        <textarea class="textarea" name="belongings" style="min-height:56px">${esc(x.belongings)}</textarea></label>
      <label class="field"><span class="field__label">メモ</span>
        <textarea class="textarea" name="memo" style="min-height:56px">${esc(x.memo)}</textarea></label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);
  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  m.box.querySelector('[data-a-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    try {
      const saved = await db.upsertAudition({
        ...(a ? { id: a.id } : {}),
        title: fd.title.trim(), organizer: fd.organizer.trim(), kind: fd.kind,
        url: fd.url.trim() || null, status: fd.status,
        apply_deadline: fd.apply_deadline || null,
        document_due: fd.document_due || null,
        event_date: fd.event_date || null,
        event_time: fd.event_time || null,
        venue: fd.venue.trim(), belongings: fd.belongings.trim(), memo: fd.memo.trim(),
      });
      m.close();
      await load();
      if (saved) await select(saved.id);
      toast('保存しました', 'ok');
    } catch (e) {
      m.box.querySelector('[data-error]').textContent = e.message;
    }
  };
}

function lessonModal(l) {
  const x = l || {
    title: '', category: 'dance', studio: '', teacher: '',
    lesson_date: jstToday(), start_time: '', end_time: '', attended: null, memo: '', fee_yen: '',
  };
  const m = modal(`
    <p class="modal__title">${l ? 'レッスンを編集' : 'レッスンを追加'}</p>
    <form data-l-form>
      <label class="field"><span class="field__label">レッスン名</span>
        <input class="input" name="title" value="${esc(x.title)}" required></label>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">種別</span>
          <select class="select" name="category">
            ${[['vocal', 'ボイス'], ['dance', 'ダンス'], ['acting', '演技'],
               ['walking', 'ウォーキング'], ['other', 'その他']].map(([k, v]) =>
              `<option value="${k}" ${x.category === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></label>
        <label class="field" style="flex:1"><span class="field__label">日付</span>
          <input class="input" type="date" name="lesson_date" value="${esc(x.lesson_date)}" required></label>
      </div>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">開始</span>
          <input class="input" type="time" name="start_time" value="${esc(x.start_time || '')}"></label>
        <label class="field" style="flex:1"><span class="field__label">終了</span>
          <input class="input" type="time" name="end_time" value="${esc(x.end_time || '')}"></label>
      </div>
      <label class="field"><span class="field__label">スタジオ</span>
        <input class="input" name="studio" value="${esc(x.studio)}"></label>
      <label class="field"><span class="field__label">先生</span>
        <input class="input" name="teacher" value="${esc(x.teacher)}"></label>
      <label class="field"><span class="field__label">出欠</span>
        <select class="select" name="attended">
          <option value="" ${x.attended === null ? 'selected' : ''}>予定</option>
          <option value="1" ${x.attended === true ? 'selected' : ''}>出席</option>
          <option value="0" ${x.attended === false ? 'selected' : ''}>欠席</option>
        </select></label>
      <label class="field"><span class="field__label">先生からのアドバイス</span>
        <textarea class="textarea" name="memo">${esc(x.memo)}</textarea></label>
      <label class="field"><span class="field__label">レッスン料（円）</span>
        <input class="input" type="number" name="fee_yen" value="${x.fee_yen ?? ''}"></label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);
  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  m.box.querySelector('[data-l-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    try {
      await db.upsertLesson({
        ...(l ? { id: l.id } : {}),
        title: fd.title.trim(), category: fd.category,
        lesson_date: fd.lesson_date,
        start_time: fd.start_time || null, end_time: fd.end_time || null,
        studio: fd.studio.trim(), teacher: fd.teacher.trim(),
        attended: fd.attended === '' ? null : fd.attended === '1',
        memo: fd.memo.trim(),
        fee_yen: fd.fee_yen === '' ? null : parseInt(fd.fee_yen, 10),
      });
      m.close();
      await load();
      toast('保存しました', 'ok');
    } catch (e) {
      m.box.querySelector('[data-error]').textContent = e.message;
    }
  };
}

// =====================================================================
export default {
  async mount(el) {
    root = el;
    state = { auditions: [], lessons: [], filter: 'active', selected: null, tasks: [], result: null, loading: true };

    root.addEventListener('click', async (ev) => {
      const chip = ev.target.closest('[data-filter]');
      if (chip) { state.filter = chip.dataset.filter; render(); return; }

      const rowSel = ev.target.closest('[data-select]');
      if (rowSel && !ev.target.closest('[data-act]')) { await select(rowSel.dataset.select); return; }

      const delTask = ev.target.closest('[data-del-task]');
      if (delTask) {
        try { await db.deleteAuditionTask(delTask.dataset.delTask); await select(state.selected); }
        catch (e) { toast(e.message, 'error'); }
        return;
      }

      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      try {
        if (act === 'new') auditionModal(null);
        else if (act === 'new-lesson') lessonModal(null);
        else if (act === 'edit') auditionModal(state.auditions.find((a) => a.id === btn.dataset.id));
        else if (act === 'edit-lesson') lessonModal(state.lessons.find((l) => l.id === btn.dataset.id));
        else if (act === 'delete') {
          const a = state.auditions.find((x) => x.id === btn.dataset.id);
          const ok = await confirmDialog(`「${a.title}」を削除しますか？`, { okLabel: '削除する', danger: true });
          if (!ok) return;
          await db.softDeleteAudition(a.id);
          state.selected = null;
          await load();
        } else if (act === 'add-task') {
          const { promptDialog } = await import('./../ui.js');
          const title = await promptDialog('追加する項目', { placeholder: '例：履歴書（写真つき）' });
          if (!title?.trim()) return;
          await db.upsertAuditionTask({
            audition_id: btn.dataset.audition,
            kind: btn.dataset.kind,
            title: title.trim(),
            sort_order: state.tasks.length,
          });
          await select(state.selected);
        }
      } catch (e) {
        toast(e.message || 'うまくいきませんでした', 'error');
      }
    });

    root.addEventListener('change', async (ev) => {
      const cb = ev.target.closest('[data-task]');
      if (!cb) return;
      const t = state.tasks.find((x) => x.id === cb.dataset.task);
      if (!t) return;
      try {
        await db.upsertAuditionTask({
          id: t.id, audition_id: t.audition_id, title: t.title, kind: t.kind,
          done: cb.checked, done_at: cb.checked ? new Date().toISOString() : null,
        });
        await select(state.selected);
      } catch (e) { toast(e.message, 'error'); }
    });

    root.addEventListener('submit', async (ev) => {
      const form = ev.target.closest('[data-result-form]');
      if (!form) return;
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      try {
        await db.upsertAuditionResult({
          audition_id: state.selected,
          result: fd.result,
          result_date: fd.result_date || null,
          feedback: fd.feedback.trim(),
          parent_memo: fd.parent_memo.trim(),
          fee_yen: fd.fee_yen === '' ? null : parseInt(fd.fee_yen, 10),
          reveal_to_child: !!fd.reveal_to_child,
          child_note: fd.child_note.trim(),
        });
        await select(state.selected);
        await load();
        toast('結果を保存しました', 'ok');
      } catch (e) {
        toast(e.message || '保存できませんでした', 'error');
      }
    });

    await load();
  },

  destroy() { root = null; },
};
