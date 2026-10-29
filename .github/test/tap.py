# tap.py "<text>" : finds a node whose text/content-desc contains <text> in a uiautomator dump and taps its centre
import re, subprocess, sys, time
want = sys.argv[1]
for attempt in range(4):
    subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
    xml = subprocess.run(["adb", "shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
    for m in re.finditer(r'<node [^>]*?(?:text|content-desc)="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if want in m.group(1):
            x = (int(m.group(2)) + int(m.group(4))) // 2; y = (int(m.group(3)) + int(m.group(5))) // 2
            subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
            print("tapped", repr(m.group(1)), x, y); sys.exit(0)
    time.sleep(2)
print("NOT FOUND:", want); sys.exit(0)
