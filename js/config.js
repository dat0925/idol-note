// =====================================================================
// Supabase クライアント
//
// ★このプロジェクトは taskra と同じ Supabase プロジェクトに相乗りしている。
//   テーブル名はすべて idol_ 接頭辞で衝突を避けている。
// ★anon key はブラウザに露出している前提で設計している。
//   本当の防御線は RLS（supabase/migrations/*.sql）であり、
//   「フロントから直接呼ばない＝安全」ではない。
// ★storageKey を 'idol-auth' にして、同一 Supabase プロジェクトを使う
//   taskra とセッションが混ざらないようにしている。
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://sfhtvtcmgueystyuhzvd.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaHR2dGNtZ3VleXN0eXVoenZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3Nzg0MDYsImV4cCI6MjA5MDM1NDQwNn0.qsON2xYdDf22LtU-jGd96Ubaif0xzzswC9KnzWndKNw';

export const BUCKET = 'idol-media';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'idol-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
