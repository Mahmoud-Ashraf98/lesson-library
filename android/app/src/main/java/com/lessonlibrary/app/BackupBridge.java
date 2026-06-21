package com.lessonlibrary.app;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONArray;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Static Python&lt;-&gt;Java bridge for Feature E (backup &amp; restore) over the
 * Android Storage Access Framework. The Python server (via Chaquopy) calls
 * these methods by class name to read and write backup zips in the cloud
 * folder the teacher picked once. No new dependencies: DocumentsContract is
 * part of the Android framework, so the offline build kit is untouched.
 *
 * The chosen folder's persistable tree URI lives in SharedPreferences, so the
 * choice survives app restarts. backup.json on disk only records that the
 * destination is "saf"; this class is the source of truth for the URI.
 */
public final class BackupBridge {
    private static final String PREFS = "lesson_library_backup";
    private static final String KEY_TREE = "tree_uri";
    private static Context appContext;

    private BackupBridge() {}

    static void init(Context ctx) {
        if (appContext == null) {
            appContext = ctx.getApplicationContext();
        }
    }

    static void setTreeUri(String uri) {
        if (appContext == null) {
            return;
        }
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_TREE, uri).apply();
    }

    static void clear() {
        if (appContext == null) {
            return;
        }
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove(KEY_TREE).apply();
    }

    private static Uri treeUri() {
        if (appContext == null) {
            return null;
        }
        String s = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_TREE, null);
        return (s == null || s.isEmpty()) ? null : Uri.parse(s);
    }

    private static Uri dirDocUri(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(
                tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private static Uri childrenUri(Uri tree) {
        return DocumentsContract.buildChildDocumentsUriUsingTree(
                tree, DocumentsContract.getTreeDocumentId(tree));
    }

    /** Python: write a backup file into the chosen folder. */
    public static void writeBackupFileToUri(String sourcePath,
                                            String displayName)
            throws Exception {
        Uri tree = treeUri();
        if (tree == null) {
            throw new IllegalStateException("No backup folder chosen.");
        }
        Uri doc = DocumentsContract.createDocument(
                appContext.getContentResolver(), dirDocUri(tree),
                "application/zip", displayName);
        if (doc == null) {
            throw new java.io.IOException("Could not create the backup file.");
        }
        try (InputStream in = new FileInputStream(new File(sourcePath));
             OutputStream out =
                     appContext.getContentResolver().openOutputStream(doc)) {
            if (out == null) {
                throw new java.io.IOException("Could not open the backup file.");
            }
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            out.flush();
        } catch (Exception e) {
            try {
                DocumentsContract.deleteDocument(
                        appContext.getContentResolver(), doc);
            } catch (Exception ignored) {
                // Best effort: some providers do not support delete.
            }
            throw e;
        }
    }

    /** Python: JSON array of file names in the chosen folder. */
    public static String readBackupNames() {
        JSONArray arr = new JSONArray();
        Uri tree = treeUri();
        if (tree == null) {
            return arr.toString();
        }
        Cursor c = null;
        try {
            c = appContext.getContentResolver().query(childrenUri(tree),
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String name = c.getString(0);
                    if (name != null && !name.isEmpty()) {
                        arr.put(name);
                    }
                }
            }
        } catch (Exception ignored) {
            // return whatever was gathered before the failure
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return arr.toString();
    }

    /** Python: stream a named backup file to a temporary local path. */
    public static void readBackupFileToPath(String displayName,
                                            String destinationPath)
            throws Exception {
        Uri tree = treeUri();
        if (tree == null) {
            throw new IllegalStateException("No backup folder chosen.");
        }
        Uri found = findChild(tree, displayName);
        if (found == null) {
            throw new java.io.FileNotFoundException(displayName);
        }
        File destination = new File(destinationPath);
        try (InputStream in =
                     appContext.getContentResolver().openInputStream(found);
             OutputStream out = new FileOutputStream(destination)) {
            if (in == null) {
                throw new java.io.IOException("Could not open the backup file.");
            }
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            out.flush();
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            destination.delete();
            throw e;
        }
    }

    private static Uri findChild(Uri tree, String displayName) {
        Cursor c = null;
        try {
            c = appContext.getContentResolver().query(childrenUri(tree),
                    new String[]{
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    if (displayName.equals(c.getString(1))) {
                        return DocumentsContract.buildDocumentUriUsingTree(
                                tree, c.getString(0));
                    }
                }
            }
        } catch (Exception ignored) {
            // fall through to null
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return null;
    }
}
