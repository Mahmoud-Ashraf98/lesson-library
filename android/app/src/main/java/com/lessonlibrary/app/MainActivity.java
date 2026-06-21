package com.lessonlibrary.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.chaquo.python.PyException;
import com.chaquo.python.Python;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
    private static final int STORAGE_REQUEST = 1001;
    private static final int FILE_REQUEST = 1002;
    private static final int FOLDER_REQUEST = 1003;
    private static final String APP_URL = "http://127.0.0.1:8077/";
    private static final AtomicBoolean SERVER_STARTED = new AtomicBoolean(false);

    private WebView webView;
    private TextView statusView;
    private ValueCallback<Uri[]> fileCallback;
    private boolean appLoading;
    private Intent pendingShareIntent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        BackupBridge.init(getApplicationContext());
        buildScreen();
        configureWebView();

        if (isShareIntent(getIntent())) {
            pendingShareIntent = getIntent();
        }

        statusView.setOnClickListener(v -> requestStorageAccess());
        if (hasStorageAccess()) {
            startApp();
        } else {
            showPermissionMessage();
            requestStorageAccess();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!isShareIntent(intent)) {
            return;
        }
        if (hasStorageAccess() && appLoading) {
            // App already running: stage the files, then reload onto the
            // Inbox screen so the fresh batch is in the page's data payload.
            new Thread(() -> {
                copySharedToInbox(intent);
                runOnUiThread(() -> webView.evaluateJavascript(
                        "location.href='" + APP_URL + "#/inbox'; location.reload();",
                        null));
            }, "lesson-library-share").start();
        } else {
            pendingShareIntent = intent;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasStorageAccess() && !appLoading) {
            startApp();
        } else if (!hasStorageAccess()) {
            showPermissionMessage();
        }
    }

    private void buildScreen() {
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        statusView = new TextView(this);
        statusView.setBackgroundColor(Color.rgb(244, 244, 250));
        statusView.setTextColor(Color.rgb(28, 28, 46));
        statusView.setTextSize(18);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(40, 40, 40, 40);
        root.addView(statusView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(true);

        webView.addJavascriptInterface(new ShareBridge(), "MLBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view,
                                                    WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isExternalFile(uri) || !isLocalUrl(uri)) {
                    openExternally(uri);
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(picker, FILE_REQUEST);
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                                          boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(
                            WebView ignored, WebResourceRequest request) {
                        openExternally(request.getUrl());
                        popup.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport =
                        (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
    }

    /** Kit files and the CSV export should open in a real app, not the WebView. */
    private boolean isExternalFile(Uri uri) {
        if (!isLocalUrl(uri) || uri.getPath() == null) {
            return false;
        }
        String path = uri.getPath();
        return path.startsWith("/files/") || path.startsWith("/inbox-files/")
                || path.equals("/api/export.csv");
    }

    private boolean isLocalUrl(Uri uri) {
        return "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 8077;
    }

    private void openExternally(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this file.",
                    Toast.LENGTH_LONG).show();
        }
    }

    // ---- sharing OUT: called from the web app via window.MLBridge ----
    private class ShareBridge {
        @JavascriptInterface
        public void shareFile(String materialId, String fileName) {
            Uri uri = KitFileProvider.uriFor(materialId, fileName);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(getContentResolver().getType(uri));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launchChooser(Intent.createChooser(send, fileName));
        }

        /** Share several files of one material at once (SEND_MULTIPLE).
         *  fileNamesJson is a JSON array of file names within the material. */
        @JavascriptInterface
        public void shareFiles(String materialId, String fileNamesJson) {
            ArrayList<Uri> uris = new ArrayList<>();
            try {
                JSONArray names = new JSONArray(fileNamesJson);
                for (int i = 0; i < names.length(); i++) {
                    uris.add(KitFileProvider.uriFor(materialId,
                            names.getString(i)));
                }
            } catch (JSONException e) {
                return;
            }
            if (uris.isEmpty()) {
                return;
            }
            if (uris.size() == 1) {
                shareFile(materialId, uris.get(0).getLastPathSegment());
                return;
            }
            Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE);
            send.setType("*/*");
            send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            launchChooser(Intent.createChooser(send,
                    uris.size() + " files"));
        }

        private void launchChooser(Intent chooser) {
            runOnUiThread(() -> {
                try {
                    startActivity(chooser);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this,
                            "No app available to share with.",
                            Toast.LENGTH_LONG).show();
                }
            });
        }

        // ---- Feature E: pick a backup folder via the Storage Access
        // Framework (Drive, OneDrive, Dropbox, local — all uniform). ----
        @JavascriptInterface
        public void pickBackupFolder() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {
                    startActivityForResult(intent, FOLDER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this,
                            "No folder picker available on this device.",
                            Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void forgetBackupFolder() {
            BackupBridge.clear();
        }
    }

    // ---- sharing IN: "Share -> Material Library" stages files in Inbox ----
    private static boolean isShareIntent(Intent intent) {
        if (intent == null) {
            return false;
        }
        String action = intent.getAction();
        return Intent.ACTION_SEND.equals(action)
                || Intent.ACTION_SEND_MULTIPLE.equals(action);
    }

    private void copySharedToInbox(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) {
                uris.add(single);
            }
        } else {
            ArrayList<Uri> list =
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) {
                uris.addAll(list);
            }
        }
        if (uris.isEmpty()) {
            return; // text-only share; nothing to stage
        }
        File inbox = new File(Environment.getExternalStorageDirectory(),
                "LessonLibrary/Inbox");
        //noinspection ResultOfMethodCallIgnored
        inbox.mkdirs();
        List<String> staged = new ArrayList<>();
        for (Uri uri : uris) {
            File dest = dedupe(inbox, sanitizeFileName(displayName(uri)));
            try (InputStream in = getContentResolver().openInputStream(uri);
                 OutputStream out = new FileOutputStream(dest)) {
                if (in == null) {
                    throw new java.io.IOException("unreadable stream");
                }
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
                staged.add(dest.getName());
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                dest.delete();
            }
        }
        if (!staged.isEmpty()) {
            writeBatchMarker(inbox, staged);
        }
        int finalCopied = staged.size();
        runOnUiThread(() -> Toast.makeText(this,
                finalCopied > 0
                        ? finalCopied + " file(s) received — choose what to do with them"
                        : "Could not read the shared file(s).",
                Toast.LENGTH_LONG).show());
    }

    /** Inbox/.last-share.json tells the web app which files belong to the
     *  most recent share, so only that batch gets preselected. The leading
     *  dot keeps it invisible to the server's inbox listing. */
    private void writeBatchMarker(File inbox, List<String> names) {
        JSONObject marker = new JSONObject();
        try {
            marker.put("ts", System.currentTimeMillis());
            marker.put("names", new JSONArray(names));
        } catch (JSONException e) {
            return;
        }
        File file = new File(inbox, ".last-share.json");
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(marker.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) {
                    return name;
                }
            }
        } catch (Exception ignored) {
            // fall through to the path segment
        }
        String last = uri.getLastPathSegment();
        return (last == null || last.isEmpty()) ? "shared-file" : last;
    }

    /** Mirror of the server's Windows-safe filename rules, minus reserved
     *  names — the server re-sanitizes again when the file leaves Inbox. */
    private String sanitizeFileName(String name) {
        String[] parts = name.split("[/\\\\]");
        name = parts[parts.length - 1];
        name = name.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f\\x7f]", "");
        name = name.replaceAll("^[. ]+|[. ]+$", "");
        if (name.toLowerCase().endsWith(".tmp")) {
            name += "_"; // .tmp files are invisible to the server's scanner
        }
        return name.isEmpty() ? "shared-file" : name;
    }

    private File dedupe(File dir, String name) {
        File file = new File(dir, name);
        if (!file.exists()) {
            return file;
        }
        String stem = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            stem = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int n = 2; ; n++) {
            File candidate = new File(dir, stem + " (" + n + ")" + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
    }

    // ---- permissions and startup ----
    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestStorageAccess() {
        if (hasStorageAccess()) {
            startApp();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            }
        } else {
            requestPermissions(new String[]{
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
            }, STORAGE_REQUEST);
        }
    }

    private void showPermissionMessage() {
        statusView.setVisibility(View.VISIBLE);
        statusView.setText(
                "Material Library needs file access so it can use the visible "
                + "LessonLibrary folder on your phone.\n\n"
                + "Tap here, then allow access to all files.");
    }

    private void startApp() {
        if (appLoading) {
            return;
        }
        appLoading = true;
        statusView.setVisibility(View.VISIBLE);
        statusView.setText("Opening Material Library...");

        if (SERVER_STARTED.compareAndSet(false, true)) {
            Thread serverThread = new Thread(() -> {
                try {
                    String dataDir = Environment.getExternalStorageDirectory()
                            + "/LessonLibrary";
                    Python.getInstance().getModule("android_entry")
                            .callAttr("start", dataDir);
                } catch (PyException e) {
                    SERVER_STARTED.set(false);
                    runOnUiThread(() -> showStartupError(e.getMessage()));
                }
            }, "lesson-library-server");
            serverThread.setDaemon(true);
            serverThread.start();
        }

        Thread waiter = new Thread(() -> {
            // Stage any share that launched us BEFORE the first page load, so
            // the Inbox screen's payload already lists the new batch.
            String fragment = "";
            Intent share = pendingShareIntent;
            pendingShareIntent = null;
            if (share != null) {
                copySharedToInbox(share);
                fragment = "#/inbox";
            }
            String target = APP_URL + fragment;
            for (int attempt = 0; attempt < 150; attempt++) {
                if (serverIsReady()) {
                    runOnUiThread(() -> {
                        webView.loadUrl(target);
                        statusView.setVisibility(View.GONE);
                    });
                    return;
                }
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            runOnUiThread(() -> showStartupError(
                    "The local app server did not start. Close and reopen the app."));
        }, "lesson-library-waiter");
        waiter.setDaemon(true);
        waiter.start();
    }

    private boolean serverIsReady() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(APP_URL + "api/lessons")
                    .openConnection();
            connection.setConnectTimeout(100);
            connection.setReadTimeout(100);
            return connection.getResponseCode() == 200;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void showStartupError(String detail) {
        appLoading = false;
        statusView.setVisibility(View.VISIBLE);
        statusView.setText("Material Library could not start.\n\n" + detail);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == STORAGE_REQUEST && hasStorageAccess()) {
            startApp();
        } else {
            showPermissionMessage();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FOLDER_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {
                    // some providers grant access without a persistable claim
                }
                BackupBridge.setTreeUri(uri.toString());
                final String picked = uri.toString();
                runOnUiThread(() -> webView.evaluateJavascript(
                        "window.onBackupFolderPicked && onBackupFolderPicked("
                        + JSONObject.quote(picked) + ");", null));
            }
            return;
        }
        if (requestCode != FILE_REQUEST || fileCallback == null) {
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                result = new Uri[count];
                for (int i = 0; i < count; i++) {
                    result[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
