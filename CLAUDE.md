# CLAUDE.md — Material Library

Offline EFL material manager: `server.py` (Flask, only dependency) +
`static/` (vanilla JS/CSS, no build step) + `android/` (Chaquopy APK
wrapper). Runs on the owner's phone at `http://127.0.0.1:8077`. Full
reference: [README.md](README.md).

## Invariants — breaking any of these corrupts a real person's data

1. **Never rename** the `LessonLibrary/` data folder, the `lessons/`
   subfolder, the `lesson.json` sidecar filename, or the `/api/lessons`
   routes. They predate the "material" terminology; existing phones depend
   on them. (`plans/`, `plan.json`, `Inbox/`, `Trash/`, and the optional
   `backup.json` at the data root are now contracts too.)
2. **Folder name = record id, and the folder wins** over the id stored in
   json. Never invent another id source.
3. **Every JSON write** goes through `write_sidecar_json` (tmp → fsync →
   `os.replace`). Never write a sidecar any other way.
4. **Delete = move to `Trash/`**, never erase. The only permanent delete is
   `POST /api/trash/empty`, and it must stay behind an explicit user
   confirmation.
5. **No external resources, ever** — no CDNs, fonts, icon packs, network
   calls. Inline SVG + system fonts only. **Flask stays the only Python
   dependency**; the Android build kit is offline, so no new
   Gradle/Java dependencies either. **Scoped exception (Feature E only):**
   network/cloud access is permitted ONLY within the backup feature
   (`/api/backup/*` routes), ONLY when the teacher has explicitly configured
   a destination, and ONLY through the SAF bridge (`BackupBridge.java`) or a
   local filesystem path. No other feature may make network calls, and the
   no-new-dependencies rule is NOT relaxed — backup uses stdlib `zipfile`
   plus the framework `DocumentsContract`, nothing new.
6. **Windows-safe filenames + case-insensitive collision checks** everywhere
   (the phone's filesystem is case-insensitive; the dev machine is Windows).
7. **v1 sidecars**: normalize on read, rewrite as v2 only on user save.
   Never bulk-rewrite the disk.
8. **APK identity**: `applicationId com.lessonlibrary.app` and
   `android/lesson-library.keystore` are immutable, or updates stop
   installing on the phone. The keystore is **gitignored** (never publish a
   signing key) — keep a private backup. Signing passwords come from
   `android/keystore.properties` (gitignored; see `.example`); a fresh clone
   without it auto-generates a throwaway key and still builds.

## Commands

```powershell
# from lesson-library/
py tests\test_server.py                                          # 99 tests, must stay green
$env:LESSONLIB_DATA_DIR='C:\tmp\matlib'; py server.py            # run locally
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1 # build APK (offline kit)
```

Browser preview: launch config `material-library` (`.claude/launch.json`),
demo data dir `%TEMP%\matlib-demo`. Verify UI at 412×920, light AND dark
(`data-theme` on `<html>`, toggle in header).

## Where things live

- All backend behavior: `server.py` (single file; routes at the bottom,
  normalization in the middle, naming/IO helpers at the top).
- All frontend behavior: `static/app.js` (hash router `route()`/`render()`,
  payload cached in `DB`, views are `render*` functions building innerHTML).
  Bottom nav is **Library / Classes / Inbox**; maintenance (theme, rescan,
  health, backup) lives in `renderSettings()` behind the app-bar gear.
- All styling: `static/style.css` — tokens at the top (`:root` light,
  `[data-theme="dark"]` dark); components never use raw hex.
- App shell + dialogs + bottom nav: `static/index.html`.
- APK wrapper: `android/app/src/main/java/.../MainActivity.java` (WebView,
  share in/out) and `KitFileProvider.java` (read-only ContentProvider).
  `android/app/src/main/python/` contains **generated copies** — never edit.

## Gotchas that have already bitten

- `[hidden]{display:none!important}` in style.css is required (component
  classes set `display`). Don't remove.
- Any new `icon()` usage needs an explicit svg size rule on its container,
  or the SVG renders huge.
- The APK WebView opens `/files/*` and `/inbox-files/*` **navigations**
  externally — in-app image preview (library + Inbox thumbnails) must use
  `<img src>` (subresource), never a link/navigation. `/api/export.csv` is
  also routed external (downloads don't work in the WebView — there is no
  DownloadListener).
- Share is never silent: the hero button opens a multi-file picker
  (`openShareSheet`) when a material has >1 file; one file shares directly.
  The Inbox import screen (`#/inbox`) only preselects the most recent share
  batch (`inbox_batch` in the payload, fed by `Inbox/.last-share.json`), so
  unrelated files are never bundled. Import outcomes use `toast(..., {actions})`
  with View/Undo; Undo calls `/api/lessons/<id>/files/to-inbox`.
- `api_update` rebuilds the record from the form; fields the form doesn't
  post (`date_added`, `usage`) must be carried over server-side. Follow that
  pattern for any new non-form field.
- Escape every user string with `esc()` before innerHTML interpolation.
- Tests repoint module-level dir constants in `LibraryTestCase.setUp`; a new
  directory constant in server.py must be added there or tests leak into the
  import-time temp dir.
- Keep JS/CSS WebView-conservative: classic script (no modules), no CSS
  nesting, no top-level await.

## Editing checklists

**New material/plan field** → README §8: tolerant default in `normalize_*`,
carry-over in update route if not form-posted, round-trip test, then UI.

**New server route** → use `resolve_*` helpers for any path from the client
(traversal safety), return `{"error": msg}` + 4xx on failure (frontend
toasts it verbatim), take `LOCK` around `STATE` access, log one line.

**UI change** → keep 44px touch targets, both themes, `esc()` everything,
`aria-` parity with visuals, respect `prefers-reduced-motion`; verify in
preview at phone size before calling it done.

**Shipping to the phone** → rebuild the APK (the build script copies
`server.py` + `static/` into the package; a stale APK ships stale code).
