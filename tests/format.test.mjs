// =====================================================================
// format.js の純関数テスト
//   実行: node --test tests/
//
// 特に日付まわりは「日本の 0〜9時」で壊れやすいので、
// UTC 上で前日になる時刻を明示的に食わせて検証している。
// =====================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  jstToday, addDays, diffDays, weekKeys, dowJa, shortDate, longDate,
  minutesText, deadlineText, deadlineLevel, localStreak, pct, heatLevel,
  esc, newBadges, friendlyError,
  addMonths, monthStart, monthEnd, ageAt, ageText,
  levelRank, levelLabel, timelineRange, monthTicks, barSpan, todayPct,
} from '../js/format.js';

// ── JST の日付 ───────────────────────────────────────
test('jstToday: 日本の午前2時でも「その日」を返す（UTCでは前日）', () => {
  // 2026-08-15 02:00 JST = 2026-08-14 17:00 UTC
  const d = new Date('2026-08-14T17:00:00Z');
  assert.equal(jstToday(d), '2026-08-15');
  // 同じ瞬間を toISOString で切ると前日になってしまう（これを避けるのが目的）
  assert.equal(d.toISOString().slice(0, 10), '2026-08-14');
});

test('jstToday: 日本の午後11時でも翌日にならない', () => {
  const d = new Date('2026-08-15T14:00:00Z');   // 23:00 JST
  assert.equal(jstToday(d), '2026-08-15');
});

test('addDays: 月またぎ・年またぎ・うるう年', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');   // 2028年はうるう年
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-08-15', 0), '2026-08-15');
});

test('diffDays', () => {
  assert.equal(diffDays('2026-08-20', '2026-08-15'), 5);
  assert.equal(diffDays('2026-08-15', '2026-08-20'), -5);
  assert.equal(diffDays('2026-01-01', '2025-12-31'), 1);
});

test('weekKeys: 日曜始まりの7日', () => {
  // 2026-08-15 は土曜日
  const w = weekKeys('2026-08-15');
  assert.equal(w.length, 7);
  assert.equal(w[0], '2026-08-09');   // 日曜
  assert.equal(w[6], '2026-08-15');   // 土曜
});

test('dowJa / shortDate / longDate', () => {
  assert.equal(dowJa('2026-08-15'), '土');
  assert.equal(dowJa('2026-08-16'), '日');
  assert.equal(shortDate('2026-08-15'), '8/15(土)');
  assert.equal(longDate('2026-08-15'), '2026年8月15日');
});

// ── 表示 ─────────────────────────────────────────────
test('minutesText', () => {
  assert.equal(minutesText(0), '0分');
  assert.equal(minutesText(45), '45分');
  assert.equal(minutesText(60), '1時間');
  assert.equal(minutesText(80), '1時間20分');
  assert.equal(minutesText(125), '2時間5分');
  assert.equal(minutesText(-5), '0分');
  assert.equal(minutesText(null), '0分');
});

test('deadlineText', () => {
  const today = '2026-08-15';
  assert.equal(deadlineText('2026-08-15', today), '今日まで');
  assert.equal(deadlineText('2026-08-16', today), 'あと1日');
  assert.equal(deadlineText('2026-08-22', today), 'あと7日');
  assert.equal(deadlineText('2026-08-13', today), '2日すぎています');
  assert.equal(deadlineText(null, today), '');
});

test('deadlineLevel', () => {
  const today = '2026-08-15';
  assert.equal(deadlineLevel('2026-08-14', today), 'over');
  assert.equal(deadlineLevel('2026-08-15', today), 'urgent');
  assert.equal(deadlineLevel('2026-08-18', today), 'urgent');
  assert.equal(deadlineLevel('2026-08-20', today), 'soon');
  assert.equal(deadlineLevel('2026-09-30', today), 'normal');
  assert.equal(deadlineLevel(null, today), '');
});

