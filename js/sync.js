// =====================================================================
// sync.js — 差分同期 + オフライン書き込みキュー（outbox）
//
// 原則:
//   Supabase が source of truth。localStorage は「起動を速くするキャッシュ」と
//   「圏外での書き込みバッファ」でしかない。
//
// 差分同期が成り立つ前提:
//   ・全テーブルに updated_at（トリガーで自動更新）
//   ・主要テーブルに deleted_at（トゥームストーン）
//     ★これがないと、削除された行がキャッシュに残り続け
//       「消したはずの記録が復活する」という定番の事故が起きる。
//
// 競合解決は Last-Write-Wins。親子2人・端末数台なので CRDT 等は完全に過剰。
// =====================================================================
import { supabase } from './config.js';
import * as Store from './store.js';
import * as LS from './storage.js';
import { toast } from './ui.js';

/** upsert の衝突キー（複合ユニークがあるテーブルはそれを使う） */
const CONFLICT_KEY = {
  idol_practice_logs: 'subject_user_id,log_date',
  idol_practice_log_items: 'log_id,menu_id',
  idol_body_records: 'subject_user_id,measured_on',
  idol_earned_badges: 'user_id,badge_key',
};

/**
 * サーバーから差分を取り込み、localStorage キャッシュを更新する。
 * 起動時とフォアグラウンド復帰時に呼ぶ。
 */
export async function pullDelta() {
  const familyId = Store.get('family')?.id;
  if (!familyId || !navigator.onLine) return;

  const meta = LS.readMeta(familyId);
  meta.lastSyncAt = meta.lastSyncAt || {};

  for (const table of LS.SYNC_TABLES) {
    const since = meta.lastSyncAt[table] || '1970-01-01T00:00:00Z';
    // RLS が family を絞ってくれるが、.eq を付けるとインデックスが効く
    const { data, error } = await supabase
      .from(table).select('*')
      .eq('family_id', familyId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(1000);

    if (error) { console.warn('[sync] 差分取得に失敗', table, error.message); continue; }
    if (!data?.length) continue;

    const cache = LS.readTable(familyId, table);
    const byId = new Map(cache.map((r) => [r.id, r]));
    for (const row of data) {
      if (row.deleted_at) byId.delete(row.id);   // トゥームストーンで削除を反映
      else byId.set(row.id, row);
    }
    LS.writeTable(familyId, table, [...byId.values()]);
    meta.lastSyncAt[table] = data[data.length - 1].updated_at;
  }

  LS.writeMeta(familyId, meta);
}

/**
 * オフラインでも失われない書き込み。
 * ・ID はクライアント採番 → 何度リトライしても upsert が冪等になる
 * ・先にキャッシュを更新して UI を進める（楽観更新）
 */
export function queueMutation(table, op, payload) {
  const familyId = Store.get('family')?.id;
  if (!familyId) throw new Error('家族に所属していません');

  const row = { ...payload, family_id: familyId };
  if (op === 'insert' && !row.id) row.id = crypto.randomUUID();
  row.updated_at = new Date().toISOString();

  applyLocal(familyId, table, op, row);

  LS.pushOutbox({
    opId: crypto.randomUUID(),
    table, op, payload: row,
    ts: Date.now(), tries: 0,
  });

  if (navigator.onLine) flushOutbox().catch(() => {});
  return row;
}

/** キャッシュに即反映（画面を待たせない） */
function applyLocal(familyId, table, op, row) {
  const cache = LS.readTable(familyId, table);
  const i = cache.findIndex((r) => r.id === row.id);
  if (op === 'delete') {
    if (i >= 0) cache.splice(i, 1);
  } else if (i >= 0) {
    cache[i] = { ...cache[i], ...row };
  } else {
    cache.push(row);
  }
  LS.writeTable(familyId, table, cache);
}

let flushing = false;

/** 未送信ぶんを順に送る。恒久的に通らないものは捨ててユーザーに知らせる */
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return;
  const jobs = LS.readOutbox();
  if (!jobs.length) return;

  flushing = true;
  const remain = [];
  let failed = 0;

  try {
    for (const job of jobs) {
      try {
        if (job.op === 'delete') {
          const { error } = await supabase.from(job.table)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', job.payload.id);
          if (error) throw error;
        } else {
          const onConflict = CONFLICT_KEY[job.table] || 'id';
          const { error } = await supabase.from(job.table)
            .upsert(job.payload, { onConflict });
          if (error) throw error;
        }
      } catch (e) {
        job.tries = (job.tries || 0) + 1;
        const code = String(e.code || '');
        // 42501=RLS違反 / 23514=CHECK違反 / 23503=FK違反 は何度やっても通らない
        const permanent = /^(42501|23514|23503)$/.test(code);
        if (permanent || job.tries > 5) {
          failed++;
          console.error('[sync] 送信をあきらめました', job.table, e.message || e);
        } else {
          remain.push(job);
        }
      }
    }
  } finally {
    LS.writeOutbox(remain);
    flushing = false;
  }

  if (failed) toast(`${failed}件の変更を送信できませんでした`, 'error');
  if (remain.length === 0 && jobs.length > 0) await pullDelta();
}

/** 未送信件数（UIのバッジ用） */
export function pendingCount() {
  return LS.readOutbox().length;
}
