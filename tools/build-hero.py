#!/usr/bin/env python3
"""背景イラストを WebP に変換して assets/idol-hero.webp を作る。

    python tools/build-hero.py <元画像のパス>

なぜ変換するか:
  ・生成AIが出す PNG はたいてい 1〜3MB ある。娘は 4G のスマホで開くので、
    そのまま置くと初回表示が目に見えて遅くなる。
  ・表示は最大でも幅 460px（CSS 側）。Retina を考えても 920px あれば足りる。
    それ以上の解像度は転送量になるだけで、画面上の見た目は1ドットも変わらない。
  ・透過を保つ必要があるので JPEG は使えない。WebP を使う。

ビルドステップは無いので、これは「アセットを差し替えるときに手で1回叩く道具」。
生成物（assets/idol-hero.webp）はリポジトリにコミットする。
"""
import sys
from pathlib import Path

from PIL import Image

# CSS の width: min(86vw, 460px) に対する 2倍。これ以上は転送量の無駄
MAX_WIDTH = 920
QUALITY = 82

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "idol-hero.webp"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    src = Path(sys.argv[1]).expanduser()
    if not src.exists():
        print(f"元画像が見つかりません: {src}")
        return 1

    im = Image.open(src)
    # 透過を保ったまま扱う（P モードのままだと縮小で縁が汚れる）
    im = im.convert("RGBA")
    before = im.size

    if im.width > MAX_WIDTH:
        h = round(im.height * MAX_WIDTH / im.width)
        im = im.resize((MAX_WIDTH, h), Image.LANCZOS)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT, "WEBP", quality=QUALITY, method=6)

    print(f"元:   {before[0]}x{before[1]}  {src.stat().st_size / 1024:,.0f} KB")
    print(f"出力: {im.width}x{im.height}  {OUT.stat().st_size / 1024:,.0f} KB")
    print(f"      {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
