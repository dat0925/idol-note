// =====================================================================
// timeline.js — 横軸＝時間 / 縦軸＝目標 のチャート（ガント）
//
// ねらい:
//   「本番までにどこで何を終わらせるのか」を1枚で見せる。
//   ツリー表示は上下関係は分かるが、"間に合うのか" が分からない。
//
// 方針:
//   ・位置の計算は format.js の純関数（timelineRange / monthTicks / barSpan）。
//     ここは HTML を組み立てるだけ。だから計算side はテストできる。
//   ・色は「階層の深さ」を表す。最終目標が一番濃く、行動目標が一番淡い。
//     ★これは順序のある尺度なので、色相を4つ配るのではなく
//       1色の濃淡（sequential）にする。色覚特性に関係なく順序が読める。
//     ★淡い段は下地とのコントラストが 3:1 に届かないので、
//       すべての棒に輪郭線を入れ、行の左には必ず文字ラベルを出す。
//       色だけに意味を持たせない。
//   ・棒の中の濃い塗りが達成率。棒＝期間、塗り＝進捗。
// =====================================================================
import { esc } from './../ui.js';
import {
  timelineRange, monthTicks, barSpan, todayPct, levelRank, levelLabel,
  jstToday, shortDate, longDate,
} from './../format.js';

/**
 * @param {object[]} rows  { goal, depth } の配列（ツリーを深さ優先で潰したもの）
 * @param {{mode?:string, today?:string, birthday?:string}} opts
 * @returns {string} HTML。描けないときは空文字
 */
export function timeline(rows, { mode = 'adult', today = jstToday() } = {}) {
  const goals = rows.map((r) => r.goal);
  const range = timelineRange(goals, today);
  if (!range) return '';

  const ticks = monthTicks(range);
  const now = todayPct(range, today);

  // 目盛りの線と「いまここ」。行の上に重ねるので、棒より奥に敷く
  const overlay = `
    <div class="gantt__overlay" aria-hidden="true">
      ${ticks.slice(1).map((t) => `<span class="gantt__gridline" style="left:${t.leftPct.toFixed(3)}%"></span>`).join('')}
      ${now === null ? '' : `<span class="gantt__now" style="left:${now.toFixed(3)}%"></span>`}
    </div>`;

  const head = `
    <div class="gantt__row gantt__row--head">
      <div class="gantt__label">${now === null ? '' : `<span class="gantt__now-tag">今日 ${esc(shortDate(today))}</span>`}</div>
      <div class="gantt__track">
        ${ticks.map((t) => `<span class="gantt__tick" style="left:${t.leftPct.toFixed(3)}%;width:${t.widthPct.toFixed(3)}%">${esc(t.label)}</span>`).join('')}
      </div>
    </div>`;

  const body = rows.map(({ goal, depth }) => {
    const span = barSpan(goal.period_start, goal.period_end, range);
    const rank = levelRank(goal.level);
    const done = goal.status === 'done';
    const pctv = done ? 100 : (goal.progress_pct || 0);
    // 読み上げと、狭い画面でのホバー用。棒の意味を文字でも持たせる
    const desc = `${levelLabel(goal.level, mode)}：${goal.title}`
      + `（${goal.period_start ? longDate(goal.period_start) : '開始日なし'}`
      + ` 〜 ${goal.period_end ? longDate(goal.period_end) : '期日なし'}）`
      + ` 達成 ${pctv}%`;

    return `
      <div class="gantt__row" data-id="${esc(goal.id)}">
        <div class="gantt__label" style="padding-left:calc(${depth} * var(--sp-3))">
          <span class="gantt__dot" data-rank="${rank}" aria-hidden="true"></span>
          <span class="gantt__name ${done ? 'is-done' : ''}">${esc(goal.title)}</span>
        </div>
        <div class="gantt__track">
          ${span === null
            ? '<span class="gantt__nodate">期日なし</span>'
            : `<div class="gantt__bar" data-rank="${rank}" title="${esc(desc)}"
                    style="left:${span.leftPct.toFixed(3)}%;width:${span.widthPct.toFixed(3)}%">
                 <span class="gantt__fill" style="width:${pctv}%"></span>
                 <span class="sr-only">${esc(desc)}</span>
               </div>`}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="gantt" role="img" aria-label="目標のタイムライン。横が時間、縦が目標。">
      <div class="gantt__scroll">
        <div class="gantt__inner">
          ${overlay}
          ${head}
          ${body}
        </div>
      </div>
      ${legend(mode)}
    </div>`;
}

/** 凡例。色が何を表すかを必ず文字でも出す */
function legend(mode) {
  const levels = ['big', 'milestone', 'month', 'task'];
  return `<div class="gantt__legend">
    ${levels.map((l) => `<span class="gantt__legend-item">
      <span class="gantt__dot" data-rank="${levelRank(l)}" aria-hidden="true"></span>
      ${esc(levelLabel(l, mode))}
    </span>`).join('')}
    <span class="gantt__legend-item gantt__legend-item--now">
      <span class="gantt__legend-line" aria-hidden="true"></span> 今日
    </span>
  </div>`;
}

/**
 * ツリーを「深さ優先の一次元配列」に潰す。チャートの行の並び順になる。
 * @param {object[]} goals すべての目標
 * @param {{maxRank?:number}} opts maxRank=2 なら行動目標(3)を出さない
 */
export function flattenGoals(goals, { maxRank = 3 } = {}) {
  const byParent = new Map();
  for (const g of goals) {
    const k = g.parent_goal_id || '__root__';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(g);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order - b.sort_order)
      || String(a.period_end || '9999').localeCompare(String(b.period_end || '9999')));
  }

  const out = [];
  const walk = (parentKey, depth) => {
    for (const g of byParent.get(parentKey) || []) {
      if (g.status === 'archived') continue;
      if (levelRank(g.level) > maxRank) continue;
      out.push({ goal: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk('__root__', 0);
  return out;
}
