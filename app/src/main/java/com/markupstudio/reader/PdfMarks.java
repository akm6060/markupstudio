package com.markupstudio.reader;
import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.MediaScannerConnection;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.content.res.Configuration;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.app.ActivityManager;
import android.content.ComponentCallbacks2;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.io.MemoryUsageSetting;
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.pdmodel.graphics.blend.BlendMode;
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDColor;
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB;
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode;
import java.security.MessageDigest;
import com.tom_roush.pdfbox.cos.COSArray;
import com.tom_roush.pdfbox.cos.COSBase;
import com.tom_roush.pdfbox.cos.COSDictionary;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.cos.COSStream;
import com.tom_roush.pdfbox.cos.COSString;
import com.tom_roush.pdfbox.pdmodel.PDDocumentCatalog;
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory;
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject;
import com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentGroup;
import com.tom_roush.pdfbox.pdmodel.graphics.optionalcontent.PDOptionalContentProperties;
import com.tom_roush.pdfbox.util.Matrix;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.webkit.WebChromeClient;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;
import com.tom_roush.pdfbox.pdmodel.PDResources;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.view.ViewGroup;
import java.io.FilterInputStream;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** The mark layer inside saved PDFs: written, read back, erased; and small PDF helpers. */
final class PdfMarks {
    private PdfMarks() {}

    /* marks are kept in the PDF as one extra drawing per page inside the optional layer "Markup Studio marks"
       (other PDF apps show it), plus the marks themselves (/MSMarks) so the app can show them again as marks
       that can be erased or changed; the app hides that layer and draws the marks itself */
    static final COSName MS_LAYER = COSName.getPDFName("MSLayer"), MS_PRE = COSName.getPDFName("MSPre"),
            MS_MARKS = COSName.getPDFName("MSMarks"), MS_OWN = COSName.getPDFName("MSOwn"), OCP = COSName.getPDFName("OCProperties");
    static final String MS_GROUP = "Markup Studio marks";

    static PDOptionalContentGroup msGroup(PDDocument doc) {
        PDDocumentCatalog cat = doc.getDocumentCatalog();
        PDOptionalContentProperties ocp = cat.getOCProperties();
        if (ocp == null) { ocp = new PDOptionalContentProperties(); cat.setOCProperties(ocp); }
        PDOptionalContentGroup g = ocp.getGroup(MS_GROUP);
        if (g == null) { g = new PDOptionalContentGroup(MS_GROUP); ocp.addGroup(g); }
        COSDictionary od = ocp.getCOSObject();
        od.setNeedToBeUpdated(true);
        for (String k : new String[]{"OCGs", "D"}) {
            COSBase v = od.getDictionaryObject(COSName.getPDFName(k));
            if (v instanceof COSArray) ((COSArray) v).setNeedToBeUpdated(true);
            if (v instanceof COSDictionary) {
                ((COSDictionary) v).setNeedToBeUpdated(true);
                for (String k2 : new String[]{"ON", "OFF", "Order"}) {
                    COSBase w = ((COSDictionary) v).getDictionaryObject(COSName.getPDFName(k2));
                    if (w instanceof COSArray) ((COSArray) w).setNeedToBeUpdated(true);
                }
            }
        }
        cat.getCOSObject().setNeedToBeUpdated(true);
        return g;
    }

    /** drop the drawing objects an earlier save of the marks left in the page resources */
    static void cleanRes(PDPage page) {
        try {
            PDResources r = page.getResources();
            if (r == null) return;
            for (COSName kind : new COSName[]{COSName.EXT_G_STATE, COSName.XOBJECT}) {
                COSBase d = r.getCOSObject().getDictionaryObject(kind);
                if (!(d instanceof COSDictionary)) continue;
                COSDictionary dd = (COSDictionary) d;
                for (COSName k : new ArrayList<>(dd.keySet())) {
                    COSBase v = dd.getDictionaryObject(k);
                    if (v instanceof COSDictionary && ((COSDictionary) v).getBoolean(MS_OWN, false)) { dd.removeItem(k); dd.setNeedToBeUpdated(true); }
                }
            }
        } catch (Exception ignored) {
        }
    }

