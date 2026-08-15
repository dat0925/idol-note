// =====================================================================
// practice.js — 毎日の練習記録
//
// こども: 大きなトグルカードをタップするだけ。完了で紙吹雪。
// おとな: 日付を選んで入力＋履歴テーブル＋月次集計。
// データ取得は共通、描画だけモードで分ける。
// =====================================================================
import * as db from './../db.js';
import * as Store from './../store.js';
import { esc, toast, confetti, vibrate, progressRing, emptyState, skeleton, promptDialog } from './../ui.js';
import {
  jstToday, shortDate, dowJa, weekKeys, minutesText, localStreak, addDays, heatLevel,
} from './../format.js';

let root = null;
let unsub = [];
let state = {
  date: jstToday(),
  menus: [],
  log: null,
  items: [],
  recent: [],       // 直近90日のログ（週スタンプ / ヒートマップ用）
  loading: true,
};

const TIME_PRESETS = [5, 10, 15, 20, 30, 45, 60];

// =====================================================================
// データ
// =====================================================================
async function load() {
  state.loading = true;
  render();
  try {
    const [menus, log, recent] = await Promise.all([
      db.listMenus(),
      db.getLog(state.date),
      db.listLogs({ from: addDays(jstToday(), -90), to: jstToday() }),
    ]);
    state.menus = menus;
    state.log = log;
    state.recent = recent;
    state.items = log ? await db.listLogItems(log.id) : [];
  } catch (e) {
    console.error('[practice] 読み込みに失敗', e);
    toast(e.message || '読み込みに失敗しました', 'error');
  } finally {
    state.loading = false;
    render();
    refreshStreak();
  }
}

/** 連続日数はサーバーのビューが正。オフライン時はローカル計算で暫定表示 */
async function refreshStreak() {
  const doneDates = state.recent.filter((l) => l.total_minutes > 0).map((l) => l.log_date);
  Store.set({ streak: { ...Store.get('streak'), current_streak: localStreak(doneDates) } });
  if (!navigator.onLine) return;
  try {
    const s = await db.getStreak();
    Store.set({ streak: s });
    await maybeGrantBadges(s);
  } catch (e) {
    console.warn('[practice] ストリーク取得に失敗', e.message);
  }
}

async function maybeGrantBadges(streak) {
  try {
    const { newBadges } = await import('./../format.js');
    const earned = await db.listBadges();
    const have = earned.map((b) => b.badge_key);
    const totalMinutes = state.recent.reduce((s, l) => s + (l.total_minutes || 0), 0);
    const keys = newBadges({
      currentStreak: streak.current_streak,
      bestStreak: streak.best_streak,
      totalMinutes,
      practiceCount: state.recent.filter((l) => l.total_minutes > 0).length,
    }, have);
    if (!keys.length) return;
    await db.grantBadges(keys);
    const { BADGES } = await import('./../format.js');
    const b = BADGES.find((x) => x.key === keys[0]);
    if (b) { confetti(90); toast(`${b.icon} 「${b.name}」をゲット！`, 'ok', 4000); }
  } catch (e) {
    console.warn('[practice] バッジ判定に失敗', e.message);
  }
}

/** メニューのつけ外し */
async function toggleMenu(menu, minutesOverride = null) {
  const existing = state.items.find((i) => i.menu_id === menu.id);
  const nextDone = minutesOverride != null ? true : !existing?.done;

  // 楽観更新
  const optimistic = {
    ...(existing || { id: 'tmp-' + menu.id, menu_id: menu.id, menu_name: menu.name }),
    done: nextDone,
    minutes: nextDone ? (minutesOverride ?? existing?.minutes ?? menu.default_minutes) : 0,
    points: nextDone ? menu.points : 0,
  };
  state.items = existing
    ? state.items.map((i) => (i.menu_id === menu.id ? optimistic : i))
    : [...state.items, optimistic];
  render();
  vibrate(nextDone ? 14 : 8);

  try {
    let log = state.log;
    if (!log) { log = await db.ensureLog(state.date); state.log = log; }

    const saved = await db.setLogItem({
      logId: log.id,
      menu,
      done: nextDone,
      minutes: optimistic.minutes,
    });
    state.items = state.items.map((i) => (i.menu_id === menu.id ? saved : i));

    // total_minutes はサーバートリガーが正なので取り直す
    state.log = await db.getLog(state.date);
    const idx = state.recent.findIndex((l) => l.log_date === state.date);
    if (state.log) {
      if (idx >= 0) state.recent[idx] = state.log;
      else state.recent = [state.log, ...state.recent];
    }
    render();

    // 今日ぶんが全部終わったらお祝い
    if (nextDone && state.date === jstToday()) {
      const done = state.items.filter((i) => i.done).length;
      if (done === state.menus.length && state.menus.length > 0) {
        confetti(120);
        toast('今日のミッション、全部クリア！ 🎉', 'ok', 4000);
      }
    }
    refreshStreak();
  } catch (e) {
    console.error('[practice] 保存に失敗', e);
    toast(e.message || '保存できませんでした', 'error');
    load();   // サーバーの状態に戻す
  }
}

