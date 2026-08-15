// =====================================================================
// db.js — Supabase テーブルアクセスの単一窓口
//
// 約束: このファイルと config / auth / sync / photos 以外から
//       supabase を import しない。views は必ずここを通す。
//
// ★デリケートな3テーブル（idol_audition_results / idol_body_records /
//   idol_parent_pins）は localStorage にキャッシュしない。必ず都度取得する。
// =====================================================================
import { supabase } from './config.js';
import * as Store from './store.js';
import * as LS from './storage.js';
import { jstToday, friendlyError } from './format.js';

const fam = () => Store.get('family')?.id;
const uid = () => Store.get('user')?.id;

/**
 * Supabase のエラーをここで1回だけ日本語に変える。
 * views は素の e.message を toast に流しているので、
 * ここを通しておけば全画面が同時に直る。
 * 生のメッセージは原因調査のためコンソールにだけ残す。
 */
function guard(error) {
  if (!error) return;
  console.error('[db]', error.message, error);
  throw new Error(friendlyError(error.message));
}

// =====================================================================
// 練習メニュー
// =====================================================================
export async function listMenus() {
  const { data, error } = await supabase
    .from('idol_practice_menus').select('*')
    .eq('family_id', fam()).is('deleted_at', null).eq('is_active', true)
    .order('sort_order');
  guard(error);
  return data || [];
}

export async function upsertMenu(menu) {
  const row = { ...menu, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_practice_menus').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeleteMenu(id) {
  const { error } = await supabase
    .from('idol_practice_menus')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id);
  guard(error);
}

// =====================================================================
// 練習記録
// =====================================================================

/** その日のログ（なければ作る）。1人1日1行なので onConflict で衝突を吸収する */
export async function ensureLog(dateKey = jstToday(), subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase
    .from('idol_practice_logs')
    .upsert({ family_id: fam(), subject_user_id: subject, log_date: dateKey },
            { onConflict: 'subject_user_id,log_date', ignoreDuplicates: false })
    .select().maybeSingle();
  guard(error);
  return data;
}

export async function getLog(dateKey = jstToday(), subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase
    .from('idol_practice_logs').select('*')
    .eq('subject_user_id', subject).eq('log_date', dateKey).is('deleted_at', null)
    .maybeSingle();
  guard(error);
  return data;
}

export async function listLogs({ from, to, subjectId = null } = {}) {
  const subject = subjectId || Store.get('talentId') || uid();
  let q = supabase.from('idol_practice_logs').select('*')
    .eq('subject_user_id', subject).is('deleted_at', null)
    .order('log_date', { ascending: false });
  if (from) q = q.gte('log_date', from);
  if (to) q = q.lte('log_date', to);
  const { data, error } = await q;
  guard(error);
  return data || [];
}

export async function updateLog(id, patch) {
  const { data, error } = await supabase
    .from('idol_practice_logs').update(patch).eq('id', id).select().maybeSingle();
  guard(error);
  return data;
}

export async function listLogItems(logId) {
  const { data, error } = await supabase
    .from('idol_practice_log_items').select('*').eq('log_id', logId).order('created_at');
  guard(error);
  return data || [];
}

/**
 * メニューのチェックをつけ外しする。
 * unique(log_id, menu_id) があるので upsert で冪等に扱える。
 */
export async function setLogItem({ logId, menu, done, minutes, memo = '' }) {
  const row = {
    family_id: fam(),
    log_id: logId,
    menu_id: menu.id,
    menu_name: menu.name,          // メニューを消しても履歴が壊れないようスナップショット
    done,
    minutes: done ? (minutes ?? menu.default_minutes) : 0,
    points: done ? menu.points : 0, // 付与時点のポイントを固定
    memo,
  };
  const { data, error } = await supabase
    .from('idol_practice_log_items')
    .upsert(row, { onConflict: 'log_id,menu_id' })
    .select().maybeSingle();
  guard(error);
  return data;
}

/** 連続日数・合計（サーバーのビューが正） */
export async function getStreak(subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase
    .from('v_idol_streaks').select('*').eq('subject_user_id', subject).maybeSingle();
  guard(error);
  return data || { current_streak: 0, best_streak: 0, total_days: 0, practiced_today: false };
}

export async function getPoints(subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase
    .from('v_idol_points').select('*').eq('user_id', subject).maybeSingle();
  guard(error);
  return data || { earned_points: 0, spent_points: 0, balance_points: 0 };
}

/** ホーム用のまとめ取得（往復を減らす） */
export async function homeSummary(subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase.rpc('idol_home_summary', { p_user_id: subject });
  guard(error);
  return data || {};
}

