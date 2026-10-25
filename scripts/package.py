#!/usr/bin/env python3
"""Create a reproducible, unsigned Firefox extension archive from original sources."""
import hashlib
import json
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parent.parent
source=root/'extension'
manifest=json.loads((source/'manifest.json').read_text())
version=manifest['version']
out=root/'dist';out.mkdir(exist_ok=True)
files=sorted(p for p in source.rglob('*') if p.is_file())
archive=out/f'bilibili-cdn-primer-{version}.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in files:
  relative=p.relative_to(source).as_posix()
  if any(v in relative for v in ['.DS_Store','node_modules','__pycache__']): continue
  info=zipfile.ZipInfo(relative,date_time=(2026,10,25,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644 << 16
  z.writestr(info,p.read_bytes())
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
(out/'SHA256SUMS').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
print(archive)
