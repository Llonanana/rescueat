"""產生拼字正確的 RescuEat Logo：文字轉成向量路徑，任何電腦開都一樣。"""
import re
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = TTFont(Path(__file__).resolve().parent / "fonts" / "nunito-latin-800-normal.woff2")
# 字型：npm pack @fontsource/nunito 解壓後，把 files/nunito-latin-800-normal.woff2 放到 scripts/fonts/
gs = FONT.getGlyphSet()
cmap = FONT.getBestCmap()
UPM = FONT["head"].unitsPerEm
hmtx = FONT["hmtx"]


def text_paths(parts, size, x0, baseline, tracking=-0.01):
    """parts = [(文字, 顏色)] → (svg path 字串, 總寬度)"""
    scale = size / UPM
    x = x0
    out = []
    for text, color in parts:
        d_all = []
        for ch in text:
            g = cmap[ord(ch)]
            pen = SVGPathPen(gs)
            tp = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
            gs[g].draw(tp)
            d_all.append(pen.getCommands())
            x += hmtx[g][0] * scale + tracking * size
        out.append(f'<path fill="{color}" d="{" ".join(d_all)}"/>')
    return "".join(out), x - x0


ICON = Path(__file__).resolve().parent.parent / "img" / "logo.svg".read_text()
icon_inner = re.search(r"<svg[^>]*>(.*)</svg>", ICON, re.S).group(1)
icon_inner = re.sub(r"<!--.*?-->", "", icon_inner)

GREEN_D, ORANGE, CREAM = "#1F6B45", "#F28C28", "#FDF0CC"


def lockup(bg):
    W, H = 1000, 860
    size = 168
    _, tw = text_paths([("Rescu", GREEN_D), ("Eat", ORANGE)], size, 0, 0)
    words, _ = text_paths([("Rescu", GREEN_D), ("Eat", ORANGE)], size, (W - tw) / 2, 765)
    # 圖示：120×120 的 viewBox 放大 5 倍，圖釘置中（圖釘中心在 x=46）
    s = 5.0
    ix = W / 2 - 46 * s
    rect = f'<rect width="{W}" height="{H}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="RescuEat">'
            f'{rect}<g transform="translate({ix:.1f} 40) scale({s})">{icon_inner}</g>{words}</svg>')


def horizontal(bg):
    """橫式：圖示在左、字在右，適合簡報頁首與網站。"""
    H, size = 240, 120
    s = 2.0
    words, tw = text_paths([("Rescu", GREEN_D), ("Eat", ORANGE)], size, 250, 165)
    W = int(250 + tw + 40)
    rect = f'<rect width="{W}" height="{H}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="RescuEat">'
            f'{rect}<g transform="translate(10 6) scale({s})">{icon_inner}</g>{words}</svg>')


out = Path(__file__).resolve().parent.parent / "img" / "brand"
out.mkdir(parents=True, exist_ok=True)
(out / "RescuEat-logo.svg").write_text(lockup(CREAM))
(out / "RescuEat-logo-transparent.svg").write_text(lockup(None))
(out / "RescuEat-logo-horizontal.svg").write_text(horizontal(None))
print("ok")
