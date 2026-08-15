#!/usr/bin/env python3
"""背景イラストを WebP に変換して assets/ に置く。

    python tools/build-hero.py idleimage1.png idleimage2.png idleimage3.png

引数の順に idol-hero-1 / -2 / -3 … になる。
1枚につき2つ出力する。

    assets/idol-hero-N.webp        背景本体（長辺 920px）
    assets/idol-hero-N-thumb.webp  えらぶボタン用（長辺 220px）

なぜ変換するか:
  ・生成AIが出す PNG はたいてい 1〜3MB ある。娘は 4G のスマホで開くので、
    3枚そのまま置くと初回表示が目に見えて遅くなる。
  ・背景の表示幅は最大 460px（CSS 側）。Retina を考えても 920px で足りる。
    それ以上は転送量になるだけで、画面上の見た目は1ドットも変わらない。
  ・サムネを別に作るのは、えらぶボタンのために本体3枚を読ませないため。
  ・透過を保つ必要があるので JPEG は使えない。WebP を使う。

ビルドステップは無いので、これは「アセットを差し替えるときに手で叩く道具」。
生成物（assets/*.webp）はリポジトリにコミットする。
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

HERO_WIDTH = 920    # CSS の width: min(86vw, 460px) に対する2倍
THUMB_WIDTH = 220
QUALITY = 82

# 縁のなじませ（楕円フェード）。
# Image.radial_gradient は中心0・外周255 の距離マップを返す。
# FEATHER_IN までは完全に不透明、FEATHER_OUT で完全に透明にする。
#
# ★辺の中央は角より距離が小さく、この画像では約 181 だった。
#   FEATHER_OUT をそれ以下にしないと、角だけ落ちて直線の縁が残る。
FEATHER_IN = 120
FEATHER_OUT = 180

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets"


def has_alpha(im: Image.Image) -> bool:
    """実際に透明な画素があるか。白背景のまま貼られていないかの確認用。"""
    alpha = im.getchannel("A")
    return alpha.getextrema()[0] < 250


def feather(im: Image.Image) -> Image.Image:
    """外周を楕円状に透明へ落とす。

    生成AIの出力は「四角い絵」であることが多く、そのまま背景に置くと
    板が浮いて見える。背景に溶け込ませるために縁を飛ばす。

    ★もともと透過している画像には掛けない。
      すでに縁が抜けているので、重ねると人物まで削ってしまう。
    ★色を抜く方式（白を透明にする等）は採らない。
      衣装の白まで穴が開いて崩壊するため。
    """
    ramp = Image.radial_gradient("L").resize(im.size, Image.BILINEAR)
    span = FEATHER_OUT - FEATHER_IN
    ramp = ramp.point(lambda v: 255 if v <= FEATHER_IN
                      else 0 if v >= FEATHER_OUT
                      else int(255 * (FEATHER_OUT - v) / span))
    out = im.copy()
    out.putalpha(ImageChops.multiply(im.getchannel("A"), ramp))
    return out


def save(im: Image.Image, width: int, path: Path) -> None:
    out = im
    if im.width > width:
        h = round(im.height * width / im.width)
        out = im.resize((width, h), Image.LANCZOS)
    out.save(path, "WEBP", quality=QUALITY, method=6)


def main() -> int:
    srcs = sys.argv[1:]
    if not srcs:
        print(__doc__)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total_before = total_after = 0

    for i, raw in enumerate(srcs, start=1):
        src = Path(raw).expanduser()
        if not src.exists():
            print(f"見つかりません: {src}")
            return 1

        im = Image.open(src).convert("RGBA")
        was_flat = not has_alpha(im)
        if was_flat:
            im = feather(im)

        hero = OUT_DIR / f"idol-hero-{i}.webp"
        thumb = OUT_DIR / f"idol-hero-{i}-thumb.webp"
        save(im, HERO_WIDTH, hero)
        save(im, THUMB_WIDTH, thumb)

        before = src.stat().st_size
        after = hero.stat().st_size + thumb.stat().st_size
        total_before += before
        total_after += after

        note = "  （不透過だったので縁をなじませた）" if was_flat else ""
        print(f"{src.name:<20} {im.width}x{im.height} {before/1024:>7,.0f} KB"
              f"  →  {hero.name} + thumb {after/1024:>6,.0f} KB{note}")

    print(f"\n合計 {total_before/1024/1024:.2f} MB → {total_after/1024:,.0f} KB "
          f"（{100 - total_after / total_before * 100:.0f}% 削減）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
