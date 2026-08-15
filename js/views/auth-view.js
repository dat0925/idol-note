// =====================================================================
// auth-view.js — ログイン / 新規登録 / 家族の作成・参加
//
// #/login  #/signup  #/join  #/setup をすべてこの1枚で扱う。
// 親は「家族をつくる」、娘は「招待コードで参加」。
// =====================================================================
import * as Auth from './../auth.js';
import * as Store from './../store.js';
import * as Router from './../router.js';
import * as Nav from './../components/nav.js';
import { esc, toast } from './../ui.js';

let root = null;

function shell(inner) {
  return `<div style="max-width:420px;margin:var(--sp-6) auto">
    <div style="text-align:center;margin-bottom:var(--sp-5)">
      <div style="font-size:56px;line-height:1">⭐</div>
      <h1 style="font-size:var(--fs-xl);font-weight:800">アイドルノート</h1>
      <p style="color:var(--text-sub);font-size:var(--fs-sm)">
        なりたい自分に、まいにち一歩ずつ。
      </p>
    </div>
    <div class="card">${inner}</div>
  </div>`;
}

function loginForm() {
  return shell(`
    <h2 class="card__title">ログイン</h2>
    <form data-form="login" novalidate>
      <label class="field">
        <span class="field__label">メールアドレス</span>
        <input class="input" type="email" name="email" autocomplete="username" required>
      </label>
      <label class="field">
        <span class="field__label">パスワード</span>
        <input class="input" type="password" name="password" autocomplete="current-password" required>
      </label>
      <p class="pin-error" data-error></p>
      <button class="btn btn--primary btn--block" type="submit">ログイン</button>
    </form>
    <div style="text-align:center;margin-top:var(--sp-4);display:grid;gap:var(--sp-2)">
      <a href="#/signup">アカウントをつくる</a>
      <button type="button" class="btn btn--ghost btn--sm" data-act="reset">パスワードを忘れた</button>
    </div>
  `);
}

function signupForm() {
  return shell(`
    <h2 class="card__title">アカウントをつくる</h2>
    <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-3)">
      おとなの方と、お子さんとで、それぞれ別のメールアドレスで登録してください。
    </p>
    <form data-form="signup" novalidate>
      <label class="field">
        <span class="field__label">メールアドレス</span>
        <input class="input" type="email" name="email" autocomplete="username" required>
      </label>
      <label class="field">
        <span class="field__label">パスワード</span>
        <input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required>
        <span class="field__hint">6文字以上</span>
      </label>
      <p class="pin-error" data-error></p>
      <button class="btn btn--primary btn--block" type="submit">登録する</button>
    </form>
    <div style="text-align:center;margin-top:var(--sp-4)">
      <a href="#/login">ログインにもどる</a>
    </div>
  `);
}

function setupForm() {
  return shell(`
    <h2 class="card__title">はじめの設定</h2>
    <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-4)">
      おとなの方は「家族をつくる」、お子さんは、おとなの方から聞いた
      <b>招待コード</b>で参加してください。
    </p>

    <details open style="margin-bottom:var(--sp-4)">
      <summary style="font-weight:800;cursor:pointer;padding:var(--sp-2) 0">👩 家族をつくる（おとな）</summary>
      <form data-form="create" novalidate style="padding-top:var(--sp-2)">
        <label class="field">
          <span class="field__label">家族の名前</span>
          <input class="input" name="familyName" value="わたしの家族">
        </label>
        <label class="field">
          <span class="field__label">あなたの呼び名</span>
          <input class="input" name="displayName" placeholder="ママ / パパ など" required>
        </label>
        <button class="btn btn--primary btn--block" type="submit">家族をつくる</button>
      </form>
    </details>

    <details>
      <summary style="font-weight:800;cursor:pointer;padding:var(--sp-2) 0">🎀 招待コードで参加（こども）</summary>
      <form data-form="join" novalidate style="padding-top:var(--sp-2)">
        <label class="field">
          <span class="field__label">招待コード</span>
          <input class="input" name="code" placeholder="8文字" style="text-transform:uppercase" required>
        </label>
        <label class="field">
          <span class="field__label">なまえ</span>
          <input class="input" name="displayName" placeholder="さくら" required>
        </label>
        <button class="btn btn--soft btn--block" type="submit">参加する</button>
      </form>
    </details>

    <p class="pin-error" data-error></p>
    <div style="text-align:center;margin-top:var(--sp-4)">
      <button type="button" class="btn btn--ghost btn--sm" data-act="signout">ログアウト</button>
    </div>
  `);
}

async function handleSubmit(ev) {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();

  const kind = form.dataset.form;
  const fd = Object.fromEntries(new FormData(form));
  const err = root.querySelector('[data-error]');
  const submit = form.querySelector('[type="submit"]');
  err.textContent = '';
  submit.disabled = true;

  try {
    if (kind === 'login') {
      await Auth.signIn(fd.email.trim(), fd.password);
      await afterAuth();
    } else if (kind === 'signup') {
      const res = await Auth.signUp(fd.email.trim(), fd.password);
      if (!res.session) {
        toast('確認メールを送りました。リンクを開いてからログインしてください', 'ok', 6000);
        Router.navigate('/login');
      } else {
        await afterAuth();
      }
    } else if (kind === 'create') {
      await Auth.createFamily(fd.familyName.trim(), fd.displayName.trim());
      await afterAuth();
      toast('家族をつくりました！設定画面から招待コードを確認できます', 'ok', 5000);
    } else if (kind === 'join') {
      await Auth.joinFamily(fd.code.trim().toUpperCase(), fd.displayName.trim(), true);
      await afterAuth();
      toast('参加しました！', 'ok');
    }
  } catch (e) {
    err.textContent = e.message || 'うまくいきませんでした';
  } finally {
    submit.disabled = false;
  }
}

async function afterAuth() {
  const status = await Auth.loadSession();
  Nav.renderAll();
  if (status === 'no-family') Router.navigate('/setup', { replace: true });
  else Router.navigate('/home', { replace: true });
}

export default {
  async mount(el) {
    root = el;
    const path = Store.get('route');

    if (path === '/setup') root.innerHTML = setupForm();
    else if (path === '/signup') root.innerHTML = signupForm();
    else root.innerHTML = loginForm();

    root.addEventListener('submit', handleSubmit);

    root.addEventListener('click', async (ev) => {
      if (ev.target.closest('[data-act="signout"]')) {
        await Auth.signOut();
        Router.navigate('/login', { replace: true });
        return;
      }
      if (ev.target.closest('[data-act="reset"]')) {
        const email = root.querySelector('input[name="email"]')?.value.trim();
        if (!email) { toast('先にメールアドレスを入力してください'); return; }
        try {
          await Auth.resetPassword(email);
          toast('再設定メールを送りました', 'ok', 5000);
        } catch (e) {
          toast(e.message || '送信に失敗しました', 'error');
        }
      }
    });
  },

  destroy() {
    root = null;
  },
};
