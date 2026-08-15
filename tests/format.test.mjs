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
  esc, newBadges,
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
