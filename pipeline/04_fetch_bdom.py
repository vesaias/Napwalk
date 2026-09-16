"""W1: fetch bDOM20 LAZ sample tiles (Nordend/Bornheim).

Fill TILE_URLS with direct Downloadcenter links (see data/README.md), or
drop manually downloaded zips into data/bdom/downloads/. Idempotent.
"""
import zipfile

import requests

from common import WORK, check

TILE_URLS: list[str] = [
    # paste direct URLs here (see data/README.md for the capture procedure)
]
BDOM = WORK / "bdom"
DL = BDOM / "downloads"
LAZ = BDOM / "laz"


def main():
    DL.mkdir(parents=True, exist_ok=True)
    LAZ.mkdir(parents=True, exist_ok=True)
    for url in TILE_URLS:
        name = url.split("/")[-1].split("?")[0]
        dest = DL / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"have {name}")
            continue
        print(f"fetching {name}")
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    for z in DL.glob("*.zip"):
        with zipfile.ZipFile(z) as zf:
            for m in zf.namelist():
                base = m.split("/")[-1]
                if base.lower().endswith((".laz", ".las")) and not (LAZ / base).exists():
                    zf.extract(m, LAZ)
    for f in DL.glob("*.laz"):
        if not (LAZ / f.name).exists():
            f.replace(LAZ / f.name)
    tiles = list(LAZ.glob("*.la?"))
    check(len(tiles) >= 1, "no LAZ tiles in data/bdom/laz — see data/README.md")
    for t in tiles:
        check(t.stat().st_size > 1_000_000, f"{t.name} suspiciously small")
    print(f"OK: {len(tiles)} LAZ tiles, "
          f"{sum(t.stat().st_size for t in tiles) / 1e9:.2f} GB")


if __name__ == "__main__":
    main()