// ── ストリーク ───────────────────────────────────────
test('localStreak: 今日を含む連続', () => {
  const today = '2026-08-15';
  assert.equal(localStreak(['2026-08-15', '2026-08-14', '2026-08-13'], today), 3);
});

test('localStreak: 今日まだ未記録なら昨日から数える（朝に0にしない）', () => {
  const today = '2026-08-15';
  assert.equal(localStreak(['2026-08-14', '2026-08-13'], today), 2);
});

test('localStreak: 2日空いたら途切れる', () => {
  const today = '2026-08-15';
  assert.equal(localStreak(['2026-08-13', '2026-08-12'], today), 0);
});

test('localStreak: 空・重複・順不同', () => {
  const today = '2026-08-15';
  assert.equal(localStreak([], today), 0);
  assert.equal(localStreak(['2026-08-14', '2026-08-15', '2026-08-14'], today), 2);
});

test('localStreak: 月をまたいでも続く', () => {
  const today = '2026-09-01';
  assert.equal(localStreak(['2026-09-01', '2026-08-31', '2026-08-30'], today), 3);
});

// ── そのほか ─────────────────────────────────────────
test('pct', () => {
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(0, 0), 0);      // 0除算しない
  assert.equal(pct(5, 4), 100);    // 上限で丸める
  assert.equal(pct(-1, 4), 0);
});

test('heatLevel', () => {
  assert.equal(heatLevel(0), 0);
  assert.equal(heatLevel(10), 1);
  assert.equal(heatLevel(20), 2);
  assert.equal(heatLevel(45), 3);
  assert.equal(heatLevel(90), 4);
});

test('esc: HTMLを無害化する', () => {
  assert.equal(esc('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc('a & "b" \'c\''), 'a &amp; &quot;b&quot; &#39;c&#39;');
});

// ── バッジ判定 ───────────────────────────────────────
test('newBadges: 条件を満たしたものだけ返す', () => {
  const got = newBadges({
    currentStreak: 7, bestStreak: 7, totalMinutes: 700, practiceCount: 12,
  }, []);
  assert.ok(got.includes('first_practice'));
  assert.ok(got.includes('streak_3'));
  assert.ok(got.includes('streak_7'));
  assert.ok(got.includes('total_10h'));       // 700分 = 11.6時間
  assert.ok(!got.includes('streak_30'));
  assert.ok(!got.includes('total_50h'));
});

test('newBadges: 獲得済みは返さない', () => {
  const got = newBadges({ currentStreak: 7, bestStreak: 7, totalMinutes: 0, practiceCount: 7 },
    ['first_practice', 'streak_3', 'streak_7']);
  assert.deepEqual(got, []);
});

test('newBadges: bestStreak が current より小さくても current で判定する', () => {
  const got = newBadges({ currentStreak: 30, bestStreak: 3, totalMinutes: 0, practiceCount: 30 }, []);
  assert.ok(got.includes('streak_30'));
});

// ── エラーメッセージの日本語化 ───────────────────────
// 生の Postgres メッセージが画面に出た事故（応援画面）の再発防止。
test('friendlyError: 同じスタンプの二度押しを日本語で説明する', () => {
  const raw = 'duplicate key value violates unique constraint "idol_cheer_unique_reaction_log"';
  assert.equal(friendlyError(raw), 'そのスタンプは、もうおくってあります');
});

test('friendlyError: 内部の制約名やテーブル名を画面に漏らさない', () => {
  const raws = [
    'duplicate key value violates unique constraint "idol_something_key"',
    'new row violates row-level security policy for table "idol_body_records"',
    'permission denied for table idol_parent_pins',
    'null value in column "title" violates not-null constraint',
    'new row for relation "idol_goals" violates check constraint "idol_goals_period_order"',
  ];
  for (const raw of raws) {
    const msg = friendlyError(raw);
    assert.ok(!/idol_|constraint|violates|denied/i.test(msg), `漏れている: ${msg}`);
    assert.ok(/[ぁ-んァ-ヶ一-龠]/.test(msg), `日本語になっていない: ${msg}`);
  }
});

