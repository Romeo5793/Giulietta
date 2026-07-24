import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ROOT = Path(__file__).resolve().parents[1]
DOCX = ROOT / "docs" / "OBDアプリ開発用データ調査.docx"
OUT = ROOT / "docs" / "obd-research-extract.txt"

with zipfile.ZipFile(DOCX) as z:
    root = ET.fromstring(z.read("word/document.xml"))

lines = []
for p in root.iter(W + "p"):
    line = "".join(t.text or "" for t in p.iter(W + "t")).strip()
    if line:
        lines.append(line)

OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"Wrote {len(lines)} lines to {OUT}")
