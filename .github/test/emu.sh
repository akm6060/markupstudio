#!/bin/bash
# runs inside the emulator job: install, grant storage, open the built-in file browser, open a PDF
API=$1; PKG=com.markupstudio.reader; T=.github/test
adb install -r MarkupStudio.apk
adb shell mkdir -p /sdcard/Download
adb push $T/test2col.pdf /sdcard/Download/test2col.pdf
python3 $T/mkbig.py big.pdf 16 && adb push big.pdf /sdcard/Download/big.pdf
if [ "$API" -ge 30 ]; then adb shell appops set --uid $PKG MANAGE_EXTERNAL_STORAGE allow; adb shell appops set $PKG MANAGE_EXTERNAL_STORAGE allow; fi
if [ "$API" -ge 23 ]; then adb shell pm grant $PKG android.permission.READ_EXTERNAL_STORAGE || true; adb shell pm grant $PKG android.permission.WRITE_EXTERNAL_STORAGE || true; fi
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity || true
sleep 12
adb exec-out screencap -p > s1-start.png
python3 $T/tap.py "Choose files"; sleep 4
adb exec-out screencap -p > s2-browser.png
python3 $T/tap.py "Download"; sleep 3
adb exec-out screencap -p > s3-download.png
python3 $T/tap.py "test2col.pdf"; sleep 10
adb exec-out screencap -p > s4-doc.png
python3 $T/tap.py "🔍" "Search"; sleep 2
python3 $T/tap.py "Word or phrase (Hindi or English)" "Word or phrase"; sleep 1
adb shell input text ultrasound; sleep 1
adb shell input keyevent 66; sleep 6
adb exec-out screencap -p > s5-search.png
adb shell input keyevent 4; sleep 1
python3 $T/tap.py "📂" "Open a file"; sleep 3
python3 $T/tap.py "big.pdf"; sleep 10
adb exec-out screencap -p > s6-big.png
adb shell dumpsys activity activities | grep -i -E "mResumedActivity|topResumedActivity" > resumed.txt || true
adb shell pidof $PKG > pid.txt || echo none > pid.txt
adb logcat -d -b crash > crash.txt || true
adb logcat -d > full.txt || true
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > ui-last.xml || true
