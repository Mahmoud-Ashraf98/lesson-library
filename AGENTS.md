# AGENTS.md

Guidance for AI coding agents (Cursor, Copilot, Claude Code, etc.) working in
this repo. The canonical, detailed instructions live in **[CLAUDE.md](CLAUDE.md)**
— this file just points you there so you don't miss them.

## Orient in 60 seconds

This is an **offline-first** EFL material manager: a single-file Flask backend
(`server.py`, Flask is the *only* dependency), a no-build vanilla-JS frontend
(`static/`), and an Android APK wrapper (`android/`). It runs on the owner's
phone with no account or database. **The folders on disk are the database.**
The only network-capable feature is an explicitly configured backup destination
through Android's Storage Access Framework; everything else stays local.

1. **Read [CLAUDE.md](CLAUDE.md) before changing anything** — it lists the
   invariants that, if broken, corrupt a real person's data (folder/route names,
   atomic JSON writes, delete-to-Trash, Flask-only, Windows-safe filenames…).
2. **Read [README.md](README.md)** for the full reference: on-disk data model,
   the HTTP API table, frontend architecture, and the design system.

## Verify your work

```bash
python tests/test_server.py        # 108 tests, must stay green (Windows: py tests\test_server.py)
```

For UI changes, run the server (`LESSONLIB_DATA_DIR=/tmp/matlib python server.py`)
and check both light and dark themes at phone size (412×920). See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and PR checklist.

## Hard rules (full list in CLAUDE.md)

- No new dependencies — Flask only; no CDNs/fonts/icon packs. Network access is
  limited to the opt-in backup destination described in `CLAUDE.md`.
- Never rename the `LessonLibrary/`, `lessons/`, `plans/`, `Inbox/`, `Trash/`
  folders, the `lesson.json`/`plan.json` sidecars, or the `/api/lessons` routes.
- Every JSON write goes through `write_sidecar_json`; deletes move to `Trash/`.
- Escape every user string with `esc()` before `innerHTML`; keep JS/CSS
  WebView-conservative (classic script, no CSS nesting, no top-level await).
