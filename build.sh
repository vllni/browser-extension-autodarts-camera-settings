#!/usr/bin/env bash
# build.sh – produces dist/chrome/ and dist/firefox/ extension packages
# Usage: bash build.sh
# Requires: bash, zip (for .xpi packaging)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/src"
DIST="$SCRIPT_DIR/dist"

# ── Icons ───────────────────────────────────────────────────────────
# Generate real RGBA PNG files using Python (stdlib only, no deps).
# Each icon: solid blue circle with a white tune (sliders) icon inside.

ICONS_DIR="$SRC/icons"
mkdir -p "$ICONS_DIR"

python3 - "$ICONS_DIR" <<'PYEOF'
import sys, struct, zlib, os, math

def make_png(size):
    transparent = (0, 0, 0, 0)
    blue  = (0x42, 0x99, 0xe1, 0xff)   # #4299e1 Chakra blue.400
    white = (0xff, 0xff, 0xff, 0xff)

    cx = cy = size / 2.0
    R = size * 0.46   # blue circle radius

    # Tune icon bounding box (inset from circle edge)
    pad = size * 0.22
    iw  = size - 2 * pad
    ih  = size - 2 * pad

    # 3 horizontal slider bars: y at 20%, 50%, 80% of icon height
    # Knobs alternating right / left / right at 65% / 35% / 65% of icon width
    bars = [
        (pad + ih * 0.20, pad + iw * 0.65),
        (pad + ih * 0.50, pad + iw * 0.35),
        (pad + ih * 0.80, pad + iw * 0.65),
    ]
    bar_h  = max(1.0, size * 0.055)   # half-height of each bar
    knob_r = max(2.0, size * 0.095)   # radius of knob circle

    def in_icon(px, py):
        for (by, kx) in bars:
            if abs(py - by) <= bar_h and pad <= px <= pad + iw:
                return True
            if (px - kx) ** 2 + (py - by) ** 2 <= knob_r ** 2:
                return True
        return False

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            dist = math.hypot(px - cx, py - cy)
            if dist > R + 1:
                row.append(transparent)
            else:
                color = white if in_icon(px, py) else blue
                if dist <= R - 1:
                    row.append(color)
                else:
                    a = int(max(0.0, min(1.0, R - dist + 0.5)) * 255)
                    row.append((color[0], color[1], color[2], a))
        pixels.append(row)

    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # RGBA
    sig  = b'\x89PNG\r\n\x1a\n'
    return (sig
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))

icons_dir = sys.argv[1]
os.makedirs(icons_dir, exist_ok=True)
for size in [16, 48, 128]:
    path = os.path.join(icons_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(make_png(size))
    print(f'  Generated {path}')
PYEOF
echo "Icons generated."

# ── Build targets ───────────────────────────────────────────────────
build_target() {
  local TARGET="$1"           # chrome or firefox
  local MANIFEST_SRC="$2"    # path to manifest file

  local OUT="$DIST/$TARGET"
  rm -rf "$OUT"
  mkdir -p "$OUT/icons"

  # Copy extension files
  cp "$MANIFEST_SRC" "$OUT/manifest.json"
  cp "$SRC/content.js"    "$OUT/content.js"
  cp "$SRC/content.css"   "$OUT/content.css"
  cp "$SRC/background.js"  "$OUT/background.js"

  # Copy icons
  for SIZE in 16 48 128; do
    local ICON_PNG="$ICONS_DIR/icon${SIZE}.png"
    if [[ -f "$ICON_PNG" ]]; then
      cp "$ICON_PNG" "$OUT/icons/icon${SIZE}.png"
    else
      echo "  WARNING: Missing icon${SIZE}.png – extension will load but may show no icon"
    fi
  done

  echo "Built $TARGET → $OUT"

  # Create zip package
  local ZIP="$DIST/autodarts-camera-settings-${TARGET}.zip"
  rm -f "$ZIP"
  (cd "$OUT" && zip -qr "$ZIP" .)
  echo "Packaged → $ZIP"
}

build_target "chrome"  "$SRC/manifest.chrome.json"
build_target "firefox" "$SRC/manifest.firefox.json"

echo ""
echo "Done!"
echo ""
echo "Load in Chrome:  chrome://extensions → Enable 'Developer mode' → 'Load unpacked' → select dist/chrome/"
echo "Load in Firefox: about:debugging → 'This Firefox' → 'Load Temporary Add-on' → select dist/firefox/manifest.json"
echo "                 (or submit dist/autodarts-camera-settings-firefox.zip to AMO)"
