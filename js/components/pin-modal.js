// =====================================================================
// pin-modal.js — PIN の入力/設定モーダル
//
// 自前テンキーを使う理由: <input type="number"> だとスマホでキーボードが
// せり上がり、モーダルが隠れる。72px 角のキーなら誤タップも減る。
// =====================================================================
import { modal, esc, vibrate } from './../ui.js';
import * as Pin from './../pin.js';
import * as Auth from './../auth.js';
import * as Store from './../store.js';

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

function padHTML() {
  return `<div class="pin-pad">${PAD_KEYS.map((k) =>
    k === ''
      ? '<button type="button" class="pin-key pin-key--blank" tabindex="-1" aria-hidden="true"></button>'
      : `<button type="button" class="pin-key" data-key="${esc(k)}"
           aria-label="${k === '⌫' ? '1文字消す' : k}">${esc(k)}</button>`
  ).join('')}</div>`;
}

function dotsHTML(n) {
  return `<div class="pin-dots">${[0, 1, 2, 3].map((i) =>
    `<span class="pin-dot ${i < n ? 'pin-dot--on' : ''}"></span>`).join('')}</div>`;
}

/**
 * PIN 入力用の共通シェル。
 * @param {string} title
 * @param {string} subtitle
 * @param {(pin:string)=>Promise<{ok:boolean,message?:string}>} onComplete
 * @param {string} footerHTML
 * @returns {Promise<boolean>} 成功したら true
 */
function pinShell(title, subtitle, onComplete, footerHTML = '') {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };

    const m = modal(`
      <p class="modal__title">🔒 ${esc(title)}</p>
      <p style="text-align:center;color:var(--text-sub);font-size:var(--fs-sm)">${esc(subtitle)}</p>
      <div data-dots>${dotsHTML(0)}</div>
      <p class="pin-error" data-error></p>
      ${padHTML()}
      <div style="margin-top:var(--sp-3);text-align:center">${footerHTML}</div>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost btn--block" data-act="cancel">やめる</button>
      </div>
    `, { onClose: () => finish(false) });

    const dots = m.box.querySelector('[data-dots]');
    const err = m.box.querySelector('[data-error]');
    let buf = '';
    let busy = false;

    const paint = () => { dots.innerHTML = dotsHTML(buf.length); };

    const fail = (message) => {
      err.textContent = message;
      m.box.classList.add('shake');
      vibrate([30, 40, 30]);
      setTimeout(() => m.box.classList.remove('shake'), 420);
      buf = '';
      paint();
    };

    const press = async (key) => {
      if (busy) return;
      err.textContent = '';
      if (key === '⌫') { buf = buf.slice(0, -1); paint(); return; }
      if (buf.length >= 4) return;
      buf += key;
      paint();
      vibrate(8);

      if (buf.length === 4) {
        busy = true;
        const pin = buf;
        try {
          const res = await onComplete(pin);
          if (res.ok) { finish(true); m.close(); return; }
          fail(res.message || 'ちがうみたいです');
        } catch (e) {
          fail(e.message || 'エラーが起きました');
        } finally {
          busy = false;
        }
      }
    };

    m.box.addEventListener('click', (ev) => {
      const keyBtn = ev.target.closest('[data-key]');
      if (keyBtn) { press(keyBtn.dataset.key); return; }
      if (ev.target.closest('[data-act="cancel"]')) { finish(false); m.close(); return; }
      const forgot = ev.target.closest('[data-act="forgot"]');
      if (forgot) {
        finish(false);
        m.close();
        recoverPin();
      }
    });

    // 物理キーボードでも打てるように
    const onKey = (ev) => {
      if (/^\d$/.test(ev.key)) press(ev.key);
      else if (ev.key === 'Backspace') press('⌫');
    };
    document.addEventListener('keydown', onKey);
    const origClose = m.close;
    m.close = () => { document.removeEventListener('keydown', onKey); origClose(); };
  });
}

/** PIN を新規設定する（2回入力で確認） */
export async function setupPin() {
  let first = '';
  const step1 = await pinShell(
    '安心番号を決める',
    'おとなモードに入るための4けたの番号です',
    async (pin) => { first = pin; return { ok: true }; },
  );
  if (!step1) return false;

  const step2 = await pinShell(
    'もう一度',
    '確認のため、同じ番号をもう一度',
    async (pin) => {
      if (pin !== first) return { ok: false, message: '番号が一致しません。最初からやり直してください' };
      await Pin.setPin(pin);
      return { ok: true };
    },
  );
  return step2;
}

/**
 * おとなモードに入るための PIN 入力。
 * 未設定なら設定フローに回す。
 * @returns {Promise<boolean>}
 */
export async function requestUnlock() {
  if (Store.get('role') !== 'parent') return false;
  if (Pin.isUnlocked()) return true;

  const exists = await Pin.hasPin();
  if (!exists) return setupPin();

  return pinShell(
    'おとなモード',
    '4けたの番号をいれてください',
    async (pin) => {
      const res = await Pin.verifyPin(pin);
      if (res.ok) return { ok: true };
      if (res.reason === 'locked') {
        return { ok: false, message: `しばらく待ってください（あと${res.wait}秒）` };
      }
      if (res.reason === 'no_pin') return { ok: false, message: '番号が設定されていません' };
      return {
        ok: false,
        message: res.left > 0 ? `ちがいます（あと${res.left}回）` : 'ちがいます',
      };
    },
    '<button type="button" class="btn btn--ghost btn--sm" data-act="forgot">番号を忘れた場合</button>',
  );
}

/**
 * PIN 忘れのリカバリ。
 *
 * ログインが Google のみになったので、本人確認は
 * 「Google でログインし直してもらう」に置き換えた。
 * prompt=login を付けるため、端末に Google のセッションが残っていても
 * Google 側でパスワードの再入力が必ず求められる。
 * ＝ 親のログイン済み端末を娘が触っても、ここは通れない。
 *
 * Google へ遷移して戻ってくる間にこの画面は失われるので、
 * 印を sessionStorage に置き、app.js の起動処理で拾って再設定へ進む。
 * （PIN の平文はどこにも保存していないので「思い出させる」ことはできない）
 */
export async function recoverPin() {
  const email = Store.get('user')?.email || '';
  return new Promise((resolve) => {
    const m = modal(`
      <p class="modal__title">番号のリセット</p>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-3)">
        <b>${esc(email)}</b> で Google にログインし直して本人確認をします。
        確認できたら、そのまま新しい番号を決められます。
      </p>
      <p class="pin-error" data-error></p>
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-act="cancel">やめる</button>
        <button type="button" class="btn btn--primary" data-act="ok">Google で確認する</button>
      </div>
    `, { onClose: () => resolve(false) });

    const err = m.box.querySelector('[data-error]');
    m.box.addEventListener('click', async (ev) => {
      if (ev.target.closest('[data-act="cancel"]')) { m.close(); return; }
      const ok = ev.target.closest('[data-act="ok"]');
      if (!ok) return;

      ok.disabled = true;
      err.textContent = '';
      try {
        Auth.beginPinReauth();
        // 成功するとページごと Google へ遷移する（ここには戻ってこない）
        await Auth.signInWithGoogle({ forceReauth: true });
      } catch (e) {
        err.textContent = e.message || '確認に失敗しました';
        ok.disabled = false;
      }
    });
  });
}
