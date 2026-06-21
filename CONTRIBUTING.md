# Contributing

Thanks for your interest! This is a small, deliberately constrained project —
an **offline-first** material manager that runs on one teacher's phone. Those
constraints are the point, so a contribution that respects them is far more
likely to merge than a big one that doesn't.

## Read these first

- [CLAUDE.md](CLAUDE.md) — the invariants you must not break (breaking one
  corrupts real user data), the commands, and the gotchas. This is the
  single most important file for anyone — human or AI — changing the code.
- [README.md](README.md) — the full reference: data model, HTTP API, frontend
  architecture, and design system.

## Set up and run

```bash
git clone <your-fork-url>
cd lesson-library
pip install -r requirements.txt          # Flask is the only dependency

# Run the server against a throwaway data dir (never your real library):
LESSONLIB_DATA_DIR=/tmp/matlib python server.py   # http://127.0.0.1:8077
```

On Windows (PowerShell): `$env:LESSONLIB_DATA_DIR='C:\tmp\matlib'; py server.py`

## Before you open a PR

1. **Run the tests** — they must stay green:

   ```bash
   python tests/test_server.py        # or:  py tests\test_server.py
   ```

   Add a round-trip test for any new field or route.

2. **Honor the invariants** (CLAUDE.md §Invariants). The big ones:
   - Flask stays the only Python dependency; no external resources (no CDNs,
     fonts, or icon packs). Network access is restricted to the explicitly
     configured backup destination described in `CLAUDE.md`.
   - Never rename the data folders or `/api/lessons` routes — existing phones
     depend on them.
   - Every JSON write goes through `write_sidecar_json`; delete means move to
     `Trash/`, never erase.
   - Filenames must be Windows-safe with case-insensitive collision checks.

3. **UI changes:** verify both light and dark themes at phone size (412×920),
   keep 44px touch targets, and `esc()` every user string before `innerHTML`.

4. Keep PRs focused; fill in the pull request checklist.

The Android APK build (`android/build-apk.ps1`) needs the Windows-only offline
build kit and is not required for most contributions — server/frontend changes
are testable with Python + a browser alone.
