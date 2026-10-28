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
    private boolean jsReady = false;
    private String pickMode = "replace";

    private TextToSpeech tts;
    private boolean ttsReady = false;

    private File saveTmp;
    private OutputStream saveOs;

    /* ------------------------------------------------------------------ lifecycle */

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("ms", MODE_PRIVATE);
        applyFullscreen(prefs.getBoolean("fullscreen", true));

        loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/__file/", new FileHandler())
                .build();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !HOST.equals(r.getUrl().getHost());   // never leave the app
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");

        handleIntent(getIntent());
        web.loadUrl("https://" + HOST + "/assets/index.html");

        if (!prefs.getBoolean("askedStorage", false)) {
            prefs.edit().putBoolean("askedStorage", true).apply();
            web.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (!hasStorage()) requestStorage();
                }
            }, 1500);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        List<Entry> added = handleIntent(intent);
        if (!added.isEmpty() && jsReady) deliver(added, "replace");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("window.__paused&&window.__paused()", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && prefs.getBoolean("fullscreen", true)) applyFullscreen(true);
    }

    @Override
    public void onBackPressed() {
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
            e.id = nextId++;
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
        e.id = nextId++;
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
                web.evaluateJavascript("window.__nativeEvent&&window.__nativeEvent(" + JSONObject.quote(ev) + ")", null);
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

    private String writeViaTreeNew(File dir, String name) {
        String[] vr = volumeAndRel(dir);
        if (vr == null) return null;
        Uri tu = treeFor(vr[0], vr[1]);
        if (tu == null) return null;
        try {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tu, vr[0] + ":" + vr[1]);
            Uri doc = DocumentsContract.createDocument(getContentResolver(), parent, "application/pdf", name);
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

    private String writeCopy(Entry e, String suggested) throws Exception {
        String nm = (e != null && e.name != null ? stripExt(e.name) + "-edited.pdf" : suggested);
        if (e != null && e.file != null && e.file.getParentFile() != null) {
            File dir = e.file.getParentFile();
            File f = unique(dir, nm);
            try {
                copyTmpToFile(f);
                scan(f);
                return f.getPath();
            } catch (IOException | SecurityException ignored) {
            }
            String w = writeViaTreeNew(dir, f.getName());
            if (w != null) return w;
        }
        return writePublic("MarkupStudio", nm, "application/pdf");
    }

    private JSONObject doSave(String mode, String name, int primary) throws Exception {
        Entry e = entries.get(primary);
        String note = "";
        String where = null, outMode = mode;
        if ("export".equals(mode)) {
            String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            where = writePublic("MarkupStudio", name, mime != null ? mime : "application/octet-stream");
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
                where = writeCopy(e, name);
                outMode = "copy";
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
        });
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
                    e.id = nextId++;
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
                r = doSave(mode, name, primary);
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
