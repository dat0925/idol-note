// =====================================================================
// goals.js — 目標とロードマップ
//   こども: 山のぼり表示（いまどこにいるかだけ分かればいい）
//   おとな: 大目標 → 月目標 → 週目標 の3階層ツリーを編集
// 進捗率は子ノードの平均をサーバートリガーが自動でロールアップする。
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import * as Store from './../store.js';
import {
  esc, toast, progressBar, progressRing, emptyState, skeleton, modal, confirmDialog, confetti,
} from './../ui.js';
import { jstToday, shortDate } from './../format.js';

let root = null;
let unsub = [];
let state = { goals: [], loading: true };

const LEVEL_LABEL = { big: '大目標', month: '月の目標', week: '週の目標', task: 'やること' };
const CHILD_LEVEL = { big: 'month', month: 'week', week: 'task' };

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

const childrenOf = (id) => state.goals
  .filter((g) => g.parent_goal_id === id)
  .sort((a, b) => a.sort_order - b.sort_order);

const roots = () => state.goals
  .filter((g) => !g.parent_goal_id && g.status !== 'archived')
  .sort((a, b) => a.sort_order - b.sort_order);

// =====================================================================
// こども：山のぼり
// =====================================================================
function kidView() {
  const big = roots();
  if (!big.length) {
    return emptyState('🎯', 'まだ目標がありません。おうちの人といっしょに決めよう！');
  }
  return big.map((g) => {
    const steps = childrenOf(g.id);
    // 「いまここ」＝完了していない最初のステップ
    const nowIdx = steps.findIndex((s) => s.status !== 'done');
    return `
      <div class="card" style="text-align:center;margin-bottom:var(--sp-4)">
        <div style="font-size:44px">${esc(g.icon)}</div>
        <h2 style="font-size:var(--fs-lg);font-weight:900;margin:var(--sp-2) 0">${esc(g.title)}</h2>
        ${g.description ? `<p style="color:var(--text-sub);font-size:var(--fs-sm)">${esc(g.description)}</p>` : ''}
        <div style="display:flex;justify-content:center;margin-top:var(--sp-3)">
          ${progressRing(g.progress_pct, 104, 11)}
        </div>
      </div>
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
                    ${s.period_end ? '〜' + shortDate(s.period_end) : ''}
                    ${s.progress_pct ? ' ・ ' + s.progress_pct + '%' : ''}
                  </div>
                </div>
                ${isNow ? '<span class="mountain__here">いまここ</span>' : ''}
              </div>`;
            }).join('')}
      </div>`;
  }).join('');
}

// =====================================================================
// おとな：ツリー編集
// =====================================================================
function adultView() {
  const big = roots();
  return `
    <div class="page-head">
      <h1>目標とロードマップ</h1>
      <div class="row">
        ${big.length === 0
          ? '<button class="btn btn--soft btn--sm" data-act="seed">雛形を入れる</button>'
          : ''}
        <button class="btn btn--primary btn--sm" data-act="new" data-level="big">＋ 大目標</button>
      </div>
    </div>

    ${big.length === 0
      ? emptyState('🎯', '目標がまだありません。\n「雛形を入れる」で1年ぶんのロードマップを作れます。')
      : big.map((g) => treeNode(g, 0)).join('')}
  `;
}

function treeNode(g, depth) {
  const kids = childrenOf(g.id);
  const next = CHILD_LEVEL[g.level];
  return `<div class="${depth === 0 ? 'card' : 'tree__node'}" style="${depth === 0 ? 'margin-bottom:var(--sp-3)' : ''}">
    <div class="tree__row ${depth === 0 ? 'tree--big' : ''}">
      <span>${esc(g.icon)}</span>
      <span class="tree__title ${g.status === 'done' ? 'is-done' : ''}">${esc(g.title)}</span>
      ${g.period_end ? `<span class="tag">〜${esc(g.period_end)}</span>` : ''}
      <span class="tree__bar">${progressBar(g.progress_pct)}</span>
      <span class="tree__pct">${g.progress_pct}%</span>
      <button class="btn btn--ghost btn--sm" data-act="toggle-done" data-id="${esc(g.id)}"
              title="完了/未完了">${g.status === 'done' ? '↩︎' : '✓'}</button>
      <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(g.id)}" title="編集" aria-label="編集">${icon('pencil', { size: 18 })}</button>
      ${next ? `<button class="btn btn--ghost btn--sm" data-act="new"
                 data-level="${next}" data-parent="${esc(g.id)}" title="下位目標を追加">＋</button>` : ''}
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
  const g = goal || {
    level: level || 'big', parent_goal_id: parentId || null,
    title: '', description: '', icon: level === 'big' ? '🌟' : '📌',
    period_start: jstToday(), period_end: '', progress_pct: 0,
    progress_mode: 'auto', status: 'active', sort_order: 0,
  };

  const m = modal(`
    <p class="modal__title">${isNew ? LEVEL_LABEL[g.level] + 'を追加' : '目標を編集'}</p>
    <form data-goal-form>
      <label class="field">
        <span class="field__label">アイコン と タイトル</span>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" name="icon" value="${esc(g.icon)}" style="width:64px;text-align:center" maxlength="4">
          <input class="input" name="title" value="${esc(g.title)}" required placeholder="例：毎日15分ダンスを踊る">
        </div>
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
    try {
      await db.upsertGoal({
        ...(goal ? { id: goal.id } : {}),
        parent_goal_id: g.parent_goal_id,
        level: g.level,
        icon: fd.icon || '📌',
        title: fd.title.trim(),
        description: fd.description.trim(),
        period_start: fd.period_start || null,
        period_end: fd.period_end || null,
        progress_pct: Number(fd.progress_pct) || 0,
        progress_mode: fd.manual ? 'manual' : 'auto',
        owner_user_id: Store.get('talentId'),
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
function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(3, 110); return; }
  root.innerHTML = Store.get('mode') === 'kid' ? kidView() : adultView();
}

export default {
  async mount(el) {
    root = el;
    state = { goals: [], loading: true };

    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const goal = state.goals.find((g) => g.id === btn.dataset.id);

      if (act === 'new') {
        editModal(null, { level: btn.dataset.level, parentId: btn.dataset.parent || null });
      } else if (act === 'edit' && goal) {
        editModal(goal);
      } else if (act === 'toggle-done' && goal) {
        const done = goal.status === 'done';
        try {
          await db.upsertGoal({
            id: goal.id,
            status: done ? 'active' : 'done',
            progress_pct: done ? goal.progress_pct : 100,
            completed_at: done ? null : new Date().toISOString(),
          });
          if (!done) { confetti(70); toast('達成おめでとう！ 🎉', 'ok'); }
          await load();
        } catch (e) { toast(e.message, 'error'); }
      } else if (act === 'delete' && goal) {
        const ok = await confirmDialog(`「${goal.title}」を削除しますか？（下位の目標もまとめて消えます）`,
          { okLabel: '削除する', danger: true });
        if (!ok) return;
        try { await db.softDeleteGoal(goal.id); await load(); toast('削除しました'); }
        catch (e) { toast(e.message, 'error'); }
      } else if (act === 'seed') {
        try {
          const id = await db.seedRoadmap();
          await load();
          toast(id ? '1年ぶんのロードマップを入れました' : 'すでに目標があります', 'ok');
        } catch (e) { toast(e.message, 'error'); }
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
