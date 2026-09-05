"""Stable archive order, timestamps and permissions; no external zip dependency."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_STORED
import hashlib
root = Path(__file__).resolve().parents[1]
target = root / "sovereignty-chromium.zip"
with ZipFile(target, "w", compression=ZIP_STORED) as archive:
    for path in sorted((root / "dist").rglob("*")):
        if path.is_file():
            info = ZipInfo(path.relative_to(root / "dist").as_posix(), (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
print(f"{hashlib.sha256(target.read_bytes()).hexdigest()}  {target.name}")
