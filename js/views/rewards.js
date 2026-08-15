// =====================================================================
// rewards.js — ごほうび帳
//   子は「これ交換したい」を押せる。承認は親のみ（DBトリガーで担保）。
//   ポイント残高は v_idol_points から導出（残高カラムを持たない）。
// =====================================================================
import * as db from './../db.js';
import * as Store from './../store.js';
import {
  esc, toast, progressBar, emptyState, skeleton, modal, confirmDialog, confetti,
} from './../ui.js';

let root = null;
let unsub = [];
let state = { rewards: [], points: { balance_points: 0 }, loading: true };

const STATUS_LABEL = {
  open: 'まだ', requested: 'リクエスト中', redeemed: 'こうかんずみ', expired: 'おわり',
};

async function load() {
  state.loading = true;
  render();
  try {
    const [rewards, points] = await Promise.all([db.listRewards(), db.getPoints()]);
    state.rewards = rewards;
    state.points = points;
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(3, 90); return; }

  const isParent = Store.get('role') === 'parent';
  const balance = state.points?.balance_points || 0;

  root.innerHTML = `
    <div class="page-head">
      <h1>🏆 ごほうび帳</h1>
      ${isParent ? '<button class="btn btn--primary btn--sm" data-act="new">＋ ごほうびを追加</button>' : ''}
    </div>

    <div class="card" style="text-align:center;margin-bottom:var(--sp-4)">
      <p style="color:var(--text-sub);font-size:var(--fs-sm)">いまのポイント</p>
      <p style="font-size:var(--fs-2xl);font-weight:900">${balance} <span style="font-size:.5em">pt</span></p>
      <p style="color:var(--text-sub);font-size:var(--fs-xs)">
        これまでに ${state.points?.earned_points || 0}pt ためて、${state.points?.spent_points || 0}pt つかいました
      </p>
    </div>

    ${state.rewards.length === 0
      ? emptyState('🎁', isParent
          ? 'ごほうびがまだありません。<br>「あと10日つづけたら○○」など、目標にできるものを登録しましょう。'
          : 'ごほうびがまだありません')
      : state.rewards.map((r) => card(r, balance, isParent)).join('')}
  `;
}

function card(r, balance, isParent) {
  const reached = balance >= r.cost_points;
  const done = r.status === 'redeemed';
  return `<div class="card" style="${done ? 'opacity:.6' : ''}">
    <div class="row row--between">
      <div style="flex:1">
        <p style="font-weight:800;font-size:var(--fs-lg)">${esc(r.icon)} ${esc(r.title)}</p>
        ${r.description ? `<p style="color:var(--text-sub);font-size:var(--fs-sm)">${esc(r.description)}</p>` : ''}
      </div>
      <span class="tag ${done ? 'tag--ok' : r.status === 'requested' ? 'tag--warn' : ''}">
        ${esc(STATUS_LABEL[r.status] || r.status)}
      </span>
    </div>

    <div style="margin-top:var(--sp-3)">
      ${progressBar(r.cost_points ? (balance / r.cost_points) * 100 : 100)}
      <p style="text-align:right;font-size:var(--fs-xs);color:var(--text-sub);margin-top:4px">
        ${done ? 'こうかんずみ'
          // 「220 / 100 pt」のように必要ポイントを超えて見えると混乱するので上限で丸める
          : `${Math.min(balance, r.cost_points)} / ${r.cost_points} pt`}
        ${reached || done ? '' : ` ・ あと${r.cost_points - balance}pt`}
      </p>
    </div>

    <div class="row" style="justify-content:flex-end;margin-top:var(--sp-3)">
      ${!done && r.status === 'open' && reached
        ? `<button class="btn btn--primary btn--sm" data-act="request" data-id="${esc(r.id)}">
             こうかんしたい！</button>` : ''}
      ${isParent && r.status === 'requested'
        ? `<button class="btn btn--primary btn--sm" data-act="redeem" data-id="${esc(r.id)}">
             ✅ 承認する</button>` : ''}
      ${isParent
        ? `<button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(r.id)}">✏️</button>
           <button class="btn btn--ghost btn--sm" data-act="delete" data-id="${esc(r.id)}">🗑</button>` : ''}
    </div>
  </div>`;
}

function editModal(reward) {
  const r = reward || { icon: '🎁', title: '', description: '', cost_points: 100, sort_order: 0 };
  const m = modal(`
    <p class="modal__title">${reward ? 'ごほうびを編集' : 'ごほうびを追加'}</p>
    <form data-reward-form>
      <label class="field">
        <span class="field__label">アイコン と なまえ</span>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" name="icon" value="${esc(r.icon)}" style="width:64px;text-align:center" maxlength="4">
          <input class="input" name="title" value="${esc(r.title)}" required placeholder="例：好きなケーキを買う">
        </div>
      </label>
      <label class="field">
        <span class="field__label">せつめい</span>
        <input class="input" name="description" value="${esc(r.description)}">
      </label>
      <label class="field">
        <span class="field__label">必要ポイント</span>
        <input class="input" type="number" name="cost_points" value="${r.cost_points}" min="0" step="10">
        <span class="field__hint">練習1メニューで5〜10pt たまります。100pt ≒ 2週間ぶんが目安です。</span>
      </label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);
  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  m.box.querySelector('[data-reward-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    try {
      await db.upsertReward({
        ...(reward ? { id: reward.id } : {}),
        icon: fd.icon || '🎁',
        title: fd.title.trim(),
        description: fd.description.trim(),
        cost_points: Math.max(0, parseInt(fd.cost_points, 10) || 0),
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
    state = { rewards: [], points: { balance_points: 0 }, loading: true };

    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const r = state.rewards.find((x) => x.id === btn.dataset.id);

      try {
        if (act === 'new') { editModal(null); }
        else if (act === 'edit' && r) { editModal(r); }
        else if (act === 'request' && r) {
          await db.requestReward(r.id);
          toast('おうちの人にリクエストしました！', 'ok');
          await load();
        } else if (act === 'redeem' && r) {
          const ok = await confirmDialog(`「${r.title}」を承認しますか？（${r.cost_points}pt つかいます）`);
          if (!ok) return;
          await db.redeemReward(r.id);
          confetti(100);
          toast('こうかん成立！ 🎉', 'ok');
          await load();
        } else if (act === 'delete' && r) {
          const ok = await confirmDialog('このごほうびを削除しますか？', { okLabel: '削除する', danger: true });
          if (!ok) return;
          await db.softDeleteReward(r.id);
          await load();
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