test('friendlyError: RLS 拒否は権限の話として伝える', () => {
  const raw = 'new row violates row-level security policy for table "idol_body_records"';
  assert.equal(friendlyError(raw), 'この操作をする権限がありません');
});

test('friendlyError: トリガーが日本語で投げたメッセージはそのまま通す', () => {
  assert.equal(friendlyError('ごほうびの承認は親のみです'), 'ごほうびの承認は親のみです');
  assert.equal(friendlyError('role の変更は親のみ可能です'), 'role の変更は親のみ可能です');
});

test('friendlyError: 空や未知の英語メッセージでも既定文言を返す', () => {
  assert.equal(friendlyError(''), 'うまくいきませんでした');
  assert.equal(friendlyError(null), 'うまくいきませんでした');
  assert.equal(friendlyError('some unexpected failure'), 'うまくいきませんでした');
});

test('friendlyError: 通信断はやり直せる案内にする', () => {
  assert.equal(friendlyError('TypeError: Failed to fetch'),
    'つうしんできませんでした。電波を確認してください');
});

// ── 月の計算 ─────────────────────────────────────────
test('addMonths: 月末は行き過ぎない（1/31 + 1か月 は 2/28）', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');   // うるう年
  assert.equal(addMonths('2026-08-16', 4), '2026-12-16');
  assert.equal(addMonths('2026-12-26', 1), '2027-01-26');   // 年またぎ
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
});

test('monthStart / monthEnd', () => {
  assert.equal(monthStart('2026-08-16'), '2026-08-01');
  assert.equal(monthEnd('2026-08-16'), '2026-08-31');
  assert.equal(monthEnd('2026-09-01'), '2026-09-30');
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(monthEnd('2028-02-10'), '2028-02-29');
  assert.equal(monthEnd('2026-12-26'), '2026-12-31');
});

// ── 年齢 ─────────────────────────────────────────────
test('ageAt: 誕生日が来ていない月は繰り上げない', () => {
  // 2016-10-06 生まれ
  assert.deepEqual(ageAt('2016-10-06', '2026-10-05'), { years: 9, months: 11 });
  assert.deepEqual(ageAt('2016-10-06', '2026-10-06'), { years: 10, months: 0 });
  assert.deepEqual(ageAt('2016-10-06', '2026-12-26'), { years: 10, months: 2 });
});

test('ageAt: 未来の日付でも計算できる（目標の期日で使う）', () => {
  assert.deepEqual(ageAt('2016-10-06', '2030-04-06'), { years: 13, months: 6 });
});

test('ageAt: 不正な入力は null', () => {
  assert.equal(ageAt(null, '2026-08-16'), null);
  assert.equal(ageAt('2016-10-06', null), null);
  assert.equal(ageAt('2016-10-06', '2016-10-05'), null);   // 生まれる前
  assert.equal(ageAt('', '2026-08-16'), null);
});

test('ageText: ちょうどの年は「か月」を出さない', () => {
  assert.equal(ageText('2016-10-06', '2026-10-06'), '10歳');
  assert.equal(ageText('2016-10-06', '2026-12-26'), '10歳2か月');
  assert.equal(ageText(null, '2026-12-26'), '');
});

// ── 目標の階層 ───────────────────────────────────────
test('levelRank: 未知の level は行動目標あつかい（色が消えない）', () => {
  assert.equal(levelRank('big'), 0);
  assert.equal(levelRank('milestone'), 1);
  assert.equal(levelRank('month'), 2);
  assert.equal(levelRank('week'), 2);      // 旧データ
  assert.equal(levelRank('task'), 3);
  assert.equal(levelRank('なにこれ'), 3);
});

test('levelLabel: こどもモードは言い方を変える', () => {
  assert.equal(levelLabel('big'), '最終目標');
  assert.equal(levelLabel('big', 'kid'), '大きな目標');
  assert.equal(levelLabel('task', 'kid'), 'やること');
  assert.equal(levelLabel('存在しない'), '');
});

