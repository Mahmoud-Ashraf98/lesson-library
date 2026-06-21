#!/usr/bin/env python3
"""Personal Material Library — offline, folder-backed, runs in Termux on the phone.

The folders ARE the database: every material is one directory under
LessonLibrary/lessons/ holding the kit files plus a human-readable
lesson.json sidecar. The in-memory index is disposable — rebuilt from disk
at startup and on Rescan. The folder name is the material id and always
wins over the id recorded in lesson.json (healed on the next metadata write).

LEGACY CONTRACTS — do not rename without a data migration:
the LessonLibrary/ data folder, the lessons/ subfolder, the lesson.json
sidecar filename, and the /api/lessons routes all predate the "material"
terminology and existing phones depend on them.

Schema v2: age groups, CEFR levels, exam targets, grammar points,
vocabulary focuses, topics, themes, and formats are independent multi-value
fields; Pronunciation is a skill; every file can carry a short note.
v1 sidecars are normalized in memory on read and rewritten as v2 only when
the user saves that record — never as a bulk rewrite at startup.

The server only scans, writes, and serves files; all search and filtering
happen client-side in static/app.js.
"""

import csv
import io
import json
import logging
import mimetypes
import os
import re
import shutil
import socket
import sys
import threading
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file

try:
    from werkzeug.utils import safe_join
except ImportError:  # older Werkzeug
    from werkzeug.security import safe_join

# ---- configuration ---------------------------------------------------------
# LESSONLIB_DATA_DIR is a test hook only; on the phone the default is used.
DATA_DIR = Path(os.environ.get("LESSONLIB_DATA_DIR")
                or "/storage/emulated/0/LessonLibrary")
HOST = "127.0.0.1"
PORT = 8077
MAX_UPLOAD_BYTES = 512 * 1024 * 1024

LESSONS_DIR = DATA_DIR / "lessons"
TRASH_DIR = DATA_DIR / "Trash"
# Plans and Inbox are schema-v3 additions; both live beside lessons/ so they
# stay visible to Samsung Files and folder backups, like everything else.
PLANS_DIR = DATA_DIR / "plans"
INBOX_DIR = DATA_DIR / "Inbox"

SCHEMA_VERSION = 2
AGE_GROUPS = ["Young Learners", "Teens", "Adults"]
CEFR_LEVELS = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]
SKILLS = ["Speaking", "Listening", "Reading", "Writing", "Pronunciation",
          "Grammar", "Vocabulary", "Integrated"]
FORMATS = ["Slides", "Worksheet", "Flashcards", "Cut-up cards", "HTML game"]

# Multi-value fields whose option catalogs live in static/taxonomy.json.
TAXONOMY_FIELDS = ("grammar_points", "vocab_focuses", "topics", "themes",
                   "exam_targets")
TAXONOMY_PATH = Path(__file__).resolve().parent / "static" / "taxonomy.json"

WINDOWS_RESERVED = {"con", "prn", "aux", "nul",
                    *(f"com{i}" for i in range(1, 10)),
                    *(f"lpt{i}" for i in range(1, 10))}
FORBIDDEN_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*]')

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

# id -> material record / id -> needs-attention entry / id -> plan record.
# Guarded by LOCK because the server runs threaded; contention is trivial
# (one user).
STATE = {"lessons": {}, "needs": {}, "plans": {}}
LOCK = threading.Lock()


