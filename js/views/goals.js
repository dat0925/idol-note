// =====================================================================
// goals.js — 目標とロードマップ
//
// 階層は4段（自己参照の1テーブル）:
//   最終目標(big) → 中間目標(milestone) → 月の目標(month) → 行動目標(task)
//   ★行動目標は「今日それをやったかどうか」が言える粒度にする。
//     「がんばる」は目標ではなく気持ちなので、チェックできない。
//
//   こども: 本番までのカウントダウン ＋ 今月やること ＋ 山のぼり
//   おとな: サマリー ＋ タイムライン ＋ ツリー編集
//
// 達成度は下から積み上がる。行動目標にチェックを入れると、
// サーバーのトリガーが 月 → 中間 → 最終 の順に平均を取り直す
// （progress_mode='auto' のとき）。画面側では合計しない。
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import * as Store from './../store.js';
import {
  esc, toast, progressBar, progressRing, emptyState, skeleton, modal, confirmDialog, confetti,
} from './../ui.js';
import {
  jstToday, shortDate, longDate, diffDays, deadlineText, addMonths, monthEnd,
  GOAL_LEVELS, levelLabel, ageText,
} from './../format.js';
import { timeline, flattenGoals } from './../components/timeline.js';
import { TEMPLATES, toRows } from './../goal-templates.js';

let root = null;
let unsub = [];
let state = { goals: [], loading: true, showActions: false };

const childLevel = (level) => GOAL_LEVELS[level]?.child || null;

async function load() {
  state.loading = true;
  render();
  try {
    state.goals = await db.listGoals();
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

const alive = (g) => g.status !== 'archived';

const childrenOf = (id) => state.goals
  .filter((g) => g.parent_goal_id === id && alive(g))
  .sort((a, b) => (a.sort_order - b.sort_order)
    || String(a.period_end || '9999').localeCompare(String(b.period_end || '9999')));

const roots = () => state.goals
  .filter((g) => !g.parent_goal_id && alive(g))
  .sort((a, b) => a.sort_order - b.sort_order);

/**
 * ある目標と、その配下すべての id。
 * 削除は soft delete（deleted_at）で、DB の cascade が効かないので
 * 消す範囲をここで作る。
 */
function subtreeIds(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const c of state.goals.filter((g) => g.parent_goal_id === out[i])) {
      if (!out.includes(c.id)) out.push(c.id);
    }
  }
  return out;
}

