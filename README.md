# Material Library

[![tests](../../actions/workflows/tests.yml/badge.svg)](../../actions/workflows/tests.yml)

A personal, **fully offline** material manager for an EFL teacher. One Flask
server + one vanilla-JS page, running on the teacher's own phone (Samsung S10
Lite, Android 13) inside Termux or as a standalone APK at
`http://127.0.0.1:8077`. There is no cloud, no account, no database, and no
external resource of any kind.

> **For AI agents:** read [CLAUDE.md](CLAUDE.md) first. It lists the
> invariants you must not break and the commands to verify your work. This
> README is the full reference behind it.

---

## Quick start

```bash
git clone https://github.com/Mahmoud-Ashraf98/lesson-library.git && cd lesson-library
pip install -r requirements.txt                    # Flask is the only dependency
LESSONLIB_DATA_DIR=/tmp/matlib python server.py    # → http://127.0.0.1:8077
```

On Windows (PowerShell): `$env:LESSONLIB_DATA_DIR='C:\tmp\matlib'; py server.py`.
Run the test suite with `python tests/test_server.py`. The prebuilt Android APK
is attached to the [Releases](../../releases) page (it is not committed to the
repo). Everything below is the full reference.

---

## 1. Design philosophy

1. **The folders ARE the database.** Every material is a plain directory under
   `LessonLibrary/lessons/` containing the actual files (PDFs, slides, audio…)
   plus a human-readable `lesson.json` sidecar. The in-memory index is
   disposable — rebuilt from disk at startup and on demand (Rescan). The user
   can manipulate folders with any file manager and the app reconciles.
2. **Visible storage on purpose.** Data lives at
   `/storage/emulated/0/LessonLibrary/` (not private app storage) so Samsung
   Files, Google Drive backup, and USB transfer all see it. This is why the
   APK needs "All files access".
3. **Offline is a feature.** No CDN fonts, no icon packs, no analytics, no
   network calls of any kind. System fonts + inline SVG only.
4. **Nothing is ever silently destroyed.** Delete = move to
   `LessonLibrary/Trash/`. The single permanent-delete operation
   (`POST /api/trash/empty`) exists only behind an explicit confirmation on
   the Health screen.
5. **Crash-safe writes.** Every JSON write goes through
   `tmp file → fsync → os.replace` (atomic on the same filesystem). Uploads
   stream to `*.part.tmp` first. A half-finished add surfaces as a
   "needs attention" entry, never a corrupt record.

---

## 2. Repository layout

```
lesson-library/
├── server.py               # The entire backend (Flask, stdlib only)
├── start.sh                # Termux launcher (+ Termux:Widget shortcut)
├── static/
│   ├── index.html          # App shell: header, nav, dialogs, <main id=view>
│   ├── app.js              # The entire frontend (no framework, no build step)
│   ├── style.css           # Design system: all tokens + components
│   └── taxonomy.json       # Curated option catalogs (grammar, topics, …)
├── tests/
│   └── test_server.py      # 99 unittest tests (Flask test client, no deps)
├── android/                # APK wrapper (Chaquopy embeds Python + WebView)
│   ├── build-apk.ps1       # One-command build (copies server+static in)
│   ├── README.md           # Wrapper details
│   ├── lesson-library.keystore   # DO NOT LOSE — update-install identity (gitignored)
│   └── app/src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/lessonlibrary/app/
│       │   ├── MainActivity.java      # WebView host, share in/out, permission flow
│       │   └── KitFileProvider.java   # read-only ContentProvider for sharing files
│       └── python/         # build-time copies of server.py + static/ (generated)
├── .android-tools/         # Portable offline build kit: JDK, Gradle 9.4.1, SDK (gitignored)
└── LessonLibrary.apk       # Last built APK (gitignored; published via Releases)
```

The workspace root also has `.claude/launch.json` with a `material-library`
preview configuration that runs the server against a throwaway data dir
(`LESSONLIB_DATA_DIR`).

---

## 3. On-disk data model

### 3.1 Data directory

`DATA_DIR` defaults to `/storage/emulated/0/LessonLibrary` and is overridden
by the `LESSONLIB_DATA_DIR` environment variable (the only configuration
that exists — used by tests and the desktop preview).

