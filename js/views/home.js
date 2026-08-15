// =====================================================================
// home.js — ホーム
//   こども: きょうのミッション / 応援 / ごほうび進捗 / バッジ
//   おとな: ダッシュボード（連続日数・今月・次の締切・目標進捗・直近の記録）
// =====================================================================
import * as db from './../db.js';
import * as Store from './../store.js';
import * as Stage from './../components/stage.js';
import { esc, toast, progressRing, progressBar, emptyState, skeleton, vibrate } from './../ui.js';
import {
  jstToday, shortDate, minutesText, addDays, deadlineText, deadlineLevel,
  BADGES, AUDITION_STATUS,
} from './../format.js';

let root = null;
let unsub = [];
let onPick = null;
let state = { loading: true };

async function load() {
  state.loading = true;
  render();

  const isAdult = Store.get('mode') === 'adult';
  try {
    const [menus, log, streak, points, badges, cheers, goals, recent] = await Promise.all([
      db.listMenus(),
      db.getLog(jstToday()),
      db.getStreak(),
      db.getPoints(),
      db.listBadges(),
      db.listCheers({ limit: 5 }),
      db.listGoals(),
      db.listLogs({ from: addDays(jstToday(), -30), to: jstToday() }),
    ]);

    state = {
      loading: false,
      menus, log, streak, points, badges, cheers, goals, recent,
      items: log ? await db.listLogItems(log.id) : [],
      rewards: [],
      auditions: [],
    };
    Store.set({ streak });

    // ごほうび・オーディションは必要なほうだけ取る
    state.rewards = await db.listRewards().catch(() => []);
    if (isAdult && Store.get('role') === 'parent') {
      state.auditions = await db.listAuditions().catch(() => []);
    }
  } catch (e) {
    console.error('[home] 読み込みに失敗', e);
    state.loading = false;
    toast(e.message || '読み込みに失敗しました', 'error');
  }
  render();
}

// =====================================================================
// こども
// =====================================================================
function kidView() {
  const done = (state.items || []).filter((i) => i.done).length;
  const total = (state.menus || []).length;
  const streak = state.streak?.current_streak || 0;
  const name = Store.get('members').find((m) => m.is_talent)?.nickname
            || Store.get('members').find((m) => m.is_talent)?.display_name
            || '';

  return `
    <div class="mission" style="margin-bottom:var(--sp-4)">
      <div class="mission__text">
        <p class="mission__label">きょうのミッション</p>
        <p class="mission__count">${done}<span style="font-size:.5em"> / ${total}</span></p>
        <p class="mission__note">
          ${done === 0 ? 'まずは1つやってみよう！'
            : done >= total && total > 0 ? 'ぜんぶクリア！すごい！🎉'
            : 'あと' + (total - done) + 'つ！'}
        </p>
      </div>
      ${progressRing(total ? (done / total) * 100 : 0, 92, 10)}
    </div>

    <a class="btn btn--primary btn--block" href="#/practice"
       style="margin-bottom:var(--sp-4)">✏️ きょうのれんしゅうをきろくする</a>

    ${streak > 0 ? `<div class="card" style="text-align:center">
      <p style="font-size:var(--fs-2xl);font-weight:900">🔥 ${streak}日</p>
      <p style="color:var(--text-sub);font-size:var(--fs-sm)">
        れんぞくきろく${state.streak?.best_streak > streak ? `（さいこう記録は${state.streak.best_streak}日）` : ''}
      </p>
    </div>` : ''}

    ${cheerCard()}
    ${rewardCard()}
    ${badgeCard()}
    ${heroPicker()}
  `;
}

/**
 * 背景イラストを選ぶ。
 * 「自分の画面」だと思えることがやる気につながるので、親ではなく本人に選ばせる。
 */
function heroPicker() {
  const now = Stage.currentHero();
  return `<div class="card" style="margin-top:var(--sp-3)">
    <p class="card__title">🖼️ はいけいをえらぶ</p>
    <div class="hero-pick" role="radiogroup" aria-label="はいけいのイラスト">
      ${Stage.HEROES.map((id) => `
        <button type="button" class="hero-pick__item${id === now ? ' is-on' : ''}"
                role="radio" aria-checked="${id === now}"
                data-hero="${id}" aria-label="イラスト${id}">
          <img src="${esc(Stage.heroThumb(id))}" alt="" loading="lazy" decoding="async">
        </button>`).join('')}
    </div>
  </div>`;
}