    static String plainJson(JSONArray strokes) throws Exception {
        JSONArray a = new JSONArray();
        for (int i = 0; i < strokes.length(); i++) {
            JSONObject o = new JSONObject(strokes.getJSONObject(i).toString());
            o.remove("img"); o.remove("inOrig"); o.remove("inCopy");
            a.put(o);
        }
        return a.toString();
    }

    /** replace the page's marks (none = remove them) */
    static void writeLayer(PDDocument doc, PDPage page, JSONArray strokes) throws Exception {
        COSDictionary pd = page.getCOSObject();
        COSBase c = pd.getDictionaryObject(COSName.CONTENTS);
        COSArray arr = new COSArray();
        boolean pre = false, had = false;
        if (c instanceof COSArray) {
            COSArray ca = (COSArray) c;
            for (int i = 0; i < ca.size(); i++) {
                COSBase raw = ca.get(i), r = ca.getObject(i);
                if (r instanceof COSStream) {
                    if (((COSStream) r).getBoolean(MS_LAYER, false)) { had = true; continue; }
                    if (arr.size() == 0 && ((COSStream) r).getBoolean(MS_PRE, false)) pre = true;
                }
                arr.add(raw);
            }
        } else if (c != null) arr.add(pd.getItem(COSName.CONTENTS));
        boolean has = strokes != null && strokes.length() > 0;
        if (!has && !had && !pd.containsKey(MS_MARKS)) return;
        cleanRes(page);
        if (has && !pre) {
            COSStream q = doc.getDocument().createCOSStream();
            OutputStream os = q.createOutputStream();
            os.write("q\n".getBytes("ISO-8859-1"));
            os.close();
            q.setBoolean(MS_PRE, true);
            arr.add(0, q);
        }
        pd.setItem(COSName.CONTENTS, arr);
        if (!has) { pd.removeItem(MS_MARKS); return; }
        PDOptionalContentGroup g = msGroup(doc);
        PDPageContentStream cs = new PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, false);
        try {
            cs.restoreGraphicsState();
            cs.saveGraphicsState();
            cs.beginMarkedContent(COSName.OC, g);
            drawStrokes(doc, page, cs, strokes);
            cs.endMarkedContent();
            cs.restoreGraphicsState();
        } finally {
            cs.close();
        }
        COSBase now = pd.getDictionaryObject(COSName.CONTENTS);
        if (now instanceof COSArray) {
            COSBase last = ((COSArray) now).getObject(((COSArray) now).size() - 1);
            if (last instanceof COSStream) ((COSStream) last).setBoolean(MS_LAYER, true);
        }
        pd.setString(MS_MARKS, plainJson(strokes));
    }

    /** the marks saved in a PDF by this app: page number (1..) -> marks */
    static JSONObject readMarks(PDDocument doc) throws Exception {
        JSONObject m = new JSONObject();
        int i = 0;
        for (PDPage pg : doc.getPages()) {
            i++;
            try {
                COSBase v = pg.getCOSObject().getDictionaryObject(MS_MARKS);
                if (v instanceof COSString) m.put(String.valueOf(i), new JSONArray(((COSString) v).getString()));
            } catch (Exception ignored) {
            }
        }
        return m;
    }

    /* the same drawing the page does for pen / underline / highlighter / text */
    static void drawStrokes(PDDocument doc, PDPage page, PDPageContentStream cs, JSONArray strokes) throws Exception {
        PDRectangle cb = page.getCropBox();
        final int rot = ((page.getRotation() % 360) + 360) % 360;
        final float ox = cb.getLowerLeftX(), oy = cb.getLowerLeftY(), W0 = cb.getWidth(), H0 = cb.getHeight();
            for (int i = 0; i < strokes.length(); i++) {
                JSONObject s = strokes.getJSONObject(i);
                String t = s.optString("t");
                float a = (float) s.optDouble("a", 1);
                String hex = s.optString("c", "#000000").replace("#", "");
                if (hex.length() == 3) hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
                float r = Integer.parseInt(hex.substring(0, 2), 16) / 255f, g = Integer.parseInt(hex.substring(2, 4), 16) / 255f, b = Integer.parseInt(hex.substring(4, 6), 16) / 255f;
                PDColor col = new PDColor(new float[]{r, g, b}, PDDeviceRGB.INSTANCE);
                PDExtendedGraphicsState gs = new PDExtendedGraphicsState();
                gs.setStrokingAlphaConstant(a);
                gs.setNonStrokingAlphaConstant(a);
                gs.setBlendMode("tx".equals(t) ? BlendMode.NORMAL : BlendMode.MULTIPLY);
                gs.getCOSObject().setBoolean(MS_OWN, true);
                cs.saveGraphicsState();
                cs.setGraphicsStateParameters(gs);
                if ("tx".equals(t)) {
                    String im = s.optString("img", "");
                    if (!im.isEmpty()) {
                        byte[] bb = Base64.decode(im.substring(im.indexOf(',') + 1), Base64.DEFAULT);
                        Bitmap bm = BitmapFactory.decodeByteArray(bb, 0, bb.length);
                        if (bm != null) {
                            PDImageXObject x = LosslessFactory.createFromImage(doc, bm);
                            bm.recycle();
                            x.getCOSObject().setBoolean(MS_OWN, true);
                            double X = s.getDouble("x"), Y = s.getDouble("y"), W = s.getDouble("w"), H = s.getDouble("h");
                            float[] O = map(rot, ox, oy, W0, H0, X, Y + H), U = map(rot, ox, oy, W0, H0, X + W, Y + H), V = map(rot, ox, oy, W0, H0, X, Y);
                            cs.drawImage(x, new Matrix(U[0] - O[0], U[1] - O[1], V[0] - O[0], V[1] - O[1], O[0], O[1]));
                        }
                    }
                } else if ("hl".equals(t)) {
                    cs.setNonStrokingColor(col);
                    JSONArray segs = s.getJSONArray("segs");
                    for (int k = 0; k < segs.length(); k++) {
                        JSONArray q = segs.getJSONArray(k);
                        float[] A = map(rot, ox, oy, W0, H0, q.getDouble(0), q.getDouble(1)), B = map(rot, ox, oy, W0, H0, q.getDouble(2), q.getDouble(3));
                        cs.addRect(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1]));
                        cs.fill();
                    }
                } else {
                    cs.setStrokingColor(col);
                    cs.setLineWidth((float) s.optDouble("w", 2));
                    cs.setLineJoinStyle(1);
                    if ("wu".equals(t)) {
                        cs.setLineCapStyle(1);
                        JSONArray segs = s.getJSONArray("segs");
                        for (int k = 0; k < segs.length(); k++) {
                            JSONArray q = segs.getJSONArray(k);
                            float[] A = map(rot, ox, oy, W0, H0, q.getDouble(0), q.getDouble(2)), B = map(rot, ox, oy, W0, H0, q.getDouble(1), q.getDouble(2));
                            cs.moveTo(A[0], A[1]);
                            cs.lineTo(B[0], B[1]);
                            cs.stroke();
                        }
                    } else {
                        cs.setLineCapStyle(s.optInt("sq", 0) == 1 ? 0 : 1);
                        JSONArray q = s.getJSONArray("p");
                        int n = q.length();
                        float[][] P = new float[n][];
                        for (int k = 0; k < n; k++) P[k] = new float[]{(float) q.getJSONArray(k).getDouble(0), (float) q.getJSONArray(k).getDouble(1)};
                        if (n == 1) {
                            float[] A = map(rot, ox, oy, W0, H0, P[0][0], P[0][1]);
                            cs.moveTo(A[0], A[1]);
                            cs.lineTo(A[0] + 0.01f, A[1]);
                        } else if ("line".equals(t) || n < 3) {
                            float[] A = map(rot, ox, oy, W0, H0, P[0][0], P[0][1]), B = map(rot, ox, oy, W0, H0, P[n - 1][0], P[n - 1][1]);
                            cs.moveTo(A[0], A[1]);
                            cs.lineTo(B[0], B[1]);
                        } else {
                            float[] cur = map(rot, ox, oy, W0, H0, P[0][0], P[0][1]);
                            cs.moveTo(cur[0], cur[1]);
                            for (int k = 1; k < n - 1; k++) {
                                float[] C = map(rot, ox, oy, W0, H0, P[k][0], P[k][1]);
                                float[] E = map(rot, ox, oy, W0, H0, (P[k][0] + P[k + 1][0]) / 2, (P[k][1] + P[k + 1][1]) / 2);
                                cs.curveTo(cur[0] + 2f / 3 * (C[0] - cur[0]), cur[1] + 2f / 3 * (C[1] - cur[1]), E[0] + 2f / 3 * (C[0] - E[0]), E[1] + 2f / 3 * (C[1] - E[1]), E[0], E[1]);
                                cur = E;
                            }
                            float[] Z = map(rot, ox, oy, W0, H0, P[n - 1][0], P[n - 1][1]);
                            cs.lineTo(Z[0], Z[1]);
                        }
                        cs.stroke();
                    }
                }
                cs.restoreGraphicsState();
            }
    }

    static float[] map(int rot, float ox, float oy, float W0, float H0, double xd, double yd) {
        float x = (float) xd, y = (float) yd, u, v;
        if (rot == 0) { u = x; v = H0 - y; }
        else if (rot == 90) { u = y; v = x; }
        else if (rot == 180) { u = W0 - x; v = y; }
        else { u = W0 - y; v = H0 - x; }
        return new float[]{ox + u, oy + v};
    }

    /* only the changed pages are added at the end of the file ("incremental update"): fast even for huge books */
    static void markChanged(PDDocument doc, PDPage page) {
        COSDictionary d = page.getCOSObject();
        d.setNeedToBeUpdated(true);
        COSBase par = d.getDictionaryObject(COSName.PARENT);
        int guard = 0;
        while (par instanceof COSDictionary && guard++ < 64) {
            ((COSDictionary) par).setNeedToBeUpdated(true);
            par = ((COSDictionary) par).getDictionaryObject(COSName.PARENT);
        }
        doc.getDocumentCatalog().getCOSObject().setNeedToBeUpdated(true);
        try {
            PDResources r = page.getResources();
            if (r != null) {
                COSDictionary rd = r.getCOSObject();
                rd.setNeedToBeUpdated(true);
                COSBase eg = rd.getDictionaryObject(COSName.EXT_G_STATE);
                if (eg instanceof COSDictionary) ((COSDictionary) eg).setNeedToBeUpdated(true);
                for (COSName kn : new COSName[]{COSName.XOBJECT, COSName.PROPERTIES}) {
                    COSBase x = rd.getDictionaryObject(kn);
                    if (x instanceof COSDictionary) ((COSDictionary) x).setNeedToBeUpdated(true);
                }
            }
        } catch (Exception ignored) {
        }
        COSBase c = d.getDictionaryObject(COSName.CONTENTS);
        if (c instanceof COSArray) ((COSArray) c).setNeedToBeUpdated(true);
    }

    /** saves doc (loaded from a file) with its changes added at the end; falls back to a full save */
    static boolean saveChanges(PDDocument doc, File out) throws IOException {
        try {
            OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 1 << 16);
            try {
                doc.saveIncremental(os);
            } finally {
                os.close();
            }
            if (out.length() > 0) return true;
        } catch (Exception ex) {
            Log.w("MarkupStudio", "incremental save failed, full save: " + ex);
        }
        doc.save(out);
        return false;
    }

    /** a copy of one page that keeps everything it inherits from the book (size, resources, rotation) */
    static PDPage importPage(PDDocument out, PDPage src) throws IOException {
        PDPage p = out.importPage(src);
        p.setResources(src.getResources());
        p.setMediaBox(src.getMediaBox());
        p.setCropBox(src.getCropBox());
        p.setRotation(src.getRotation());
        return p;
    }

    static String sha1(String t) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(t.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(t.hashCode());
        }
    }

    static void deleteDir(File d) {
        File[] l = d.listFiles();
        if (l != null) for (File f : l) { if (f.isDirectory()) deleteDir(f); else f.delete(); }
        d.delete();
    }

    static void readOutline(PDDocument doc, PDOutlineNode node, int lv, JSONArray out, java.util.Map<PDPage, Integer> idx) {
        if (node == null || lv > 6 || out.length() > 3000) return;
        for (PDOutlineItem it : node.children()) {
            try {
                PDPage pg = it.findDestinationPage(doc);
                Integer i = pg == null ? null : idx.get(pg);
                if (i != null) out.put(new JSONObject().put("title", it.getTitle() == null ? "" : it.getTitle().trim()).put("lv", lv).put("pi", i));
            } catch (Exception ignored) {
            }
            readOutline(doc, it, lv + 1, out, idx);
        }
    }

}