```
LessonLibrary/
├── lessons/                # one folder per material — FOLDER NAME = MATERIAL ID
│   └── <material-id>/
│       ├── lesson.json     # metadata sidecar (schema v2)
│       └── *.*             # the kit files themselves
├── plans/                  # one folder per lesson plan — FOLDER NAME = PLAN ID
│   └── <plan-id>/
│       └── plan.json       # plan sidecar (schema 1)
├── Inbox/                  # staging area for files shared into the app
└── Trash/                  # everything "deleted" moves here, never erased
```

### 3.2 `lesson.json` (material sidecar, schema v2)

```json
{
  "schema_version": 2,
  "id": "jellyfish-debate",
  "title": "Jellyfish debate — persuasive speaking",
  "files": [
    { "name": "debate-cards.pdf", "note": "Cut up before class", "role": "Cards" },
    { "name": "listening.mp3", "note": "", "role": "Audio",
      "transcript": "Speaker 1: So, where are you from?…" }
  ],
  "age_groups": ["Teens"],
  "cefr_levels": ["B2"],
  "exam_targets": ["Cambridge English: B2 First"],
  "skills": ["Speaking", "Integrated"],
  "grammar_points": ["Second conditional"],
  "vocab_focuses": ["Sea animals"],
  "topics": ["Animals", "Environment"],
  "themes": ["Critical thinking"],
  "formats": ["Cut-up cards", "Worksheet"],
  "duration_min": 45,
  "notes": "free-text memory hooks",
  "date_added": "2026-06-02T10:12:00+02:00",
  "usage": [
    { "date": "2026-06-09", "group": "Teens Sat", "note": "",
      "rating": 4, "reflection": "Paced too fast — add CCQs.",
      "needs_revision": true }
  ]
}
```

Rules that matter:

- **The folder name always wins over `json["id"]`** (a stale id is healed on
  the next metadata write). Renaming a folder with a file manager + Rescan is
  a supported "rename" operation.
- `files[]` on disk stores `name` + `note`, plus optional **`role`**
  (Student handout / Teacher notes / Answer key / Audio / Slides / Cards /
  Other, or a custom value — Feature D) and **`transcript`** (free text, only
  meaningful for audio). Empty role/transcript keys are omitted, never stored
  as nulls. **The directory listing is the source of truth** for which files
  exist and their sizes; metadata is matched to real files by exact name at
  scan time, stale entries are dropped.
- `usage[]` is the teaching log. Entries must have an ISO `YYYY-MM-DD` date;
  malformed entries are dropped at read time, the rest are preserved verbatim.
  Each entry may carry the optional **reflection trio** (Feature A):
  `rating` (integer 1–5), `reflection` (one-line text), and `needs_revision`
  (bool). All three are omitted when empty, so v1 logs gain no spurious keys
  until the teacher actually reflects.
- All multi-value fields tolerate v1 scalars (`"topic": "x"` →
  `["x"]`) and are deduped case-insensitively, snapping to the canonical
  casing of the option catalogs while preserving unknown custom values.
- **v1 sidecars are normalized in memory on read and rewritten as v2 only
  when the user saves that record.** Never bulk-rewrite at startup.

### 3.3 `plan.json` (lesson-plan sidecar, schema 1)

```json
{
  "schema_version": 1,
  "id": "tuesday-b2-evening",
  "title": "Tuesday 18:00 — B2 evening",
  "group": "B2 evening",
  "plan_date": "2026-06-16",
  "notes": "Exam block first, debate as reward.",
  "items": [
    { "material_id": "ielts-writing-task-2", "done": true,  "note": "" },
    { "placeholder": "Break", "duration_min": 5, "done": false, "note": "" },
    { "material_id": "jellyfish-debate",     "done": false, "note": "" }
  ],
  "stage_durations": { "warmer": 5, "break": 5, "cool-down": 5 },
  "date_added": "2026-06-10T09:00:00+02:00"
}
```

- `items[].material_id` references a material **folder name**. Dangling
  references (renamed/trashed material) are intentionally kept — the UI flags
  them; the server never garbage-collects the teacher's planning.
- An item may instead be a **stage placeholder** (`{"placeholder": "Warmer",
  "duration_min": 5, "done": …, "note": …}`) for warmers, breaks, and
  cool-downs. Placeholders have no material; they count toward the plan's live
  duration and can be checked off like any item (no teaching-log side effect).
- `stage_durations` (optional, Feature B) holds per-stage default minutes
  (`warmer` / `break` / `cool-down`, each 1–180) for the run-mode countdown
  timer. Invalid values are dropped; the client falls back to 5 minutes.
