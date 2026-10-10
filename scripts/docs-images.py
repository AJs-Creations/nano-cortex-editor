"""Second step of `npm run docs:screenshots` (needs Pillow): composes docs/images/hero.png from the toolbar strip and
the editor captured by scripts/docs-screenshots.js, and trims empty background off the bottom of the tall crops."""
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
images = root / 'docs' / 'images'
raw = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'test-output' / 'docs-raw'

bar, body = Image.open(raw / '_toolbar-editor.png').convert('RGB'), Image.open(raw / '_editor-full.png').convert('RGB')
hero = Image.new('RGB', (body.width, bar.height + body.height))
hero.paste(bar, (0, 0))
hero.paste(body, (0, bar.height))
hero = hero.resize((1600, round(hero.height * 1600 / hero.width)), Image.LANCZOS)
hero.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(images / 'hero.png', optimize=True)


def trim_bottom(name, margin=48):
    """Cut rows at the bottom that are plain background (the colour of the bottom-left pixel)."""
    path = images / name
    im = Image.open(path).convert('RGB')
    bg = im.getpixel((2, im.height - 2))
    px = im.load()
    last = 0
    for y in range(im.height - 1, -1, -1):
        if any(max(abs(a - b) for a, b in zip(px[x, y], bg)) > 12 for x in range(0, im.width, 2)):
            last = y
            break
    if last + margin < im.height:
        im.crop((0, 0, im.width, last + margin)).save(path, optimize=True)


for name in ['inspector-capture.png', 'inspector-cab.png', 'inspector-fx.png', 'inspector-gate.png', 'expression.png']:
    trim_bottom(name)
for f in sorted(images.glob('*.png')):
    print(f.name, Image.open(f).size, f.stat().st_size // 1024, 'KB')
