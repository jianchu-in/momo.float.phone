from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,zipfile
root=Path(__file__).parent
src=root/'src'
css=(src/'style.css').read_text()
imp=(src/'importer.js').read_text().replace('</script','<\\/script')
app=(src/'app.js').read_text().replace('</script','<\\/script')
html=(src/'index.template.html').read_text().replace('/* CSS_INJECT */',css).replace('/* IMPORTER_INJECT */',imp).replace('/* APP_INJECT */',app)
(root/'index.html').write_text(html)
res=512; img=Image.new('RGBA',(res,res),(239,241,250,255));dr=ImageDraw.Draw(img)
dr.rounded_rectangle((24,24,488,488),radius=112,fill=(239,240,251),outline=(212,217,239),width=3)
dr.rounded_rectangle((135,112,378,411),radius=42,fill=(125,136,188))
dr.rounded_rectangle((152,127,360,394),radius=31,fill=(255,255,255))
dr.rounded_rectangle((175,166,336,178),radius=6,fill=(216,219,235))
dr.rounded_rectangle((175,190,301,203),radius=6,fill=(229,232,244))
dr.ellipse((199,241,316,357),fill=(233,235,249))
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',94)
except: font=ImageFont.load_default()
dr.text((257,292),'✦',font=font,fill=(129,139,186),anchor='mm')
img.save(root/'icon.png')
zip_name=root.parent/'角色库管理-v0.1.0.zip'
with zipfile.ZipFile(zip_name,'w',zipfile.ZIP_DEFLATED,compresslevel=8) as z:
 for name in ('manifest.json','index.html','icon.png'):
  z.write(root/name,name)
sourcezip=root.parent/'角色库管理-源码-v0.1.0.zip'
with zipfile.ZipFile(sourcezip,'w',zipfile.ZIP_DEFLATED,compresslevel=8) as z:
 for p in [root/'README.md',root/'manifest.json',root/'index.html',root/'icon.png',*src.glob('*'),*(root/'tests').glob('*'),root/'build.py']:
  z.write(p,str(p.relative_to(root)))
print('APP ZIP:',zip_name,zip_name.stat().st_size)
print('SRC ZIP:',sourcezip,sourcezip.stat().st_size)
print('HTML size',len(html))