- An unreadable `plan.json` is surfaced as a recovered plan with
  `"unreadable": true` (API-side flag, not persisted); saving from the UI
  rewrites it cleanly.

### 3.4 Inbox

Plain files staged by either (a) Android share-sheet → MainActivity copies
the stream in, or (b) the user dropping files there with a file manager.
Attaching inbox files to a material **moves** them (`os.replace`, same
filesystem) into the material folder. Dotfiles and `*.tmp` are invisible.

The Android share sheet also writes `Inbox/.last-share.json`
(`{"ts", "names": [...]}`) recording exactly which files arrived in the most
recent share. The Import screen (`#/inbox`) preselects **only that batch** —
older inbox files are never auto-bundled into a new material. The marker is a
dotfile (invisible to the scanner) and self-heals: `list_inbox_batch()` drops
names that have since left the Inbox, and clearing it is one route
(`/api/inbox/batch/clear`, the "keep in Inbox" action).

### 3.5 Trash

Direct children of `Trash/` are whole moved folders (or files). Plan folders
get a `plan-` prefix to avoid colliding with material names; any further
collision gets a `-YYYYMMDD-HHMMSS` suffix. Restore = move back with a file
manager + Rescan.

A `replace_all` restore (Feature E) first moves the live `lessons/`, `plans/`,
`Inbox/`, `Trash/` into a sibling `Trash-restore-<YYYYMMDD-HHMMSS>/` folder, so
the previous state is always recoverable by hand.

### 3.6 `backup.json` (data-root, Feature E, optional)

A single optional file at the data root configuring cloud backup. Absent until
the teacher connects a destination; while absent the rest of the app is fully
offline and every `/api/backup/*` action route returns `503`.

```json
{
  "destination_type": "saf",            // "saf" (Android) | "local" (Termux/desktop)
  "destination_uri": "content://…",     // SAF tree URI, Android only
  "destination_path": "/sdcard/…",      // filesystem path, Termux/desktop only
  "last_backup_at": "2026-06-22T14:30:00+02:00",
  "last_backup_size_bytes": 12345678,
  "last_backup_material_count": 142,
  "auto_frequency": "after_n_materials", // "never" | "weekly" | "after_n_materials"
  "after_n_value": 10,
  "reminder_days": 7,
  "materials_added_since_last_backup": 3
}
```

`materials_added_since_last_backup` increments on each material create (only
when backup is configured) and resets to 0 after a successful backup, driving
the "back up after N new materials" nudge. Written through
`write_sidecar_json` like every other sidecar.

---

## 4. Backend (`server.py`)

Single file, single dependency (**Flask** — keep it that way), stdlib
everything else. Runs threaded on `127.0.0.1:8077`; state is
`STATE = {"lessons", "needs", "plans"}` guarded by one `LOCK` (single user,
contention is trivial).

### 4.1 Key internals

| Function | Responsibility |
|---|---|
| `normalize_record(id, raw, files)` | Any json/form (v1/v2/hand-edited) → API-shaped v2 record |
| `normalize_plan(id, raw)` / `plan_from_form` | Same idea for plans |
| `normalize_usage(value)` | Teaching-log hygiene (date gate + optional reflection trio) |
| `merge_file_meta` / `attach_file_meta` | Carry per-file note/role/transcript through add/reorder/edit |
| `perform_backup` / `perform_restore` | Feature E zip create / strategy-driven restore (stdlib `zipfile`) |
| `read_backup_config` / `backup_is_due` | `backup.json` access and the reminder/after-N due check |
| `scan_library()` / `scan_plans()` / `rebuild_index()` | Disk → in-memory index |
| `write_sidecar_json(folder, name, data)` | tmp + fsync + `os.replace` (use for **every** JSON write) |
| `save_uploads` / `receive_uploads` | Streamed uploads with sanitize + dedupe, returns final names |
| `take_inbox_files(folder)` | Moves request-named inbox files into a material folder |
| `slugify` / `unique_slug(base, parent)` | Windows-safe, case-insensitively unique folder names |
| `sanitize_filename` / `dedupe_filename` | Windows-safe kit file names (`a.pdf` → `a (2).pdf`) |
| `resolve_lesson_dir` / `resolve_plan_dir` / `resolve_inbox_file` | Path-traversal-safe resolution (realpath parent check) |
| `index_payload()` | The one big payload the frontend boots from |