def log(msg):
    print(msg, flush=True)


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ---- field normalization ----------------------------------------------------
def clean_line(value):
    """Trim and collapse internal whitespace (single-line fields)."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def canon(value, options):
    """Snap a value onto its canonical casing; keep unknown values as-is so
    hand-edited json and custom entries survive a scan."""
    v = clean_line(value)
    for opt in options:
        if v.lower() == opt.lower():
            return opt
    return v


def parse_duration(value):
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def as_list(value):
    """Scalar-to-list tolerance for hand-edited json: a string counts as a
    one-item list, anything that is not a string or list of strings is []."""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, str)]


_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_usage(value):
    """Teaching log entries: [{date: YYYY-MM-DD, group, note}]. Entries with
    a malformed date are dropped; everything else is kept as written."""
    out = []
    if not isinstance(value, list):
        return out
    for entry in value:
        if not isinstance(entry, dict):
            continue
        date = clean_line(entry.get("date"))[:10]
        if not _ISO_DAY.match(date):
            continue
        out.append({"date": date,
                    "group": clean_line(entry.get("group")),
                    "note": clean_line(entry.get("note"))})
    return out


# ---- taxonomy catalog --------------------------------------------------------
def load_taxonomy():
    raw = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("taxonomy.json must be a JSON object")
    out = {}
    for field in TAXONOMY_FIELDS:
        groups = raw.get(field)
        if not isinstance(groups, list) or not groups:
            raise ValueError(f"taxonomy.json: {field!r} must be a "
                             "non-empty list of groups")
        cleaned = []
        for g in groups:
            name = clean_line(g.get("group")) if isinstance(g, dict) else ""
            opts = g.get("options") if isinstance(g, dict) else None
            if not name or not isinstance(opts, list) or not opts \
                    or not all(isinstance(o, str) and o.strip() for o in opts):
                raise ValueError(f"taxonomy.json: bad group in {field!r}")
            cleaned.append({"group": name,
                            "options": [clean_line(o) for o in opts]})
        out[field] = cleaned
    return out


try:
    TAXONOMY = load_taxonomy()
except Exception as exc:  # keep the library usable even if the catalog breaks
    print(f"WARNING: could not load {TAXONOMY_PATH} ({exc}); "
          "dropdown catalogs will be empty", flush=True)
    TAXONOMY = {field: [] for field in TAXONOMY_FIELDS}


def taxonomy_options(field):
    return [o for g in TAXONOMY.get(field, []) for o in g["options"]]


# ---- v1 level migration --------------------------------------------------------
# v1 had one "level" field mixing CEFR bands with exam names. Schema v2 keeps
# them independent; these are the known legacy spellings.
_CE = "Cambridge English: "
LEGACY_LEVEL_MAP = {
    "pre-a1 starters": (["Pre-A1"], [_CE + "Pre A1 Starters"]),
    "starters":        (["Pre-A1"], [_CE + "Pre A1 Starters"]),
    "a1 movers":       (["A1"],     [_CE + "A1 Movers"]),
    "movers":          (["A1"],     [_CE + "A1 Movers"]),
    "a2 flyers":       (["A2"],     [_CE + "A2 Flyers"]),
    "flyers":          (["A2"],     [_CE + "A2 Flyers"]),
    "a2 ket":          (["A2"],     [_CE + "A2 Key"]),
    "ket":             (["A2"],     [_CE + "A2 Key"]),
    "b1 pet":          (["B1"],     [_CE + "B1 Preliminary"]),
    "pet":             (["B1"],     [_CE + "B1 Preliminary"]),
    "b2 fce":          (["B2"],     [_CE + "B2 First"]),
    "fce":             (["B2"],     [_CE + "B2 First"]),
    "c1 cae":          (["C1"],     [_CE + "C1 Advanced"]),
    "cae":             (["C1"],     [_CE + "C1 Advanced"]),
    "c2 cpe":          (["C2"],     [_CE + "C2 Proficiency"]),
    "cpe":             (["C2"],     [_CE + "C2 Proficiency"]),
    "ielts":           ([],         ["IELTS"]),
}
_EXAMISH = re.compile(r"ielts|toefl|toeic|pte|duolingo|cambridge|trinity"
                      r"|starters|movers|flyers|ket|pet|fce|cae|cpe|exam",
                      re.IGNORECASE)


def split_legacy_level(value):
    """One v1 level -> (cefr_levels, exam_targets). Unknown values are
    preserved on the side they most resemble, never discarded."""
    v = clean_line(value)
    if not v:
        return [], []
    hit = LEGACY_LEVEL_MAP.get(v.lower())
    if hit:
        return list(hit[0]), list(hit[1])
    c = canon(v, CEFR_LEVELS)
    if c in CEFR_LEVELS:
        return [c], []
    if _EXAMISH.search(v):
        return [], [v]
    return [v], []


# ---- record normalization ------------------------------------------------------
def normalize_record(material_id, raw, files):
    """API-shaped v2 record from arbitrary json/form data (v1, v2, or
    hand-edited). The folder name (material_id) always wins over raw['id'].
    `files` is the real directory listing — stored file notes are matched to
    it by exact file name; stale note entries are dropped silently."""
    raw = raw if isinstance(raw, dict) else {}

    def values_for(plural, singular=None):
        if plural in raw:
            return as_list(raw.get(plural))
        if singular is not None and singular in raw:
            return as_list(raw.get(singular))
        return []

    def multi(vals, options):
        out = []
        for v in vals:
            c = canon(v, options)
            if c and all(c.lower() != x.lower() for x in out):
                out.append(c)
        return out

    if "cefr_levels" in raw or "exam_targets" in raw:
        cefr = as_list(raw.get("cefr_levels"))
        exams = as_list(raw.get("exam_targets"))
    else:
        cefr, exams = split_legacy_level(raw.get("level"))

    notes = {}
    order = []
    raw_files = raw.get("files")
    if isinstance(raw_files, list):
        for entry in raw_files:
            if isinstance(entry, dict) and entry.get("name"):
                notes[str(entry["name"])] = clean_line(entry.get("note"))
                order.append(str(entry["name"]))

    # the directory listing is the truth for which files exist; the sidecar's
    # order is honoured, and notes ride along by exact name
    ordered = order_files(files, order)

    return {
        "schema_version": SCHEMA_VERSION,
        "id": material_id,
        "title": clean_line(raw.get("title")),
        "files": [{"name": f["name"], "size": f["size"],
                   "note": notes.get(f["name"], "")} for f in ordered],
        "age_groups": multi(values_for("age_groups", "age_group"),
                            AGE_GROUPS),
        "cefr_levels": multi(cefr, CEFR_LEVELS),
        "exam_targets": multi(exams, taxonomy_options("exam_targets")),
        "skills": multi(values_for("skills"), SKILLS),
        "grammar_points": multi(values_for("grammar_points", "grammar_point"),
                                taxonomy_options("grammar_points")),
        "vocab_focuses": multi(values_for("vocab_focuses", "vocab_focus"),
                               taxonomy_options("vocab_focuses")),
        "topics": multi(values_for("topics", "topic"),
                        taxonomy_options("topics")),
        "themes": multi(values_for("themes", "theme"),
                        taxonomy_options("themes")),
        "formats": multi(values_for("formats", "format"), FORMATS),
        "duration_min": parse_duration(raw.get("duration_min")),
        "notes": str(raw.get("notes") or "").strip(),
        "date_added": clean_line(raw.get("date_added")),
        "usage": normalize_usage(raw.get("usage")),
    }


# ---- plan normalization --------------------------------------------------------
PLAN_SCHEMA_VERSION = 1


def normalize_plan(plan_id, raw):
    """API-shaped plan from plan.json (or anything resembling one). Items
    reference materials by folder id; a dangling reference is kept — the
    client flags it instead of silently dropping the teacher's planning.
    Items may instead be stage placeholders ({"placeholder": "Warmer", …})
    with an optional duration so plan totals stay honest."""
    raw = raw if isinstance(raw, dict) else {}
    items = []
    for entry in raw.get("items") if isinstance(raw.get("items"), list) else []:
        if isinstance(entry, str) and clean_line(entry):
            items.append({"material_id": clean_line(entry),
                          "done": False, "note": ""})
        elif isinstance(entry, dict) and clean_line(entry.get("material_id")):
            items.append({"material_id": clean_line(entry.get("material_id")),
                          "done": bool(entry.get("done")),
                          "note": clean_line(entry.get("note"))})
        elif isinstance(entry, dict) and clean_line(entry.get("placeholder")):
            items.append({"placeholder": clean_line(entry.get("placeholder")),
                          "duration_min": parse_duration(
                              entry.get("duration_min")),
                          "done": bool(entry.get("done")),
                          "note": clean_line(entry.get("note"))})
    return {
        "schema_version": PLAN_SCHEMA_VERSION,
        "id": plan_id,
        "title": clean_line(raw.get("title")) or plan_id.replace("-", " "),
        "group": clean_line(raw.get("group")),
        "plan_date": clean_line(raw.get("plan_date")),
        "notes": str(raw.get("notes") or "").strip(),
        "items": items,
        "date_added": clean_line(raw.get("date_added")),
    }


def plan_from_form(plan_id, form):
    raw = {k: form.get(k, "") for k in ("title", "group", "plan_date",
                                        "notes", "date_added")}
    try:
        raw["items"] = json.loads(form.get("items") or "[]")
    except ValueError:
        raw["items"] = []
    return normalize_plan(plan_id, raw)


def record_from_form(material_id, form, files, file_notes=None):
    raw = {k: form.get(k, "") for k in ("title", "duration_min", "notes")}
    for field in ("age_groups", "cefr_levels", "exam_targets", "skills",
                  "grammar_points", "vocab_focuses", "topics", "themes",
                  "formats"):
        raw[field] = form.getlist(field)
    if file_notes:
        raw["files"] = [{"name": n, "note": note}
                        for n, note in file_notes.items()]
    return normalize_record(material_id, raw, files)


def disk_record(rec):
    """lesson.json shape: same fields, files as {name, note} — size is
    omitted because the directory remains the source of truth."""
    d = dict(rec)
    d["files"] = [{"name": f["name"], "note": f["note"]} for f in rec["files"]]
    return d


def stored_file_notes(folder):
    """{file name: note} from the folder's current lesson.json, tolerating
    v1 (plain name strings, no notes) and broken json (no notes at all)."""
    try:
        # utf-8-sig: tolerate a BOM from hand-editing on Windows
        raw = json.loads((folder / "lesson.json")
                         .read_text(encoding="utf-8-sig"))
    except Exception:
        return {}
    notes = {}
    if isinstance(raw, dict) and isinstance(raw.get("files"), list):
        for entry in raw["files"]:
            if isinstance(entry, dict) and entry.get("name"):
                notes[str(entry["name"])] = clean_line(entry.get("note"))
    return notes


def parse_notes_list(value):
    """file_notes form field: JSON array of notes, paired with the uploads
    of the same request by position."""
    try:
        data = json.loads(value) if value else []
    except ValueError:
        data = []
    if not isinstance(data, list):
        return []
    return [clean_line(x) if isinstance(x, str) else "" for x in data]


def parse_notes_map(value):
    """existing_notes form field: JSON object of {file name: note}."""
    try:
        data = json.loads(value) if value else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        return {}
    return {str(k): clean_line(v) for k, v in data.items()
            if isinstance(v, str)}


# ---- naming ------------------------------------------------------------------
def slugify(title, default="material"):
    s = unicodedata.normalize("NFKD", title)
    s = s.encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = s[:60].rstrip("-")
    if not s:
        return default
    if s in WINDOWS_RESERVED:
        return default + "-" + s
    return s


def unique_slug(base, parent=None):
    parent = LESSONS_DIR if parent is None else parent
    existing = {p.name.lower() for p in parent.iterdir() if p.is_dir()}
    if base.lower() not in existing:
        return base
    n = 2
    while True:
        suffix = f"-{n}"
        cand = base[:max(1, 60 - len(suffix))].rstrip("-") + suffix
        if cand.lower() not in existing:
            return cand
        n += 1


def sanitize_filename(name):
    """Windows-safe but human-readable: keep Unicode, drop forbidden chars."""
    name = re.split(r"[/\\]", name)[-1]
    name = "".join(ch for ch in name if ord(ch) >= 32 and ch != "\x7f")
    name = FORBIDDEN_FILENAME_CHARS.sub("", name)
    name = name.strip().lstrip(".").rstrip(". ")
    stem, ext = os.path.splitext(name)
    if stem.lower() in WINDOWS_RESERVED:
        stem = "file-" + stem
    if len(stem) > 120:
        stem = stem[:120].rstrip(". ")
    name = (stem + ext).strip()
    if name.lower().endswith(".tmp"):  # .tmp files are invisible to the scanner
        name += "_"
    return name or "file"


def dedupe_filename(name, existing_lower):
    if name.lower() not in existing_lower:
        return name
    stem, ext = os.path.splitext(name)
    n = 2
    while True:
        cand = f"{stem} ({n}){ext}"
        if cand.lower() not in existing_lower:
            return cand
        n += 1


# ---- disk I/O ----------------------------------------------------------------
def fsync_dir(folder):
    """Best effort — sdcardfs/FUSE may refuse directory fsync."""
    try:
        fd = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def write_sidecar_json(folder, filename, data):
    """tmp + fsync + atomic rename, every time. Human-readable on purpose."""
    tmp = folder / (filename + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2))
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, folder / filename)
    fsync_dir(folder)


def write_lesson_json(folder, data):
    write_sidecar_json(folder, "lesson.json", data)


def write_plan_json(folder, data):
    write_sidecar_json(folder, "plan.json", data)


def list_kit_files(folder):
    """Kit files = everything except lesson.json, dotfiles, *.tmp, subdirs."""
    out = []
    for entry in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        name = entry.name
        low = name.lower()
        if low == "lesson.json" or name.startswith(".") or low.endswith(".tmp"):
            continue
        if not entry.is_file():
            continue
        try:
            size = entry.stat().st_size
        except OSError:
            size = 0
        out.append({"name": name, "size": size})
    return out


def order_files(files, ordered_names):
    """Sort a disk listing to a stored name order; names not in the order keep
    their (alphabetical) position at the end. list_kit_files already returns
    files alphabetically, so this is a stable reordering of it."""
    idx = {n: i for i, n in enumerate(ordered_names)}
    return sorted(files, key=lambda f: idx.get(f["name"], len(idx)))


def save_uploads(folder, uploads):
    """Returns [{original_name, name}] in upload order — sanitizing and
    deduplication can change a name, and the caller needs the final one to
    attach the matching file note."""
    saved = []
    existing = {p.name.lower() for p in folder.iterdir()}
    existing.add("lesson.json")
    for f in uploads:
        if not f or not f.filename:
            continue
        name = dedupe_filename(sanitize_filename(f.filename), existing)
        tmp = folder / (name + ".part.tmp")
        with open(tmp, "wb") as out:
            shutil.copyfileobj(f.stream, out, 256 * 1024)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, folder / name)
        existing.add(name.lower())
        saved.append({"original_name": f.filename, "name": name})
    if saved:
        fsync_dir(folder)
    return saved


def receive_uploads(folder):
    """Save this request's uploads and pair file_notes with them by form
    order, keyed by the final saved name."""
    uploads = [f for f in request.files.getlist("files") if f and f.filename]
    notes_list = parse_notes_list(request.form.get("file_notes"))
    saved = save_uploads(folder, uploads)
    new_notes = {s["name"]: (notes_list[i] if i < len(notes_list) else "")
                 for i, s in enumerate(saved)}
    return saved, new_notes


# ---- inbox -------------------------------------------------------------------
# LessonLibrary/Inbox is a staging area: the Android share sheet (and the
# user, via any file manager) drops files there; the Add/Edit form attaches
# them to a material, which MOVES them into the material folder.
# After staging a share, the APK also writes Inbox/.last-share.json
# ({"names": [...]}) so the UI can preselect exactly that batch — and never
# silently bundle older inbox files into a new material.
INBOX_BATCH_FILE = ".last-share.json"


def list_inbox_files():
    if not INBOX_DIR.is_dir():
        return []
    out = []
    for entry in sorted(INBOX_DIR.iterdir(), key=lambda p: p.name.lower()):
        name = entry.name
        if name.startswith(".") or name.lower().endswith(".tmp"):
            continue
        if not entry.is_file():
            continue
        try:
            size = entry.stat().st_size
        except OSError:
            size = 0
        out.append({"name": name, "size": size})
    return out


def list_inbox_batch():
    """Names from the most recent share batch that are still in the Inbox.
    Stale names (already attached, trashed, or renamed) are filtered out, so
    the marker self-heals as the inbox empties."""
    try:
        raw = json.loads((INBOX_DIR / INBOX_BATCH_FILE)
                         .read_text(encoding="utf-8-sig"))
    except Exception:
        return []
    names = raw.get("names") if isinstance(raw, dict) else None
    if not isinstance(names, list):
        return []
    existing = {f["name"] for f in list_inbox_files()}
    return [n for n in names if isinstance(n, str) and n in existing]


def clear_inbox_batch():
    try:
        (INBOX_DIR / INBOX_BATCH_FILE).unlink()
    except OSError:
        pass


def resolve_inbox_file(name):
    """Direct child file of Inbox/ or nothing."""
    joined = safe_join(str(INBOX_DIR), name)
    if not joined:
        return None
    real = os.path.realpath(joined)
    root = os.path.realpath(str(INBOX_DIR))
    if os.path.normcase(os.path.dirname(real)) != os.path.normcase(root):
        return None
    if not os.path.isfile(real):
        return None
    return Path(real)


def take_inbox_files(folder):
    """Move the inbox files named in this request's inbox_files field into
    the material folder. Returns {final name: note} for the moved files.
    Unknown names are skipped silently — the inbox may have changed since
    the form was rendered, and losing a save over that would be worse."""
    try:
        names = json.loads(request.form.get("inbox_files") or "[]")
    except ValueError:
        names = []
    if not isinstance(names, list):
        names = []
    notes = parse_notes_map(request.form.get("inbox_notes"))
    taken = {}
    existing = {p.name.lower() for p in folder.iterdir()}
    existing.add("lesson.json")
    for name in names:
        if not isinstance(name, str):
            continue
        src = resolve_inbox_file(name)
        if src is None:
            continue
        dest = dedupe_filename(sanitize_filename(src.name), existing)
        os.replace(src, folder / dest)
        existing.add(dest.lower())
        taken[dest] = notes.get(name, "")
    if taken:
        fsync_dir(folder)
        fsync_dir(INBOX_DIR)
    return taken


# ---- scanning ------------------------------------------------------------------
def scan_library():
    lessons, needs = {}, {}
    for entry in sorted(LESSONS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_dir():
            continue
        lid = entry.name
        files = list_kit_files(entry)
        raw, problem = None, None
        json_path = entry / "lesson.json"
        if not json_path.is_file():
            problem = "missing lesson.json"
        else:
            try:
                # utf-8-sig: tolerate a BOM from hand-editing on Windows
                raw = json.loads(json_path.read_text(encoding="utf-8-sig"))
                if not isinstance(raw, dict):
                    problem = "lesson.json is not a JSON object"
                elif not clean_line(raw.get("title")):
                    problem = "lesson.json has no title"
            except Exception as e:
                problem = f"unreadable lesson.json ({e.__class__.__name__})"
        if problem:
            needs[lid] = {"id": lid, "problem": problem, "files": files,
                          "draft": normalize_record(lid, raw, files)}
        else:
            lessons[lid] = normalize_record(lid, raw, files)
    return lessons, needs


def scan_plans():
    plans = {}
    if not PLANS_DIR.is_dir():
        return plans
    for entry in sorted(PLANS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_dir():
            continue
        pid = entry.name
        raw, unreadable = None, False
        json_path = entry / "plan.json"
        if json_path.is_file():
            try:
                raw = json.loads(json_path.read_text(encoding="utf-8-sig"))
            except Exception:
                unreadable = True
        plan = normalize_plan(pid, raw)
        if unreadable:
            # Saving from the UI rewrites a clean plan.json.
            plan["unreadable"] = True
        plans[pid] = plan
    return plans


def rebuild_index():
    lessons, needs = scan_library()
    plans = scan_plans()
    with LOCK:
        STATE["lessons"] = lessons
        STATE["needs"] = needs
        STATE["plans"] = plans
    log(f"scan: {len(lessons)} material(s), {len(needs)} need(s) attention, "
        f"{len(plans)} plan(s)")


def library_customs(records, field, catalog):
    """Distinct values used in the library but missing from the catalog,
    deduped case-insensitively keeping the most frequent casing. These feed
    the 'Your library' group at the top of each combobox."""
    catalog_lower = {o.lower() for o in catalog}
    casings = {}
    for rec in records:
        for v in rec.get(field) or []:
            if v.lower() in catalog_lower:
                continue
            casings.setdefault(v.lower(), Counter())[v] += 1
    return sorted((c.most_common(1)[0][0] for c in casings.values()),
                  key=str.lower)


def index_payload():
    with LOCK:
        lessons = list(STATE["lessons"].values())
        needs = list(STATE["needs"].values())
        plans = list(STATE["plans"].values())
    lessons.sort(key=lambda r: (r.get("date_added") or "", r["id"]),
                 reverse=True)
    plans.sort(key=lambda r: (r.get("plan_date") or "9999",
                              r.get("date_added") or "", r["id"]))
    taxonomy = {}
    for field in TAXONOMY_FIELDS:
        catalog_groups = TAXONOMY.get(field, [])
        customs = library_customs(lessons, field,
                                  [o for g in catalog_groups
                                   for o in g["options"]])
        groups = ([{"group": "Your library", "options": customs}]
                  if customs else [])
        taxonomy[field] = groups + catalog_groups
    return {
        # "lessons" is a legacy payload key; the records are materials
        "lessons": lessons,
        "needs_attention": needs,
        "plans": plans,
        "inbox": list_inbox_files(),
        "inbox_batch": list_inbox_batch(),
        "options": {"age_groups": AGE_GROUPS, "cefr_levels": CEFR_LEVELS,
                    "skills": SKILLS, "formats": FORMATS},
        "taxonomy": taxonomy,
    }


# ---- path safety ----------------------------------------------------------------
def _resolve_child_dir(parent, name):
    """Direct child directory of parent or nothing."""
    joined = safe_join(str(parent), name)
    if not joined:
        return None
    real = os.path.realpath(joined)
    root = os.path.realpath(str(parent))
    if os.path.normcase(os.path.dirname(real)) != os.path.normcase(root):
        return None
    if not os.path.isdir(real):
        return None
    return Path(real)


def resolve_lesson_dir(lid):
    return _resolve_child_dir(LESSONS_DIR, lid)


def resolve_plan_dir(pid):
    return _resolve_child_dir(PLANS_DIR, pid)


# ---- routes ----------------------------------------------------------------------
# /api/lessons is a legacy route name kept for compatibility; it serves
# material records.
@app.get("/")
def home():
    return app.send_static_file("index.html")


@app.get("/api/lessons")
def api_index():
    return jsonify(index_payload())


@app.post("/api/rescan")
def api_rescan():
    rebuild_index()
    return jsonify(index_payload())


@app.post("/api/lessons")
def api_create():
    title = clean_line(request.form.get("title"))
    if not title:
        return jsonify(error="Title is required."), 400
    slug = unique_slug(slugify(title))
    folder = LESSONS_DIR / slug
    folder.mkdir(parents=True)
    # Crash-safe ordering: folder, then files, then lesson.json as the
    # commit marker — a half-finished add surfaces as "needs attention".
    _, new_notes = receive_uploads(folder)
    new_notes.update(take_inbox_files(folder))
    rec = record_from_form(slug, request.form, list_kit_files(folder),
                           new_notes)
    rec["date_added"] = now_iso()
    write_lesson_json(folder, disk_record(rec))
    with LOCK:
        STATE["lessons"][slug] = rec
    log(f"created {slug!r} ({len(rec['files'])} file(s))")
    return jsonify(lesson=rec), 201


@app.post("/api/lessons/<lid>")
def api_update(lid):
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    title = clean_line(request.form.get("title"))
    if not title:
        return jsonify(error="Title is required."), 400
    # Note precedence: stored notes survive unless the request's
    # existing_notes map explicitly overrides a file.
    file_notes = stored_file_notes(folder)
    file_notes.update(parse_notes_map(request.form.get("existing_notes")))
    file_notes.update(take_inbox_files(folder))
    rec = record_from_form(folder.name, request.form,
                           list_kit_files(folder), file_notes)
    with LOCK:
        prev = STATE["lessons"].get(folder.name)
        broken = STATE["needs"].get(folder.name)
    rec["date_added"] = ((prev or {}).get("date_added")
                         or (broken or {}).get("draft", {}).get("date_added")
                         or now_iso())
    # The teaching log is not part of the edit form; carry it over.
    rec["usage"] = ((prev or {}).get("usage")
                    or (broken or {}).get("draft", {}).get("usage")
                    or [])
    write_lesson_json(folder, disk_record(rec))  # also heals a stale id
    with LOCK:
        STATE["needs"].pop(folder.name, None)
        STATE["lessons"][folder.name] = rec
    log(f"updated {folder.name!r}")
    return jsonify(lesson=rec)


@app.post("/api/lessons/<lid>/files")
def api_add_files(lid):
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    saved, new_notes = receive_uploads(folder)
    files = list_kit_files(folder)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    if rec is not None:
        merged = {f["name"]: f.get("note", "") for f in rec["files"]}
        merged.update(new_notes)
        files = order_files(files, [f["name"] for f in rec["files"]])
        files = [dict(f, note=merged.get(f["name"], "")) for f in files]
        rec = dict(rec, id=folder.name, files=files)
        write_lesson_json(folder, disk_record(rec))
        with LOCK:
            STATE["lessons"][folder.name] = rec
    else:
        # Malformed sidecar: keep the files, never touch lesson.json.
        with LOCK:
            if folder.name in STATE["needs"]:
                STATE["needs"][folder.name]["files"] = files
    log(f"added {len(saved)} file(s) to {folder.name!r}")
    return jsonify(saved=saved, lesson=rec)


@app.post("/api/lessons/<lid>/inbox")
def api_attach_inbox(lid):
    """Attach inbox files (inbox_files/inbox_notes form fields) to an
    existing material WITHOUT touching its metadata — the Inbox screen's
    'add to existing' action. Mirrors api_add_files."""
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    taken = take_inbox_files(folder)
    files = list_kit_files(folder)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    if rec is not None:
        merged = {f["name"]: f.get("note", "") for f in rec["files"]}
        merged.update(taken)
        files = order_files(files, [f["name"] for f in rec["files"]])
        files = [dict(f, note=merged.get(f["name"], "")) for f in files]
        rec = dict(rec, id=folder.name, files=files)
        write_lesson_json(folder, disk_record(rec))
        with LOCK:
            STATE["lessons"][folder.name] = rec
    else:
        # Malformed sidecar: keep the files, never touch lesson.json.
        with LOCK:
            if folder.name in STATE["needs"]:
                STATE["needs"][folder.name]["files"] = files
    log(f"attached {len(taken)} inbox file(s) to {folder.name!r}")
    return jsonify(attached=sorted(taken), lesson=rec)


@app.post("/api/lessons/<lid>/files/to-inbox")
def api_files_to_inbox(lid):
    """Move named kit files back into the Inbox — the undo half of an
    import. Names must match the folder's real files (that membership check
    is also the traversal gate). With trash_if_empty=1, a material left
    with no files moves to Trash — it was just created from those files."""
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    try:
        names = json.loads(request.form.get("names") or "[]")
    except ValueError:
        names = []
    if not isinstance(names, list):
        names = []
    INBOX_DIR.mkdir(exist_ok=True)
    existing = {p.name.lower() for p in INBOX_DIR.iterdir()}
    valid = {f["name"] for f in list_kit_files(folder)}
    moved, inbox_dests = [], []
    for name in names:
        if not isinstance(name, str) or name not in valid:
            continue
        dest = dedupe_filename(name, existing)
        os.replace(folder / name, INBOX_DIR / dest)
        existing.add(dest.lower())
        moved.append(name)
        inbox_dests.append(dest)  # final Inbox names — lets the client Undo
    if moved:
        fsync_dir(folder)
        fsync_dir(INBOX_DIR)
    files = list_kit_files(folder)
    if not files and request.form.get("trash_if_empty"):
        dest_name = folder.name
        trash_names = {p.name.lower() for p in TRASH_DIR.iterdir()}
        if dest_name.lower() in trash_names:
            dest_name += "-" + datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.move(str(folder), str(TRASH_DIR / dest_name))
        with LOCK:
            STATE["lessons"].pop(folder.name, None)
            STATE["needs"].pop(folder.name, None)
        log(f"returned {len(moved)} file(s) to Inbox; "
            f"trashed empty {folder.name!r}")
        return jsonify(moved=moved, inbox_names=inbox_dests, lesson=None)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    if rec is not None:
        notes = {f["name"]: f.get("note", "") for f in rec["files"]}
        files = order_files(files, [f["name"] for f in rec["files"]])
        files = [dict(f, note=notes.get(f["name"], "")) for f in files]
        rec = dict(rec, id=folder.name, files=files)
        write_lesson_json(folder, disk_record(rec))
        with LOCK:
            STATE["lessons"][folder.name] = rec
    else:
        with LOCK:
            if folder.name in STATE["needs"]:
                STATE["needs"][folder.name]["files"] = files
    log(f"returned {len(moved)} file(s) from {folder.name!r} to Inbox")
    return jsonify(moved=moved, inbox_names=inbox_dests, lesson=rec)


@app.post("/api/lessons/<lid>/files/edit")
def api_edit_file(lid):
    """Rename a kit file and/or set its note in one go — the in-app file
    editor. The old name must match a real file (that membership check is
    also the traversal gate). Names are sanitized; a collision with a
    different file is reported rather than silently deduped, because a rename
    is deliberate. The stored file order and the note travel to the new name."""
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    old = request.form.get("old") or ""
    valid = {f["name"] for f in list_kit_files(folder)}  # traversal gate
    if old not in valid:
        return jsonify(error="That file is no longer here — try Rescan."), 404
    requested = clean_line(request.form.get("name"))
    if not requested:
        return jsonify(error="Please enter a file name."), 400
    new = sanitize_filename(requested)
    # a missing note field means "keep the current note"; an empty one clears it
    set_note = "note" in request.form
    note = clean_line(request.form.get("note"))
    renamed = new != old
    if renamed:
        if new.lower() in {n.lower() for n in valid if n != old}:
            return jsonify(error=f"A file named “{new}” is already here. "
                                 "Pick another name."), 400
        if new.lower() == old.lower():
            # case-only change: hop via a tmp name so a case-insensitive
            # filesystem doesn't treat src and dest as the same file
            tmp = folder / (old + ".renametmp")
            os.replace(folder / old, tmp)
            os.replace(tmp, folder / new)
        else:
            os.replace(folder / old, folder / new)
        fsync_dir(folder)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    files = list_kit_files(folder)
    if rec is not None:
        notes = {f["name"]: f.get("note", "") for f in rec["files"]}
        order = [new if n == old else n for n in (f["name"] for f in rec["files"])]
        kept = notes.get(old, "")
        notes.pop(old, None)
        notes[new] = note if set_note else kept
        files = order_files(files, order)
        files = [dict(f, note=notes.get(f["name"], "")) for f in files]
        rec = dict(rec, id=folder.name, files=files)
        write_lesson_json(folder, disk_record(rec))
        with LOCK:
            STATE["lessons"][folder.name] = rec
    else:
        with LOCK:
            if folder.name in STATE["needs"]:
                STATE["needs"][folder.name]["files"] = files
    log(f"edited file {old!r} -> {new!r} in {folder.name!r}")
    return jsonify(lesson=rec, old=old, new=new)


@app.post("/api/lessons/<lid>/files/reorder")
def api_reorder_files(lid):
    """Persist a new file order (order = JSON array of names). Unknown names
    are ignored and any real files the client didn't mention keep their
    alphabetical place at the end — so a stale order can never drop a file."""
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    try:
        order = json.loads(request.form.get("order") or "[]")
    except ValueError:
        order = []
    if not isinstance(order, list):
        order = []
    disk = list_kit_files(folder)
    valid = {f["name"] for f in disk}
    seen, new_order = set(), []
    for name in order:
        if isinstance(name, str) and name in valid and name not in seen:
            new_order.append(name)
            seen.add(name)
    for f in disk:  # any unmentioned file keeps its alphabetical tail position
        if f["name"] not in seen:
            new_order.append(f["name"])
    files = order_files(disk, new_order)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    if rec is not None:
        notes = {f["name"]: f.get("note", "") for f in rec["files"]}
        files = [dict(f, note=notes.get(f["name"], "")) for f in files]
        rec = dict(rec, id=folder.name, files=files)
        write_lesson_json(folder, disk_record(rec))
        with LOCK:
            STATE["lessons"][folder.name] = rec
    else:
        with LOCK:
            if folder.name in STATE["needs"]:
                STATE["needs"][folder.name]["files"] = files
    log(f"reordered {len(files)} file(s) in {folder.name!r}")
    return jsonify(lesson=rec)


@app.post("/api/lessons/<lid>/trash")
def api_trash(lid):
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    dest_name = folder.name
    existing = {p.name.lower() for p in TRASH_DIR.iterdir()}
    if dest_name.lower() in existing:
        dest_name += "-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.move(str(folder), str(TRASH_DIR / dest_name))
    with LOCK:
        STATE["lessons"].pop(folder.name, None)
        STATE["needs"].pop(folder.name, None)
    log(f"trashed {folder.name!r} -> Trash/{dest_name}")
    return jsonify(trashed=dest_name)


# ---- teaching log -----------------------------------------------------------
@app.post("/api/lessons/<lid>/usage")
def api_log_usage(lid):
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    if rec is None:
        return jsonify(error="Fix this material's metadata first."), 409
    date = clean_line(request.form.get("date"))[:10]
    if not _ISO_DAY.match(date):
        date = datetime.now().strftime("%Y-%m-%d")
    entry = {"date": date,
             "group": clean_line(request.form.get("group")),
             "note": clean_line(request.form.get("note"))}
    rec = dict(rec, usage=list(rec.get("usage") or []) + [entry])
    write_lesson_json(folder, disk_record(rec))
    with LOCK:
        STATE["lessons"][folder.name] = rec
    log(f"logged use of {folder.name!r} on {date}")
    return jsonify(lesson=rec)


@app.post("/api/lessons/<lid>/usage/delete")
def api_delete_usage(lid):
    folder = resolve_lesson_dir(lid)
    if folder is None:
        abort(404)
    with LOCK:
        rec = STATE["lessons"].get(folder.name)
    if rec is None:
        abort(404)
    try:
        index = int(request.form.get("index", ""))
    except ValueError:
        return jsonify(error="index is required."), 400
    usage = list(rec.get("usage") or [])
    if not 0 <= index < len(usage):
        return jsonify(error="No such log entry."), 400
    usage.pop(index)
    rec = dict(rec, usage=usage)
    write_lesson_json(folder, disk_record(rec))
    with LOCK:
        STATE["lessons"][folder.name] = rec
    return jsonify(lesson=rec)


# ---- plans --------------------------------------------------------------------
@app.post("/api/plans")
def api_plan_create():
    title = clean_line(request.form.get("title"))
    if not title:
        return jsonify(error="Title is required."), 400
    PLANS_DIR.mkdir(parents=True, exist_ok=True)
    slug = unique_slug(slugify(title, default="plan"), PLANS_DIR)
    folder = PLANS_DIR / slug
    folder.mkdir()
    plan = plan_from_form(slug, request.form)
    plan["date_added"] = now_iso()
    write_plan_json(folder, plan)
    with LOCK:
        STATE["plans"][slug] = plan
    log(f"created plan {slug!r}")
    return jsonify(plan=plan), 201


@app.post("/api/plans/<pid>")
def api_plan_update(pid):
    folder = resolve_plan_dir(pid)
    if folder is None:
        abort(404)
    title = clean_line(request.form.get("title"))
    if not title:
        return jsonify(error="Title is required."), 400
    plan = plan_from_form(folder.name, request.form)
    with LOCK:
        prev = STATE["plans"].get(folder.name)
    plan["date_added"] = (prev or {}).get("date_added") or now_iso()
    write_plan_json(folder, plan)
    with LOCK:
        STATE["plans"][folder.name] = plan
    log(f"updated plan {folder.name!r}")
    return jsonify(plan=plan)


@app.post("/api/plans/<pid>/trash")
def api_plan_trash(pid):
    folder = resolve_plan_dir(pid)
    if folder is None:
        abort(404)
    dest_name = "plan-" + folder.name
    existing = {p.name.lower() for p in TRASH_DIR.iterdir()}
    if dest_name.lower() in existing:
        dest_name += "-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.move(str(folder), str(TRASH_DIR / dest_name))
    with LOCK:
        STATE["plans"].pop(folder.name, None)
    log(f"trashed plan {folder.name!r} -> Trash/{dest_name}")
    return jsonify(trashed=dest_name)


# ---- inbox, health, maintenance --------------------------------------------------
@app.get("/api/inbox")
def api_inbox():
    return jsonify(files=list_inbox_files(), batch=list_inbox_batch())


@app.post("/api/inbox/trash")
def api_inbox_trash():
    """Move named inbox files into Trash — same never-erase rule as
    materials. Unknown names are skipped, mirroring take_inbox_files."""
    try:
        names = json.loads(request.form.get("names") or "[]")
    except ValueError:
        names = []
    if not isinstance(names, list):
        names = []
    moved = []
    existing = {p.name.lower() for p in TRASH_DIR.iterdir()}
    for name in names:
        if not isinstance(name, str):
            continue
        src = resolve_inbox_file(name)
        if src is None:
            continue
        dest = dedupe_filename(src.name, existing)
        shutil.move(str(src), str(TRASH_DIR / dest))
        existing.add(dest.lower())
        moved.append(name)
    if moved:
        fsync_dir(INBOX_DIR)
        log(f"trashed {len(moved)} inbox file(s)")
    return jsonify(trashed=moved, files=list_inbox_files(),
                   batch=list_inbox_batch())


@app.post("/api/inbox/batch/clear")
def api_inbox_batch_clear():
    """Forget the last-share marker (the user chose 'keep in Inbox')."""
    clear_inbox_batch()
    return jsonify(ok=True)


@app.get("/inbox-files/<path:name>")
def serve_inbox_file(name):
    """Serve a staged inbox file (thumbnails on the Inbox screen). Same
    inline disposition as /files/ so Android can hand it to a viewer."""
    real = resolve_inbox_file(name)
    if real is None:
        abort(404)
    mime = mimetypes.guess_type(str(real))[0] or "application/octet-stream"
    return send_file(str(real), mimetype=mime, conditional=True,
                     download_name=real.name, as_attachment=False)


def folder_size(path):
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda e: None):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


@app.get("/api/health")
def api_health():
    with LOCK:
        lessons = list(STATE["lessons"].values())
        needs = list(STATE["needs"].values())
        plans = list(STATE["plans"].values())
    total_files = (sum(len(r["files"]) for r in lessons)
                   + sum(len(e["files"]) for e in needs))
    total_bytes = (sum(f["size"] for r in lessons for f in r["files"])
                   + sum(f["size"] for e in needs for f in e["files"]))
    untagged = []
    for r in sorted(lessons, key=lambda r: r["title"].lower()):
        missing = []
        if not r["cefr_levels"] and not r["exam_targets"]:
            missing.append("level")
        if not r["skills"]:
            missing.append("skills")
        if not r["formats"]:
            missing.append("format")
        if not r["topics"]:
            missing.append("topics")
        if missing:
            untagged.append({"id": r["id"], "title": r["title"],
                             "missing": missing})
    trash = []
    if TRASH_DIR.is_dir():
        for entry in sorted(TRASH_DIR.iterdir(), key=lambda p: p.name.lower()):
            if entry.name.startswith("."):
                continue
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                mtime = 0
            trash.append({
                "name": entry.name,
                "size": folder_size(entry),
                "trashed": (datetime.fromtimestamp(mtime).astimezone()
                            .isoformat(timespec="seconds") if mtime else ""),
            })
    inbox = list_inbox_files()
    return jsonify(
        materials=len(lessons),
        needs_attention=len(needs),
        plans=len(plans),
        files=total_files,
        bytes=total_bytes,
        untagged=untagged,
        trash=trash,
        trash_bytes=sum(t["size"] for t in trash),
        inbox=inbox,
        inbox_bytes=sum(f["size"] for f in inbox),
        data_dir=str(DATA_DIR),
    )


@app.post("/api/trash/empty")
def api_trash_empty():
    """Permanent deletion — the one route that erases data, only ever
    triggered from the Health screen behind an explicit confirmation."""
    days = parse_duration(request.form.get("older_than_days"))
    cutoff = (datetime.now().timestamp() - days * 86400) if days else None
    removed = 0
    if TRASH_DIR.is_dir():
        for entry in list(TRASH_DIR.iterdir()):
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                mtime = 0
            if cutoff is not None and mtime > cutoff:
                continue
            try:
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
                removed += 1
            except OSError:
                pass
    log(f"emptied Trash: removed {removed} item(s)")
    return jsonify(removed=removed)


@app.get("/api/export.csv")
def api_export_csv():
    with LOCK:
        lessons = list(STATE["lessons"].values())
    lessons.sort(key=lambda r: r["title"].lower())
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "title", "age_groups", "cefr_levels", "exam_targets",
                "skills", "formats", "grammar_points", "vocab_focuses",
                "topics", "themes", "duration_min", "date_added",
                "times_used", "last_used", "files", "notes"])
    for r in lessons:
        usage = r.get("usage") or []
        w.writerow([
            r["id"], r["title"],
            "; ".join(r["age_groups"]), "; ".join(r["cefr_levels"]),
            "; ".join(r["exam_targets"]), "; ".join(r["skills"]),
            "; ".join(r["formats"]), "; ".join(r["grammar_points"]),
            "; ".join(r["vocab_focuses"]), "; ".join(r["topics"]),
            "; ".join(r["themes"]),
            r["duration_min"] or "", (r["date_added"] or "")[:10],
            len(usage), max((u["date"] for u in usage), default=""),
            "; ".join(f["name"] for f in r["files"]), r["notes"],
        ])
    # BOM so Excel detects UTF-8 when the teacher opens the export directly.
    return Response("\ufeff" + buf.getvalue(),
                    mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition":
                             'attachment; filename="material-library.csv"'})


@app.get("/files/<lid>/<path:filename>")
def serve_kit_file(lid, filename):
    joined = safe_join(str(LESSONS_DIR), lid, filename)
    if not joined:
        abort(404)
    real = os.path.realpath(joined)
    root = os.path.realpath(str(LESSONS_DIR))
    if not os.path.normcase(real).startswith(os.path.normcase(root) + os.sep):
        abort(404)
    if not os.path.isfile(real):
        abort(404)
    mime = mimetypes.guess_type(real)[0] or "application/octet-stream"
    # conditional=True gives Range support; inline disposition lets Android
    # decide whether Chrome renders it or hands it to a system viewer.
    return send_file(real, mimetype=mime, conditional=True,
                     download_name=os.path.basename(real),
                     as_attachment=False)


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="Upload too large (limit 512 MB per request)."), 413


# ---- startup ----------------------------------------------------------------------
def ensure_dirs():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        LESSONS_DIR.mkdir(exist_ok=True)
        TRASH_DIR.mkdir(exist_ok=True)
        PLANS_DIR.mkdir(exist_ok=True)
        INBOX_DIR.mkdir(exist_ok=True)
        probe = DATA_DIR / ".write-probe.tmp"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError:
        print(f"Cannot write to {DATA_DIR} — run `termux-setup-storage`, "
              "allow storage access, then start again.")
        sys.exit(1)


def ensure_port_free():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind((HOST, PORT))
    except OSError:
        print(f"Port {PORT} is already in use — probably a previous instance. "
              f"Reuse the open tab at http://{HOST}:{PORT}/ or run: "
              "pkill -f server.py")
        sys.exit(1)
    finally:
        s.close()


if __name__ == "__main__":
    logging.basicConfig(stream=sys.stdout, level=logging.INFO)
    ensure_dirs()
    ensure_port_free()
    rebuild_index()
    log(f"data: {DATA_DIR}")
    log(f"Material Library running — open http://{HOST}:{PORT}/ in Chrome")
    app.run(host=HOST, port=PORT, threaded=True, debug=False)
