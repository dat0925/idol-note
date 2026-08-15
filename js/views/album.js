// =====================================================================
// album.js — 成長の記録（ポートフォリオ）
//   写真・できるようになったこと日記・自己PR文・動画リンクのタイムライン。
//   写真は端末側で圧縮してから非公開バケットへ。表示は毎回署名付きURL。
// =====================================================================
import * as db from './../db.js';
import { icon } from './../icons.js';
import * as photos from './../photos.js';
import * as Store from './../store.js';
import { esc, toast, emptyState, skeleton, modal, confirmDialog } from './../ui.js';
import { jstToday, shortDate, longDate } from './../format.js';

let root = null;
let unsub = [];
let state = { entries: [], urls: {}, filter: 'all', loading: true };

const KINDS = {
  diary:       { icon: '📔', label: 'できたこと' },
  photo:       { icon: '📷', label: '写真' },
  achievement: { icon: '🏅', label: 'できるようになった' },
  pr:          { icon: '📝', label: '自己PR' },
  video:       { icon: '🎥', label: 'どうが' },
  award:       { icon: '🏆', label: '賞・実績' },
};

async function load() {
  state.loading = true;
  render();
  try {
    state.entries = await db.listPortfolio({ limit: 200 });
    const paths = state.entries.flatMap((e) => e.cover_path ? [e.cover_path] : (e.photo_paths || []).slice(0, 1));
    state.urls = await photos.getPhotoUrls(paths);
  } catch (e) {
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function visible() {
  return state.filter === 'all'
    ? state.entries
    : state.entries.filter((e) => e.kind === state.filter);
}

function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(4, 120); return; }

  const kid = Store.get('mode') === 'kid';
  const list = visible();

  root.innerHTML = `
    <div class="page-head">
      <h1>${kid ? 'アルバム' : '成長の記録'}</h1>
      <button class="btn btn--primary btn--sm" data-act="new">＋ ${kid ? '記録する' : '追加'}</button>
    </div>

    <div class="chips" style="margin-bottom:var(--sp-4)">
      <button class="chip" aria-pressed="${state.filter === 'all'}" data-filter="all">すべて</button>
      ${Object.entries(KINDS).map(([k, v]) =>
        `<button class="chip" aria-pressed="${state.filter === k}" data-filter="${k}">${v.icon} ${esc(v.label)}</button>`).join('')}
    </div>

    ${list.length === 0
      ? emptyState('📷', kid ? 'まだ何もありません。\nできるようになったことを書いてみよう！'
                             : 'まだ記録がありません')
      : `<div class="grid grid--2">${list.map(card).join('')}</div>`}
  `;
}

