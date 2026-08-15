// =====================================================================
// settings.js — 設定（親限定＋PIN解錠が必要）
//   家族と招待コード / 練習メニュー編集 / PIN / データ書き出し / ログアウト
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import * as Auth from './../auth.js';
import * as Pin from './../pin.js';
import * as Store from './../store.js';
import * as LS from './../storage.js';
import * as Router from './../router.js';
import { pendingCount, pullDelta } from './../sync.js';
import { setupPin } from './../components/pin-modal.js';
import { esc, toast, skeleton, modal, confirmDialog, emptyState } from './../ui.js';

let root = null;
let state = { menus: [], inviteCode: null, hasPin: false, loading: true };

const CATEGORIES = [
  ['vocal', 'ボイス'], ['dance', 'ダンス'], ['expression', '表情'],
  ['stretch', 'ストレッチ'], ['acting', '演技'], ['study', '勉強'], ['other', 'その他'],
];

async function load() {
  state.loading = true;
  render();
  try {
    const [menus, hasPin] = await Promise.all([db.listMenus(), Pin.hasPin()]);
    state.menus = menus;
    state.hasPin = hasPin;
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(4, 100); return; }

  const family = Store.get('family');
  const members = Store.get('members');
  const pending = pendingCount();

  root.innerHTML = `
    <div class="page-head"><h1>設定</h1></div>

    <div class="card">
      <p class="card__title">${icon('users', { size: 20 })} 家族</p>
      <p style="margin-bottom:var(--sp-3)"><b>${esc(family?.name || '')}</b></p>
      <ul>${members.map((m) => `<li class="row row--between"
            style="padding:var(--sp-2) 0;border-bottom:1px solid var(--border)">
        <span>${m.role === 'parent' ? '👩' : '🎀'} ${esc(m.nickname || m.display_name)}
          ${m.is_talent ? '<span class="tag tag--info">アイドル志望</span>' : ''}</span>
        <span class="tag">${m.role === 'parent' ? '親' : 'こども'}</span>
      </li>`).join('')}</ul>

      <div class="row" style="margin-top:var(--sp-3)">
        <button class="btn btn--outline btn--sm" data-act="show-invite">招待コードを表示</button>
        <button class="btn btn--ghost btn--sm" data-act="rotate-invite">コードを作り直す</button>
      </div>
      ${state.inviteCode ? `<div style="margin-top:var(--sp-3);text-align:center">
        <p style="font-size:var(--fs-2xl);font-weight:900;letter-spacing:.15em">${esc(state.inviteCode)}</p>
        <p style="color:var(--text-sub);font-size:var(--fs-xs)">
          お子さんの端末で「招待コードで参加」に入力してください。<br>
          このコードを知っている人は家族に参加できます。取り扱いにご注意を。
        </p>
      </div>` : ''}
    </div>

    <div class="card">
      <div class="row row--between">
        <p class="card__title" style="margin:0">${icon('pencil', { size: 20 })} 練習メニュー</p>
        <button class="btn btn--primary btn--sm" data-act="new-menu">＋ 追加</button>
      </div>
      ${state.menus.length === 0
        ? emptyState('📝', 'メニューがありません')
        : `<ul style="margin-top:var(--sp-3)">${state.menus.map((m) => `
          <li class="row row--between" style="padding:var(--sp-2) 0;border-bottom:1px solid var(--border)">
            <span>${esc(m.icon)} <b>${esc(m.name)}</b>
              <small style="color:var(--text-sub)">
                ${m.default_minutes}分 / ${m.points}pt
              </small></span>
            <span>
              <button class="btn btn--ghost btn--sm" data-act="edit-menu" data-id="${esc(m.id)}" aria-label="編集">${icon('pencil', { size: 18 })}</button>
              <button class="btn btn--ghost btn--sm" data-act="delete-menu" data-id="${esc(m.id)}" aria-label="削除">${icon('trash', { size: 18 })}</button>
            </span>
          </li>`).join('')}</ul>`}
    </div>

    <div class="card">
      <p class="card__title">${icon('lock', { size: 20 })} 安心番号（PIN）</p>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-3)">
        おとなモードに入るときの4桁の番号です。${state.hasPin ? '設定済み。' : 'まだ設定されていません。'}<br>
        これは「端末を渡したときの目隠し」です。オーディションの結果や体重は、
        お子さんのアカウントからは<b>そもそもデータが取得できない</b>ようになっています。
      </p>
      <div class="row">
        <button class="btn btn--outline btn--sm" data-act="set-pin">${state.hasPin ? '番号を変更' : '番号を設定'}</button>
        ${state.hasPin ? '<button class="btn btn--ghost btn--sm" data-act="clear-pin">番号を削除</button>' : ''}
        <button class="btn btn--ghost btn--sm" data-act="lock">いますぐロック</button>
      </div>
    </div>

    <div class="card">
      <p class="card__title">${icon('database', { size: 20 })} データ</p>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-3)">
        未送信の変更：${pending}件${pending ? '（オンラインになると自動で送られます）' : ''}
      </p>
      <div class="row">
        <button class="btn btn--outline btn--sm" data-act="export">JSONで書き出す</button>
        <button class="btn btn--ghost btn--sm" data-act="resync">いま同期する</button>
        <button class="btn btn--ghost btn--sm" data-act="clear-cache">キャッシュを消す</button>
      </div>
    </div>

    <div class="card">
      <p class="card__title">アカウント</p>
      <p style="color:var(--text-sub);font-size:var(--fs-sm)">${esc(Store.get('user')?.email || '')}</p>
      <button class="btn btn--danger btn--sm" data-act="signout" style="margin-top:var(--sp-3)">ログアウト</button>
    </div>
  `;
}

