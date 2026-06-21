<!-- Thanks for contributing! Keep changes small and respect the invariants. -->

## What & why

<!-- One or two sentences: what does this change and what problem does it solve? -->

## Checklist

Read [CLAUDE.md](../CLAUDE.md) §Invariants first — breaking one corrupts a real
person's data.

- [ ] `py tests\test_server.py` is green (add a round-trip test for any new field)
- [ ] No new dependency — Flask stays the only Python dep; no new Gradle/Java deps
- [ ] No external resources (no CDNs, fonts, icon packs, or network calls)
- [ ] Every JSON write goes through `write_sidecar_json`; deletes move to `Trash/`
- [ ] Filenames stay Windows-safe with case-insensitive collision checks
- [ ] New server routes use the `resolve_*` helpers and take `LOCK` around `STATE`
- [ ] UI: both light & dark themes, 44px touch targets, `esc()` on every user
      string, verified at phone size (412×920)
- [ ] Data-folder / route names unchanged (`LessonLibrary/`, `lessons/`,
      `lesson.json`, `/api/lessons`, …)
