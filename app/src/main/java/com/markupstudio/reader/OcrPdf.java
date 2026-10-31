package com.markupstudio.reader;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.pdf.PdfDocument;
import android.util.Base64;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font;
import com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode;
import com.tom_roush.pdfbox.util.Matrix;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Scanned books made into text books: an invisible word layer on the original pages ("searchable"),
 *  or every page typed again on clean paper with its pictures put back ("typed"). */
final class OcrPdf {
    private OcrPdf() {}

    /* ---------------- searchable: invisible words on top of the original page ---------------- */

    static PDFont loadFont(PDDocument doc, Context ctx) throws Exception {
        InputStream in = ctx.getAssets().open("fonts/Hind-Regular.ttf");
        try {
            return PDType0Font.load(doc, in, true);
        } finally {
            in.close();
        }
    }

    /** text the font can write; letters it does not have are left out (the cache keeps it quick) */
    private static String writable(PDFont font, String s, Set<Integer> bad) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            String ch = new String(Character.toChars(cp));
            i += Character.charCount(cp);
            if (bad.contains(cp)) continue;
            try {
                font.encode(ch);
                sb.append(ch);
            } catch (Exception e) {
                bad.add(cp);
            }
        }
        return sb.toString();
    }

    /** words: [[x0, baseline, x1, size, text], …] in page points measured from the top-left of the page as shown */
    static int overlay(PDDocument doc, PDPage page, PDFont font, JSONArray words, Set<Integer> bad) throws Exception {
        if (words == null || words.length() == 0) return 0;
        PDRectangle cb = page.getCropBox();
        int rot = ((page.getRotation() % 360) + 360) % 360;
        float ox = cb.getLowerLeftX(), oy = cb.getLowerLeftY(), W0 = cb.getWidth(), H0 = cb.getHeight();
        PDPageContentStream cs = new PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true);
        int n = 0;
        try {
            cs.saveGraphicsState();
            cs.beginText();
            cs.setRenderingMode(RenderingMode.NEITHER);
            cs.setFont(font, 1);
            for (int i = 0; i < words.length(); i++) {
                JSONArray w = words.optJSONArray(i);
                if (w == null || w.length() < 5) continue;
                String t = writable(font, w.optString(4, ""), bad);
                if (t.trim().isEmpty()) continue;
                double x0 = w.getDouble(0), base = w.getDouble(1), x1 = w.getDouble(2), fs = Math.max(1, w.getDouble(3));
                float tw = font.getStringWidth(t) / 1000f * (float) fs;
                float sx = tw > 0 ? (float) Math.max(.2, Math.min(5, (x1 - x0) / tw)) : 1f;
                float[] O = PdfMarks.map(rot, ox, oy, W0, H0, x0, base), U = PdfMarks.map(rot, ox, oy, W0, H0, x0 + 1, base), V = PdfMarks.map(rot, ox, oy, W0, H0, x0, base - 1);
                float ux = U[0] - O[0], uy = U[1] - O[1], vx = V[0] - O[0], vy = V[1] - O[1], f = (float) fs;
                cs.setTextMatrix(new Matrix(ux * f * sx, uy * f * sx, vx * f, vy * f, O[0], O[1]));
                cs.showText(t + " ");
                n++;
            }
            cs.endText();
            cs.restoreGraphicsState();
        } finally {
            cs.close();
        }
        return n;
    }

    /* ---------------- typed: every page written again with the phone's own text engine ---------------- */

    static final class Typed {
        private final File dir;
        private PdfDocument doc;
        private int inPart = 0, total = 0;
        final List<String> parts = new ArrayList<>();
        private final Paint img = new Paint(Paint.FILTER_BITMAP_FLAG), txt = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);

        Typed(File dir) {
            this.dir = dir;
        }

        /** {w, h, imgs:[{x,y,w,h,d:jpeg data url}], lines:[{c:"#rrggbb", w:[[x0, baseline, x1, size, text]]}]} */
        void page(String json) throws Exception {
            JSONObject o = new JSONObject(json);
            if (doc == null) doc = new PdfDocument();
            int W = Math.max(1, (int) Math.round(o.getDouble("w"))), H = Math.max(1, (int) Math.round(o.getDouble("h")));
            PdfDocument.Page pg = doc.startPage(new PdfDocument.PageInfo.Builder(W, H, ++total).create());
            Canvas cv = pg.getCanvas();
            List<Bitmap> used = new ArrayList<>();
            try {
                JSONArray im = o.optJSONArray("imgs");
                if (im != null) for (int i = 0; i < im.length(); i++) {
                    JSONObject a = im.getJSONObject(i);
                    String d = a.optString("d", "");
                    byte[] b = Base64.decode(d.substring(d.indexOf(',') + 1), Base64.DEFAULT);
                    Bitmap bm = BitmapFactory.decodeByteArray(b, 0, b.length);
                    if (bm == null) continue;
                    used.add(bm);
                    float x = (float) a.getDouble("x"), y = (float) a.getDouble("y");
                    cv.drawBitmap(bm, null, new RectF(x, y, x + (float) a.getDouble("w"), y + (float) a.getDouble("h")), img);
                }
                JSONArray ls = o.optJSONArray("lines");
                if (ls != null) for (int i = 0; i < ls.length(); i++) {
                    JSONObject L = ls.getJSONObject(i);
                    int col;
                    try { col = Color.parseColor(L.optString("c", "#111111")); } catch (Exception e) { col = 0xff111111; }
                    txt.setColor(col);
                    JSONArray ws = L.optJSONArray("w");
                    if (ws == null) continue;
                    for (int k = 0; k < ws.length(); k++) {
                        JSONArray w = ws.optJSONArray(k);
                        if (w == null || w.length() < 5) continue;
                        String t = w.optString(4, "");
                        if (t.trim().isEmpty()) continue;
                        float x0 = (float) w.getDouble(0), base = (float) w.getDouble(1), x1 = (float) w.getDouble(2), fs = (float) Math.max(2, w.getDouble(3));
                        txt.setTextSize(fs);
                        txt.setTextScaleX(1f);
                        float mw = txt.measureText(t);
                        if (mw > 0) txt.setTextScaleX(Math.max(.55f, Math.min(1.8f, (x1 - x0) / mw)));
                        cv.drawText(t, x0, base, txt);
                    }
                }
            } finally {
                doc.finishPage(pg);
                for (Bitmap b : used) b.recycle();
            }
            if (++inPart >= 40) flush();
        }

        private void flush() throws Exception {
            if (doc == null) return;
            File f = new File(dir, "typed-" + System.nanoTime() + ".pdf");
            FileOutputStream os = new FileOutputStream(f);
            try {
                doc.writeTo(os);
            } finally {
                os.close();
                doc.close();
                doc = null;
                inPart = 0;
            }
            parts.add(f.getPath());
        }

        List<String> end() throws Exception {
            flush();
            return parts;
        }

        void cancel() {
            try { if (doc != null) doc.close(); } catch (Exception ignored) { }
            doc = null;
            for (String p : parts) new File(p).delete();
            parts.clear();
        }
    }

    static Set<Integer> newBadSet() {
        return new HashSet<>();
    }
}