function menuModal(menu) {
  const m0 = menu || {
    icon: '⭐', name: '', category: 'other', default_minutes: 15, points: 5,
    sort_order: state.menus.length + 1,
  };
  const m = modal(`
    <p class="modal__title">${menu ? 'メニューを編集' : 'メニューを追加'}</p>
    <form data-menu-form>
      <label class="field">
        <span class="field__label">アイコン と なまえ</span>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" name="icon" value="${esc(m0.icon)}" style="width:64px;text-align:center" maxlength="4">
          <input class="input" name="name" value="${esc(m0.name)}" required placeholder="例：ボイストレーニング">
        </div>
      </label>
      <label class="field"><span class="field__label">カテゴリ</span>
        <select class="select" name="category">
          ${CATEGORIES.map(([k, v]) =>
            `<option value="${k}" ${m0.category === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
      <div class="row" style="gap:var(--sp-2)">
        <label class="field" style="flex:1"><span class="field__label">めやすの時間（分）</span>
          <input class="input" type="number" name="default_minutes" value="${m0.default_minutes}" min="0" max="600"></label>
        <label class="field" style="flex:1"><span class="field__label">ポイント</span>
          <input class="input" type="number" name="points" value="${m0.points}" min="0" max="1000"></label>
      </div>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);
  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();
  m.box.querySelector('[data-menu-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    try {
      await db.upsertMenu({
        ...(menu ? { id: menu.id } : {}),
        icon: fd.icon || '⭐',
        name: fd.name.trim(),
        category: fd.category,
        default_minutes: parseInt(fd.default_minutes, 10) || 0,
        points: parseInt(fd.points, 10) || 0,
        sort_order: m0.sort_order,
      });
      m.close();
      await load();
      toast('保存しました', 'ok');
    } catch (e) {
      m.box.querySelector('[data-error]').textContent = e.message;
    }
  };
}

/** すべてのデータを1つのJSONにまとめて書き出す */
async function exportJson() {
  toast('書き出しています…');
  const [menus, logs, goals, auditions, lessons, portfolio, rewards, badges, cheers] = await Promise.all([
    db.listMenus(), db.listLogs({ from: '2000-01-01' }), db.listGoals(),
    db.listAuditions(), db.listLessons({ from: '2000-01-01' }),
    db.listPortfolio({ limit: 1000 }), db.listRewards(), db.listBadges(), db.listCheers({ limit: 1000 }),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    family: Store.get('family'),
    members: Store.get('members'),
    menus, logs, goals, auditions, lessons, portfolio, rewards, badges, cheers,
    note: '写真の実体は含まれません（photo_paths のみ）。合否・体重などの親限定データも含みません。',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `idol-note-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('書き出しました', 'ok');
}

export default {
  async mount(el) {
    root = el;
    state = { menus: [], inviteCode: null, hasPin: false, loading: true };

    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const menu = state.menus.find((m) => m.id === btn.dataset.id);

      try {
        switch (act) {
          case 'show-invite':
            state.inviteCode = await Auth.fetchInviteCode();
            render();
            break;
          case 'rotate-invite': {
            const ok = await confirmDialog('招待コードを作り直しますか？（古いコードは使えなくなります）');
            if (!ok) break;
            state.inviteCode = await Auth.rotateInviteCode();
            render();
            toast('新しいコードを発行しました', 'ok');
            break;
          }
          case 'new-menu': menuModal(null); break;
          case 'edit-menu': if (menu) menuModal(menu); break;
          case 'delete-menu': {
            if (!menu) break;
            const ok = await confirmDialog(`「${menu.name}」を削除しますか？（過去の記録は残ります）`,
              { okLabel: '削除する', danger: true });
            if (!ok) break;
            await db.softDeleteMenu(menu.id);
            await load();
            break;
          }
          case 'set-pin':
            if (await setupPin()) { await load(); toast('番号を設定しました', 'ok'); }
            break;
          case 'clear-pin': {
            const ok = await confirmDialog('安心番号を削除しますか？（次回おとなモードに入るとき再設定を求められます）',
              { okLabel: '削除する', danger: true });
            if (!ok) break;
            await Pin.clearPin();
            await load();
            break;
          }
          case 'lock':
            Pin.lock();
            toast('ロックしました');
            Router.navigate('/home');
            break;
          case 'export': await exportJson(); break;
          case 'resync': await pullDelta(); toast('同期しました', 'ok'); break;
          case 'clear-cache':
            LS.clearCaches();
            toast('キャッシュを消しました。次回起動時に取り直します', 'ok');
            break;
          case 'signout': {
            const ok = await confirmDialog('ログアウトしますか？', { okLabel: 'ログアウト', danger: true });
            if (!ok) break;
            await Auth.signOut();
            Router.navigate('/login', { replace: true });
            break;
          }
        }
      } catch (e) {
        toast(e.message || 'うまくいきませんでした', 'error');
      }
    });

    await load();
  },

  destroy() { root = null; },
};