function card(e) {
  const k = KINDS[e.kind] || KINDS.diary;
  const cover = e.cover_path || (e.photo_paths || [])[0];
  const url = cover ? state.urls[cover] : null;
  const parent = Store.get('mode') === 'adult';

  return `<article class="card" data-entry="${esc(e.id)}">
    ${url ? `<img src="${esc(url)}" alt="" loading="lazy"
              style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r-md);margin-bottom:var(--sp-3)">` : ''}
    <div class="row row--between" style="margin-bottom:var(--sp-2)">
      <span class="tag">${k.icon} ${esc(k.label)}</span>
      <span style="color:var(--text-sub);font-size:var(--fs-xs)">${shortDate(e.entry_date)}</span>
    </div>
    ${e.title ? `<p style="font-weight:800;margin-bottom:4px">${esc(e.title)}</p>` : ''}
    ${e.body ? `<p style="white-space:pre-wrap;font-size:var(--fs-sm)">${esc(e.body)}</p>` : ''}
    ${e.video_url ? `<p style="margin-top:var(--sp-2)">
      <a href="${esc(e.video_url)}" target="_blank" rel="noopener noreferrer">🎥 動画を見る</a></p>` : ''}
    ${(e.photo_paths || []).length > 1
      ? `<p style="color:var(--text-sub);font-size:var(--fs-xs);margin-top:4px">ほか${e.photo_paths.length - 1}枚</p>` : ''}
    ${parent ? `<div class="row" style="margin-top:var(--sp-3);justify-content:flex-end">
      <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(e.id)}" aria-label="編集">${icon('pencil', { size: 18 })}</button>
      <button class="btn btn--ghost btn--sm" data-act="delete" data-id="${esc(e.id)}" aria-label="削除">${icon('trash', { size: 18 })}</button>
    </div>` : ''}
  </article>`;
}

// =====================================================================
// 追加/編集モーダル
// =====================================================================
function editModal(entry) {
  const e = entry || {
    kind: 'diary', entry_date: jstToday(), title: '', body: '',
    video_url: '', photo_paths: [], cover_path: null,
  };
  let pendingFiles = [];
  let keepPaths = [...(e.photo_paths || [])];

  const m = modal(`
    <p class="modal__title">${entry ? '記録を編集' : '記録を追加'}</p>
    <form data-entry-form>
      <label class="field">
        <span class="field__label">しゅるい</span>
        <select class="select" name="kind">
          ${Object.entries(KINDS).map(([k, v]) =>
            `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="field__label">日付</span>
        <input class="input" type="date" name="entry_date" value="${esc(e.entry_date)}" max="${jstToday()}">
      </label>
      <label class="field">
        <span class="field__label">タイトル</span>
        <input class="input" name="title" value="${esc(e.title)}" placeholder="例：はじめて1曲さいごまで踊れた！">
      </label>
      <label class="field">
        <span class="field__label">ないよう</span>
        <textarea class="textarea" name="body" placeholder="どんなことができるようになった？">${esc(e.body)}</textarea>
      </label>
      <label class="field">
        <span class="field__label">写真（複数えらべます）</span>
        <input class="input" type="file" name="photos" accept="image/*" multiple data-files>
        <span class="field__hint">端末の中で小さくしてからアップロードします。外部には公開されません。</span>
      </label>
      <div data-preview class="row" style="gap:6px"></div>
      <label class="field">
        <span class="field__label">動画のURL（YouTube限定公開など）</span>
        <input class="input" type="url" name="video_url" value="${esc(e.video_url || '')}"
               placeholder="https://...">
        <span class="field__hint">動画はアップロードせず、リンクだけを記録します。</span>
      </label>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>
  `);

  const preview = m.box.querySelector('[data-preview]');
  const err = m.box.querySelector('[data-error]');

  m.box.querySelector('[data-files]').addEventListener('change', (ev) => {
    pendingFiles = Array.from(ev.target.files || []);
    // アップロード完了を待たずに即プレビュー（体感を待たせない）
    preview.innerHTML = pendingFiles.map((f) =>
      `<img src="${URL.createObjectURL(f)}" alt=""
        style="width:64px;height:64px;object-fit:cover;border-radius:var(--r-sm)">`).join('');
  });

  m.box.querySelector('[data-act="cancel"]').onclick = () => m.close();

  m.box.querySelector('[data-entry-form]').onsubmit = async (ev) => {
    ev.preventDefault();
    const submit = ev.target.querySelector('[type="submit"]');
    submit.disabled = true;
    err.textContent = '';
    const fd = Object.fromEntries(new FormData(ev.target));

    try {
      const uploaded = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        submit.textContent = `アップロード中… ${i + 1}/${pendingFiles.length}`;
        const r = await photos.uploadPhoto(pendingFiles[i], 'portfolio');
        uploaded.push(r.path);
      }
      const allPaths = [...keepPaths, ...uploaded];

      await db.upsertPortfolio({
        ...(entry ? { id: entry.id } : {}),
        subject_user_id: Store.get('talentId'),
        kind: fd.kind,
        entry_date: fd.entry_date,
        title: fd.title.trim(),
        body: fd.body.trim(),
        video_url: fd.video_url.trim() || null,
        photo_paths: allPaths,
        cover_path: allPaths[0] || null,
      });
      m.close();
      await load();
      toast('保存しました', 'ok');
    } catch (ex) {
      err.textContent = ex.message || '保存できませんでした';
      submit.disabled = false;
      submit.textContent = '保存';
    }
  };
}

// =====================================================================
export default {
  async mount(el) {
    root = el;
    state = { entries: [], urls: {}, filter: 'all', loading: true };

    root.addEventListener('click', async (ev) => {
      const chip = ev.target.closest('[data-filter]');
      if (chip) { state.filter = chip.dataset.filter; render(); return; }

      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const entry = state.entries.find((e) => e.id === btn.dataset.id);

      if (btn.dataset.act === 'new') editModal(null);
      else if (btn.dataset.act === 'edit' && entry) editModal(entry);
      else if (btn.dataset.act === 'delete' && entry) {
        const ok = await confirmDialog('この記録を削除しますか？（写真も消えます）',
          { okLabel: '削除する', danger: true });
        if (!ok) return;
        try {
          await db.softDeletePortfolio(entry.id);
          await photos.deletePhotos(entry.photo_paths);
          await load();
          toast('削除しました');
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
