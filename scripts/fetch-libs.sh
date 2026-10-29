#!/usr/bin/env bash
# Downloads the JavaScript libraries the app bundles (so it works fully offline).
# Needs Node.js + npm.  Run once from the project root:  bash scripts/fetch-libs.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/src/main/assets/libs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
cd "$TMP"
npm init -y >/dev/null
npm install --no-audit --no-fund \
  pdfjs-dist@3.11.174 pdf-lib@1.17.1 jszip@3.10.1 mammoth@1.6.0 xlsx@0.18.5 pptxgenjs@3.12.0
N="$TMP/node_modules"
# legacy build: runs on the older WebView versions found on Android 5-11 phones
cp "$N/pdfjs-dist/legacy/build/pdf.min.js"         "$OUT/pdf.min.js"
cp "$N/pdfjs-dist/legacy/build/pdf.worker.min.js"  "$OUT/pdf.worker.min.js"
cp "$N/pdf-lib/dist/pdf-lib.min.js"            "$OUT/pdf-lib.min.js"
cp "$N/jszip/dist/jszip.min.js"                "$OUT/jszip.min.js"
cp "$N/mammoth/mammoth.browser.min.js"         "$OUT/mammoth.browser.min.js"
cp "$N/xlsx/dist/xlsx.full.min.js"             "$OUT/xlsx.full.min.js"
cp "$N/pptxgenjs/dist/pptxgen.bundle.js"       "$OUT/pptxgen.bundle.js"
echo "Libraries copied to $OUT"
ls -la "$OUT"
