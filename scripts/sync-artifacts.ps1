# Copy pipeline artifacts into web/public so dev/build/deploy can serve them.
# Rerun after regenerating tiles, graphs or the basemap. Idempotent.
$root = Split-Path $PSScriptRoot -Parent
# one vector basemap per city (pipeline/21_basemap_extract.py) plus the
# glyphs and sprites it needs (scripts/basemap-assets.ps1) - self-hosted
# since 2026-09-05, so nothing on the map comes from a third party at runtime
# /XF: the .json sidecars record which planet build and maxzoom each cut came
# from (21_basemap_extract) and .part is its temporary - pipeline bookkeeping,
# not something the app serves
robocopy "$root\data\output\basemap" "$root\web\public\basemap" /MIR /XF *.pmtiles.json *.pmtiles.part /NJH /NJS /NDL /NC /NS | Out-Null
robocopy "$root\data\output\basemap-assets" "$root\web\public\basemap-assets" /MIR /NJH /NJS /NDL /NC /NS | Out-Null
# every city's artifact: graph.bin.gz (Frankfurt), graph-<city>.bin.gz, or
# the .gz.0 ... .N-1 parts of one too big for a single Pages asset (2026-09-01);
# since 2026-09-10 a v8 city ships graph.core.bin.gz + graph.shade.K.bin.gz
# instead (backlog B11), and the glob covers all three shapes.
# The mirror is cleared first: a city that moved from v7 to v8 leaves its old
# graph.bin.gz behind otherwise, and cities-manifest.mjs would count the city
# twice while the dev server served a 7 MB file nothing fetches.
Remove-Item "$root\web\public\graph*.bin.gz*" -Force -ErrorAction SilentlyContinue
Copy-Item "$root\data\output\graph*.bin.gz*" "$root\web\public\" -Force
# per-city overlay tiles: data/output/tiles/<city>/{dsm,noise}/... (2026-09-01).
# shade_tiles and shade_frac were legacy - nothing in web/src fetches them.
if (Test-Path "$root\data\output\tiles") {
    robocopy "$root\data\output\tiles" "$root\web\public\tiles" /MIR /NJH /NJS /NDL /NC /NS | Out-Null
}
foreach ($legacy in @("shade_tiles","noise_tiles","shade_frac","dsm_tiles")) {
    if (Test-Path "$root\web\public\$legacy") { Remove-Item -Recurse -Force "$root\web\public\$legacy" }
}
$b = (Get-ChildItem "$root\web\public\basemap" -Filter "*.pmtiles" -ErrorAction SilentlyContinue).Count
if ($b -lt 8) {
    Write-Error "$b of 8 city basemaps - run pipeline/21_basemap_extract.py for each CITY"
    exit 1
}
$a = if (Test-Path "$root\web\public\basemap-assets\fonts") { (Get-ChildItem -Recurse -File "$root\web\public\basemap-assets").Count } else { 0 }
if ($a -lt 700) {
    Write-Error "$a basemap glyph/sprite files - run scripts\basemap-assets.ps1"
    exit 1
}
$n = if (Test-Path "$root\web\public\tiles") { (Get-ChildItem -Recurse -File "$root\web\public\tiles").Count } else { 0 }
$g = (Get-ChildItem "$root\web\public" -Filter "graph*.bin.gz*").Count
Write-Output "synced: $b basemaps + $a glyph/sprite files + $n overlay tiles + $g graph files"
