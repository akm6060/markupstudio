# tap.py "<text>" ["<text2>" ...] : taps the first screen element whose text or description equals (or contains) one of the texts
import re, subprocess, sys, time
wants = sys.argv[1:]
def dump():
    subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
    return subprocess.run(["adb", "shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
for attempt in range(4):
    xml = dump()
    nodes = [(m.group(1), m.group(2), [int(m.group(i)) for i in range(3, 7)]) for m in re.finditer(
        r'<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)]
    for exact in (True, False):
        for w in wants:
            for t, d, b in nodes:
                if (exact and (t == w or d == w)) or (not exact and (w in t or w in d)):
                    x, y = (b[0] + b[2]) // 2, (b[1] + b[3]) // 2
                    subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
                    print("tapped", repr(t or d), x, y); sys.exit(0)
    time.sleep(2)
open("ui-notfound-%s.xml" % re.sub(r"\W", "_", wants[0])[:20], "w").write(xml)
print("NOT FOUND:", wants); sys.exit(0)
