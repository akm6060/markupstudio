#!/bin/bash
# runs inside the emulator job: install, grant storage, open the built-in file browser, open a PDF
API=$1; PKG=com.markupstudio.fresh; T=.github/test
adb install -r MarkupStudio.apk
adb shell mkdir -p /sdcard/Download
adb push $T/test2col.pdf /sdcard/Download/test2col.pdf
python3 $T/mkbig.py big.pdf 16 && adb push big.pdf /sdcard/Download/big.pdf
python3 $T/mkbook.py book.pdf 2000 40 && adb push book.pdf /sdcard/Download/book.pdf
if [ "$API" -ge 30 ]; then adb shell appops set --uid $PKG MANAGE_EXTERNAL_STORAGE allow; adb shell appops set $PKG MANAGE_EXTERNAL_STORAGE allow; fi
if [ "$API" -ge 23 ]; then adb shell pm grant $PKG android.permission.READ_EXTERNAL_STORAGE || true; adb shell pm grant $PKG android.permission.WRITE_EXTERNAL_STORAGE || true; fi
adb logcat -c
adb shell am start -W -n $PKG/com.markupstudio.reader.MainActivity || true
sleep 12
adb exec-out screencap -p > s1-start.png
python3 $T/tap.py "Choose files"; sleep 4
adb exec-out screencap -p > s2-browser.png
python3 $T/tap.py "Download"; sleep 3
adb exec-out screencap -p > s3-download.png
python3 $T/tap.py "test2col.pdf"; sleep 10
adb exec-out screencap -p > s4-doc.png
python3 $T/tap.py "🔍" "Search"; sleep 2
python3 $T/tap.py "Search words"; sleep 1
adb shell input text ultrasound; sleep 1
adb shell input keyevent 66; sleep 6
adb exec-out screencap -p > s5-search.png
adb shell input keyevent 4; sleep 1
python3 $T/tap.py "📂" "Open a file"; sleep 3
python3 $T/tap.py "big.pdf"; sleep 10
adb exec-out screencap -p > s6-big.png
# a 2000-page, 86 MB book: prepared in parts, scrolled, then the PDF tools self-test
python3 $T/tap.py "📂" "Open a file"; sleep 3
python3 $T/tap.py "book.pdf"; sleep 45
adb exec-out screencap -p > s7-book.png
WH=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); W=${WH%x*}; H=${WH#*x}
for i in $(seq 1 40); do adb shell input swipe $((W/2)) $((H*3/4)) $((W/2)) $((H/5)) 250; done; sleep 4
adb exec-out screencap -p > s8a-scroll.png
for i in $(seq 1 40); do adb shell input swipe $((W/2)) $((H*3/4)) $((W/2)) $((H/5)) 250; done; sleep 4
adb exec-out screencap -p > s8-scroll.png
adb shell input tap $((W/2)) $((H/2)); sleep 1
adb shell am start -n $PKG/com.markupstudio.reader.MainActivity --ez ms_selftest true; sleep 100
adb exec-out screencap -p > s9-selftest.png
adb shell ls -la /sdcard/Download/MarkupStudio/ > files.txt 2>&1 || true
adb shell ls -laR /sdcard/Android/data/$PKG/cache/books/ >> files.txt 2>&1 || true
adb shell dumpsys meminfo $PKG > mem.txt 2>&1 || true
adb shell dumpsys activity activities | grep -i -E "mResumedActivity|topResumedActivity" > resumed.txt || true
adb shell pidof $PKG > pid.txt || echo none > pid.txt
adb logcat -d -b crash > crash.txt || true
adb logcat -d > full.txt || true
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > ui-last.xml || true