Filename safety: forbidden characters stripped, Windows reserved names
(`con`, `prn`, …) prefixed, `*.tmp` suffixed with `_` (the scanner ignores
`.tmp`), collisions deduped **case-insensitively** (the phone's sdcardfs is
case-insensitive).

### 4.2 HTTP API

Everything is same-origin JSON; mutations are `multipart/form-data` POSTs
(file uploads and text fields share one encoding). Multi-value fields repeat
the form key. Structured fields are JSON strings inside form fields.

| Route | Method | Purpose / body | Returns |
|---|---|---|---|
| `/` | GET | App shell | HTML |
| `/api/lessons` | GET | Full index payload (see below) | `{lessons, needs_attention, plans, inbox, inbox_batch, options, taxonomy, file_roles}` |
| `/api/rescan` | POST | Rebuild index from disk | same payload |
| `/api/lessons` | POST | Create material. `title` (required), repeated facet fields, `duration_min`, `notes`, `files` (uploads) + `file_notes` (JSON array, paired by order), `inbox_files` (JSON array of Inbox names to move in) + `inbox_notes` (JSON map) | `201 {lesson}` |
| `/api/lessons/<id>` | POST | Update metadata (same fields; `existing_notes` JSON map overrides stored per-file notes; `inbox_files`/`inbox_notes` as above). `date_added` and `usage` are **carried over server-side** — the form never posts them | `{lesson}` |
| `/api/lessons/<id>/files` | POST | Upload more files only (`files` + `file_notes`) | `{saved, lesson}` |
| `/api/lessons/<id>/inbox` | POST | Attach Inbox files (`inbox_files`/`inbox_notes`) to an existing material **without touching metadata** — the Import screen's "add to existing" | `{attached, lesson}` |
| `/api/lessons/<id>/files/to-inbox` | POST | Move named kit files back to the Inbox (the Undo half of an import); `trash_if_empty=1` trashes a material left with no files | `{moved, lesson}` |
| `/api/lessons/<id>/trash` | POST | Move material folder to Trash | `{trashed}` |
| `/api/lessons/<id>/usage` | POST | Append teaching-log entry: `date` (optional, defaults today), `group`, `note`, and the optional reflection trio `rating`/`reflection`/`needs_revision` | `{lesson}` |
| `/api/lessons/<id>/usage/update` | POST | Add/edit the reflection on entry `index` (`rating`/`reflection`/`needs_revision`; a present-but-empty field clears that key) | `{lesson}` |
| `/api/lessons/<id>/usage/delete` | POST | Remove entry by `index` | `{lesson}` |
| `/api/lessons/<id>/files/edit` | POST | Rename a file and/or set its `note`, `role`, `transcript` (present-but-empty clears) | `{lesson, old, new}` |
| `/api/reflections` | GET | Reverse-chron feed of reflective log entries; `?needs_revision=true` filters | `{reflections: [{material_id, material_name, date, group, rating, reflection, needs_revision}]}` |
| `/api/plans` | POST | Create plan: `title` (required), `group`, `plan_date`, `notes`, `items` (JSON array) | `201 {plan}` |
| `/api/plans/<id>` | POST | Full plan update (same fields; `date_added` carried over) | `{plan}` |
| `/api/plans/<id>/trash` | POST | Move plan folder to Trash (`plan-` prefix) | `{trashed}` |
| `/api/inbox` | GET | List staged files + the last-share batch | `{files: [{name, size}], batch: [name]}` |
| `/api/inbox/trash` | POST | Move named Inbox files to Trash (`names` JSON array) | `{trashed, files, batch}` |
| `/api/inbox/batch/clear` | POST | Forget the last-share marker ("keep in Inbox") | `{ok}` |
| `/inbox-files/<name>` | GET | Serve a staged Inbox file (thumbnails on the Import screen) | file |
| `/api/health` | GET | Stats: counts, byte totals, `untagged[]` (missing level/skills/format/topics), `trash[]` with sizes+ages, inbox summary, `data_dir` | JSON |
| `/api/trash/empty` | POST | **Permanent delete** of Trash contents; optional `older_than_days` | `{removed}` |
| `/api/export.csv` | GET | Whole index as UTF-8-BOM CSV (Excel-safe), includes `times_used`/`last_used` | CSV attachment |
| `/files/<id>/<name>` | GET | Serve a kit file (Range support, inline disposition) | file |

