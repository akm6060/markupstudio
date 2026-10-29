# mkbook.py <out.pdf> <pages> <kb_per_page> : a long "book" (text + a picture on every page), standard library only
import os, sys, zlib
out, N, kb = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
start = int(sys.argv[4]) if len(sys.argv) > 4 else 1
objs = []
def add(b): objs.append(b); return len(objs)
font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>")
pages_id = 3 * N + 2             # objects: font, then per page (content, image, page), then pages, catalog
kids = []
side = max(16, int((kb * 1024 / 3) ** 0.5))
for n in range(1, N + 1):
    g = n + start - 1
    lines = ["Page %d of the big test book" % g, "Chapter %d section %d" % ((g - 1) // 100 + 1, (g - 1) // 10 + 1)]
    lines += ["the river carried silt across the plain and farmers learned line %d" % k for k in range(1, 30)]
    if g % 7 == 0: lines.append("ultrasound appears on this page")
    t = "BT /F1 11 Tf 60 780 Td 14 TL " + " ".join("(%s) '" % l for l in lines) + " ET q 200 0 0 140 330 80 cm /Im1 Do Q"
    c = add(b"<< /Length %d >>\nstream\n" % len(t) + t.encode() + b"\nendstream")
    raw = os.urandom(side * side * 3)
    im = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length %d >>\nstream\n" % (side, side, len(raw)) + raw + b"\nendstream")
    kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 %d 0 R >> /XObject << /Im1 %d 0 R >> >> /Contents %d 0 R >>" % (pages_id, font, im, c)))
assert len(objs) + 1 == pages_id
add(b"<< /Type /Pages /Count %d /Kids [%s] >>" % (N, b" ".join(b"%d 0 R" % k for k in kids)))
cat = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
with open(out, "wb") as f:
    f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"); offs = []
    for i, o in enumerate(objs, 1):
        offs.append(f.tell()); f.write(b"%d 0 obj\n" % i + o + b"\nendobj\n")
    x = f.tell()
    f.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs))
    f.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, x))
print(out, os.path.getsize(out))
