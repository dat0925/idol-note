#!/usr/bin/env python3
"""logo.png から、アプリのロゴと PWA のアイコン一式を書き出す。

    python tools/build-icons.py logo.png

出力:
    assets/logo-96.webp        ヘッダ左上のロゴ（角丸・透過）
    icon-192.png               PWA（purpose: any）
    icon-512.png               PWA（purpose: any）
    icon-maskable-512.png      PWA（purpose: maskable）
    apple-touch-icon.png       iOS のホーム画面用（180px）

なぜ4種類も要るか:

  ・元画像の角は「黒」で塗られている（透過ではない）。
    そのまま使うと、角丸の外側が黒く出る端末がある。
    → 角丸のマスクをかけて、角を透明にする。

  ・maskable は端末が好きな形（丸・角丸・しずく型）に切り抜く。
    その際、外周およそ20%は切り落とされる前提で作る必要がある。
    このロゴは文字が正方形いっぱいに入っているので、そのまま渡すと
    「アイドルノート」の文字が欠ける。
    → 縮小して余白を足し、背景を塗りつぶした専用画像を作る。

  ・iOS は透過を黒として塗る。apple-touch-icon に透過を渡すと角が黒くなる。
    → 背景を塗った不透明の正方形にする（角丸は iOS 側がやる）。

差し替えたら sw.js の CACHE 版数を上げること。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

CORNER_RATIO = 0.18     # 元画像に焼き込まれている角丸の見た目に合わせる
MASKABLE_SCALE = 0.76   # 外周20%が切られても文字が残る大きさ
QUALITY = 88


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def brand_color(im: Image.Image) -> tuple:
    """ロゴの縁の色を平均して、余白に敷く色を決める。

    決め打ちの色を書かないのは、ロゴを描き直したときに
    余白だけ昔の色のまま取り残されるのを防ぐため。
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    inset = int(w * CORNER_RATIO)          # 黒い角を避けて内側を見る
    pts = [(w // 2, inset), (w // 2, h - inset), (inset, h // 2), (w - inset, h // 2)]
    cols = [rgb.getpixel(p) for p in pts]
    avg = [sum(c[i] for c in cols) / len(cols) for i in range(3)]
    # そのまま平均するとくすんだ藤色になる。白に寄せて、
    # アプリの背景（--bg: #fff7fb）と並べても浮かない淡いピンクにする。
    mix = 0.45
    return tuple(round(v + (255 - v) * mix) for v in avg)


def main() -> int:
    src = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else ROOT / "logo.png"
    if not src.exists():
        print(__doc__)
        print(f"見つかりません: {src}")
        return 1

    im = Image.open(src).convert("RGBA")
    size = min(im.size)
    im = im.crop((0, 0, size, size))       # 念のため正方形に揃える

    bg = brand_color(im)
    print(f"元画像 {size}x{size} / 余白に敷く色 {bg}")

    # ── 角を透明にした版（ヘッダと purpose:any 用）──
    rounded = im.copy()
    rounded.putalpha(rounded_mask(size, int(size * CORNER_RATIO)))

    out = []

    # ヘッダのロゴ。表示は約32pxなので3倍の96pxあれば足りる
    (ROOT / "assets").mkdir(exist_ok=True)
    p = ROOT / "assets" / "logo-96.webp"
    rounded.resize((96, 96), Image.LANCZOS).save(p, "WEBP", quality=QUALITY, method=6)
    out.append(p)

    for px in (192, 512):
        p = ROOT / f"icon-{px}.png"
        rounded.resize((px, px), Image.LANCZOS).save(p, "PNG")
        out.append(p)

    # ── maskable: 縮小して余白を足す（端末が外周を切り落とすため）──
    mk = Image.new("RGBA", (512, 512), bg + (255,))
    inner = int(512 * MASKABLE_SCALE)
    mk.paste(rounded.resize((inner, inner), Image.LANCZOS),
             ((512 - inner) // 2, (512 - inner) // 2),
             rounded.resize((inner, inner), Image.LANCZOS))
    p = ROOT / "icon-maskable-512.png"
    mk.save(p, "PNG")
    out.append(p)

    # ── iOS: 透過を黒く塗られるので、背景を敷いた不透明の正方形にする ──
    ios = Image.new("RGBA", (180, 180), bg + (255,))
    small = rounded.resize((180, 180), Image.LANCZOS)
    ios.paste(small, (0, 0), small)
    p = ROOT / "apple-touch-icon.png"
    ios.convert("RGB").save(p, "PNG")
    out.append(p)

    for p in out:
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1024:,.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
