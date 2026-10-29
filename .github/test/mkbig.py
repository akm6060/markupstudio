# mkbig.py <out.pdf> [MB] : a valid 3-page PDF padded with a large unused stream (standard library only)
import os, sys
out = sys.argv[1]; mb = int(sys.argv[2]) if len(sys.argv) > 2 else 16
objs = []
def add(b): objs.append(b); return len(objs)
font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
pages_id = len(objs) + 1 + 6  # placeholder, fixed below
kids = []
contents = []
for n in range(3):
    text = ("BT /F1 18 Tf 60 760 Td (BIG PDF TEST PAGE %d) Tj 0 -30 Td (ultrasound appears here) Tj ET" % (n + 1)).encode()
    contents.append(add(b"<< /Length %d >>\nstream\n" % len(text) + text + b"\nendstream"))
pad = add(None)              # big unused stream, filled in later
pages_num = len(objs) + 1 + 3
for n in range(3):
    kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>" % (pages_num, font, contents[n])))
pages = add(b"<< /Type /Pages /Count 3 /Kids [%s] >>" % b" ".join(b"%d 0 R" % k for k in kids))
assert pages == pages_num
cat = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages)
junk = os.urandom(mb * 1024 * 1024)
objs[pad - 1] = b"<< /Length %d >>\nstream\n" % len(junk) + junk + b"\nendstream"
buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"); offs = []
# put the pages first and the padding last so the first page can be shown without reading the padding
order = [i for i in range(1, len(objs) + 1) if i != pad] + [pad]
for i in order:
    offs.append((i, len(buf))); buf += b"%d 0 obj\n" % i + objs[i - 1] + b"\nendobj\n"
x = len(buf); offs.sort()
buf += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for _, o in offs)
buf += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, x)
open(out, "wb").write(buf)
print(out, len(buf))
