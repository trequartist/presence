#!/bin/bash
# Generate macOS .icns file from PNG icons.
# Must be run on macOS (requires iconutil).
#
# Usage: ./scripts/generate-icns.sh

set -e

ICONSET_DIR="assets/Presence.iconset"
mkdir -p "$ICONSET_DIR"

# Copy PNGs into iconset with required naming convention
cp assets/icon-16.png  "$ICONSET_DIR/icon_16x16.png"
cp assets/icon-32.png  "$ICONSET_DIR/icon_16x16@2x.png"
cp assets/icon-32.png  "$ICONSET_DIR/icon_32x32.png"
cp assets/icon-64.png  "$ICONSET_DIR/icon_32x32@2x.png"
cp assets/icon-128.png "$ICONSET_DIR/icon_128x128.png"
cp assets/icon-256.png "$ICONSET_DIR/icon_128x128@2x.png"
cp assets/icon-256.png "$ICONSET_DIR/icon_256x256.png"
cp assets/icon-512.png "$ICONSET_DIR/icon_256x256@2x.png"
cp assets/icon-512.png "$ICONSET_DIR/icon_512x512.png"

# Generate .icns
iconutil -c icns "$ICONSET_DIR" -o assets/icon.icns

# Cleanup
rm -rf "$ICONSET_DIR"

echo "Generated assets/icon.icns"
