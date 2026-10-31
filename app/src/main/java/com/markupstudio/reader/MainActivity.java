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

/**
 * Markup Studio: a full-screen WebView host.
 * - registers files from "Open with" / "Share" / the picker and serves them to the page at /__file/<id>
 * - saves edited PDFs into the original file or as a new copy (no prompts)
 * - exposes Android text-to-speech (online + offline voices, English + Hindi)
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final int REQ_PICK = 11, REQ_TREE = 12, REQ_PERM = 13, REQ_ALLFILES = 14;

    private WebView web;
    private WebViewAssetLoader loader;
    private SharedPreferences prefs;

    private static class Entry {
        int id;
        Uri uri;
        File file;
        String name, mime;
        long size;
    }

    private final Map<Integer, Entry> entries = new ConcurrentHashMap<>();
    private final List<Entry> pending = new ArrayList<>();
    private int nextId = 1;

    private synchronized int newId() {
        return nextId++;
    }
    private boolean jsReady = false;
    private String pickMode = "replace";

    private TextToSpeech tts;
    private boolean ttsReady = false;

    private File saveTmp;
    private OutputStream saveOs;

    /* ------------------------------------------------------------------ lifecycle */

    /* ---- crash reporter: a failure is shown on screen next time instead of the app just closing ---- */

    private static void installCrashCatcher(final Context ctx) {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        if (prev instanceof CrashCatcher) return;
        Thread.setDefaultUncaughtExceptionHandler(new CrashCatcher(ctx.getApplicationContext(), prev));
    }

    private static class CrashCatcher implements Thread.UncaughtExceptionHandler {
        final Context ctx;
        final Thread.UncaughtExceptionHandler prev;

        CrashCatcher(Context c, Thread.UncaughtExceptionHandler p) {
            ctx = c;
            prev = p;
        }

        @Override
        public void uncaughtException(Thread t, Throwable e) {
            saveCrash(ctx, e);
            if (prev != null) prev.uncaughtException(t, e);
        }
    }

    static void saveCrash(Context ctx, Throwable e) {
        try {
            java.io.StringWriter sw = new java.io.StringWriter();
            e.printStackTrace(new java.io.PrintWriter(sw));
            String info = "Markup Studio crash\nAndroid " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")\n"
                    + Build.MANUFACTURER + " " + Build.MODEL + "\n\n" + sw;
            ctx.getSharedPreferences("ms_crash", MODE_PRIVATE).edit().putString("trace", info).commit();
        } catch (Throwable ignored) {
        }
    }

    private void showError(final String text, final boolean canContinue) {
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.WHITE);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad * 2, pad, pad);

        android.widget.TextView head = new android.widget.TextView(this);
        head.setText("Markup Studio hit a problem. Tap COPY and paste it to Claude.");
        head.setTextColor(Color.BLACK);
        head.setTextSize(18);
        box.addView(head);

        android.widget.LinearLayout row = new android.widget.LinearLayout(this);
        android.widget.Button copy = new android.widget.Button(this);
        copy.setText("COPY");
        copy.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("crash", text));
                Toast.makeText(MainActivity.this, "Copied", Toast.LENGTH_SHORT).show();
            }
        });
        row.addView(copy);
        if (canContinue) {
            android.widget.Button go = new android.widget.Button(this);
            go.setText("OPEN APP");
            go.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    getSharedPreferences("ms_crash", MODE_PRIVATE).edit().remove("trace").commit();
                    recreate();
                }
            });
            row.addView(go);
        }
        box.addView(row);

        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        android.widget.TextView tv = new android.widget.TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.DKGRAY);
        tv.setTextSize(12);
        tv.setTextIsSelectable(true);
        sv.addView(tv);
        box.addView(sv);
        setContentView(box);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        installCrashCatcher(this);
        String last = getSharedPreferences("ms_crash", MODE_PRIVATE).getString("trace", null);
        if (last != null) {
            showError(last, true);
            return;
        }
        try {
            setup();
        } catch (Throwable e) {
            saveCrash(this, e);
            web = null;
            showError(getSharedPreferences("ms_crash", MODE_PRIVATE).getString("trace", String.valueOf(e)), true);
        }
    }

    private void setup() {
        prefs = getSharedPreferences("ms", MODE_PRIVATE);
        try {
            File[] old = workDir().listFiles();
            if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 6 * 3600 * 1000L) f.delete();
        } catch (Exception ignored) {
        }

        loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/__file/", new FileHandler())
                .build();

        web = new WebView(this);
        applyTheme(prefs.getString("p_theme", "light"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);
        /* the keyboard covers the bottom of the page (full screen mode cannot resize): tell the page how much,
           so the toolbars sit just above the keyboard */
        try {
            final View root = getWindow().getDecorView();
            root.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener() {
                int last = -1;
                @Override
                public void onGlobalLayout() {
                    try {
                        if (web == null) return;
                        android.graphics.Rect r = new android.graphics.Rect();
                        root.getWindowVisibleDisplayFrame(r);
                        int[] loc = new int[2];
                        web.getLocationOnScreen(loc);
                        float d = getResources().getDisplayMetrics().density;
                        int over = loc[1] + web.getHeight() - r.bottom;
                        if (over < 80 * d) over = 0;
                        if (over != last) {
                            last = over;
                            if (jsReady) web.evaluateJavascript("window.__kb&&window.__kb(" + Math.round(over / d) + ")", null);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });
        } catch (Throwable ignored) {
        }
        try {
            applyFullscreen(prefs.getBoolean("fullscreen", true));
        } catch (Throwable ignored) {
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String path = u.getPath();
                if (HOST.equals(u.getHost()) && path != null && path.startsWith("/__file/"))
                    return serveFile(path.substring(8), r.getRequestHeaders());
                return loader.shouldInterceptRequest(u);
            }

            /* the page viewer process was killed (usually: out of memory with a very big file).
               Without this the whole app closes; with it the viewer restarts and reopens the book. */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recoverViewer();
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !HOST.equals(r.getUrl().getHost());   // never leave the app
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");

        handleIntent(getIntent());
        web.loadUrl("https://" + HOST + "/assets/index.html");
        startedAt = System.currentTimeMillis();

        if (!prefs.getBoolean("askedStorage", false)) {
            prefs.edit().putBoolean("askedStorage", true).apply();
            web.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (hasStorage() || isFinishing()) return;
                    try {
                        new android.app.AlertDialog.Builder(MainActivity.this, isDark(prefs.getString("p_theme", "light")) ? android.R.style.Theme_Material_Dialog_Alert : android.R.style.Theme_Material_Light_Dialog_Alert)
                                .setTitle("Allow file access?")
                                .setMessage("Markup Studio needs file access to save your markings back into the original file. "
                                        + "Tap ALLOW, then switch on the setting and press Back to return here.")
                                .setPositiveButton("ALLOW", new android.content.DialogInterface.OnClickListener() {
                                    @Override
                                    public void onClick(android.content.DialogInterface d, int w) {
                                        requestStorage();
                                    }
                                })
                                .setNegativeButton("LATER", null)
                                .show();
                    } catch (Throwable ignored) {
                    }
                }
            }, 1500);
        }
    }

    private long startedAt = 0;
    private boolean safeStart = false;

    private void recoverViewer() {
        long now = System.currentTimeMillis();
        safeStart = now - startedAt < 60000;          // died again within a minute: do not reopen the same book automatically
        try {
            if (web != null) {
                ViewGroup parent = (ViewGroup) web.getParent();
                if (parent != null) parent.removeView(web);
                web.destroy();
            }
        } catch (Throwable ignored) {
        }
        web = null;
        jsReady = false;
        synchronized (pending) {
            pending.clear();
        }
        setIntent(new Intent());
        try {
            setup();
            toastUi(safeStart ? "The viewer ran out of memory again. Open a smaller part of the book, or close other apps."
                    : "The viewer ran out of memory and was restarted.");
        } catch (Throwable e) {
            saveCrash(this, e);
            showError(getSharedPreferences("ms_crash", MODE_PRIVATE).getString("trace", String.valueOf(e)), true);
        }
    }

    /* ---- serves opened files to the page; supports byte ranges so big PDFs are read piece by piece ---- */

    private static class LimitedStream extends FilterInputStream {
        private long left;

        LimitedStream(InputStream in, long n) {
            super(in);
            left = n;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int c = super.read();
            if (c >= 0) left--;
            return c;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }

    private InputStream openAt(Entry e, long pos) throws IOException {
        FileInputStream fis = null;
        if (e.file != null && e.file.canRead()) fis = new FileInputStream(e.file);
        else if (e.uri != null) {
            ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(e.uri, "r");
            if (pfd != null) fis = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
        }
        if (fis != null) {
            try {
                fis.getChannel().position(pos);
                return fis;
            } catch (Exception ex) {
                try {
                    fis.close();
                } catch (Exception ignored) {
                }
            }
        }
        InputStream in = openStream(e);                 // not seekable: read up to the position
        long skip = pos;
        while (skip > 0) {
            long k = in.skip(skip);
            if (k <= 0) {
                if (in.read() < 0) break;
                k = 1;
            }
            skip -= k;
        }
        return in;
    }

    private WebResourceResponse serveFile(String id, Map<String, String> reqHeaders) {
        try {
            Entry e = entries.get(Integer.parseInt(id));
            if (e == null) throw new FileNotFoundException(id);
            long total = e.size > 0 ? e.size : (e.file != null ? e.file.length() : -1);
            String range = null;
            if (reqHeaders != null) for (Map.Entry<String, String> h : reqHeaders.entrySet())
                if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            h.put("Accept-Ranges", "bytes");
            if (range != null && total > 0 && range.startsWith("bytes=") && range.indexOf(',') < 0) {
                String[] ab = range.substring(6).trim().split("-", -1);
                long a, b;
                if (ab[0].isEmpty()) {
                    a = Math.max(0, total - Long.parseLong(ab[1]));
                    b = total - 1;
                } else {
                    a = Long.parseLong(ab[0]);
                    b = ab.length > 1 && !ab[1].isEmpty() ? Math.min(Long.parseLong(ab[1]), total - 1) : total - 1;
                }
                if (a <= b && a < total) {
                    h.put("Content-Range", "bytes " + a + "-" + b + "/" + total);
                    h.put("Content-Length", String.valueOf(b - a + 1));
                    Log.i("MarkupStudio", "MSRange " + a + "-" + b + "/" + total);
                    return new WebResourceResponse(e.mime, null, 206, "Partial Content", h, new LimitedStream(openAt(e, a), b - a + 1));
                }
            }
            if (total > 0) h.put("Content-Length", String.valueOf(total));
            return new WebResourceResponse(e.mime, null, 200, "OK", h, openStream(e));
        } catch (Exception ex) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", new HashMap<String, String>(),
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (web == null) return;
        if (intent != null && intent.getBooleanExtra("ms_selftest", false)) {      // only used by the automatic tests
            js("window.__selfTest&&window.__selfTest()");
            return;
        }
        List<Entry> added = handleIntent(intent);
        if (!added.isEmpty() && jsReady) deliver(added, "replace");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null && jsReady) web.evaluateJavascript("window.__paused&&window.__paused()", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        try {
            if (hasFocus && web != null && prefs != null && prefs.getBoolean("fullscreen", true)) applyFullscreen(true);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("window.__back?window.__back():false", new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (!"true".equals(v)) finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ theme */

    private boolean isDark(String t) {
        if ("dark".equals(t)) return true;
        if (!"auto".equals(t)) return false;
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyTheme(String t) {
        int bg = isDark(t) ? 0xFF15171A : Color.WHITE;
        try {
            if (web != null) web.setBackgroundColor(bg);
            getWindow().getDecorView().setBackgroundColor(bg);
        } catch (Throwable ignored) {
        }
    }

    /* ------------------------------------------------------------------ full screen */

    private void applyFullscreen(boolean on) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(!on);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int bars = WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars();
                if (on) {
                    c.hide(bars);
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    c.show(bars);
                }
            }
        } else {
            int f = on ? (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
                    : View.SYSTEM_UI_FLAG_VISIBLE;
            w.getDecorView().setSystemUiVisibility(f);
        }
    }

    /* ------------------------------------------------------------------ storage permission */

    private boolean hasStorage() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        if (Build.VERSION.SDK_INT >= 23)
            return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        return true;
    }

    private void requestStorage() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startActivityForResult(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getPackageName())), REQ_ALLFILES);
            } catch (Exception e) {
                try {
                    startActivityForResult(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), REQ_ALLFILES);
                } catch (Exception ignored) {
                }
            }
        } else if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERM && !hasStorage() && Build.VERSION.SDK_INT >= 23
                && !shouldShowRequestPermissionRationale(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            toastUi("Turn on Storage in Permissions, then come back");
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {
            }
        }
        jsEvent("storage");
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_ALLFILES) {
            jsEvent("storage");
        } else if (req == REQ_TREE) {
            if (res == RESULT_OK && data != null && data.getData() != null) {
                Uri t = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(t,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {
                }
                Set<String> set = new HashSet<>(prefs.getStringSet("trees", new HashSet<String>()));
                set.add(t.toString());
                prefs.edit().putStringSet("trees", set).apply();
                toastUi("Folder access granted");
            }
            jsEvent("storage");
        } else if (req == REQ_PICK) {
            if (res != RESULT_OK || data == null) return;
            List<Uri> uris = new ArrayList<>();
            ClipData cd = data.getClipData();
            if (cd != null) {
                for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
            List<Entry> added = new ArrayList<>();
            for (Uri u : uris) {
                if (u == null) continue;
                try {
                    getContentResolver().takePersistableUriPermission(u,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception e) {
                    try {
                        getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ignored) {
                    }
                }
                added.add(register(u, null));
            }
            if (!added.isEmpty()) deliver(added, pickMode);
        }
    }

    /* ------------------------------------------------------------------ incoming files */

    private List<Entry> handleIntent(Intent it) {
        List<Entry> added = new ArrayList<>();
        if (it == null || it.getAction() == null) return added;
        String a = it.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(a) || Intent.ACTION_EDIT.equals(a)) {
            if (it.getData() != null) uris.add(it.getData());
        } else if (Intent.ACTION_SEND.equals(a)) {
            @SuppressWarnings("deprecation")
            Uri u = it.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
            else if (it.getStringExtra(Intent.EXTRA_TEXT) != null) {
                Entry e = sharedText(it.getStringExtra(Intent.EXTRA_TEXT));
                if (e != null) added.add(e);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            @SuppressWarnings("deprecation")
            ArrayList<Uri> l = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        } else {
            return added;
        }
        for (Uri u : uris) {
            try {
                getContentResolver().takePersistableUriPermission(u,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {
            }
            added.add(register(u, it.getType()));
        }
        synchronized (pending) {
            pending.addAll(added);
        }
        return added;
    }

    private Entry sharedText(String text) {
        try {
            File f = new File(getCacheDir(), "shared-text-" + System.currentTimeMillis() + ".txt");
            FileOutputStream os = new FileOutputStream(f);
            os.write(text.getBytes("UTF-8"));
            os.close();
            Entry e = new Entry();
            e.id = newId();
            e.file = f;
            e.name = f.getName();
            e.mime = "text/plain";
            e.size = f.length();
            entries.put(e.id, e);
            return e;
        } catch (IOException ex) {
            return null;
        }
    }

    private Entry register(Uri uri, String mime) {
        Entry e = new Entry();
        e.id = newId();
        e.uri = uri;
        e.mime = mime;
        if ("file".equals(uri.getScheme())) {
            e.file = new File(uri.getPath());
            e.name = e.file.getName();
            e.size = e.file.length();
        } else {
            Cursor c = null;
            try {
                c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null);
                if (c != null && c.moveToFirst()) {
                    e.name = c.getString(0);
                    e.size = c.isNull(1) ? 0 : c.getLong(1);
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
            e.file = resolvePath(uri);
        }
        if (e.name == null || e.name.isEmpty()) {
            String seg = uri.getLastPathSegment();
            e.name = seg == null ? "document" : seg.substring(seg.lastIndexOf('/') + 1);
        }
        if (e.mime == null || e.mime.equals("*/*") || e.mime.equals("application/octet-stream")) {
            int dot = e.name.lastIndexOf('.');
            String g = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(e.name.substring(dot + 1).toLowerCase(Locale.ROOT));
            if (g == null && !"file".equals(uri.getScheme())) g = getContentResolver().getType(uri);
            e.mime = g != null ? g : "application/octet-stream";
        }
        entries.put(e.id, e);
        return e;
    }

    /** Best-effort conversion of a content:// Uri to a real path (internal storage, SD card, USB). */
    private File resolvePath(Uri uri) {
        try {
            String auth = uri.getAuthority();
            if (DocumentsContract.isDocumentUri(this, uri)) {
                String id = DocumentsContract.getDocumentId(uri);
                if ("com.android.externalstorage.documents".equals(auth)) {
                    String[] sp = id.split(":", 2);
                    File base = sp[0].equalsIgnoreCase("primary") ? Environment.getExternalStorageDirectory() : new File("/storage/" + sp[0]);
                    return sp.length > 1 ? new File(base, sp[1]) : base;
                }
                if ("com.android.providers.downloads.documents".equals(auth) && id.startsWith("raw:")) {
                    return new File(id.substring(4));
                }
            }
            Cursor c = null;
            try {
                c = getContentResolver().query(uri, new String[]{"_data"}, null, null, null);
                if (c != null && c.moveToFirst() && !c.isNull(0)) {
                    File f = new File(c.getString(0));
                    if (f.exists()) return f;
                }
            } finally {
                if (c != null) c.close();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private InputStream openStream(Entry e) throws IOException {
        if (e.uri != null) {
            try {
                InputStream in = getContentResolver().openInputStream(e.uri);
                if (in != null) return in;
            } catch (Exception ignored) {
            }
        }
        if (e.file != null && e.file.canRead()) return new FileInputStream(e.file);
        throw new FileNotFoundException(e.name);
    }

    private JSONObject entryJson(Entry e) throws Exception {
        return new JSONObject().put("id", e.id).put("name", e.name).put("mime", e.mime).put("size", e.size);
    }

    private void deliver(List<Entry> es, String mode) {
        try {
            JSONArray arr = new JSONArray();
            for (Entry e : es) arr.put(entryJson(e));
            synchronized (pending) {
                pending.removeAll(es);
            }
            final String js = ("window.__nativeOpen&&window.__nativeOpen(" + arr.toString() + "," + JSONObject.quote(mode) + ")")
                    .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    web.evaluateJavascript(js, null);
                }
            });
        } catch (Exception ignored) {
        }
    }

    private void jsEvent(final String ev) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript("window.__nativeEvent&&window.__nativeEvent(" + JSONObject.quote(ev) + ")", null);
            }
        });
    }

    private void toastUi(final String m) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /* ------------------------------------------------------------------ serving files to the page */

    private class FileHandler implements WebViewAssetLoader.PathHandler {
        @Override
        public WebResourceResponse handle(String path) {
            try {
                Entry e = entries.get(Integer.parseInt(path));
                if (e == null) throw new FileNotFoundException(path);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-store");
                if (e.size > 0) h.put("Content-Length", String.valueOf(e.size));
                return new WebResourceResponse(e.mime, null, 200, "OK", h, openStream(e));
            } catch (Exception ex) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", new HashMap<String, String>(),
                        new ByteArrayInputStream(new byte[0]));
            }
        }
    }

    /* ------------------------------------------------------------------ saving */

    private static String stripExt(String n) {
        int i = n.lastIndexOf('.');
        return i > 0 ? n.substring(0, i) : n;
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        String base = stripExt(name), ext = name.substring(base.length());
        for (int i = 2; i < 1000; i++) {
            f = new File(dir, base + "-" + i + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private void copyTmpTo(OutputStream os) throws IOException {
        InputStream in = new FileInputStream(saveTmp);
        try {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            os.flush();
        } finally {
            in.close();
        }
    }

    private void copyTmpToFile(File dest) throws IOException {
        FileOutputStream os = new FileOutputStream(dest, false);
        try {
            copyTmpTo(os);
        } finally {
            os.close();
        }
    }

    private void scan(File f) {
        try {
            MediaScannerConnection.scanFile(this, new String[]{f.getPath()}, null, null);
        } catch (Exception ignored) {
        }
    }

    private void replaceFile(File f) throws IOException {
        File dir = f.getParentFile();
        boolean done = false;
        if (dir != null) {
            File tmp = new File(dir, "." + f.getName() + ".ms.tmp");
            try {
                copyTmpToFile(tmp);
                if (tmp.renameTo(f) || (f.delete() && tmp.renameTo(f))) done = true;
            } catch (IOException ignored) {
            } finally {
                if (tmp.exists() && !done) tmp.delete();
            }
        }
        if (!done) copyTmpToFile(f);          // e.g. file is writable but its folder is not
        scan(f);
    }

    /** "<volume>" and the path below it for /storage/<vol>/... and the primary storage paths. */
    private String[] volumeAndRel(File f) {
        String p = f.getAbsolutePath();
        String prim = Environment.getExternalStorageDirectory().getAbsolutePath();
        String[] primaries = {prim, "/storage/emulated/0", "/sdcard", "/mnt/sdcard"};
        for (String q : primaries) {
            if (p.equals(q) || p.startsWith(q + "/")) return new String[]{"primary", p.length() > q.length() ? p.substring(q.length() + 1) : ""};
        }
        if (p.startsWith("/storage/")) {
            String r = p.substring(9);
            int i = r.indexOf('/');
            if (i > 0) return new String[]{r.substring(0, i), r.substring(i + 1)};
        }
        return null;
    }

    private Uri treeFor(String vol, String rel) {
        Set<String> trees = prefs.getStringSet("trees", new HashSet<String>());
        for (String t : trees) {
            try {
                Uri tu = Uri.parse(t);
                String tid = DocumentsContract.getTreeDocumentId(tu);
                String[] sp = tid.split(":", 2);
                if (!sp[0].equalsIgnoreCase(vol)) continue;
                String sub = sp.length > 1 ? sp[1] : "";
                if (sub.isEmpty() || rel.equals(sub) || rel.startsWith(sub + "/")) return tu;
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    private String writeViaTreeExisting(File f) {
        String[] vr = volumeAndRel(f);
        if (vr == null) return null;
        Uri tu = treeFor(vr[0], vr[1]);
        if (tu == null) return null;
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tu, vr[0] + ":" + vr[1]);
            OutputStream os = getContentResolver().openOutputStream(doc, "wt");
            if (os == null) return null;
            try {
                copyTmpTo(os);
            } finally {
                os.close();
            }
            return f.getPath();
        } catch (Exception e) {
            return null;
        }
    }

    private String writeViaTreeNew(File dir, String name, String mime) {
        String[] vr = volumeAndRel(dir);
        if (vr == null) return null;
        Uri tu = treeFor(vr[0], vr[1]);
        if (tu == null) return null;
        try {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tu, vr[0] + ":" + vr[1]);
            Uri doc = DocumentsContract.createDocument(getContentResolver(), parent, mime, name);
            if (doc == null) return null;
            OutputStream os = getContentResolver().openOutputStream(doc, "wt");
            if (os == null) return null;
            try {
                copyTmpTo(os);
            } finally {
                os.close();
            }
            return new File(dir, name).getPath();
        } catch (Exception e) {
            return null;
        }
    }

    private String writePublic(String subDir, String name, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/" + subDir);
            Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            lastPublicUri = u;
            if (u == null) throw new IOException("MediaStore insert failed");
            OutputStream os = getContentResolver().openOutputStream(u);
            if (os == null) throw new IOException("cannot open output");
            try {
                copyTmpTo(os);
            } finally {
                os.close();
            }
            return "Download/" + subDir + "/" + name;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subDir);
        dir.mkdirs();
        File f = unique(dir, name);
        copyTmpToFile(f);
        scan(f);
        return f.getPath();
    }

    private String writeOriginal(Entry e) {
        if (e.file != null && e.file.exists()) {
            try {
                replaceFile(e.file);
                return e.file.getPath();
            } catch (IOException | SecurityException ignored) {
            }
        }
        if (e.uri != null && "content".equals(e.uri.getScheme())) {
            try {
                OutputStream os = getContentResolver().openOutputStream(e.uri, "wt");
                if (os != null) {
                    try {
                        copyTmpTo(os);
                    } finally {
                        os.close();
                    }
                    return e.file != null ? e.file.getPath() : e.name;
                }
            } catch (Exception ignored) {
            }
        }
        if (e.file != null) return writeViaTreeExisting(e.file);
        return null;
    }

    /** writes the pending file into a folder the user picked; null if that is not possible */
    private String writeToDir(String dirPath, String name, String mime) {
        if (dirPath == null || dirPath.isEmpty()) return null;
        File dir = new File(dirPath);
        File f = unique(dir, name);
        try {
            if (!dir.exists()) dir.mkdirs();
            copyTmpToFile(f);
            scan(f);
            return f.getPath();
        } catch (Exception ignored) {
            if (f.exists() && f.length() == 0) f.delete();
        }
        return writeViaTreeNew(dir, f.getName(), mime);
    }

    private String writeCopy(Entry e, String suggested) throws Exception {
        String nm = (e != null && e.name != null ? stripExt(e.name) + "-edited.pdf" : suggested);
        String cdir = prefs.getString("p_copyDir", "");
        boolean nextToOriginal = !"dir".equals(prefs.getString("p_copyWhere", cdir.isEmpty() ? "orig" : "dir")) || cdir.isEmpty();
        String chosen = nextToOriginal ? null : writeToDir(prefs.getString("p_copyDir", ""), nm, "application/pdf");
        if (chosen != null) return chosen;
        if (e != null && e.file != null && e.file.getParentFile() != null) {
            File dir = e.file.getParentFile();
            File f = unique(dir, nm);
            try {
                copyTmpToFile(f);
                scan(f);
                return f.getPath();
            } catch (IOException | SecurityException ignored) {
            }
            String w = writeViaTreeNew(dir, f.getName(), "application/pdf");
            if (w != null) return w;
        }
        if (nextToOriginal) { String w = writeToDir(prefs.getString("p_copyDir", ""), nm, "application/pdf"); if (w != null) return w; }
        return writePublic("MarkupStudio", nm, "application/pdf");
    }

    /* ------------------------------------------------------------------ PDF tools for big books (PDFBox, uses disk instead of memory) */

    private final Object saveLock = new Object();
    private int jobSeq = 0;
    private boolean pdfboxReady = false;

    private File workDir() {
        File best = getCacheDir();
        try {
            File ext = getExternalCacheDir();
            if (ext != null && ext.getUsableSpace() > best.getUsableSpace()) best = ext;
        } catch (Exception ignored) {
        }
        File d = new File(best, "work");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private MemoryUsageSetting diskMemory() {
        return MemoryUsageSetting.setupTempFileOnly().setTempDir(workDir());
    }

    private static void copyFile(File a, File b) throws IOException {
        InputStream in = new FileInputStream(a);
        OutputStream os = new FileOutputStream(b);
        try {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        } finally {
            in.close();
            os.close();
        }
    }

    /** put a finished file in the export folder (or Download/MarkupStudio) */
    private String deliverFile(File tmp, String name) throws Exception {
        synchronized (saveLock) {
            File old = saveTmp;
            saveTmp = tmp;
            try {
                String w = writeToDir(prefs.getString("p_exportDir", ""), name, "application/pdf");
                return w != null ? w : writePublic("MarkupStudio", name, "application/pdf");
            } finally {
                saveTmp = old;
            }
        }
    }

    private PDDocument openPdf(Entry e) throws Exception {
        if (!pdfboxReady) {
            PDFBoxResourceLoader.init(getApplicationContext());
            pdfboxReady = true;
        }
        if (e.file != null && e.file.canRead()) return PDDocument.load(e.file, diskMemory());
        InputStream in = openStream(e);
        try {
            return PDDocument.load(in, diskMemory());
        } finally {
            in.close();
        }
    }

    private void jobMsg(String id, String type, JSONObject data) {
        js("window.__job&&window.__job(" + JSONObject.quote(id) + "," + JSONObject.quote(type) + "," + data + ")");
    }

    private void jobProgress(String id, int done, int total, String msg) {
        try {
            jobMsg(id, "progress", new JSONObject().put("done", done).put("total", total).put("msg", msg));
        } catch (Exception ignored) {
        }
    }

    /* marks are kept in the PDF as one extra drawing per page inside the optional layer "Markup Studio marks"
       (other PDF apps show it), plus the marks themselves (/MSMarks) so the app can show them again as marks
       that can be erased or changed; the app hides that layer and draws the marks itself */
    static final COSName MS_LAYER = COSName.getPDFName("MSLayer"), MS_PRE = COSName.getPDFName("MSPre"),
            MS_MARKS = COSName.getPDFName("MSMarks"), MS_OWN = COSName.getPDFName("MSOwn"), OCP = COSName.getPDFName("OCProperties");
    static final String MS_GROUP = "Markup Studio marks";

    private static PDOptionalContentGroup msGroup(PDDocument doc) {
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
    private static void cleanRes(PDPage page) {
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

    private static String plainJson(JSONArray strokes) throws Exception {
        JSONArray a = new JSONArray();
        for (int i = 0; i < strokes.length(); i++) {
            JSONObject o = new JSONObject(strokes.getJSONObject(i).toString());
            o.remove("img"); o.remove("inOrig"); o.remove("inCopy");
            a.put(o);
        }
        return a.toString();
    }

    /** replace the page's marks (none = remove them) */
    private static void writeLayer(PDDocument doc, PDPage page, JSONArray strokes) throws Exception {
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
    private static JSONObject readMarks(PDDocument doc) throws Exception {
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
    private static void drawStrokes(PDDocument doc, PDPage page, PDPageContentStream cs, JSONArray strokes) throws Exception {
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

    private static float[] map(int rot, float ox, float oy, float W0, float H0, double xd, double yd) {
        float x = (float) xd, y = (float) yd, u, v;
        if (rot == 0) { u = x; v = H0 - y; }
        else if (rot == 90) { u = y; v = x; }
        else if (rot == 180) { u = W0 - x; v = y; }
        else { u = W0 - y; v = H0 - x; }
        return new float[]{ox + u, oy + v};
    }

    /* only the changed pages are added at the end of the file ("incremental update"): fast even for huge books */
    private static void markChanged(PDDocument doc, PDPage page) {
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
    private static boolean saveChanges(PDDocument doc, File out) throws IOException {
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
    private static PDPage importPage(PDDocument out, PDPage src) throws IOException {
        PDPage p = out.importPage(src);
        p.setResources(src.getResources());
        p.setMediaBox(src.getMediaBox());
        p.setCropBox(src.getCropBox());
        p.setRotation(src.getRotation());
        return p;
    }

    /* ---- big books are cut once into part files (kept in the app's storage) so only one part is ever in memory ---- */

    private File booksDir() {
        File base = getExternalCacheDir();
        if (base == null) base = getCacheDir();
        File d = new File(base, "books");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String sha1(String t) {
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

    private String bookKey(Entry e, int partSize) {
        long size = e.file != null ? e.file.length() : e.size, mt = e.file != null ? e.file.lastModified() : 0;
        return sha1((e.file != null ? e.file.getPath() : String.valueOf(e.uri)) + "|" + size + "|" + mt + "|" + partSize + "|v2");
    }

    private static void deleteDir(File d) {
        File[] l = d.listFiles();
        if (l != null) for (File f : l) { if (f.isDirectory()) deleteDir(f); else f.delete(); }
        d.delete();
    }

    private static void readOutline(PDDocument doc, PDOutlineNode node, int lv, JSONArray out, java.util.Map<PDPage, Integer> idx) {
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

    private void prepareBook(String id, JSONObject o) throws Exception {
        Entry e = entries.get(o.getInt("src"));
        if (e == null) throw new FileNotFoundException("The book is no longer open");
        int ps = Math.max(50, o.optInt("partSize", 200));
        String key = bookKey(e, ps);
        File dir = new File(booksDir(), key), info = new File(dir, "info.json");
        if (info.isFile()) {                                   // prepared before: open straight away
            try {
                byte[] b = new byte[(int) info.length()];
                FileInputStream in = new FileInputStream(info);
                int off = 0, n;
                while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
                in.close();
                JSONObject j = new JSONObject(new String(b, "UTF-8"));
                JSONArray files = j.getJSONArray("files");
                boolean ok = j.optBoolean("complete");
                for (int i = 0; ok && i < files.length(); i++) ok = new File(files.getString(i)).isFile();
                if (ok) {
                    info.setLastModified(System.currentTimeMillis());
                    jobMsg(id, "done", j.put("ok", true).put("cached", true));
                    return;
                }
            } catch (Exception ignored) {
            }
        }
        long size = e.file != null ? e.file.length() : e.size;
        File[] olds = booksDir().listFiles();                 // keep the storage use small: forget books prepared earlier
        if (olds != null) {
            java.util.Arrays.sort(olds, new java.util.Comparator<File>() {
                public int compare(File a, File b) { return Long.compare(new File(b, "info.json").lastModified(), new File(a, "info.json").lastModified()); }
            });
            int kept = 0;
            for (File f : olds) {
                if (f.getName().equals(key)) continue;
                if (kept < 1 && booksDir().getUsableSpace() > size * 2.3) { kept++; continue; }
                deleteDir(f);
            }
        }
        if (booksDir().getUsableSpace() < size * 1.15 + 50e6) throw new IOException("Not enough free storage space to prepare this book in parts");
        if (dir.exists()) deleteDir(dir);
        dir.mkdirs();
        jobProgress(id, 0, 1, "Opening the book…");
        PDDocument src = openPdf(e);
        try {
            int n = src.getNumberOfPages(), parts = (n + ps - 1) / ps;
            java.util.List<PDPage> all = new ArrayList<>();
            try { for (PDPage pg : src.getPages()) all.add(pg); } catch (Exception ex) { all.clear(); }
            java.util.Map<PDPage, Integer> idx = new HashMap<>();
            for (int i = 0; i < all.size(); i++) idx.put(all.get(i), i);
            JSONArray outline = new JSONArray();
            try { PDDocumentOutline ol = src.getDocumentCatalog().getDocumentOutline(); if (ol != null) readOutline(src, ol, 0, outline, idx); } catch (Exception ignored) { }
            JSONArray sizes = new JSONArray();                // every page's size as shown (crop box, turned by rotation)
            for (int i = 0; i < n; i++) {
                float w = 595, h = 842;
                try {
                    PDPage pg = i < all.size() ? all.get(i) : src.getPage(i);
                    PDRectangle cb = pg.getCropBox();
                    w = cb.getWidth(); h = cb.getHeight();
                    int r = ((pg.getRotation() % 360) + 360) % 360;
                    if (r == 90 || r == 270) { float t = w; w = h; h = t; }
                } catch (Exception ignored) {
                }
                sizes.put(new JSONArray().put(Math.round(w * 10) / 10.0).put(Math.round(h * 10) / 10.0));
            }
            JSONObject j = new JSONObject().put("n", n).put("partSize", ps).put("parts", parts).put("outline", outline).put("key", key).put("sizes", sizes);
            jobMsg(id, "info", j);
            int first = Math.max(0, Math.min(parts - 1, o.optInt("first", 0)));
            String[] files = new String[parts];
            java.util.List<Integer> order = new ArrayList<>();
            order.add(first);
            for (int k = 0; k < parts; k++) if (k != first) order.add(k);
            int done = 0;
            for (int k : order) {
                int a = k * ps, b = Math.min(n, a + ps);
                PDDocument out = new PDDocument(diskMemory());
                try {
                    for (int i = a; i < b; i++) {
                        PDPage np;
                        try { np = importPage(out, i < all.size() ? all.get(i) : src.getPage(i)); }
                        catch (Exception ex) { np = new PDPage(PDRectangle.A4); out.addPage(np); }
                    }
                    try { COSBase ocp = src.getDocumentCatalog().getCOSObject().getDictionaryObject(OCP); if (ocp != null) out.getDocumentCatalog().getCOSObject().setItem(OCP, ocp); } catch (Exception ignored) { }
                    if (src.isEncrypted()) out.setAllSecurityToBeRemoved(true);
                    File f = new File(dir, String.format(Locale.ROOT, "part-%03d.pdf", k + 1));
                    out.save(f);
                    files[k] = f.getPath();
                } finally {
                    out.close();
                }
                done++;
                jobMsg(id, "part", new JSONObject().put("k", k).put("path", files[k]).put("done", done).put("parts", parts));
            }
            JSONArray fa = new JSONArray();
            for (String f : files) fa.put(f);
            j.put("files", fa).put("complete", true);
            OutputStream os = new FileOutputStream(info);
            os.write(j.toString().getBytes("UTF-8"));
            os.close();
            jobMsg(id, "done", j.put("ok", true));
        } finally {
            src.close();
        }
    }

    private void runJob(String id, String json) {
        PDDocument src = null;
        try {
            JSONObject o = new JSONObject(json);
            String op = o.getString("op");
            JSONObject marks = o.optJSONObject("marks");
            if ("export".equals(op)) {
                /* pages (book page numbers) -> one file or several parts; marks drawn in; dest "export" or "temp" */
                Entry e = entries.get(o.getInt("src"));
                if (e == null) throw new FileNotFoundException("The book is no longer open");
                JSONArray pg = o.getJSONArray("pages");
                int parts = Math.max(1, o.optInt("parts", 1)), total = pg.length(), done = 0, bad = 0;
                String base = o.optString("name", "pages");
                boolean temp = "temp".equals(o.optString("dest"));
                jobProgress(id, 0, total, "Opening the book…");
                src = openPdf(e);
                int nSrc = src.getNumberOfPages();
                JSONArray outs = new JSONArray();
                for (int part = 0; part < parts; part++) {
                    int a = (int) ((long) total * part / parts), b = (int) ((long) total * (part + 1) / parts);
                    if (b <= a) continue;
                    PDDocument out = new PDDocument(diskMemory());
                    try {
                        for (int i = a; i < b; i++) {
                            int pn = pg.getInt(i);
                            PDPage np;
                            try {
                                if (pn < 1 || pn > nSrc) throw new IOException("no page " + pn);
                                np = importPage(out, src.getPage(pn - 1));
                            } catch (Exception ex) {
                                np = new PDPage(PDRectangle.A4);
                                out.addPage(np);
                                bad++;
                            }
                            writeLayer(out, np, marks != null ? marks.optJSONArray(String.valueOf(pn)) : null);
                            done++;
                            if (done % 10 == 0) jobProgress(id, done, total, (parts > 1 ? "Part " + (part + 1) + " of " + parts + " · " : "") + "page " + done + " of " + total);
                        }
                        if (src.isEncrypted()) out.setAllSecurityToBeRemoved(true);
                        File t = new File(workDir(), "out-" + System.nanoTime() + ".pdf");
                        jobProgress(id, done, total, "Writing " + (parts > 1 ? "part " + (part + 1) : "the file") + "…");
                        out.save(t);
                        String name = parts > 1 ? String.format(Locale.ROOT, "%s-part%02d-of-%02d.pdf", base, part + 1, parts) : base + ".pdf";
                        if (temp) outs.put(t.getPath());
                        else { outs.put(deliverFile(t, name)); t.delete(); }
                    } finally {
                        out.close();
                    }
                }
                jobMsg(id, "done", new JSONObject().put("ok", true).put("files", outs).put("bad", bad));
            } else if ("readmarks".equals(op)) {
                Entry e = entries.get(o.getInt("src"));
                if (e == null) throw new FileNotFoundException("The file is no longer open");
                src = openPdf(e);
                JSONObject m = readMarks(src);
                jobMsg(id, "done", new JSONObject().put("ok", true).put("marks", m).put("n", src.getNumberOfPages()));
            } else if ("prepare".equals(op)) {
                prepareBook(id, o);
            } else if ("merge".equals(op)) {
                JSONArray files = o.getJSONArray("files");
                PDFMergerUtility m = new PDFMergerUtility();
                for (int i = 0; i < files.length(); i++) m.addSource(new File(files.getString(i)));
                File t = new File(workDir(), "merge-" + System.nanoTime() + ".pdf");
                m.setDestinationFileName(t.getPath());
                jobProgress(id, 0, files.length(), "Joining " + files.length() + " files…");
                if (!pdfboxReady) { PDFBoxResourceLoader.init(getApplicationContext()); pdfboxReady = true; }
                m.mergeDocuments(diskMemory());
                String where = deliverFile(t, o.optString("name", "merged") + ".pdf");
                t.delete();
                if (o.optBoolean("deleteSources")) for (int i = 0; i < files.length(); i++) {
                    File f = new File(files.getString(i));
                    if (f.getPath().startsWith(workDir().getPath())) f.delete();
                }
                jobMsg(id, "done", new JSONObject().put("ok", true).put("files", new JSONArray().put(where)));
            } else if ("marks".equals(op)) {
                /* auto-save of marks: drawn into the original book or into the copy made before, changes added at the end */
                int sid = o.getInt("src");
                Entry e = entries.get(sid);
                if (e == null) throw new FileNotFoundException("The book is no longer open");
                String mode = o.optString("mode", "original");
                boolean toCopy = !"original".equals(mode);
                Object tgt = toCopy ? copyTarget.get(sid) : null;
                if (toCopy && tgt == null) throw new IllegalStateException("nocopy");
                jobProgress(id, 0, 1, "Saving…");
                File srcFile = null;
                if (toCopy) {
                    if (tgt instanceof File) srcFile = (File) tgt;
                    else { srcFile = new File(workDir(), "copy-" + System.nanoTime() + ".pdf"); InputStream in = openTarget(tgt); OutputStream os = new FileOutputStream(srcFile); try { byte[] buf = new byte[1 << 16]; int k; while ((k = in.read(buf)) > 0) os.write(buf, 0, k); } finally { in.close(); os.close(); } }
                    if (!pdfboxReady) { PDFBoxResourceLoader.init(getApplicationContext()); pdfboxReady = true; }
                    src = PDDocument.load(srcFile, diskMemory());
                } else src = openPdf(e);
                int n = 0, total = marks == null ? 0 : marks.length();
                if (marks != null) for (java.util.Iterator<String> it = marks.keys(); it.hasNext(); ) {
                    String k = it.next(); int pn = Integer.parseInt(k);
                    if (pn >= 1 && pn <= src.getNumberOfPages()) { PDPage pg = src.getPage(pn - 1); writeLayer(src, pg, marks.getJSONArray(k)); markChanged(src, pg); }
                    n++;
                }
                if (src.isEncrypted()) src.setAllSecurityToBeRemoved(true);
                File t = new File(workDir(), "save-" + System.nanoTime() + ".pdf");
                boolean inc = !src.isEncrypted() && saveChanges(src, t);
                src.close();
                src = null;
                if (srcFile != null && !(tgt instanceof File)) srcFile.delete();
                JSONObject r;
                synchronized (saveLock) {
                    File old = saveTmp;
                    saveTmp = t;
                    try {
                        r = toCopy ? new JSONObject().put("ok", true).put("where", writeTarget(tgt)).put("mode", "copy").put("note", "")
                                   : doSave("original", o.optString("name", "book-edited.pdf"), sid);
                    } finally {
                        saveTmp = old;
                    }
                }
                r.put("incremental", inc);
                if (!toCopy && "original".equals(r.optString("mode"))) {
                    e.size = e.file != null ? e.file.length() : t.length();
                    String bk = o.optString("book", "");
                    if (!bk.isEmpty() && marks != null) {               // prepared parts: same marks, and a key that matches the new file
                        File bd = new File(booksDir(), bk);
                        try {
                            int ps = o.optInt("partSize", 200);
                            File nd = new File(booksDir(), bookKey(e, ps));
                            if (!nd.equals(bd) && bd.renameTo(nd)) {
                                File inf = new File(nd, "info.json");
                                byte[] bb = new byte[(int) inf.length()];
                                FileInputStream in = new FileInputStream(inf); int off = 0, k2; while (off < bb.length && (k2 = in.read(bb, off, bb.length - off)) > 0) off += k2; in.close();
                                JSONObject j = new JSONObject(new String(bb, "UTF-8"));
                                JSONArray fs = j.getJSONArray("files"), nf = new JSONArray();
                                for (int i = 0; i < fs.length(); i++) nf.put(new File(nd, new File(fs.getString(i)).getName()).getPath());
                                j.put("files", nf).put("key", nd.getName());
                                OutputStream os = new FileOutputStream(inf); os.write(j.toString().getBytes("UTF-8")); os.close();
                                r.put("key", nd.getName());
                            }
                        } catch (Exception ex) {
                            deleteDir(bd);
                        }
                    }
                }
                t.delete();
                jobMsg(id, "done", r);
            } else if ("rebuild".equals(op)) {
                /* pages were moved, copied, deleted or added: write the book again in the new order */
                int sid = o.getInt("src");
                Entry e = entries.get(sid);
                if (e == null) throw new FileNotFoundException("The book is no longer open");
                JSONArray order = o.getJSONArray("order");
                jobProgress(id, 0, order.length(), "Opening the book…");
                /* the original as it was when opened is kept (once) before it is first rewritten, so pages deleted
                   and brought back with undo, or a copy made later, still come from the right pages */
                File bk = backups.get(sid);
                if (bk == null && "original".equals(o.optString("mode"))) {
                    try {
                        long need = e.file != null ? e.file.length() : e.size;
                        if (workDir().getUsableSpace() > need * 1.2 + 50e6) {
                            File b = new File(workDir(), "backup-" + sid + "-" + System.nanoTime() + ".pdf");
                            InputStream in = e.file != null && e.file.canRead() ? new FileInputStream(e.file) : openStream(e);
                            OutputStream os = new FileOutputStream(b);
                            try { byte[] buf = new byte[1 << 16]; int k; while ((k = in.read(buf)) > 0) os.write(buf, 0, k); } finally { in.close(); os.close(); }
                            backups.put(sid, b);
                            bk = b;
                        }
                    } catch (Exception ex) {
                        bk = null;
                    }
                }
                if (bk != null) {
                    if (!pdfboxReady) { PDFBoxResourceLoader.init(getApplicationContext()); pdfboxReady = true; }
                    src = PDDocument.load(bk, diskMemory());
                } else src = openPdf(e);
                int nSrc = src.getNumberOfPages(), total = order.length();
                PDDocument out = new PDDocument(diskMemory());
                File t = new File(workDir(), "rebuild-" + System.nanoTime() + ".pdf");
                try {
                    for (int i = 0; i < total; i++) {
                        JSONObject it = order.getJSONObject(i);
                        PDPage np;
                        if (it.has("blank")) {
                            JSONArray wh = it.getJSONArray("blank");
                            np = new PDPage(new PDRectangle((float) wh.getDouble(0), (float) wh.getDouble(1)));
                            out.addPage(np);
                        } else {
                            int pn = it.getInt("pn");
                            try { if (pn < 1 || pn > nSrc) throw new IOException(); np = importPage(out, src.getPage(pn - 1)); }
                            catch (Exception ex) { np = new PDPage(PDRectangle.A4); out.addPage(np); }
                        }
                        writeLayer(out, np, marks != null ? marks.optJSONArray(String.valueOf(i + 1)) : null);
                        if (i % 25 == 0) jobProgress(id, i, total, "Arranging page " + (i + 1) + " of " + total);
                    }
                    if (src.isEncrypted()) out.setAllSecurityToBeRemoved(true);
                    jobProgress(id, total, total, "Writing the book…");
                    out.save(t);
                } finally {
                    out.close();
                }
                src.close();
                src = null;
                JSONObject r;
                synchronized (saveLock) {
                    File old = saveTmp;
                    saveTmp = t;
                    try {
                        r = doSave("original".equals(o.optString("mode")) ? "original" : "copyr", o.optString("name", "book-edited.pdf"), sid);
                    } finally {
                        saveTmp = old;
                    }
                }
                if ("original".equals(r.optString("mode"))) e.size = e.file != null ? e.file.length() : t.length();
                r.put("backup", bk != null);
                t.delete();
                jobMsg(id, "done", r);
            } else throw new IllegalArgumentException("unknown job " + op);
        } catch (Throwable ex) {
            try {
                String msg = ex instanceof OutOfMemoryError ? "Not enough memory" : String.valueOf(ex.getMessage() != null ? ex.getMessage() : ex);
                if (ex instanceof IOException && msg.toLowerCase(Locale.ROOT).contains("space")) msg = "Not enough free storage space";
                jobMsg(id, "done", new JSONObject().put("ok", false).put("err", msg));
            } catch (Exception ignored) {
            }
        } finally {
            if (src != null) try { src.close(); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW || level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL || level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE)
            js("window.__lowMemory&&window.__lowMemory(" + level + ")");
    }

    /* the copy made by auto-save is written again each time (same file), not a new copy per save */
    private TextRecognizer textRec;
    private synchronized TextRecognizer recognizer() {
        if (textRec == null) textRec = TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build());
        return textRec;
    }

    private final Map<Integer, Object> copyTarget = new HashMap<>();
    private final Map<Integer, File> backups = new ConcurrentHashMap<>();
    private Uri lastPublicUri = null;

    private String writeTarget(Object t) throws Exception {
        if (t instanceof File) {
            File f = (File) t;
            copyTmpToFile(f);
            scan(f);
            return f.getPath();
        }
        Uri u = (Uri) t;
        OutputStream os = getContentResolver().openOutputStream(u, "wt");
        if (os == null) throw new IOException("cannot write the copy");
        try {
            copyTmpTo(os);
        } finally {
            os.close();
        }
        return String.valueOf(u);
    }

    private InputStream openTarget(Object t) throws IOException {
        if (t instanceof File) return new FileInputStream((File) t);
        InputStream in = getContentResolver().openInputStream((Uri) t);
        if (in == null) throw new FileNotFoundException("copy");
        return in;
    }

    private JSONObject doSave(String mode, String name, int primary) throws Exception {
        Entry e = entries.get(primary);
        String note = "";
        boolean reuse = "copyr".equals(mode);
        if (reuse) mode = "copy";
        if (reuse && copyTarget.containsKey(primary)) {
            try {
                String w = writeTarget(copyTarget.get(primary));
                return new JSONObject().put("ok", true).put("where", w).put("mode", "copy").put("note", "");
            } catch (Exception ex) {
                copyTarget.remove(primary);                     // the copy was moved or deleted: make a new one
            }
        }
        String where = null, outMode = mode;
        if ("export".equals(mode)) {
            String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            String m = mime != null ? mime : "application/octet-stream";
            where = writeToDir(prefs.getString("p_exportDir", ""), name, m);
            if (where == null) where = writePublic("MarkupStudio", name, m);
        } else {
            if ("original".equals(mode)) {
                if (e != null && e.name != null && e.name.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
                    where = writeOriginal(e);
                    if (where == null) note = "Could not write to the original file, so a copy was saved instead.";
                } else {
                    note = e == null ? "No original file." : "The original is not a PDF, so a PDF copy was saved next to it.";
                }
            }
            if (where == null) {
                lastPublicUri = null;
                where = writeCopy(e, name);
                outMode = "copy";
                if (where != null && new File(where).isFile() && new File(where).canWrite()) copyTarget.put(primary, new File(where));
                else if (lastPublicUri != null) copyTarget.put(primary, lastPublicUri);
            }
        }
        return new JSONObject().put("ok", true).put("where", where).put("mode", outMode).put("note", note);
    }

    /* ------------------------------------------------------------------ text to speech */

    private void initTts() {
        if (tts != null) {
            if (ttsReady) js("window.__ttsReady&&window.__ttsReady(true)");
            return;
        }
        String eng = prefs.getString("p_ttsEngine", "");
        tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (ttsReady) {
                    try {
                        tts.setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                    } catch (Exception ignored) {
                    }
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String id) {
                            js("window.__tts&&window.__tts('start'," + JSONObject.quote(id) + ")");
                        }

                        @Override
                        public void onDone(String id) {
                            js("window.__tts&&window.__tts('done'," + JSONObject.quote(id) + ")");
                        }

                        @Override
                        @SuppressWarnings("deprecation")
                        public void onError(String id) {
                            js("window.__tts&&window.__tts('error'," + JSONObject.quote(id) + ")");
                        }

                        @Override
                        public void onError(String id, int code) {
                            js("window.__tts&&window.__tts('error'," + JSONObject.quote(id) + ")");
                        }

                        @Override
                        public void onRangeStart(String id, int start, int end, int frame) {
                            js("window.__tts&&window.__tts('range'," + JSONObject.quote(id) + "," + start + ")");
                        }
                    });
                }
                js("window.__ttsReady&&window.__ttsReady(" + ttsReady + ")");
            }
        }, eng.isEmpty() ? null : eng);
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(code, null);
            }
        });
    }

    /* ------------------------------------------------------------------ JS bridge */

    private class Bridge {

        @JavascriptInterface
        public void jsReady() {
            jsReady = true;
        }

        @JavascriptInterface
        public String memInfo() {
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                return new JSONObject().put("total", mi.totalMem).put("avail", mi.availMem).put("low", mi.lowMemory)
                        .put("cls", am.getMemoryClass()).put("large", am.getLargeMemoryClass()).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        /** start a PDF tool job in the background; progress and result arrive through window.__job */
        @JavascriptInterface
        public String job(final String json) {
            final String id = "j" + (++jobSeq);
            new Thread(new Runnable() {
                @Override
                public void run() {
                    runJob(id, json);
                }
            }, "pdf-job").start();
            return id;
        }

        /** make a file in the work folder readable by the page at /__file/<id> */
        @JavascriptInterface
        public int registerFile(String path) {
            File f = new File(path);
            if (!f.isFile()) return 0;
            Entry e = new Entry();
            e.id = newId();
            e.file = f;
            e.name = f.getName();
            e.size = f.length();
            e.mime = "application/pdf";
            entries.put(e.id, e);
            return e.id;
        }

        @JavascriptInterface
        public void deleteTemp(String path) {
            File f = new File(path);
            if (f.getPath().startsWith(workDir().getPath())) f.delete();
        }

        /** a picked file's real path (for merging); "" when it has none */
        @JavascriptInterface
        public String pathOf(int id) {
            Entry e = entries.get(id);
            return e != null && e.file != null ? e.file.getPath() : "";
        }

        /** true right after the viewer died twice in a row: the page should not reopen the last book by itself */
        @JavascriptInterface
        public boolean safeStart() {
            boolean s = safeStart;
            safeStart = false;
            return s;
        }

        @JavascriptInterface
        public String takePending() {
            JSONArray arr = new JSONArray();
            synchronized (pending) {
                try {
                    for (Entry e : pending) arr.put(entryJson(e));
                } catch (Exception ignored) {
                }
                pending.clear();
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void pickFiles(String mode) {
            pickMode = mode;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    i.putExtra("android.content.extra.SHOW_ADVANCED", true);
                    i.putExtra("android.content.extra.FANCY", true);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    try {
                        startActivityForResult(i, REQ_PICK);
                    } catch (Exception e) {
                        toastUi("No file picker available");
                    }
                }
            });
        }

        @JavascriptInterface
        public String entryKey(int id) {
            Entry e = entries.get(id);
            if (e == null) return "";
            return e.file != null ? e.file.getPath() : String.valueOf(e.uri);
        }

        @JavascriptInterface
        public void saveState(String ids, int page, double frac) {
            try {
                JSONArray arr = new JSONArray();
                for (String s : ids.split(",")) {
                    if (s.isEmpty()) continue;
                    Entry e = entries.get(Integer.parseInt(s));
                    if (e == null) continue;
                    JSONObject o = new JSONObject().put("name", e.name).put("mime", e.mime);
                    if (e.file != null) o.put("path", e.file.getPath());
                    if (e.uri != null) o.put("uri", e.uri.toString());
                    arr.put(o);
                }
                if (arr.length() == 0) return;
                prefs.edit().putString("last", new JSONObject().put("entries", arr).put("page", page).put("frac", frac).toString()).apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String reopenLast() {
            try {
                String s = prefs.getString("last", null);
                if (s == null) return "";
                JSONObject o = new JSONObject(s);
                JSONArray in = o.getJSONArray("entries"), out = new JSONArray();
                for (int i = 0; i < in.length(); i++) {
                    JSONObject j = in.getJSONObject(i);
                    Entry e = new Entry();
                    e.id = newId();
                    e.name = j.optString("name", "document");
                    e.mime = j.optString("mime", "application/octet-stream");
                    String path = j.optString("path", "");
                    if (!path.isEmpty()) {
                        File f = new File(path);
                        if (f.exists()) e.file = f;
                    }
                    String uri = j.optString("uri", "");
                    if (!uri.isEmpty()) e.uri = Uri.parse(uri);
                    InputStream test = null;
                    try {
                        test = openStream(e);
                    } catch (Exception ex) {
                        continue;                       // no longer reachable
                    } finally {
                        if (test != null) try { test.close(); } catch (IOException ignored) { }
                    }
                    e.size = e.file != null ? e.file.length() : 0;
                    entries.put(e.id, e);
                    out.put(entryJson(e));
                }
                if (out.length() == 0) return "";
                return new JSONObject().put("entries", out).put("page", o.optInt("page", 0)).put("frac", o.optDouble("frac", 0)).toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean saveBegin() {
            try {
                saveTmp = new File(getCacheDir(), "save-" + System.nanoTime() + ".tmp");
                saveOs = new BufferedOutputStream(new FileOutputStream(saveTmp));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean saveChunk(String b64) {
            try {
                saveOs.write(Base64.decode(b64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String saveEnd(String mode, String name, int primary) {
            JSONObject r;
            try {
                saveOs.close();
                if ("temp".equals(mode)) {                    // kept for a later merge; the page deletes it
                    File t = new File(workDir(), "part-" + System.nanoTime() + ".pdf");
                    if (!saveTmp.renameTo(t)) { copyFile(saveTmp, t); }
                    return new JSONObject().put("ok", true).put("where", t.getPath()).put("mode", "temp").toString();
                }
                synchronized (saveLock) {
                    r = doSave(mode, name, primary);
                }
            } catch (Exception e) {
                r = new JSONObject();
                try {
                    r.put("ok", false).put("err", String.valueOf(e.getMessage() != null ? e.getMessage() : e));
                } catch (Exception ignored) {
                }
            } finally {
                if (saveTmp != null) saveTmp.delete();
            }
            return r.toString();
        }

        @JavascriptInterface
        public String getPref(String k, String d) {
            if ("fullscreen".equals(k)) return prefs.getBoolean("fullscreen", true) ? "1" : "0";
            return prefs.getString("p_" + k, d);
        }

        @JavascriptInterface
        public void setPref(String k, String v) {
            prefs.edit().putString("p_" + k, v).apply();
        }

        @JavascriptInterface
        public void setFullscreen(final boolean on) {
            prefs.edit().putBoolean("fullscreen", on).apply();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyFullscreen(on);
                }
            });
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface
        public void toast(String m) {
            toastUi(m);
        }

        @JavascriptInterface
        public boolean isOnline() {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                NetworkInfo ni = cm.getActiveNetworkInfo();
                return ni != null && ni.isConnected();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void requestStorage() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.requestStorage();
                }
            });
        }

        @JavascriptInterface
        public void grantTree() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                    i.putExtra("android.content.extra.SHOW_ADVANCED", true);
                    toastUi("Pick the root of your SD card or USB drive, then tap “Use this folder”");
                    try {
                        startActivityForResult(i, REQ_TREE);
                    } catch (Exception e) {
                        toastUi("Folder access is not available on this device");
                    }
                }
            });
        }

        @JavascriptInterface
        public String storageInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("sdk", Build.VERSION.SDK_INT).put("allFiles", hasStorage());
                JSONArray vols = new JSONArray();
                File[] dirs = getExternalFilesDirs(null);
                if (dirs != null) {
                    for (File d : dirs) {
                        if (d == null) continue;
                        String p = d.getAbsolutePath();
                        int i = p.indexOf("/Android/data");
                        vols.put(i > 0 ? p.substring(0, i) : p);
                    }
                }
                o.put("volumes", vols);
                JSONArray ts = new JSONArray();
                for (String t : prefs.getStringSet("trees", new HashSet<String>())) ts.put(t);
                o.put("trees", ts);
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        /* ---- theme ---- */

        @JavascriptInterface
        public void setTheme(final String t) {
            prefs.edit().putString("p_theme", t).apply();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyTheme(t);
                }
            });
        }

        /* ---- built-in file browser: internal storage, SD cards, USB drives ---- */

        private void addRoot(JSONArray a, Set<String> seen, File d, String label, String kind) {
            if (d == null) return;
            try {
                String p = d.getAbsolutePath();
                try {
                    p = d.getCanonicalPath();
                } catch (IOException ignored) {
                }
                if ("/storage/self/primary".equals(p) || "/sdcard".equals(p)) p = Environment.getExternalStorageDirectory().getAbsolutePath();
                if (seen.contains(p) || !new File(p).exists()) return;
                seen.add(p);
                File f = new File(p);
                a.put(new JSONObject().put("path", p).put("label", label).put("kind", kind)
                        .put("total", f.getTotalSpace()).put("free", f.getFreeSpace()));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String roots() {
            JSONArray a = new JSONArray();
            Set<String> seen = new HashSet<>();
            addRoot(a, seen, Environment.getExternalStorageDirectory(), "Internal storage", "internal");
            if (Build.VERSION.SDK_INT >= 24) {
                try {
                    StorageManager sm = (StorageManager) getSystemService(Context.STORAGE_SERVICE);
                    for (StorageVolume v : sm.getStorageVolumes()) {
                        String state = v.getState();
                        if (state != null && !state.startsWith("mounted")) continue;
                        File d = null;
                        if (Build.VERSION.SDK_INT >= 30) d = v.getDirectory();
                        else {
                            try {
                                d = new File((String) v.getClass().getMethod("getPath").invoke(v));
                            } catch (Exception ignored) {
                            }
                        }
                        String label = v.getDescription(MainActivity.this);
                        String low = label == null ? "" : label.toLowerCase(Locale.ROOT);
                        String kind = v.isPrimary() ? "internal" : low.contains("usb") || low.contains("otg") ? "usb" : "sd";
                        addRoot(a, seen, d, label == null ? (kind.equals("usb") ? "USB drive" : "SD card") : label, kind);
                    }
                } catch (Throwable ignored) {
                }
            }
            try {
                File[] ds = getExternalFilesDirs(null);
                if (ds != null) for (File d : ds) {
                    if (d == null) continue;
                    String p = d.getAbsolutePath();
                    int i = p.indexOf("/Android/data");
                    if (i > 0) addRoot(a, seen, new File(p.substring(0, i)), "SD card / USB", "sd");
                }
            } catch (Throwable ignored) {
            }
            try {
                File[] l = new File("/storage").listFiles();
                if (l != null) for (File d : l) {
                    String n = d.getName();
                    if (n.equals("self") || n.equals("emulated") || !d.isDirectory() || !d.canRead()) continue;
                    addRoot(a, seen, d, n.toLowerCase(Locale.ROOT).contains("usb") ? "USB drive" : "Storage " + n, n.toLowerCase(Locale.ROOT).contains("usb") ? "usb" : "sd");
                }
            } catch (Throwable ignored) {
            }
            return a.toString();
        }

        @JavascriptInterface
        public String listDir(String path) {
            JSONObject o = new JSONObject();
            try {
                File d = new File(path);
                o.put("path", d.getAbsolutePath());
                File[] fs = d.listFiles();
                if (fs == null) {
                    boolean sys = path.contains("/Android/data") || path.contains("/Android/obb");
                    o.put("ok", false).put("perm", !hasStorage()).put("blocked", sys);
                    return o.toString();
                }
                JSONArray a = new JSONArray();
                for (File f : fs) {
                    boolean dir = f.isDirectory();
                    a.put(new JSONObject().put("n", f.getName()).put("d", dir).put("s", dir ? 0 : f.length()).put("m", f.lastModified()));
                }
                o.put("ok", true).put("items", a).put("w", d.canWrite());
            } catch (Exception e) {
                try {
                    o.put("ok", false).put("err", String.valueOf(e.getMessage()));
                } catch (Exception ignored) {
                }
            }
            return o.toString();
        }

        /** can new files be written into this folder (directly, or through a granted SD/USB folder)? */
        @JavascriptInterface
        public boolean canWriteDir(String path) {
            File d = new File(path);
            File t = new File(d, ".ms-write-test-" + System.nanoTime());
            try {
                if (t.createNewFile()) {
                    t.delete();
                    return true;
                }
            } catch (Exception ignored) {
            }
            String[] vr = volumeAndRel(d);
            return vr != null && treeFor(vr[0], vr[1]) != null;
        }

        @JavascriptInterface
        public void openPaths(String json, String mode) {
            List<Entry> added = new ArrayList<>();
            try {
                JSONArray a = new JSONArray(json);
                for (int i = 0; i < a.length(); i++) {
                    File f = new File(a.getString(i));
                    if (!f.isFile() || !f.canRead()) continue;
                    Entry e = new Entry();
                    e.id = newId();
                    e.file = f;
                    e.name = f.getName();
                    e.size = f.length();
                    int dot = e.name.lastIndexOf('.');
                    String g = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(e.name.substring(dot + 1).toLowerCase(Locale.ROOT));
                    e.mime = g != null ? g : "application/octet-stream";
                    entries.put(e.id, e);
                    added.add(e);
                }
            } catch (Exception ignored) {
            }
            if (added.isEmpty()) toastUi("Could not open that file");
            else deliver(added, mode);
        }

        /* ---- speech ---- */

        @JavascriptInterface
        public void ttsInit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    initTts();
                }
            });
        }

        /** the speech engines on the phone (Google, Samsung, …), each with its own voices */
        @JavascriptInterface
        public String ttsEngines() {
            JSONArray arr = new JSONArray();
            try {
                if (tts != null) for (TextToSpeech.EngineInfo e : tts.getEngines()) arr.put(new JSONObject().put("n", e.name).put("l", e.label));
                arr.put(new JSONObject().put("cur", tts != null ? tts.getDefaultEngine() : "").put("sel", prefs.getString("p_ttsEngine", "")));
            } catch (Exception ignored) {
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void ttsSetEngine(final String name) {
            prefs.edit().putString("p_ttsEngine", name == null ? "" : name).apply();
            runOnUiThread(new Runnable() {
                public void run() {
                    try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception ignored) { }
                    tts = null;
                    ttsReady = false;
                    initTts();
                }
            });
        }

        @JavascriptInterface
        public String ttsVoices() {
            JSONArray arr = new JSONArray();
            try {
                Set<Voice> vs = tts == null ? null : tts.getVoices();
                if (vs != null) {
                    for (Voice v : vs) {
                        boolean ni = v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
                        arr.put(new JSONObject().put("n", v.getName()).put("l", v.getLocale().toLanguageTag())
                                .put("q", v.getQuality()).put("net", v.isNetworkConnectionRequired()).put("ni", ni));
                    }
                }
            } catch (Exception ignored) {
            }
            return arr.toString();
        }

        /** returns 0 = queued, -1 = engine not ready, -2 = language/voice unavailable, -3 = failed */
        @JavascriptInterface
        public int ttsSpeak(final String id, final String text, final String voice, final String lang,
                            final float rate, final float pitch, final boolean flush) {
            if (tts == null || !ttsReady) return -1;
            final int[] rc = {0};
            final CountDownLatch done = new CountDownLatch(1);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Voice target = null;
                        if (voice != null && !voice.isEmpty()) {
                            Set<Voice> vs = tts.getVoices();
                            if (vs != null) for (Voice v : vs) if (v.getName().equals(voice)) { target = v; break; }
                        }
                        if (target != null) {
                            tts.setVoice(target);
                        } else {
                            Locale loc = Locale.forLanguageTag(lang);
                            int r = tts.setLanguage(loc);
                            if (r < TextToSpeech.LANG_AVAILABLE) r = tts.setLanguage(new Locale(loc.getLanguage()));
                            if (r < TextToSpeech.LANG_AVAILABLE) { rc[0] = -2; return; }
                        }
                        tts.setSpeechRate(rate);
                        tts.setPitch(pitch);
                        int r = tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
                        if (r != TextToSpeech.SUCCESS) rc[0] = -3;
                    } catch (Exception e) {
                        rc[0] = -3;
                    } finally {
                        done.countDown();
                    }
                }
            });
            try {
                done.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
            return rc[0];
        }

        /* text recognition of a scanned page (picture as a data: URL); the words with their boxes go back to
           window.__ocrDone(id, result). Hindi and English, on the phone, no internet needed. */
        @JavascriptInterface
        public void ocr(final String id, final String dataUrl) {
            new Thread(new Runnable() {
                public void run() {
                    try {
                        byte[] b = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
                        final Bitmap bm = BitmapFactory.decodeByteArray(b, 0, b.length);
                        if (bm == null) throw new IOException("no picture");
                        final int w = bm.getWidth(), h = bm.getHeight();
                        recognizer().process(InputImage.fromBitmap(bm, 0))
                                .addOnSuccessListener(new com.google.android.gms.tasks.OnSuccessListener<Text>() {
                                    public void onSuccess(Text t) {
                                        try {
                                            JSONArray lines = new JSONArray();
                                            for (Text.TextBlock bl : t.getTextBlocks()) for (Text.Line ln : bl.getLines()) {
                                                android.graphics.Rect lr = ln.getBoundingBox();
                                                if (lr == null) continue;
                                                JSONArray ws = new JSONArray();
                                                for (Text.Element el : ln.getElements()) {
                                                    android.graphics.Rect r = el.getBoundingBox();
                                                    if (r == null) continue;
                                                    ws.put(new JSONObject().put("t", el.getText()).put("x0", r.left).put("y0", r.top).put("x1", r.right).put("y1", r.bottom));
                                                }
                                                lines.put(new JSONObject().put("t", ln.getText()).put("x0", lr.left).put("y0", lr.top).put("x1", lr.right).put("y1", lr.bottom).put("words", ws));
                                            }
                                            js("window.__ocrDone&&window.__ocrDone(" + JSONObject.quote(id) + "," + new JSONObject().put("ok", true).put("w", w).put("h", h).put("lines", lines) + ")");
                                        } catch (Exception ex) {
                                            js("window.__ocrDone&&window.__ocrDone(" + JSONObject.quote(id) + ",{ok:false})");
                                        } finally {
                                            bm.recycle();
                                        }
                                    }
                                })
                                .addOnFailureListener(new com.google.android.gms.tasks.OnFailureListener() {
                                    public void onFailure(Exception e) {
                                        bm.recycle();
                                        js("window.__ocrDone&&window.__ocrDone(" + JSONObject.quote(id) + ",{ok:false,err:" + JSONObject.quote(String.valueOf(e.getMessage())) + "})");
                                    }
                                });
                    } catch (Throwable e) {
                        js("window.__ocrDone&&window.__ocrDone(" + JSONObject.quote(id) + ",{ok:false,err:" + JSONObject.quote(String.valueOf(e.getMessage())) + "})");
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void ttsStop() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (tts != null) tts.stop();
                }
            });
        }

        @JavascriptInterface
        public void ttsInstallData() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
                    } catch (Exception e) {
                        ttsSettings();
                    }
                }
            });
        }

        @JavascriptInterface
        public void ttsSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
                    } catch (Exception e) {
                        try {
                            startActivity(new Intent(Settings.ACTION_SETTINGS));
                        } catch (Exception ignored) {
                        }
                    }
                }
            });
        }
    }
}
