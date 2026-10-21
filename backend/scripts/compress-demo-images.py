"""压缩作品集沙盒里的案例图片：控制在几 MB 内，保证访客秒开。

策略：等比缩到最长边 900px（网页展示足够）+ 转 JPEG q82。
真实图片来自 AI 生成的主图/详情图，缩到 900px 在卡片和详情弹窗里都清晰。
"""
from PIL import Image
from pathlib import Path

D = Path('frontend/public/demo')
if not D.exists():
    print('目录不存在:', D)
    raise SystemExit(1)

n = 0
for p in sorted(D.glob('*')):
    if p.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
        continue
    im = Image.open(p)
    if im.mode in ('RGBA', 'P', 'LA'):
        rgba = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg
    else:
        im = im.convert('RGB')
    im.thumbnail((900, 900), Image.LANCZOS)
    out = p.with_suffix('.jpg')
    im.save(out, 'JPEG', quality=82, optimize=True, progressive=True)
    if out != p and p.suffix.lower() != '.jpg':
        p.unlink()
    n += 1

total = sum(f.stat().st_size for f in D.glob('*.jpg'))
print(f'共 {n} 张，总计 {total/1024/1024:.2f} MB')
