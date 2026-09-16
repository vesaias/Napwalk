# Self-host the vector basemap's glyphs and sprites (DECISIONS 2026-09-05).
#
# The map style needs two things the .pmtiles archive does not carry: the
# sprite sheet (POI and shield icons) and the glyph atlases (SDF bitmaps of
# every character MapLibre draws). Both were being fetched from
# protomaps.github.io at runtime, which is a third-party dependency on every
# page load of an otherwise fully static app - and rule 1 says the browser
# gets its data from our own artifacts.
#
# The download mirrors the upstream URL layout exactly, so switching over is
# a one-line change in MapView: ASSETS becomes /basemap-assets and both the
# glyphs and sprite templates keep working unchanged.
#
# Glyphs are per-range: MapLibre asks for fonts/<stack>/<start>-<end>.pbf in
# 256-codepoint steps and only for the ranges a label actually uses, so a
# Latin city downloads two or three of the 256. We mirror all of them
# because it costs nothing at runtime and a single Cyrillic or CJK name in
# an OSM label would otherwise render as boxes.
#
# Idempotent: an existing non-empty file is left alone. Delete the directory
# to refetch.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is ~10x faster without it

$root = Split-Path $PSScriptRoot -Parent
$base = "https://protomaps.github.io/basemaps-assets"
$out = "$root\data\output\basemap-assets"

# The text-font values in protomaps-themes-base (grep dist/*.js). There is a
# fourth, "Noto Sans Devanagari Regular v1", used when a label's script tag
# says Devanagari. It is not mirrored: upstream serves it byte-for-byte
# identical to Noto Sans Regular (checked 2026-09-05, including range
# 2304-2559, the Devanagari block itself), so it carries no Devanagari
# glyphs and 256 duplicate files would buy nothing. No label in the eight
# Latin-script cities is tagged that way.
$stacks = @("Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic")
# light and dark, 1x and 2x - the redesign ships both themes.
$sprites = @("light.json", "light.png", "light@2x.json", "light@2x.png",
             "dark.json", "dark.png", "dark@2x.json", "dark@2x.png")

$got = 0; $had = 0; $missing = 0; $bytes = 0

function Fetch($relative, $url) {
    $dest = Join-Path $out $relative
    if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) {
        $script:had++; $script:bytes += (Get-Item $dest).Length
        return
    }
    $dir = Split-Path $dest -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 60
        $script:got++; $script:bytes += (Get-Item $dest).Length
    } catch {
        # Every one of these URLs exists upstream - all 776 answered 200 on
        # 2026-09-05, the server renders empty ranges rather than 404ing. So
        # a 404 is a hard failure like any other (DNS, TLS, 5xx), not a
        # range this stack happens to skip. Warn, count it, carry on so one
        # bad response does not lose the other 775; the count check at the
        # end fails the script, and a rerun fills only the gaps.
        Remove-Item $dest -ErrorAction SilentlyContinue
        $status = $_.Exception.Response.StatusCode.value__
        Write-Warning "$relative : HTTP $status $($_.Exception.Message)"
        $script:missing++
    }
}

Write-Output "sprites -> $out\sprites\v4"
foreach ($s in $sprites) { Fetch "sprites\v4\$s" "$base/sprites/v4/$s" }

foreach ($stack in $stacks) {
    $enc = [uri]::EscapeDataString($stack)          # spaces -> %20, as MapLibre asks
    $before = $got + $had
    for ($lo = 0; $lo -lt 65536; $lo += 256) {
        $range = "$lo-$($lo + 255)"
        Fetch "fonts\$stack\$range.pbf" "$base/fonts/$enc/$range.pbf"
    }
    Write-Output ("glyphs {0}: {1}/256 ranges" -f $stack, (($got + $had) - $before))
}

$files = (Get-ChildItem -Recurse -File $out).Count
Write-Output ("basemap-assets: {0} files, {1:N0} MB ({2} downloaded, {3} already present, {4} failed)" `
    -f $files, ($bytes / 1MB), $got, $had, $missing)
$want = $sprites.Count + $stacks.Count * 256
if ($files -lt $want) { throw "only $files asset files, expected $want ($($sprites.Count) sprites + 256 glyph ranges x $($stacks.Count) stacks) - rerun to fill the gaps" }
