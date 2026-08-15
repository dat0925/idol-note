// =====================================================================
// messages.js — 応援メッセージ
//   親が書き、娘が読む。Realtime 購読でママのコメントが即座に画面に出る。
//   （このアプリの中核体験なので、ここだけは同期を待たせない）
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import * as Store from './../store.js';
import { esc, toast, emptyState, skeleton, confirmDialog, vibrate } from './../ui.js';
import { shortDate } from './../format.js';

let root = null;
let unsub = [];
let unsubRealtime = null;
let state = { cheers: [], loading: true };

const REACTIONS = [
  { key: 'heart', emoji: '💖' },
  { key: 'star',  emoji: '⭐' },
  { key: 'fire',  emoji: '🔥' },
  { key: 'clap',  emoji: '👏' },
  { key: 'like',  emoji: '👍' },
];

const emojiOf = (k) => REACTIONS.find((r) => r.key === k)?.emoji || '👍';

async function load() {
  state.loading = true;
  render();
  try {
    state.cheers = await db.listCheers({ limit: 100 });
    // 自分あて（自分が書いたものではない）の未読を既読にする
    const unread = state.cheers
      .filter((c) => !c.is_read && c.author_user_id !== Store.get('user')?.id)
      .map((c) => c.id);
    if (unread.length) db.markCheersRead(unread).catch(() => {});
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function nameOf(userId) {
  const m = Store.get('members').find((x) => x.user_id === userId);
  return m?.nickname || m?.display_name || 'だれか';
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(4, 80); return; }

  const kid = Store.get('mode') === 'kid';
  const myId = Store.get('user')?.id;

  root.innerHTML = `
    <div class="page-head">
      <h1>${kid ? '応援' : '応援メッセージ'}</h1>
    </div>

    <div class="card" style="margin-bottom:var(--sp-4)">
      <p class="card__title">${kid ? 'ありがとうを送る' : 'メッセージを送る'}</p>
      <div class="chips" style="margin-bottom:var(--sp-3)">
        ${REACTIONS.map((r) => `<button class="chip" data-react="${r.key}"
          style="font-size:22px;min-height:48px;min-width:48px">${r.emoji}</button>`).join('')}
      </div>
      <textarea class="textarea" data-body
        placeholder="${kid ? 'ありがとう！ など' : '例：きのうのダンス、かっこよかったよ！'}"></textarea>
      <button class="btn btn--primary btn--block" data-act="send" style="margin-top:var(--sp-2)">送る</button>
    </div>

    ${state.cheers.length === 0
      ? emptyState('💌', kid ? 'まだメッセージはありません' : 'まだメッセージはありません')
      : `<ul>${state.cheers.map((c) => {
          const mine = c.author_user_id === myId;
          return `<li class="card" style="${mine ? 'background:var(--accent-soft);border-color:transparent' : ''}">
            <div class="row row--between" style="margin-bottom:4px">
              <b style="font-size:var(--fs-sm)">${esc(nameOf(c.author_user_id))}</b>
              <span style="color:var(--text-sub);font-size:var(--fs-xs)">
                ${shortDate(c.created_at.slice(0, 10))}
              </span>
            </div>
            <!-- white-space:pre-wrap なので、テンプレートの改行や字下げを本文に混ぜない -->
            <p style="white-space:pre-wrap">${c.reaction ? `<span style="font-size:26px">${emojiOf(c.reaction)}</span> ` : ''}${esc(c.body)}</p>
            ${mine || Store.get('role') === 'parent'
              ? `<div class="row" style="justify-content:flex-end;margin-top:var(--sp-2)">
                  <button class="btn btn--ghost btn--sm" data-del="${esc(c.id)}" aria-label="削除">${icon('trash', { size: 18 })}</button></div>`
              : ''}
          </li>`;
        }).join('')}</ul>`}
  `;
}

async function send(body, reaction) {
  const text = (body || '').trim();
  if (!text && !reaction) { toast('メッセージかスタンプを選んでください'); return; }
  try {
    const row = await db.addCheer({
      // 応援は「今日の練習」に紐づける。なければ最新の目標に紐づける
      practiceLogId: await todayLogId(),
      body: text,
      reaction,
    });
    if (row) {
      state.cheers = [row, ...state.cheers];
      render();
      vibrate(14);
      toast('おくりました', 'ok');
    }
  } catch (e) {
    toast(e.message || '送信できませんでした', 'error');
  }
}

/** 応援の宛先。今日のログがなければ作る（対象は1つ必要なCHECK制約があるため） */
async function todayLogId() {
  const log = await db.ensureLog();
  return log.id;
}

export default {
  async mount(el) {
    root = el;
    state = { cheers: [], loading: true };

    root.addEventListener('click', async (ev) => {
      const react = ev.target.closest('[data-react]');
      if (react) {
        await send(root.querySelector('[data-body]')?.value, react.dataset.react);
        const box = root.querySelector('[data-body]');
        if (box) box.value = '';
        return;
      }
      if (ev.target.closest('[data-act="send"]')) {
        const box = root.querySelector('[data-body]');
        await send(box?.value, null);
        if (box) box.value = '';
        return;
      }
      const del = ev.target.closest('[data-del]');
      if (del) {
        const ok = await confirmDialog('このメッセージを消しますか？', { okLabel: '消す', danger: true });
        if (!ok) return;
        try {
          await db.deleteCheer(del.dataset.del);
          state.cheers = state.cheers.filter((c) => c.id !== del.dataset.del);
          render();
        } catch (e) { toast(e.message, 'error'); }
      }
    });

    unsub.push(Store.subscribe('mode', () => render()));
    await load();

    // 相手からの新着をその場で反映する
    unsubRealtime = db.subscribeCheers((row) => {
      if (state.cheers.some((c) => c.id === row.id)) return;
      state.cheers = [row, ...state.cheers];
      render();
      if (row.author_user_id !== Store.get('user')?.id) {
        vibrate([20, 40, 20]);
        toast('あたらしいメッセージがとどきました 💌', 'ok');
      }
    });
  },

  destroy() {
    unsubRealtime?.();
    unsubRealtime = null;
    unsub.forEach((f) => f());
    unsub = [];
    root = null;
  },
};
