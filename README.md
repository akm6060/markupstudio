# Markup Studio (Android)

Native Android wrapper (WebView) around the Markup Studio document reader/editor.
Android 5.0 (API 21) to Android 16, offline and online.

## Build the APK
**Option A - GitHub Actions (no setup):** push this folder to a GitHub repo, open
Actions -> "Build APK" -> Run workflow, download the `MarkupStudio-apk` artifact.

**Option B - local:** install JDK 17 + Android SDK (API 34), then
```
bash scripts/fetch-libs.sh      # downloads pdf.js, pdf-lib, etc. into assets/libs (needs npm)
./gradlew assembleRelease       # APK in app/build/outputs/apk/release/
```
Or open the folder in Android Studio (run fetch-libs.sh first).

## Features
- Appears in "Open with" and "Share" menus of file managers.
- Full-screen immersive mode (hides status and navigation bars); toggle in Menu.
- Storage access: all-files (Android 11+), runtime permission (6-10), SD card / USB folder grant.
- Save mode chosen once in Menu: replace original, or save "-edited" copy. Save never asks.
- Reopens the last document at the last page on start.
- Read aloud: voice, language (Auto Hindi+English / English / Hindi), speed; auto-continue to next page;
  auto-scroll; tap a word/line (finger or stylus, Hand tool) to read from there.
- Reading order: column 1, then column 2; pictures and their text are skipped; a picture spanning
  columns splits reading into above-picture columns, then lower columns.
- Offline voices: install Hindi/English voice data via "Voice data" button.

## Limits
- Not built or run on a real device here; Java was syntax-checked only. Logic was tested in headless
  Chromium with a mock bridge.
- Scanned (image-only) pages have no text and cannot be read aloud (no OCR).
- Replacing the original works for PDFs; other types get a PDF copy.
- Release APK is signed with the debug key; use your own keystore for Play Store.