function cheerCard() {
  const latest = (state.cheers || []).find((c) => c.author_user_id !== Store.get('user')?.id);
  return `<div class="cheer" style="margin-top:var(--sp-3)">
    <p class="cheer__from">💌 おうちの人からのおうえん</p>
    ${latest
      ? `<p class="cheer__body">${esc(latest.body || reactionEmoji(latest.reaction))}</p>`
      : '<p class="cheer__body cheer__empty">まだメッセージはありません</p>'}
    <div style="margin-top:var(--sp-3)">
      <a class="btn btn--soft btn--sm" href="#/messages">ぜんぶ見る</a>
    </div>
  </div>`;
}

function reactionEmoji(r) {
  return ({ like: '👍', star: '⭐', fire: '🔥', clap: '👏', heart: '💖' })[r] || '👍';
}

function rewardCard() {
  const open = (state.rewards || []).filter((r) => r.status === 'open');
  if (!open.length) return '';
  const balance = state.points?.balance_points || 0;
  const next = open.slice().sort((a, b) => a.cost_points - b.cost_points)
    .find((r) => r.cost_points > balance) || open[0];
  const left = Math.max(0, next.cost_points - balance);
  return `<div class="card" style="margin-top:var(--sp-3)">
    <p class="card__title">🏆 ごほうび</p>
    <p style="font-weight:800">${esc(next.icon)} ${esc(next.title)}</p>
    <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-2)">
      ${left > 0 ? `あと ${left} ポイント！` : 'こうかんできるよ！'}
    </p>
    ${progressBar(next.cost_points ? (balance / next.cost_points) * 100 : 100)}
    <p style="text-align:right;font-size:var(--fs-xs);color:var(--text-sub);margin-top:4px">
      ${balance} / ${next.cost_points} ポイント
    </p>
    <div style="margin-top:var(--sp-3)"><a class="btn btn--soft btn--sm" href="#/rewards">ごほうび帳を見る</a></div>
  </div>`;
}

function badgeCard() {
  const have = new Set((state.badges || []).map((b) => b.badge_key));
  if (!have.size) return '';
  return `<div class="card" style="margin-top:var(--sp-3)">
    <p class="card__title">🎖️ あつめたバッジ（${have.size} / ${BADGES.length}）</p>
    <div class="reward-track">
      ${BADGES.map((b) => `<span class="${have.has(b.key) ? '' : 'off'}"
        title="${esc(b.name)}：${esc(b.desc)}">${b.icon}</span>`).join('')}
    </div>
  </div>`;
}

// =====================================================================
// おとな
// =====================================================================
function adultView() {
  const streak = state.streak || {};
  const monthLogs = (state.recent || []).filter((l) => l.total_minutes > 0);
  const monthMin = monthLogs.reduce((s, l) => s + l.total_minutes, 0);
  const upcoming = nextDeadlines();

  return `
    <div class="page-head">
      <h1>ダッシュボード</h1>
      <span class="sub">${shortDate(jstToday())}</span>
    </div>

    <div class="stats" style="margin-bottom:var(--sp-4)">
      <div class="stat">
        <p class="stat__label">連続日数</p>
        <p class="stat__value">${streak.current_streak || 0}<span class="stat__unit">日</span></p>
        <p class="stat__note">最長 ${streak.best_streak || 0}日</p>
      </div>
      <div class="stat">
        <p class="stat__label">直近30日の練習</p>
        <p class="stat__value">${monthLogs.length}<span class="stat__unit">日</span></p>
        <p class="stat__note">計 ${minutesText(monthMin)}</p>
      </div>
      <div class="stat">
        <p class="stat__label">ポイント残高</p>
        <p class="stat__value">${state.points?.balance_points || 0}</p>
        <p class="stat__note">獲得 ${state.points?.earned_points || 0}</p>
      </div>
      ${upcoming[0] ? `<div class="stat ${deadlineLevel(upcoming[0].date) === 'urgent' ? 'stat--danger' : 'stat--warn'}">
        <p class="stat__label">次の締切</p>
        <p class="stat__value" style="font-size:var(--fs-lg)">${esc(upcoming[0].title)}</p>
        <p class="stat__note">${esc(upcoming[0].date)} ・ ${deadlineText(upcoming[0].date)}</p>
      </div>` : `<div class="stat">
        <p class="stat__label">次の締切</p>
        <p class="stat__value" style="font-size:var(--fs-lg)">—</p>
        <p class="stat__note">登録なし</p>
      </div>`}
    </div>

    <div class="grid grid--2" style="align-items:start">
      <div class="card">
        <p class="card__title">今日の入力状況</p>
        ${(state.menus || []).length === 0
          ? emptyState('📝', '練習メニューが未登録です',
              '<a class="btn btn--primary btn--sm" href="#/settings">メニューを登録</a>')
          : `<ul>${state.menus.map((m) => {
              const it = (state.items || []).find((i) => i.menu_id === m.id);
              return `<li class="row row--between" style="padding:6px 0">
                <span>${it?.done ? '✅' : '⬜'} ${esc(m.icon)} ${esc(m.name)}</span>
                <span style="color:var(--text-sub)">${it?.done ? minutesText(it.minutes) : '—'}</span>
              </li>`;
            }).join('')}</ul>
            <a class="btn btn--outline btn--sm btn--block" href="#/practice"
               style="margin-top:var(--sp-3)">記録を入力する</a>`}
      </div>

      <div class="card">
        <p class="card__title">目標の進捗</p>
        ${goalProgress()}
      </div>
    </div>

    <div class="card">
      <p class="card__title">直近の記録</p>
      ${monthLogs.length === 0
        ? emptyState('🌱', 'まだ記録がありません')
        : `<div class="table-wrap"><table class="table">
            <thead><tr><th>日付</th><th class="num">時間</th><th>メモ</th></tr></thead>
            <tbody>${monthLogs.slice(0, 8).map((l) => `<tr>
              <td>${shortDate(l.log_date)}</td>
              <td class="num">${minutesText(l.total_minutes)}</td>
              <td style="white-space:normal">${esc((l.note || '').slice(0, 50))}</td>
            </tr>`).join('')}</tbody></table></div>`}
    </div>

    ${auditionCard()}
  `;
}

