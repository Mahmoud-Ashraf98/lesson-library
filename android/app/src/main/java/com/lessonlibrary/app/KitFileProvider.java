package com.lessonlibrary.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;

/**
 * Read-only content provider over LessonLibrary/lessons/<material>/<file>.
 *
 * Exists so MainActivity can hand kit files to other apps with ACTION_SEND
 * without adding the androidx FileProvider dependency (the build kit is
 * offline). URIs look like content://com.lessonlibrary.app.files/<id>/<name>
 * and are only ever shared with a one-time read grant.
 */
public class KitFileProvider extends ContentProvider {

    static Uri uriFor(String materialId, String fileName) {
        return new Uri.Builder()
                .scheme("content")
                .authority("com.lessonlibrary.app.files")
                .appendPath(materialId)
                .appendPath(fileName)
                .build();
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 2) {
            throw new FileNotFoundException("Bad URI: " + uri);
        }
        File lessons = new File(Environment.getExternalStorageDirectory(),
                "LessonLibrary/lessons");
        File file = new File(new File(lessons, segments.get(0)), segments.get(1));
        try {
            String canonical = file.getCanonicalPath();
            String root = lessons.getCanonicalPath();
            if (!canonical.startsWith(root + File.separator)) {
                throw new FileNotFoundException("Outside library: " + uri);
            }
        } catch (IOException e) {
            throw new FileNotFoundException("Unresolvable: " + uri);
        }
        if (!file.isFile()) {
            throw new FileNotFoundException("No such file: " + uri);
        }
        return file;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode)
            throws FileNotFoundException {
        if (!"r".equals(mode)) {
            throw new FileNotFoundException("Read-only provider");
        }
        return ParcelFileDescriptor.open(resolve(uri),
                ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        // Receiving apps (Gmail, WhatsApp, ...) query for a display name and
        // size before accepting a stream; answer honestly, nothing more.
        File file;
        try {
            file = resolve(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        if (projection == null) {
            projection = new String[]{
                    OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        }
        MatrixCursor cursor = new MatrixCursor(projection, 1);
        Object[] row = new Object[projection.length];
        for (int i = 0; i < projection.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(projection[i])) {
                row[i] = file.getName();
            } else if (OpenableColumns.SIZE.equals(projection[i])) {
                row[i] = file.length();
            }
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0) {
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(
                        name.substring(dot + 1).toLowerCase());
                if (mime != null) {
                    return mime;
                }
            }
        }
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Read-only provider");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection,
                      String[] selectionArgs) {
        throw new UnsupportedOperationException("Read-only provider");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Read-only provider");
    }
}
