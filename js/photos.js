// =====================================================================
// photos.js — 写真の圧縮 → Storage アップロード → 署名付きURL
//
// ★署名付きURLは DB にも localStorage にも保存しない。
//   期限切れ画像の温床になるうえ、URL自体が事実上のアクセス権になるため。
//   メモリ Map に有効期限つきでキャッシュし、都度発行する。
// ★動画はアップロードしない。YouTube 限定公開などの URL を記録するだけ。
// =====================================================================
import { supabase, BUCKET } from './config.js';
import * as Store from './store.js';

const MAX_INPUT_BYTES = 20 * 1024 * 1024;   // 20MB を超える入力は受け付けない

/**
 * Canvas でリサイズ・再圧縮する。
 * createImageBitmap の imageOrientation:'from-image' で EXIF 回転を吸収する
 * （iPhone の縦写真が横向きになる事故を防ぐ）。
 */
export async function compressImage(file, { maxEdge = 1600, quality = 0.82 } = {}) {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('写真が大きすぎます（20MBまで）');
  }
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  // WebP 非対応環境（古い Safari）は JPEG にフォールバック
  const type = canvas.toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
  if (!blob) throw new Error('画像の変換に失敗しました');
  return { blob, width: w, height: h, type };
}

/** パス規約: {family_id}/{kind}/{yyyy}/{uuid}.{ext} */
export function buildPath(kind, ext = 'webp') {
  const familyId = Store.get('family')?.id;
  if (!familyId) throw new Error('家族に所属していません');
  const year = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 4);
  return `${familyId}/${kind}/${year}/${crypto.randomUUID()}.${ext}`;
}

/**
 * 圧縮してアップロードし、保存すべきパスを返す。
 * @param {File} file
 * @param {'portfolio'|'practice'|'avatar'|'docs'|'private'} kind
 * @returns {Promise<{path:string,width:number,height:number,bytes:number,type:string}>}
 */
export async function uploadPhoto(file, kind = 'portfolio') {
  const { blob, width, height, type } = await compressImage(file);
  const ext = type === 'image/webp' ? 'webp' : 'jpg';
  const path = buildPath(kind, ext);

  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: type, upsert: false, cacheControl: '3600' });
  if (error) throw new Error(error.message);

  return { path, width, height, bytes: blob.size, type };
}

// ── 署名付きURL（メモリキャッシュ）──────────────────
const urlCache = new Map();   // path -> { url, expAt }

export async function getPhotoUrl(path, { expiresIn = 3600 } = {}) {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expAt > Date.now()) return hit.url;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) { console.warn('[photos] 署名URLの発行に失敗', path, error.message); return null; }
  urlCache.set(path, { url: data.signedUrl, expAt: Date.now() + expiresIn * 800 });
  return data.signedUrl;
}

/** 一覧描画用。1回のAPI呼び出しでまとめて発行する（N+1回避） */
export async function getPhotoUrls(paths, { expiresIn = 3600 } = {}) {
  const list = [...new Set((paths || []).filter(Boolean))];
  const need = list.filter((p) => !(urlCache.get(p)?.expAt > Date.now()));
  if (need.length) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(need, expiresIn);
    if (error) console.warn('[photos] 署名URLの一括発行に失敗', error.message);
    for (const d of data || []) {
      if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, expAt: Date.now() + expiresIn * 800 });
    }
  }
  return Object.fromEntries(list.map((p) => [p, urlCache.get(p)?.url || null]));
}

/** Storage の実体を消す（DB行の削除とセットで呼ぶこと。孤児ファイルを残さない） */
export async function deletePhotos(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(list);
  if (error) console.warn('[photos] 削除に失敗（孤児ファイルの可能性）', error.message);
  list.forEach((p) => urlCache.delete(p));
}

/** 施錠時に、親限定領域の署名URLをメモリから捨てる */
window.addEventListener('idol:locked', () => {
  for (const key of urlCache.keys()) {
    if (key.includes('/private/')) urlCache.delete(key);
  }
});

/** <img> に遅延読み込みで流し込む */
export function bindLazyImage(imgEl, path) {
  if (!path) return;
  const io = new IntersectionObserver(async (entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const url = await getPhotoUrl(path);
    if (url) imgEl.src = url;
  }, { rootMargin: '200px' });
  io.observe(imgEl);
}
