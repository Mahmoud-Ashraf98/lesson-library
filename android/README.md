# Material Library Android APK

This wrapper embeds the existing Flask app in an Android application using
Chaquopy (Python 3.11 in-process). It starts the server only on
`127.0.0.1:8077` and displays it in a WebView. See the root
[README.md](../README.md) §6 for the full architecture and
[CLAUDE.md](../CLAUDE.md) for the invariants.

## Components

| File | Role |
|---|---|
| `app/src/main/java/.../MainActivity.java` | WebView host. Permission flow, server boot + readiness poll, file picker, opens `/files/*` + `/inbox-files/*` + `/api/export.csv` + non-local URLs externally, receives `ACTION_SEND`/`SEND_MULTIPLE` shares into `LessonLibrary/Inbox` (writing a `.last-share.json` batch marker), exposes `window.MLBridge.shareFile(id, name)` **and** `shareFiles(id, namesJson)` (SEND_MULTIPLE) to the page |
| `app/src/main/java/.../KitFileProvider.java` | Hand-rolled read-only `ContentProvider` over `LessonLibrary/lessons/` so files can be shared out via `ACTION_SEND`/`ACTION_SEND_MULTIPLE` content URIs. Deliberately replaces androidx FileProvider — the build kit is offline and must not pull new dependencies |
| `app/src/main/python/android_entry.py` | Entry point: sets `LESSONLIB_DATA_DIR`, boots the Flask server |
| `app/src/main/python/server.py`, `static/` | **Generated at build time** by `build-apk.ps1` from the project root — never edit these copies |
| `lesson-library.keystore` | Signing identity. **Do not lose or regenerate** — Android only installs future APKs as updates when signed with this same key |

`MainActivity` is `launchMode="singleTask"` so an incoming share while the
app is running arrives via `onNewIntent` (files are staged into `Inbox/`, a
`Inbox/.last-share.json` marker records exactly that batch, then the WebView
reloads onto `#/inbox` so the Import screen opens with only the just-shared
files preselected — never the whole Inbox). A cold-start share lands on the
same `#/inbox` screen via the readiness-waiter thread. `org.json` (bundled
in the Android SDK) is used to read/write the batch marker; no new dependency.

## Permissions

First launch opens Android's "All files access" setting
(`MANAGE_EXTERNAL_STORAGE`). This is required because the library
intentionally lives in the visible `/storage/emulated/0/LessonLibrary`
folder rather than private app storage — file managers and backups must see
it.

## Building

From the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

The script:

1. copies the current `server.py` and `static/` into the Android package
   (rebuild after **any** app change, or the APK ships stale code),
2. locates a **Python 3.11** interpreter for Chaquopy and passes its path via
   `-PchaquopyPython=…` (see below),
3. builds `assembleDebug` with the portable, fully offline kit in
   `../.android-tools/` (JDK, Gradle 9.4.1, Android SDK; selected via
   `JAVA_HOME`/`ANDROID_HOME`/`GRADLE_USER_HOME` env vars),
4. signs with `lesson-library.keystore` (debug and release both use it),
5. copies the result to `LessonLibrary.apk` in the project root.

**Host Python 3.11 is a build-time requirement.** Chaquopy runs a real
Python 3.11 on the build machine to assemble the pip requirements (Flask).
Gradle only auto-detects interpreters registered with the Windows `py`
launcher; when that fails (e.g. a uv-managed CPython), `build-apk.ps1` finds
3.11 itself — `py -3.11`, then `%APPDATA%\uv\python\cpython-3.11*`, then a
`python3.11` on `PATH` — and feeds the exact path to the `chaquopy` block in
`app/build.gradle` (which also honours a `CHAQUOPY_PYTHON` env var). This
affects only the build host; the bundled runtime inside the APK is unchanged.

Constraints: `applicationId com.lessonlibrary.app` is immutable;
`minSdk 24`, `targetSdk 35`; ABIs `arm64-v8a` + `armeabi-v7a`; the only
pip package installed into the APK is Flask (pinned in `app/build.gradle`).
