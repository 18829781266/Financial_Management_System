"""打包服务端、浏览器资产及托管数据库迁移；不包含本地数据库和凭据。"""
import sys,tarfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
archive=Path(sys.argv[1]).resolve()
with tarfile.open(archive,'w:gz') as tar:
 for name in ['.openai/hosting.json','dist']:
  tar.add(root/name,arcname=name)
print(archive)