/** 期間に今日が入っている行動目標＝「いまやること」 */
function currentTasks(today = jstToday()) {
  return state.goals.filter((g) => g.level === 'task' && alive(g)
    && (!g.period_start || g.period_start <= today)
    && (!g.period_end || g.period_end >= today))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** 本人の生年月日（目標の期日にその子が何歳かを出すのに使う） */
const talentBirthday = () =>
  Store.get('members').find((m) => m.is_talent)?.birthday || null;

// =====================================================================
// 共通パーツ
// =====================================================================

/** 期日までの残り。過ぎていたら赤くする */
function countdown(g) {
  if (!g.period_end) return '';
  const n = diffDays(g.period_end, jstToday());
  const cls = n < 0 ? 'tag--danger' : n <= 30 ? 'tag--warn' : 'tag--info';
  return `<span class="tag ${cls}">${esc(deadlineText(g.period_end))}</span>`;
}

/** タイムライン。期日を持つ目標が無ければ何も出さない */
function chartCard(maxRank, { toggle = false } = {}) {
  const shown = flattenGoals(state.goals, { maxRank });
  const all = flattenGoals(state.goals, { maxRank: 3 });
  const hidden = all.length - shown.length;
  const html = timeline(shown, { mode: Store.get('mode') });
  if (!html) return '';

  return `<div class="card">
    <div class="row row--between" style="margin-bottom:var(--sp-3)">
      <p class="card__title" style="margin:0">${icon('calendar', { size: 20 })} いつまでに何をするか</p>
      ${toggle && (hidden > 0 || state.showActions)
        ? `<button class="btn btn--ghost btn--sm" data-act="toggle-actions">
             ${state.showActions ? '行動目標をたたむ' : `行動目標も表示（${hidden}件）`}
           </button>`
        : ''}
    </div>
    ${html}
    ${!toggle && hidden > 0
      ? `<p class="field__hint">※行動目標 ${hidden} 件はこの図では省いています</p>`
      : ''}
  </div>`;
}

// =====================================================================
// こども
// =====================================================================
function kidView() {
  const big = roots();
  if (!big.length) {
    return emptyState('🎯', 'まだ目標がありません。\nおうちの人といっしょに決めよう！');
  }
  const tasks = currentTasks();

  return big.map((g) => {
    const steps = childrenOf(g.id);
    const nowIdx = steps.findIndex((s) => s.status !== 'done');
    const bd = talentBirthday();

    return `
      <div class="card" style="text-align:center;margin-bottom:var(--sp-4)">
        <div style="font-size:44px">${esc(g.icon)}</div>
        <h2 style="font-size:var(--fs-lg);font-weight:900;margin:var(--sp-2) 0">${esc(g.title)}</h2>
        ${g.period_end ? `<p style="font-weight:800;color:var(--accent)">
          ${esc(longDate(g.period_end))} ・ ${esc(deadlineText(g.period_end))}
          ${bd ? `<br><span style="color:var(--text-sub);font-size:var(--fs-sm);font-weight:700">その日は ${esc(ageText(bd, g.period_end))}</span>` : ''}
        </p>` : ''}
        <div style="display:flex;justify-content:center;margin-top:var(--sp-3)">
          ${progressRing(g.progress_pct, 104, 11)}
        </div>
      </div>

      ${tasks.length ? `<div class="card" style="margin-bottom:var(--sp-4)">
        <p class="card__title">${icon('check', { size: 20 })} いま取り組んでいること</p>
        <ul>${tasks.map((t) => `<li>
          <button class="task-row" data-act="toggle-task" data-id="${esc(t.id)}"
                  aria-pressed="${t.status === 'done'}">
            <span class="task-row__box" aria-hidden="true">${t.status === 'done' ? '✓' : ''}</span>
            <span class="task-row__body">
              <span class="task-row__title">${esc(t.icon)} ${esc(t.title)}</span>
              ${t.description ? `<span class="task-row__note">${esc(t.description)}</span>` : ''}
            </span>
          </button></li>`).join('')}</ul>
      </div>` : ''}

      <div class="mountain">
        ${steps.length === 0
          ? emptyState('🗻', 'ステップがまだありません')
          : steps.slice().reverse().map((s, i) => {
              const realIdx = steps.length - 1 - i;
              const isNow = realIdx === nowIdx;
              const isDone = s.status === 'done';
              return `<div class="mountain__step ${isDone ? 'mountain__step--done' : ''} ${isNow ? 'mountain__step--now' : ''}">
                <span class="mountain__ico">${isDone ? '🏁' : esc(s.icon)}</span>
                <div class="mountain__body">
                  <div class="mountain__title">${esc(s.title)}</div>
                  <div class="mountain__meta">
                    ${s.period_end ? '〜' + esc(shortDate(s.period_end)) : ''}
                    ${s.progress_pct ? ' ・ ' + s.progress_pct + '%' : ''}
                  </div>
                </div>
                ${isNow ? '<span class="mountain__here">いまここ</span>' : ''}
              </div>`;
            }).join('')}
      </div>`;
  }).join('') + chartCard(2);
}

// =====================================================================
// おとな
// =====================================================================
function adultView() {
  const big = roots();
  if (!big.length) {
    return `
      <div class="page-head"><h1>目標とロードマップ</h1></div>
      ${emptyState('🎯',
        '目標がまだありません。\n本番の日を入れると、そこから逆算したロードマップを作れます。',
        `<div class="row" style="justify-content:center">
           <button class="btn btn--primary btn--sm" data-act="template">雛形から作る</button>
           <button class="btn btn--outline btn--sm" data-act="new" data-level="big">自分で作る</button>
         </div>`)}`;
  }

  return `
    <div class="page-head">
      <h1>目標とロードマップ</h1>
      <div class="row">
        <button class="btn btn--outline btn--sm" data-act="template">雛形から作る</button>
        <button class="btn btn--primary btn--sm" data-act="new" data-level="big">＋ 最終目標</button>
      </div>
    </div>

    ${big.map(summaryCard).join('')}
    ${chartCard(state.showActions ? 3 : 2, { toggle: true })}

    <div class="card">
      <p class="card__title">${icon('target', { size: 20 })} 目標の内訳</p>
      ${big.map((g) => treeNode(g, 0)).join('')}
    </div>
  `;
}

/** 最終目標ごとの要約。「間に合うのか」をここだけ見て判断できるようにする */
function summaryCard(g) {
  const today = jstToday();
  const bd = talentBirthday();
  const left = g.period_end ? diffDays(g.period_end, today) : null;
  const total = (g.period_start && g.period_end) ? diffDays(g.period_end, g.period_start) : null;
  // 経過した日数の割合。進捗率と並べると「遅れているか」が分かる
  const elapsed = (total && total > 0)
    ? Math.max(0, Math.min(100, Math.round((diffDays(today, g.period_start) / total) * 100)))
    : null;
  const behind = elapsed !== null && elapsed - g.progress_pct >= 15;

  const tasks = state.goals.filter((t) => t.level === 'task' && alive(t));
  const doneTasks = tasks.filter((t) => t.status === 'done').length;

  return `<div class="card">
    <div class="row row--between" style="margin-bottom:var(--sp-2)">
      <p style="font-size:var(--fs-lg);font-weight:800">${esc(g.icon)} ${esc(g.title)}</p>
      ${countdown(g)}
    </div>
    ${g.description
      ? `<p style="color:var(--text-sub);font-size:var(--fs-sm);white-space:pre-line;margin-bottom:var(--sp-3)">${esc(g.description)}</p>`
      : ''}

    <div class="stats" style="margin-bottom:var(--sp-3)">
      <div class="stat">
        <p class="stat__label">達成度</p>
        <p class="stat__value">${g.progress_pct}<span class="stat__unit">%</span></p>
        <p class="stat__note">行動目標 ${doneTasks} / ${tasks.length} 件</p>
      </div>
      <div class="stat ${left !== null && left <= 30 ? 'stat--warn' : ''}">
        <p class="stat__label">本番まで</p>
        <p class="stat__value">${left === null ? '—' : Math.max(0, left)}<span class="stat__unit">日</span></p>
        <p class="stat__note">${g.period_end ? esc(longDate(g.period_end)) : '期日なし'}</p>
      </div>
      <div class="stat ${behind ? 'stat--danger' : ''}">
        <p class="stat__label">日数の経過</p>
        <p class="stat__value">${elapsed === null ? '—' : elapsed}<span class="stat__unit">%</span></p>
        <p class="stat__note">${behind ? '達成度が追いついていません' : '達成度と見くらべる'}</p>
      </div>
      ${bd && g.period_end ? `<div class="stat">
        <p class="stat__label">本番当日の年齢</p>
        <p class="stat__value" style="font-size:var(--fs-lg)">${esc(ageText(bd, g.period_end))}</p>
        <p class="stat__note">いま ${esc(ageText(bd, today))}</p>
      </div>` : ''}
    </div>
    ${progressBar(g.progress_pct)}
  </div>`;
}

function treeNode(g, depth) {
  const kids = childrenOf(g.id);
  const next = childLevel(g.level);
  return `<div class="${depth === 0 ? 'tree__root' : 'tree__node'}">
    <div class="tree__row ${depth === 0 ? 'tree--big' : ''}">
      <span>${esc(g.icon)}</span>
      <span class="tree__title ${g.status === 'done' ? 'is-done' : ''}">
        ${esc(g.title)}
        <small class="tree__lv">${esc(levelLabel(g.level))}</small>
      </span>
      ${g.period_end ? `<span class="tag">〜${esc(g.period_end)}</span>` : ''}
      <span class="tree__bar">${progressBar(g.progress_pct)}</span>
      <span class="tree__pct">${g.progress_pct}%</span>
      <button class="btn btn--ghost btn--sm" data-act="toggle-done" data-id="${esc(g.id)}"
              title="完了/未完了">${g.status === 'done' ? '↩︎' : '✓'}</button>
      <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(g.id)}" title="編集" aria-label="編集">${icon('pencil', { size: 18 })}</button>
      ${next ? `<button class="btn btn--ghost btn--sm" data-act="new"
                 data-level="${next}" data-parent="${esc(g.id)}"
                 title="${esc(levelLabel(next))}を追加"
                 aria-label="${esc(levelLabel(next))}を追加">＋</button>` : ''}
      <button class="btn btn--ghost btn--sm" data-act="delete" data-id="${esc(g.id)}" title="削除" aria-label="削除">${icon('trash', { size: 18 })}</button>
    </div>
    ${kids.map((k) => treeNode(k, depth + 1)).join('')}
  </div>`;
}

// =====================================================================
// 編集モーダル
// =====================================================================
function editModal(goal, { level, parentId } = {}) {
  const isNew = !goal;
  const lv = goal?.level || level || 'big';
  const parent = state.goals.find((g) => g.id === (goal?.parent_goal_id || parentId));
  const g = goal || {
    level: lv, parent_goal_id: parentId || null,
    title: '', description: '', icon: lv === 'big' ? '🌟' : '📌',
    // 親の期間の中に収める。ここを空にすると、期日なしの目標が
    // チャートに出てこなくなって「作ったのに見えない」になる
    period_start: parent?.period_start || jstToday(),
    period_end: parent?.period_end || '',
    progress_pct: 0, progress_mode: 'auto', status: 'active', sort_order: 0,
  };

  const m = modal(`
    <p class="modal__title">${isNew ? esc(levelLabel(lv)) + 'を追加' : '目標を編集'}</p>
    <form data-goal-form>
      ${parent ? `<p class="field__hint" style="margin-bottom:var(--sp-2)">
        ${esc(levelLabel(parent.level))}「${esc(parent.title)}」の下に入ります</p>` : ''}
      <label class="field">
        <span class="field__label">アイコン と タイトル</span>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" name="icon" value="${esc(g.icon)}" style="width:64px;text-align:center" maxlength="4">
          <input class="input" name="title" value="${esc(g.title)}"
                 placeholder="${lv === 'task' ? '例：毎日ハノンとスケールを10分' : '例：暗譜を完成させる'}">
        </div>
        ${lv === 'task' ? '<span class="field__hint">「今日それをやったか」が言える書き方にすると続きます</span>' : ''}
      </label>
      <label class="field">
        <span class="field__label">説明</span>
        <textarea class="textarea" name="description" style="min-height:64px">${esc(g.description)}</textarea>
      </label>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1">
          <span class="field__label">開始</span>
          <input class="input" type="date" name="period_start" value="${esc(g.period_start || '')}">
        </label>
        <label class="field" style="flex:1">
          <span class="field__label">期限</span>
          <input class="input" type="date" name="period_end" value="${esc(g.period_end || '')}">
        </label>
      </div>
      <label class="field">
        <span class="field__label">進捗率（${g.progress_mode === 'auto' ? '下位目標から自動計算中' : '手動'}）</span>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" type="range" name="progress_pct" min="0" max="100" step="5"
                 value="${g.progress_pct}" oninput="this.nextElementSibling.textContent=this.value+'%'">
          <span style="width:48px;text-align:right">${g.progress_pct}%</span>
        </div>
        <span class="field__hint">
          <label><input type="checkbox" name="manual" ${g.progress_mode === 'manual' ? 'checked' : ''}>
          手動で決める（下位目標があっても上書きしない）</label>
        </span>
      </label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);

  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  m.box.querySelector('[data-goal-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    const err = m.box.querySelector('[data-error]');
    // ★フォームに novalidate は無いが、required も書いていない。
    //   必須チェックは JS 側で自前でやる（HANDOVER の落とし穴を参照）
    const title = fd.title.trim();
    if (!title) { err.textContent = 'タイトルを入れてください'; return; }
    if (fd.period_start && fd.period_end && fd.period_end < fd.period_start) {
      err.textContent = '期限が開始より前になっています'; return;
    }
    try {
      await db.upsertGoal({
        ...(goal ? { id: goal.id } : {}),
        parent_goal_id: g.parent_goal_id,
        level: g.level,
        icon: fd.icon || '📌',
        title,
        description: fd.description.trim(),
        period_start: fd.period_start || null,
        period_end: fd.period_end || null,
        progress_pct: Number(fd.progress_pct) || 0,
        progress_mode: fd.manual ? 'manual' : 'auto',
        owner_user_id: Store.get('talentId'),
        sort_order: goal ? goal.sort_order : state.goals.length,
      });
      m.close();
      await load();
      toast('保存しました', 'ok');
    } catch (e) {
      err.textContent = e.message || '保存できませんでした';
    }
  };
}

// =====================================================================
// 雛形から作る
// =====================================================================
function templateModal() {
  let picked = TEMPLATES[0].key;
  const defaultDate = (t) => t.defaultDate && t.defaultDate >= jstToday()
    ? t.defaultDate
    : monthEnd(addMonths(jstToday(), t.key === 'piano' ? 4 : 11));

  const m = modal(`
    <p class="modal__title">雛形から作る</p>
    <form data-tpl-form>
      <div class="tpl-list">
        ${TEMPLATES.map((t, i) => `
          <label class="tpl">
            <input type="radio" name="tpl" value="${esc(t.key)}" ${i === 0 ? 'checked' : ''}>
            <span class="tpl__body">
              <span class="tpl__name">${t.icon} ${esc(t.name)}</span>
              <span class="tpl__note">${esc(t.summary)}</span>
            </span>
          </label>`).join('')}
      </div>
      <label class="field">
        <span class="field__label" data-date-label>${esc(TEMPLATES[0].dateLabel)}</span>
        <input class="input" type="date" name="targetDate" value="${esc(defaultDate(TEMPLATES[0]))}">
        <span class="field__hint">この日から逆算して、中間目標・月の目標・行動目標まで一気に作ります。<br>
          あとから自由に足したり消したりできます。</span>
      </label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">作る</button>
      </div>
    </form>
  `);

  const form = m.box.querySelector('[data-tpl-form]');
  const dateInput = form.querySelector('[name="targetDate"]');
  const dateLabel = m.box.querySelector('[data-date-label]');

  form.addEventListener('change', (ev) => {
    if (ev.target.name !== 'tpl') return;
    picked = ev.target.value;
    const t = TEMPLATES.find((x) => x.key === picked);
    dateLabel.textContent = t.dateLabel;
    dateInput.value = defaultDate(t);
  });

  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const err = m.box.querySelector('[data-error]');
    const targetDate = dateInput.value;
    if (!targetDate) { err.textContent = '日付を入れてください'; return; }
    if (targetDate <= jstToday()) { err.textContent = '未来の日付を入れてください'; return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const tpl = TEMPLATES.find((t) => t.key === picked);
      const rows = toRows(tpl.build({ targetDate, today: jstToday() }),
        { ownerId: Store.get('talentId') });
      await db.insertGoals(rows);
      m.close();
      await load();
      confetti(60);
      toast(`${rows.length}件の目標を作りました`, 'ok');
    } catch (e) {
      btn.disabled = false;
      err.textContent = e.message || '作れませんでした';
    }
  };
}

// =====================================================================
async function setDone(goal, { cheer = false } = {}) {
  const done = goal.status === 'done';
  await db.updateGoal(goal.id, {
    status: done ? 'active' : 'done',
    // 手動指定の目標の進捗率は、完了を外したときに勝手に0へ戻さない
    progress_pct: done ? (goal.progress_mode === 'manual' ? goal.progress_pct : 0) : 100,
    completed_at: done ? null : new Date().toISOString(),
  });
  if (!done && cheer) { confetti(70); toast('できた！ その調子！ 🎉', 'ok'); }
  else if (!done) { confetti(70); toast('達成おめでとう！ 🎉', 'ok'); }
  await load();
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(3, 110); return; }
  root.innerHTML = Store.get('mode') === 'kid' ? kidView() : adultView();
}

export default {
  async mount(el) {
    root = el;
    state = { goals: [], loading: true, showActions: false };

    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const goal = state.goals.find((g) => g.id === btn.dataset.id);

      try {
        if (act === 'new') {
          editModal(null, { level: btn.dataset.level, parentId: btn.dataset.parent || null });
        } else if (act === 'edit' && goal) {
          editModal(goal);
        } else if (act === 'toggle-done' && goal) {
          await setDone(goal);
        } else if (act === 'toggle-task' && goal) {
          await setDone(goal, { cheer: true });
        } else if (act === 'toggle-actions') {
          state.showActions = !state.showActions;
          render();
        } else if (act === 'template') {
          templateModal();
        } else if (act === 'delete' && goal) {
          const ids = subtreeIds(goal.id);
          const kids = ids.length - 1;
          const ok = await confirmDialog(
            `「${goal.title}」を削除しますか？${kids ? `（下位の目標 ${kids} 件もまとめて消えます）` : ''}`,
            { okLabel: '削除する', danger: true });
          if (!ok) return;
          await db.softDeleteGoal(ids);
          await load();
          toast('削除しました');
        }
      } catch (e) {
        toast(e.message || 'うまくいきませんでした', 'error');
      }
    });

    unsub.push(Store.subscribe('mode', () => render()));
    await load();
  },

  destroy() {
    unsub.forEach((f) => f());
    unsub = [];
    root = null;
  },
};