Backup & restore routes (Feature E — all opt-in; the action routes return
`503` until a destination is configured via `PUT /api/backup/config`):

| Route | Method | Purpose | Returns |
|---|---|---|---|
| `/api/backup/config` | PUT | Set destination + cadence (JSON body: `destination_type`, `destination_path`/`destination_uri`, `auto_frequency`, `after_n_value`, `reminder_days`). Works while unconfigured — this is how you turn it on | config + `{configured, is_due}` |
| `/api/backup/status` | GET | Current `backup.json` plus computed `is_due` | config or `503` |
| `/api/backup/now` | POST | Create + deliver a backup zip | `{ok, bytes, material_count, timestamp, name}` |
| `/api/backup/list` | GET | List backups in the destination | `{backups: [{name, size_bytes, modified_at}]}` |
| `/api/backup/restore` | POST | `backup_name` + `strategy` (`replace_all`/`merge_skip`/`merge_overwrite`); auto-backs-up current state first, reports `conflicts[]` | result |
| `/api/backup/disconnect` | POST | Forget the destination (backups already saved are untouched) | `{ok}` |

Error contract: failures return `{"error": "human-readable message"}` with
4xx status; the frontend surfaces `error` verbatim in a toast.

`index_payload()` notes: `lessons` is a **legacy key** (records are
materials). `inbox_batch` is the subset of `inbox` from the most recent share
(see §3.4). `taxonomy` merges a generated "Your library" group (custom values
in use, deduped by most frequent casing) on top of the curated groups from
`static/taxonomy.json`. `plans` are sorted by `plan_date` (undated last).

---

## 5. Frontend (`static/`)

No framework, no build step, no imports — `app.js` is loaded as one classic
script. Works in Chrome (Termux flow) and Android WebView (APK flow).
**Keep JS/CSS conservative**: classic script semantics, no CSS nesting, no
top-level await.

### 5.1 Architecture

- **State:** the whole index payload lives in `DB` (refetched by
  `refresh()`); filter state, sort mode, and scroll position are module-level.
  All search/filter/sort run client-side and are instant.
- **Routing:** hash-based (`hashchange` → `render()`) so the Android back
  button and WebView history work. Routes:
  `#/` (library) · `#/lesson/<id>` · `#/add` · `#/edit/<id>` ·
  `#/repair/<id>` · `#/inbox` (Import) · `#/reflections` (Reflect) ·
  `#/plans` (Classes) · `#/plan/<id>` · `#/plan/<id>/pick` ·
  `#/plan/<id>/run` (Start class) · `#/settings` · `#/health`.
- **Chrome:** bottom nav (**Library / Classes / Reflect / Inbox**, with a live
  unfiled count badge on Inbox) + contextual FAB (Add material / New plan),
  both configured per-route in `configureChrome()`; `body[data-view]` drives
  visibility via CSS. The app-bar **gear** opens Settings (theme, manual
  rescan, health & diagnostics, cloud **Backup & restore**, CSV export) —
  maintenance is no longer in the daily nav. The library auto-rescans on app
  resume (debounced) and via pull-to-refresh.
- **Mutation helpers:** `postUsage` / `deleteUsage` / `savePlan` update `DB`
  in place from the server response (no full refetch for small mutations).
- **Dialogs:** native `<dialog>` (`confirmdlg`, `plandlg`, `usagedlg`,
  `reflectdlg`, `fileeditdlg`, `plansheet`, `lightbox`, plus on-demand
  `runpickerdlg` and `restoredlg`) each with a Promise wrapper;
  `window.confirm` fallback when `showModal` is missing.
- **Icons:** `ICONS` map + `icon(name)` → inline Lucide-style SVG. Never
  emoji, never external assets.
- **Sharing:** never silent. The hero button shares a lone attachment
  directly but opens `openShareSheet()` (a checkbox picker) for a multi-file
  material; each file row also has its own share icon. `shareFile(id, name)`
  and `shareFiles(id, names)` try, in order: ① `window.MLBridge`
  (`shareFile`/`shareFiles`, APK JS bridge → SEND / SEND_MULTIPLE) → ② Web
  Share API with fetched `File`s → ③ open externally with a hint toast.