async function askMinutes(menu) {
  const cur = state.items.find((i) => i.menu_id === menu.id);
  const v = await promptDialog(`${menu.name} は何分やった？`, {
    value: String(cur?.minutes || menu.default_minutes),
    type: 'number',
  });
  if (v == null) return;
  const n = Math.max(0, Math.min(600, parseInt(v, 10) || 0));
  await toggleMenu(menu, n);
}

// =====================================================================
// 描画（こども）
// =====================================================================
function kidView() {
  const doneCount = state.items.filter((i) => i.done).length;
  const total = state.menus.length;
  const totalMin = state.log?.total_minutes || 0;
  const isToday = state.date === jstToday();

  return `
    <div class="mission" style="margin-bottom:var(--sp-4)">
      <div class="mission__text">
        <p class="mission__label">${isToday ? '今日のミッション' : shortDate(state.date) + 'の記録'}</p>
        <p class="mission__count">${doneCount}<span style="font-size:.5em"> / ${total}</span></p>
        <p class="mission__note">${totalMin > 0 ? '全部で ' + minutesText(totalMin) : 'タップして記録しよう！'}</p>
      </div>
      ${progressRing(total ? (doneCount / total) * 100 : 0, 92, 10)}
    </div>

    ${stampWeek()}

    <h2 class="card__title" style="margin-top:var(--sp-5)">練習メニュー</h2>
    ${total === 0
      ? emptyState('📝', 'メニューがまだありません。おとなの人にお願いしてね。')
      : `<div class="menu-grid">${state.menus.map(kidMenuCard).join('')}</div>`}

    <p style="text-align:center;color:var(--text-sub);font-size:var(--fs-xs);margin-top:var(--sp-4)">
      長押しすると、時間を変えられます
    </p>
  `;
}

function kidMenuCard(menu) {
  const item = state.items.find((i) => i.menu_id === menu.id);
  const done = !!item?.done;
  return `<button type="button" class="menu-card" aria-pressed="${done}"
            data-menu="${esc(menu.id)}">
    <span class="menu-card__check" aria-hidden="true">✓</span>
    <span class="menu-card__ico" aria-hidden="true">${esc(menu.icon)}</span>
    <span class="menu-card__name">${esc(menu.name)}</span>
    <span class="menu-card__time">${done ? minutesText(item.minutes) : minutesText(menu.default_minutes) + 'めやす'}</span>
  </button>`;
}