function nextDeadlines() {
  const today = jstToday();
  const out = [];
  for (const a of state.auditions || []) {
    if (a.apply_deadline && a.apply_deadline >= today) out.push({ title: a.title, date: a.apply_deadline });
    if (a.event_date && a.event_date >= today) out.push({ title: a.title + '（本番）', date: a.event_date });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function goalProgress() {
  const big = (state.goals || []).filter((g) => g.level === 'big' && g.status !== 'archived');
  if (!big.length) {
    return emptyState('🎯', '目標がまだ設定されていません',
      '<a class="btn btn--primary btn--sm" href="#/goals">目標をつくる</a>');
  }
  return big.map((g) => `<div style="margin-bottom:var(--sp-3)">
    <div class="row row--between" style="margin-bottom:4px">
      <b>${esc(g.icon)} ${esc(g.title)}</b>
      <span style="color:var(--text-sub);font-size:var(--fs-sm)">${g.progress_pct}%</span>
    </div>
    ${progressBar(g.progress_pct)}
  </div>`).join('') + '<a class="btn btn--outline btn--sm btn--block" href="#/goals">目標を見る</a>';
}

function auditionCard() {
  const list = (state.auditions || []).filter((a) => !['finished', 'declined'].includes(a.status));
  if (!list.length) return '';
  const today = jstToday();
  return `<div class="card">
    <p class="card__title">進行中のオーディション</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>案件</th><th>状態</th><th>応募締切</th><th>本番</th></tr></thead>
      <tbody>${list.slice(0, 6).map((a) => {
        const lv = deadlineLevel(a.apply_deadline, today);
        const st = AUDITION_STATUS[a.status] || { label: a.status, tag: '' };
        return `<tr class="${lv === 'urgent' || lv === 'over' ? 'is-urgent' : ''}">
          <td><a href="#/auditions/${esc(a.id)}">${esc(a.title)}</a></td>
          <td><span class="tag ${st.tag}">${esc(st.label)}</span></td>
          <td>${a.apply_deadline ? esc(a.apply_deadline) + '<br><small>' + deadlineText(a.apply_deadline) + '</small>' : '—'}</td>
          <td>${a.event_date ? esc(a.event_date) : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}

// =====================================================================
function render() {
  if (!root) return;
  if (state.loading) { root.innerHTML = skeleton(4, 100); return; }
  const kid = Store.get('mode') === 'kid';
  root.innerHTML = kid ? kidView() : adultView();

  // 背景の2人に今日の達成状況を伝える。
  // 全部終わった日は前に出て喜ぶので、「終わらせたい」動機になる。
  if (kid) {
    Stage.setProgress(
      (state.items || []).filter((i) => i.done).length,
      (state.menus || []).length,
    );
  }
}

export default {
  async mount(el) {
    root = el;
    state = { loading: true };

    // 背景イラストの切り替え。委譲にしているので再描画しても付け直さなくてよい
    onPick = (ev) => {
      const btn = ev.target.closest('[data-hero]');
      if (!btn) return;
      Stage.setHero(Number(btn.dataset.hero));
      vibrate(10);
      render();
    };
    root.addEventListener('click', onPick);

    unsub.push(Store.subscribe('mode', () => load()));
    await load();
  },
  destroy() {
    unsub.forEach((f) => f());
    unsub = [];
    if (onPick) root?.removeEventListener('click', onPick);
    onPick = null;
    root = null;
  },
};