- **Import (`renderInbox`):** files shared in (or dropped in a file manager)
  are filed from the Inbox screen — thumbnails + sizes, batch preselection,
  and four explicit outcomes: one material from selected (→ Quick Add), one
  material per file, add to existing (`openMaterialPicker`), or keep in Inbox.
  Each outcome ends in a `toast(..., {actions: [View, Undo]})`; Undo reverses
  the import via `/files/to-inbox`.
- **Quick Add:** `#/add` is two-stage — Files + Title + Format on one screen
  with a one-tap **preset** row (Cambridge Starters, Pre-K, A2 Teens, IELTS
  Writing/Speaking, Printable activity, Classroom game), and the full
  cataloguing form behind an "Add details" expander. Title and format are
  auto-suggested from the attached file names until the teacher edits them.
- **Search (`matches`):** every query word must hit the haystack — title,
  notes, **all** facets (CEFR, age, skills, formats, exams, grammar, vocab,
  topics, themes), **attachment file names, and file notes**. Matching is
  substring (covers prefixes) + alias/synonym (`YL`→young learners,
  `deck`→slides, `fce`→B2 First…) + bounded edit distance (1 typo from 5
  letters, 2 from 8). Matches are `<mark>`-highlighted; recent searches are
  remembered in `localStorage`.
- **Tag suggestions:** `refreshSuggestions()` in the form matches title +
  file names against all catalogs with word-boundary regexes — purely local,
  intentionally dumb.
- **Plans (Classes):** drag-to-reorder (`enablePlanDrag`, pointer events),
  multi-select material picker, duplicate plan, warmer/break/cool-down
  placeholders, live total + remaining duration, and a **Start class** run
  mode (`#/plan/<id>/run`) with large next/previous/done controls.
- **Plan ↔ log sync (visible):** checking a plan item done logs usage
  `{date: today, group: plan.group, note: "Plan: <title>"}` **and announces
  it in a toast** (with a **Reflect** action — Feature A); unchecking removes
  the most recent matching entry (best-effort) and says so. Placeholders never
  log.
- **Reflection loop (Feature A):** the run-mode Done toast and every
  teaching-log entry offer a lightweight reflection sheet (1–5 stars, one-line
  note, "needs revision" flag). The **Reflect** feed (`#/reflections`) lists
  every reflective entry with All / Needs-revision / 1–2★ filters; the Health
  screen surfaces a "N materials need revision" stat that jumps there.
- **Per-file roles (Feature D):** each file row shows a role chip + icon; the
  file editor sets `role` (datalist of curated + custom roles) and, for audio,
  a `transcript`. A **Hide answer keys** toggle (shared `localStorage`) hides
  `Answer key` files in the detail view and in run mode (so a projected class
  view never reveals keys). Quick Add can batch-tag roles before saving.
- **Run-mode utilities (Feature B):** a per-item **countdown timer** (chip →
  inline panel: Start/Pause, Reset, ±1 min, auto-advance; yellow under 2 min,
  red at 0:00), a **random picker** (FAB → "Pick one" / "Make teams", names
  typed on the fly, no roster, nothing persisted), and a **quick-jump** search
  that inserts a library material as a removable "side-track" without leaving.
- **Thumbnail grid (Feature C):** the library and a material's files each have
  a list ↔ grid toggle (`mlib-list-layout` / `mlib-file-layout`); grid cards
  show the first image as a thumbnail or a format/role icon, the CEFR badge,
  and a needs-revision badge.

### 5.2 Design system (`style.css`)

All colors are CSS custom properties defined twice: `:root` (light) and
`[data-theme="dark"]` (true tonal dark, not inverted). Components never use
raw hex. Theme selection: `localStorage["mlib-theme"]` if set, else
`prefers-color-scheme`, applied as `<html data-theme>`; the
`#thememeta` theme-color is updated in JS.

Token groups: surfaces (`--bg/--surface/--surface-2`), ink scale
(`--ink/--ink-2/--ink-3`), indigo primary (`--primary`, `--primary-soft`, …),
semantic (`--danger/--ok/--warn-*`), per-CEFR badge pairs
(`--cefr-a1-bg/-ink` … `c2`), shadows, radii, motion
(`--t-fast/--t-med/--ease`).

Conventions: 44px minimum touch targets, 4/8px spacing rhythm,
`prefers-reduced-motion` globally respected, `:focus-visible` rings,
`aria-pressed` on toggle chips, `aria-live="polite"` toasts.