function stampWeek() {
  const keys = weekKeys(state.date);
  const today = jstToday();
  const byDate = new Map(state.recent.map((l) => [l.log_date, l]));
  return `<div class="card">
    <p class="card__title">こんしゅうのスタンプ</p>
    <div class="stamp-week">
      ${keys.map((k) => {
        const log = byDate.get(k);
        const done = (log?.total_minutes || 0) > 0;
        const future = k > today;
        return `<div class="stamp-day ${done ? 'stamp-day--done' : ''} ${k === today ? 'stamp-day--today' : ''}">
          <div class="stamp-day__dow">${dowJa(k)}</div>
          <div class="stamp-day__mark">${done ? '⭐' : (future ? '' : '·')}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// =====================================================================
// 描画（おとな）
// =====================================================================
function adultView() {
  const totalMin = state.log?.total_minutes || 0;
  return `
    <div class="page-head">
      <h1>練習記録</h1>
      <div class="row">
        <input class="input" type="date" value="${esc(state.date)}" max="${jstToday()}"
               data-date style="width:auto">
      </div>
    </div>

    <div class="grid grid--2" style="align-items:start">
      <div class="card">
        <p class="card__title">${shortDate(state.date)} の入力</p>
        ${state.menus.length === 0
          ? emptyState('📝', '練習メニューが未登録です', '<a class="btn btn--primary" href="#/settings">メニューを登録する</a>')
          : `<ul>${state.menus.map(adultMenuRow).join('')}</ul>`}
        <div class="row row--between" style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--border)">
          <b>合計</b><b>${minutesText(totalMin)}</b>
        </div>
        <label class="field" style="margin-top:var(--sp-3)">
          <span class="field__label">メモ</span>
          <textarea class="textarea" data-note placeholder="調子・気づいたこと">${esc(state.log?.note || '')}</textarea>
        </label>
        <button class="btn btn--outline btn--sm" data-act="save-note">メモを保存</button>
      </div>

      <div>
        <div class="card">
          <p class="card__title">練習ヒートマップ（直近12週）</p>
          ${heatmap()}
          <div class="heat-legend"><span>少ない</span>
            ${[0, 1, 2, 3, 4].map((l) => `<span class="heat__cell" data-lv="${l}"></span>`).join('')}
            <span>多い</span>
          </div>
        </div>
        <div class="card">
          <p class="card__title">最近の記録</p>
          ${historyTable()}
        </div>
      </div>
    </div>
  `;
}

function adultMenuRow(menu) {
  const item = state.items.find((i) => i.menu_id === menu.id);
  const done = !!item?.done;
  return `<li class="row row--between" style="padding:var(--sp-2) 0;border-bottom:1px solid var(--border)">
    <button type="button" class="btn btn--sm ${done ? 'btn--primary' : 'btn--outline'}"
            data-menu="${esc(menu.id)}" style="min-width:110px;justify-content:flex-start">
      ${done ? '✓' : '　'} ${esc(menu.icon)} ${esc(menu.name)}
    </button>
    <div class="chips">
      ${TIME_PRESETS.map((n) => `<button type="button" class="chip"
          aria-pressed="${done && item.minutes === n}"
          data-menu-min="${esc(menu.id)}" data-min="${n}">${n}分</button>`).join('')}
    </div>
  </li>`;
}

function heatmap() {
  const today = jstToday();
  const byDate = new Map(state.recent.map((l) => [l.log_date, l]));
  // 84日ぶんを日曜始まりの列にする
  const start = addDays(today, -83);
  const cells = [];
  for (let i = 0; i < 84; i++) {
    const k = addDays(start, i);
    cells.push(`<span class="heat__cell" data-lv="${heatLevel(byDate.get(k)?.total_minutes)}"
                 title="${k}"></span>`);
  }
  return `<div class="heat">${cells.join('')}</div>`;
}

function historyTable() {
  const rows = state.recent.filter((l) => l.total_minutes > 0).slice(0, 14);
  if (!rows.length) return emptyState('🌱', 'まだ記録がありません');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>日付</th><th class="num">時間</th><th>メモ</th></tr></thead>
    <tbody>${rows.map((l) => `<tr>
      <td><a href="#/practice?d=${esc(l.log_date)}" data-jump="${esc(l.log_date)}">${shortDate(l.log_date)}</a></td>
      <td class="num">${minutesText(l.total_minutes)}</td>
      <td style="white-space:normal">${esc((l.note || '').slice(0, 40))}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// =====================================================================
function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(4, 90); return; }
  root.innerHTML = Store.get('mode') === 'kid' ? kidView() : adultView();
}

// =====================================================================
export default {
  async mount(el, params) {
    root = el;
    state = {
      date: params?.d || jstToday(),
      menus: [], log: null, items: [], recent: [], loading: true,
    };

    // 長押しで時間変更（こどもモード）
    // 長押しが発火したら、続けて起きる click は無視する
    let pressTimer = null;
    let longPressFired = false;

    root.addEventListener('pointerdown', (ev) => {
      const btn = ev.target.closest('[data-menu]');
      if (!btn || Store.get('mode') !== 'kid') return;
      const menu = state.menus.find((m) => m.id === btn.dataset.menu);
      if (!menu) return;
      longPressFired = false;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        longPressFired = true;
        askMinutes(menu);
      }, 600);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) =>
      root.addEventListener(t, () => { clearTimeout(pressTimer); pressTimer = null; }));

    root.addEventListener('click', async (ev) => {
      if (longPressFired) { longPressFired = false; return; }

      const minChip = ev.target.closest('[data-menu-min]');
      if (minChip) {
        const menu = state.menus.find((m) => m.id === minChip.dataset.menuMin);
        if (menu) await toggleMenu(menu, parseInt(minChip.dataset.min, 10));
        return;
      }

      const menuBtn = ev.target.closest('[data-menu]');
      if (menuBtn) {
        const menu = state.menus.find((m) => m.id === menuBtn.dataset.menu);
        if (menu) await toggleMenu(menu);
        return;
      }

      const jump = ev.target.closest('[data-jump]');
      if (jump) {
        ev.preventDefault();
        state.date = jump.dataset.jump;
        await load();
        return;
      }

      if (ev.target.closest('[data-act="save-note"]')) {
        const note = root.querySelector('[data-note]')?.value || '';
        try {
          const log = state.log || await db.ensureLog(state.date);
          state.log = await db.updateLog(log.id, { note });
          toast('メモを保存しました', 'ok');
        } catch (e) {
          toast(e.message || '保存できませんでした', 'error');
        }
      }
    });

    root.addEventListener('change', async (ev) => {
      const dateInput = ev.target.closest('[data-date]');
      if (dateInput) { state.date = dateInput.value; await load(); }
    });

    // モードが変わったら描き直す
    unsub.push(Store.subscribe('mode', () => render()));

    await load();
  },

  destroy() {
    unsub.forEach((f) => f());
    unsub = [];
    root = null;
  },
};
