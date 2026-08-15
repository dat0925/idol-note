// =====================================================================
// hero-picker.js — 背景イラストを選ぶモーダル
//
// ホームの中に置いていたが、ヘッダからも開けるようにしたので切り出した。
//
// ★ボトムナビには入れない。
//   ナビは「場所」を並べる所であって「操作」を置く所ではない。
//   応援を足すとナビは5つになり、そこに背景を足すと6つ＝
//   390px の画面で1つ65px、ラベルが潰れる。
//   しかも背景えらびは最初こそ楽しいが、後半はほとんど押されない操作なので、
//   一等地を渡すには釣り合わない。ヘッダのアイコンに置いた。
// =====================================================================
import * as Stage from './stage.js';
import { icon } from './../icons.js';
import { esc, modal, vibrate } from './../ui.js';

/**
 * @param {() => void} [onPick] 選び終わったあとに呼ぶ（呼び元の再描画用）
 */
export function openHeroPicker(onPick) {
  const now = Stage.currentHero();
  const m = modal(`
    <p class="modal__title">${icon('image', { size: 20 })} 背景を選ぶ</p>
    <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--sp-3)">
      横にスワイプすると、ほかの絵が出てきます。
    </p>
    <div class="hero-pick" role="radiogroup" aria-label="背景のイラスト">
      ${Stage.HEROES.map((id) => `
        <button type="button" class="hero-pick__item${id === now ? ' is-on' : ''}"
                role="radio" aria-checked="${id === now}"
                data-hero="${id}" aria-label="イラスト${id}">
          <img src="${esc(Stage.heroThumb(id))}" alt="" loading="lazy" decoding="async">
        </button>`).join('')}
    </div>
    <div class="modal__actions">
      <button type="button" class="btn btn--outline" data-act="close">閉じる</button>
    </div>
  `);

  // 今えらんでいる絵が画面外にあると「1枚しかない」と誤解されるので寄せておく
  m.box.querySelector('.hero-pick__item.is-on')
    ?.scrollIntoView({ block: 'nearest', inline: 'center' });

  m.box.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="close"]')) { m.close(); return; }
    const btn = ev.target.closest('[data-hero]');
    if (!btn) return;
    Stage.setHero(Number(btn.dataset.hero));
    vibrate(10);
    // 選んだら閉じる。背景が見たくて開いているので、居座らせない
    m.close();
    onPick?.();
  });
}