// =====================================================================
// 目標
// =====================================================================
export async function listGoals() {
  const { data, error } = await supabase
    .from('idol_goals').select('*')
    .eq('family_id', fam()).is('deleted_at', null)
    .order('level').order('sort_order');
  guard(error);
  return data || [];
}

export async function upsertGoal(goal) {
  const row = { ...goal, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_goals').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeleteGoal(id) {
  const { error } = await supabase
    .from('idol_goals').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  guard(error);
}

export async function seedRoadmap() {
  const { data, error } = await supabase.rpc('idol_seed_roadmap',
    { p_owner_user_id: Store.get('talentId') });
  guard(error);
  return data;
}

// =====================================================================
// オーディション / レッスン
// =====================================================================
export async function listAuditions() {
  const { data, error } = await supabase
    .from('idol_auditions').select('*')
    .eq('family_id', fam()).is('deleted_at', null)
    .order('apply_deadline', { ascending: true, nullsFirst: false });
  guard(error);
  return data || [];
}

export async function upsertAudition(a) {
  const row = { ...a, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_auditions').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeleteAudition(id) {
  const { error } = await supabase
    .from('idol_auditions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  guard(error);
}

/** ★親限定。子アカウントでは常に null が返る（RLS） */
export async function getAuditionResult(auditionId) {
  const { data, error } = await supabase
    .from('idol_audition_results').select('*').eq('audition_id', auditionId).maybeSingle();
  if (error && error.code !== 'PGRST116') guard(error);
  return data || null;
}

/** ★親限定 */
export async function upsertAuditionResult(result) {
  const row = { ...result, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_audition_results').upsert(row, { onConflict: 'audition_id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function listAuditionTasks(auditionId) {
  const { data, error } = await supabase
    .from('idol_audition_tasks').select('*').eq('audition_id', auditionId).order('sort_order');
  guard(error);
  return data || [];
}

export async function upsertAuditionTask(task) {
  const row = { ...task, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_audition_tasks').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function deleteAuditionTask(id) {
  const { error } = await supabase.from('idol_audition_tasks').delete().eq('id', id);
  guard(error);
}

export async function listLessons({ from, to } = {}) {
  let q = supabase.from('idol_lessons').select('*')
    .eq('family_id', fam()).is('deleted_at', null)
    .order('lesson_date', { ascending: false });
  if (from) q = q.gte('lesson_date', from);
  if (to) q = q.lte('lesson_date', to);
  const { data, error } = await q;
  guard(error);
  return data || [];
}

export async function upsertLesson(l) {
  const row = { ...l, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_lessons').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeleteLesson(id) {
  const { error } = await supabase
    .from('idol_lessons').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  guard(error);
}

/** カレンダー（締切・本番・書類期限・レッスンの統合ビュー） */
export async function listCalendar(from, to) {
  const { data, error } = await supabase
    .from('v_idol_calendar').select('*')
    .eq('family_id', fam()).gte('on_date', from).lte('on_date', to)
    .order('on_date');
  guard(error);
  return data || [];
}

// =====================================================================
// 成長の記録 / 身体記録
// =====================================================================
export async function listPortfolio({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('idol_portfolio_entries').select('*')
    .eq('family_id', fam()).is('deleted_at', null)
    .order('entry_date', { ascending: false }).limit(limit);
  guard(error);
  return data || [];
}

export async function upsertPortfolio(entry) {
  const row = { ...entry, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_portfolio_entries').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeletePortfolio(id) {
  const { error } = await supabase
    .from('idol_portfolio_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  guard(error);
}

/** ★親限定（visible_to_child の行だけ子にも見える）。キャッシュ禁止 */
export async function listBodyRecords(subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase
    .from('idol_body_records').select('*')
    .eq('subject_user_id', subject).is('deleted_at', null)
    .order('measured_on');
  guard(error);
  return data || [];
}

/** ★親限定 */
export async function upsertBodyRecord(rec) {
  const row = { ...rec, family_id: fam(), subject_user_id: rec.subject_user_id || Store.get('talentId') };
  const { data, error } = await supabase
    .from('idol_body_records').upsert(row, { onConflict: 'subject_user_id,measured_on' })
    .select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeleteBodyRecord(id) {
  const { error } = await supabase
    .from('idol_body_records').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  guard(error);
}

// =====================================================================
// 応援メッセージ / ごほうび / バッジ
// =====================================================================
export async function listCheers({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('idol_cheer_messages').select('*')
    .eq('family_id', fam())
    .order('created_at', { ascending: false }).limit(limit);
  guard(error);
  return data || [];
}

export async function addCheer({ practiceLogId = null, portfolioEntryId = null, goalId = null, body = '', reaction = null }) {
  const row = {
    family_id: fam(),
    author_user_id: uid(),
    practice_log_id: practiceLogId,
    portfolio_entry_id: portfolioEntryId,
    goal_id: goalId,
    body,
    reaction,
  };
  const { data, error } = await supabase
    .from('idol_cheer_messages').insert(row).select().maybeSingle();
  guard(error);
  return data;
}

export async function markCheersRead(ids) {
  if (!ids?.length) return;
  const { error } = await supabase
    .from('idol_cheer_messages').update({ is_read: true }).in('id', ids);
  guard(error);
}

/**
 * 自分あての未読件数。ナビのバッジに出す。
 * 「自分が書いたもの」は数えない（自分の投稿で自分に通知が付くのは無意味）。
 * head: true で件数だけ取り、本文は転送しない（起動のたびに叩くので軽くする）。
 */
export async function countUnreadCheers() {
  const { count, error } = await supabase
    .from('idol_cheer_messages')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', fam())
    .eq('is_read', false)
    .neq('author_user_id', uid());
  guard(error);
  return count || 0;
}

export async function deleteCheer(id) {
  const { error } = await supabase.from('idol_cheer_messages').delete().eq('id', id);
  guard(error);
}

/** 応援メッセージのリアルタイム購読（ママのコメントが娘の画面に即出る） */
export function subscribeCheers(onInsert) {
  const familyId = fam();
  if (!familyId) return () => {};
  const channel = supabase
    .channel('idol-cheers-' + familyId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'idol_cheer_messages', filter: `family_id=eq.${familyId}` },
      (payload) => onInsert(payload.new))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function listRewards() {
  const { data, error } = await supabase
    .from('idol_rewards').select('*')
    .eq('family_id', fam()).is('deleted_at', null)
    .order('sort_order');
  guard(error);
  return data || [];
}

export async function upsertReward(r) {
  const row = { ...r, family_id: fam() };
  const { data, error } = await supabase
    .from('idol_rewards').upsert(row, { onConflict: 'id' }).select().maybeSingle();
  guard(error);
  return data;
}

/** 子が「これ交換したい」を押す */
export async function requestReward(id) {
  const { data, error } = await supabase
    .from('idol_rewards')
    .update({ status: 'requested', requested_at: new Date().toISOString() })
    .eq('id', id).select().maybeSingle();
  guard(error);
  return data;
}

/** 親が承認する（トリガーで親以外は弾かれる） */
export async function redeemReward(id) {
  const { data, error } = await supabase
    .from('idol_rewards')
    .update({ status: 'redeemed', redeemed_at: new Date().toISOString(), approved_by: uid() })
    .eq('id', id).select().maybeSingle();
  guard(error);
  return data;
}

export async function softDeleteReward(id) {
  const { error } = await supabase
    .from('idol_rewards').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  guard(error);
}

export async function listBadges(subjectId = null) {
  const subject = subjectId || Store.get('talentId') || uid();
  const { data, error } = await supabase
    .from('idol_earned_badges').select('*').eq('user_id', subject).order('earned_on');
  guard(error);
  return data || [];
}

/** バッジを付与する。unique(user_id, badge_key) があるので重複は握りつぶす */
export async function grantBadges(keys, subjectId = null) {
  if (!keys?.length) return [];
  const subject = subjectId || Store.get('talentId') || uid();
  const rows = keys.map((k) => ({ family_id: fam(), user_id: subject, badge_key: k }));
  const { data, error } = await supabase
    .from('idol_earned_badges').upsert(rows, { onConflict: 'user_id,badge_key', ignoreDuplicates: true })
    .select();
  if (error) { console.warn('[db] バッジ付与に失敗', error.message); return []; }
  return data || [];
}

// =====================================================================
// キャッシュ付き取得（起動を速くする）
//   1. localStorage のキャッシュを即返す
//   2. 裏でサーバーから取り直し、差があれば onFresh で通知
// =====================================================================
export function cachedList(table, fetcher, onFresh) {
  const familyId = fam();
  const cached = familyId ? LS.readTable(familyId, table) : [];
  Promise.resolve()
    .then(fetcher)
    .then((rows) => {
      if (familyId) LS.writeTable(familyId, table, rows);
      onFresh?.(rows);
    })
    .catch((e) => console.warn(`[db] ${table} の取得に失敗（キャッシュを表示中）`, e.message));
  return cached;
}