// ── タイムライン ─────────────────────────────────────
test('timelineRange: 月の頭から月末までに丸める', () => {
  const r = timelineRange([
    { period_start: '2026-08-16', period_end: '2026-08-31' },
    { period_start: '2026-12-01', period_end: '2026-12-26' },
  ], '2026-08-16');
  assert.equal(r.start, '2026-08-01');
  assert.equal(r.end, '2026-12-31');
  assert.equal(r.days, 153);
});

test('timelineRange: 今日が期間の外でも必ず含める（いまここの線を出すため）', () => {
  const r = timelineRange([{ period_start: '2026-01-05', period_end: '2026-01-20' }], '2026-08-16');
  assert.equal(r.start, '2026-01-01');
  assert.equal(r.end, '2026-08-31');
});

test('timelineRange: 期日を持つ目標が無ければ null', () => {
  assert.equal(timelineRange([], '2026-08-16'), null);
  assert.equal(timelineRange([{ title: 'ひづけなし' }], '2026-08-16'), null);
});

test('monthTicks: 月ごとに割れ、幅の合計が100%になる', () => {
  const r = timelineRange([{ period_start: '2026-08-01', period_end: '2026-12-31' }], '2026-08-16');
  const ticks = monthTicks(r);
  assert.equal(ticks.length, 5);
  assert.deepEqual(ticks.map((t) => t.label), ['8月', '9月', '10月', '11月', '12月']);
  assert.equal(ticks[0].leftPct, 0);
  const total = ticks.reduce((s, t) => s + t.widthPct, 0);
  assert.ok(Math.abs(total - 100) < 0.001, `合計 ${total}`);
});

test('monthTicks: 1月は年を添える（年またぎで迷子にならない）', () => {
  const r = timelineRange([{ period_start: '2026-12-01', period_end: '2027-01-31' }], '2026-12-01');
  assert.deepEqual(monthTicks(r).map((t) => t.label), ['12月', '2027年1月']);
});

test('barSpan: 範囲を1日ぶんずつ数える', () => {
  const r = timelineRange([{ period_start: '2026-08-01', period_end: '2026-08-31' }], '2026-08-01');
  assert.equal(r.days, 31);
  const s = barSpan('2026-08-01', '2026-08-31', r);
  assert.equal(s.leftPct, 0);
  assert.equal(s.widthPct, 100);
});

test('barSpan: はみ出す分は切り詰める', () => {
  const r = timelineRange([{ period_start: '2026-08-01', period_end: '2026-08-31' }], '2026-08-01');
  const s = barSpan('2026-07-01', '2026-09-30', r);
  assert.equal(s.leftPct, 0);
  assert.equal(s.widthPct, 100);
});

test('barSpan: 期日だけ／開始だけでも描ける（幅は最低1日）', () => {
  const r = timelineRange([{ period_start: '2026-08-01', period_end: '2026-08-31' }], '2026-08-01');
  const only = barSpan(null, '2026-08-16', r);
  assert.ok(only.widthPct > 0);
  assert.ok(Math.abs(only.leftPct - (15 / 31) * 100) < 0.001);
});

test('barSpan: 範囲外なら null（描かない）', () => {
  const r = timelineRange([{ period_start: '2026-08-01', period_end: '2026-08-31' }], '2026-08-01');
  assert.equal(barSpan('2026-09-01', '2026-09-30', r), null);
  assert.equal(barSpan(null, null, r), null);
  assert.equal(barSpan('2026-08-01', '2026-08-31', null), null);
});

test('todayPct: 範囲外なら線を出さない', () => {
  const r = timelineRange([{ period_start: '2026-08-01', period_end: '2026-08-31' }], '2026-08-16');
  assert.ok(Math.abs(todayPct(r, '2026-08-16') - (15 / 31) * 100) < 0.001);
  assert.equal(todayPct(r, '2026-07-31'), null);
  assert.equal(todayPct(null, '2026-08-16'), null);
});
