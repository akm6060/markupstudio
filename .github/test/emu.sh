#!/bin/bash
# runs inside the emulator job: install, grant storage, open the built-in file browser, open a PDF
API=$1; PKG=com.markupstudio.reader; T=.github/test
adb install -r MarkupStudio.apk
adb shell mkdir -p /sdcard/Download
adb push $T/test2col.pdf /sdcard/Download/test2col.pdf
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
adb shell dumpsys activity activities | grep -i -E "mResumedActivity|topResumedActivity" > resumed.txt || true
adb shell pidof $PKG > pid.txt || echo none > pid.txt
adb logcat -d -b crash > crash.txt || true
adb logcat -d > full.txt || true