### 5.3 Known frontend footguns

- `[hidden] { display: none !important; }` exists because component classes
  set `display`; without it the `hidden` attribute does nothing. Don't remove.
- Every `icon()` usage needs an explicit size rule on its container —
  unsized inline SVGs render gigantic.
- All user strings go through `esc()` before `innerHTML` interpolation.
- The image **lightbox must never navigate** to `/files/...` — the APK
  WebView opens `/files/` and `/inbox-files/` navigations externally (see §6).
  In-app previews (lightbox, library cards, Inbox thumbnails) set `<img src>`
  instead (subresource fetches are not intercepted).
- Suggestion chips re-render on every apply; never hold element references
  across `refreshSuggestions()`.

---

## 6. Android wrapper (`android/`)

Chaquopy (Python 3.11) embeds the Flask server in-process;
`android_entry.start(dataDir)` sets `LESSONLIB_DATA_DIR` and runs it.
`MainActivity` is a plain `Activity` (no androidx) hosting a WebView pointed
at `http://127.0.0.1:8077/`.

| Concern | Implementation |
|---|---|
| Identity | `applicationId com.lessonlibrary.app` + `android/lesson-library.keystore` — **both immutable** or updates stop installing |
| Storage permission | `MANAGE_EXTERNAL_STORAGE` ("All files access") because the library is in visible shared storage |
| File opening | `shouldOverrideUrlLoading`: `/files/*`, `/inbox-files/*`, and `/api/export.csv` (and any non-local URL) open externally via `ACTION_VIEW`; everything else stays in the WebView |
| Share **in** | `singleTask` + `ACTION_SEND`/`SEND_MULTIPLE` intent filters → streams copied into `LessonLibrary/Inbox` (sanitized + deduped, mirroring server rules) + a `Inbox/.last-share.json` batch marker → WebView lands on the **Import screen** `#/inbox` (cold start: the waiter thread appends the fragment; warm start: `location.href + reload` so the payload includes the new inbox files and batch) |
| Share **out** | `window.MLBridge.shareFile(id, name)` / `shareFiles(id, namesJson)` (`@JavascriptInterface`) → `ACTION_SEND` / `ACTION_SEND_MULTIPLE` chooser with `content://com.lessonlibrary.app.files/<id>/<name>` URIs |
| `KitFileProvider` | Hand-rolled read-only `ContentProvider` (path-traversal-checked, answers `DISPLAY_NAME`/`SIZE` queries, guesses MIME). Exists **instead of androidx FileProvider** because the build kit is offline and must not need new dependencies |
| File picker | `onShowFileChooser` → `ACTION_OPEN_DOCUMENT` (multiple) |
| Backup folder (Feature E) | `window.MLBridge.pickBackupFolder()` → `ACTION_OPEN_DOCUMENT_TREE`; the granted tree URI is persisted (`takePersistableUriPermission`, stored by `BackupBridge`) and handed back to JS via `onBackupFolderPicked(uri)`. The Python server calls `BackupBridge.{writeBackupToUri, readBackupNames, readBackupBytes}` (Chaquopy → Java) using framework `DocumentsContract` — **no new dependency** |
| Back button | WebView history back (pairs with hash routing) |

Build: `powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1`
from the project root. The script copies the **current** `server.py` +
`static/` into `android/app/src/main/python/` (those copies are generated
artifacts — never edit them), then runs the portable Gradle/JDK/SDK kit in
`.android-tools/` fully offline, signs, and drops `LessonLibrary.apk` in the
project root. Signing secrets come from `android/keystore.properties`
(gitignored — copy `keystore.properties.example` and fill it in). Without that
file the script auto-generates a throwaway keystore so a fresh clone still
builds; the resulting APK simply won't install as an update over the original
author's build (different signing identity, by design).

### 6.1 Backup & restore (Feature E, opt-in)

The one feature that may touch a network — and only after the teacher
explicitly connects a destination. Until then every `/api/backup/*` action
route returns `503` and the app is unchanged. **No new dependency:** backups
are stdlib `zipfile`; the cloud connection is the Android SAF bridge or a local
path, never an HTTP client library.

- **Destinations.** *Android:* a Storage Access Framework folder (Google Drive,
  OneDrive, Dropbox, local — all uniform), picked once and persisted.
  *Termux/desktop:* a local filesystem path the teacher keeps synced to Drive
  with their own tool (rclone, Insync…). Configured in Settings → **Backup &
  restore**, persisted in `backup.json` (§3.6).
- **Backup format.** One `lesson-library-backup-YYYYMMDD-HHMMSS.zip` of the
  whole tree (`lessons/`, `plans/`, `Inbox/`, `Trash/`) with folder names —
  i.e. record ids — preserved exactly, plus a `health.json` snapshot at the
  root. Built to a temp file so memory stays flat.
- **Smart nudges.** A reminder cadence (3/7/14/30 days or never) and an
  optional "back up after N new materials" trigger drive a non-blocking,
  dismissable banner on the library home and an `is_due` flag in
  `/api/backup/status`. The Settings and Health screens both show last-backup
  time/size and a one-tap **Back up now**.
- **Restore.** Lists available backups and offers three strategies —
  **merge, keep mine** (`merge_skip`, the safe default), **merge, use backup**
  (`merge_overwrite`), or **replace everything** (`replace_all`, which moves
  the current tree to `Trash-restore-<timestamp>/` first). Every restore
  auto-creates a safety backup of the current state first, and reports any
  **conflicts** (material ids whose `lesson.json` differs between devices) for
  the teacher to reconcile by hand — never auto-resolved.

---

## 7. Running, testing, verifying

| Task | Command |
|---|---|
| Run tests (99) | `py tests\test_server.py` (from `lesson-library/`) |
| Run locally (Windows) | `$env:LESSONLIB_DATA_DIR='C:\some\tmp\dir'; py server.py` → http://127.0.0.1:8077 |
| Desktop preview (agents) | `preview_start` with launch config `material-library` (data dir `%TEMP%\matlib-demo`) |
| Run on phone (Termux) | `./start.sh` (also installs a Termux:Widget shortcut) |
| Build APK | `powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1` |

Test conventions (`tests/test_server.py`): pure `unittest` + Flask test
client. `LibraryTestCase.setUp` repoints **all** module-level dirs
(`DATA_DIR`, `LESSONS_DIR`, `TRASH_DIR`, `PLANS_DIR`, `INBOX_DIR`) at a
throwaway temp dir and resets `STATE` — any new directory constant must be
added there. Multipart helpers: uploads are `(io.BytesIO(...), "name.pdf")`
tuples; JSON-in-form fields use `json.dumps(...)`.

Manual verification checklist after UI changes: test at 412×920 (the
actual phone), both themes, with `needs_attention` + Inbox (and a
`.last-share.json` batch) non-empty, and exercise import → Quick Add (with a
preset) → share sheet → Classes plan (drag, placeholder, Start class) →
settings → health → trash → restore.

---

## 8. Versioning and migration rules

- Material schema is **v2** (`SCHEMA_VERSION = 2`); plan schema is **1**.
- Adding an optional field: add to `normalize_*` with a tolerant default,
  carry it over in `api_update` if the form doesn't post it (see `usage`),
  and add a round-trip test. That's a non-breaking change; no version bump.
- Renaming/removing fields or changing meaning: bump the schema version and
  follow the v1→v2 pattern — translate old shapes in `normalize_record`
  forever, rewrite only on user save.
- Never write a migration that walks the disk rewriting sidecars in bulk.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Material** | One teachable kit = one folder under `lessons/` (API/legacy name: "lesson") |
| **Plan / Class** | An ordered, checkable queue of materials (and stage placeholders) for one class session; surfaced in the nav as "Classes" |
| **Stage placeholder** | A non-material plan item — warmer, break, or cool-down — that still counts toward plan duration |
| **Import / batch** | The Inbox screen for filing shared files; the "batch" is the most recently shared set (`Inbox/.last-share.json`), the only files preselected |
| **Teaching log / usage** | Per-material list of `{date, group, note}` records of real classroom use |
| **Inbox** | Staging folder for files entering the library (share sheet or manual drop) |
| **Needs attention** | Folder whose sidecar is missing/broken; repairable via the UI without data loss |
| **Facet** | Any multi-value metadata axis (age, CEFR, skills, format, exam, grammar, vocab, topic, theme) |
| **Taxonomy** | The curated option catalogs in `static/taxonomy.json` + per-library custom values |

---

## 10. License

Released under the [MIT License](LICENSE). Contributions are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) and the invariants in [CLAUDE.md](CLAUDE.md).
