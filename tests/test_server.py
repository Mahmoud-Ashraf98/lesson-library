"""Schema-v2 regression suite for the Material Library server.

Standard unittest + the Flask test client only — no extra dependencies.
Each test gets a throwaway data dir; the module-level paths in server.py
are repointed in setUp, mirroring how LESSONLIB_DATA_DIR works on the phone.
"""

import io
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LESSONLIB_DATA_DIR",
                      tempfile.mkdtemp(prefix="matlib-import-"))

import server  # noqa: E402


CAMBRIDGE = "Cambridge English: "


class LibraryTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="matlib-test-")
        self.data = Path(self._tmp)
        server.DATA_DIR = self.data
        server.LESSONS_DIR = self.data / "lessons"
        server.TRASH_DIR = self.data / "Trash"
        server.PLANS_DIR = self.data / "plans"
        server.INBOX_DIR = self.data / "Inbox"
        server.LESSONS_DIR.mkdir(parents=True)
        server.TRASH_DIR.mkdir(parents=True)
        server.PLANS_DIR.mkdir(parents=True)
        server.INBOX_DIR.mkdir(parents=True)
        with server.LOCK:
            server.STATE["lessons"] = {}
            server.STATE["needs"] = {}
            server.STATE["plans"] = {}
        self.client = server.app.test_client()

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    # -- helpers ------------------------------------------------------------
    def write_folder(self, lid, meta=None, files=()):
        folder = server.LESSONS_DIR / lid
        folder.mkdir()
        for name, content in files:
            (folder / name).write_bytes(content)
        if meta is not None:
            text = meta if isinstance(meta, str) else json.dumps(meta)
            (folder / "lesson.json").write_text(text, encoding="utf-8")
        return folder

    def create_material(self, **over):
        data = {
            "title": "Jellyfish debate",
            "age_groups": ["Teens", "Adults"],
            "cefr_levels": ["B1", "B2"],
            "skills": ["Speaking", "Pronunciation"],
            "formats": ["Worksheet"],
        }
        data.update(over)
        return self.client.post("/api/lessons", data=data,
                                content_type="multipart/form-data")

    def disk_json(self, lid):
        path = server.LESSONS_DIR / lid / "lesson.json"
        return json.loads(path.read_text(encoding="utf-8"))


class TestLegacyMigration(LibraryTestCase):
    def test_every_legacy_default_level_maps(self):
        cases = {
            "Pre-A1 Starters": (["Pre-A1"], [CAMBRIDGE + "Pre A1 Starters"]),
            "A1 Movers": (["A1"], [CAMBRIDGE + "A1 Movers"]),
            "A2 Flyers": (["A2"], [CAMBRIDGE + "A2 Flyers"]),
            "A2 KET": (["A2"], [CAMBRIDGE + "A2 Key"]),
            "B1 PET": (["B1"], [CAMBRIDGE + "B1 Preliminary"]),
            "B2": (["B2"], []),
            "C1": (["C1"], []),
            "IELTS": ([], ["IELTS"]),
        }
        for legacy, (cefr, exams) in cases.items():
            rec = server.normalize_record(
                "x", {"title": "t", "level": legacy}, [])
            self.assertEqual(rec["cefr_levels"], cefr, msg=legacy)
            self.assertEqual(rec["exam_targets"], exams, msg=legacy)

    def test_unknown_levels_are_preserved_not_discarded(self):
        rec = server.normalize_record("x", {"title": "t", "level": "B2+"}, [])
        self.assertEqual(rec["cefr_levels"], ["B2+"])
        self.assertEqual(rec["exam_targets"], [])
        rec = server.normalize_record(
            "x", {"title": "t", "level": "TOEFL prep"}, [])
        self.assertEqual(rec["cefr_levels"], [])
        self.assertEqual(rec["exam_targets"], ["TOEFL prep"])

    def test_v1_scalars_become_lists(self):
        raw = {"title": "t", "age_group": "Teens", "grammar_point": "",
               "vocab_focus": "sea animals", "topic": "Oceans",
               "theme": "environment"}
        rec = server.normalize_record("x", raw, [])
        self.assertEqual(rec["age_groups"], ["Teens"])
        self.assertEqual(rec["grammar_points"], [])
        self.assertEqual(rec["vocab_focuses"], ["sea animals"])
        self.assertEqual(rec["topics"], ["Oceans"])
        self.assertEqual(rec["themes"], ["environment"])

    def test_v1_file_name_strings_become_objects_with_empty_notes(self):
        files = [{"name": "a.pdf", "size": 3}]
        rec = server.normalize_record(
            "x", {"title": "t", "files": ["a.pdf"]}, files)
        self.assertEqual(rec["files"],
                         [{"name": "a.pdf", "size": 3, "note": ""}])

    def test_v2_record_passes_through(self):
        raw = {
            "schema_version": 2, "title": "t",
            "age_groups": ["Teens", "Adults"],
            "cefr_levels": ["B1", "B2"], "exam_targets": [],
            "skills": ["Pronunciation"],
            "grammar_points": ["Second conditional"],
            "vocab_focuses": ["Collocations"],
            "topics": ["Travel and tourism"], "themes": ["Relationships"],
            "formats": ["Worksheet"],
            "files": [{"name": "a.pdf", "note": "Answer key"}],
        }
        rec = server.normalize_record(
            "x", raw, [{"name": "a.pdf", "size": 1}])
        self.assertEqual(rec["age_groups"], ["Teens", "Adults"])
        self.assertEqual(rec["cefr_levels"], ["B1", "B2"])
        self.assertEqual(rec["exam_targets"], [])
        self.assertEqual(rec["files"][0]["note"], "Answer key")
        self.assertEqual(rec["schema_version"], 2)

    def test_v2_keys_win_over_v1_keys(self):
        raw = {"title": "t", "level": "B1 PET", "cefr_levels": ["C1"],
               "exam_targets": []}
        rec = server.normalize_record("x", raw, [])
        self.assertEqual(rec["cefr_levels"], ["C1"])
        self.assertEqual(rec["exam_targets"], [])

    def test_pronunciation_is_a_first_class_skill(self):
        self.assertIn("Pronunciation", server.SKILLS)
        rec = server.normalize_record(
            "x", {"title": "t", "skills": ["pronunciation"]}, [])
        self.assertEqual(rec["skills"], ["Pronunciation"])


class TestRescanReconciliation(LibraryTestCase):
    def test_notes_matched_by_exact_name_stale_dropped_new_empty(self):
        meta = {"schema_version": 2, "title": "Kit",
                "files": [{"name": "keep.pdf", "note": "Answer key"},
                          {"name": "gone.pdf", "note": "stale"}]}
        self.write_folder("kit", meta, files=[("keep.pdf", b"k"),
                                              ("new.pdf", b"n")])
        server.rebuild_index()
        rec = server.STATE["lessons"]["kit"]
        notes = {f["name"]: f["note"] for f in rec["files"]}
        self.assertEqual(notes, {"keep.pdf": "Answer key", "new.pdf": ""})

    def test_manually_copied_file_appears_after_rescan(self):
        self.create_material(title="Manual")
        folder = server.LESSONS_DIR / "manual"
        (folder / "dropped-in.pdf").write_bytes(b"x")
        resp = self.client.post("/api/rescan")
        recs = {m["id"]: m for m in resp.get_json()["lessons"]}
        names = [f["name"] for f in recs["manual"]["files"]]
        self.assertIn("dropped-in.pdf", names)
        notes = {f["name"]: f["note"] for f in recs["manual"]["files"]}
        self.assertEqual(notes["dropped-in.pdf"], "")

    def test_malformed_json_still_enters_needs_attention(self):
        self.write_folder("broken", meta="{not json", files=[("a.pdf", b"a")])
        server.rebuild_index()
        self.assertIn("broken", server.STATE["needs"])
        problem = server.STATE["needs"]["broken"]["problem"]
        self.assertIn("lesson.json", problem)


class TestApiRoundTrips(LibraryTestCase):
    def test_create_saves_schema_v2_with_file_notes(self):
        resp = self.create_material(
            files=[(io.BytesIO(b"handout"), "student-handout.pdf"),
                   (io.BytesIO(b"key"), "answer-key.pdf")],
            file_notes=json.dumps(["Print one per pair", "Teacher key"]),
        )
        self.assertEqual(resp.status_code, 201)
        rec = resp.get_json()["lesson"]
        self.assertEqual(rec["schema_version"], 2)
        self.assertEqual(rec["age_groups"], ["Teens", "Adults"])
        notes = {f["name"]: f["note"] for f in rec["files"]}
        self.assertEqual(notes, {"student-handout.pdf": "Print one per pair",
                                 "answer-key.pdf": "Teacher key"})
        disk = self.disk_json(rec["id"])
        self.assertEqual(disk["schema_version"], 2)
        # on disk: name + note only, no size — the directory is the truth
        self.assertEqual(
            sorted(disk["files"], key=lambda f: f["name"]),
            [{"name": "answer-key.pdf", "note": "Teacher key"},
             {"name": "student-handout.pdf", "note": "Print one per pair"}])

    def test_material_can_be_teens_and_adults_and_survives_edit(self):
        rec = self.create_material().get_json()["lesson"]
        data = {"title": rec["title"], "age_groups": ["Teens", "Adults"],
                "cefr_levels": ["B1", "B2"], "skills": ["Speaking"]}
        resp = self.client.post("/api/lessons/" + rec["id"], data=data,
                                content_type="multipart/form-data")
        out = resp.get_json()["lesson"]
        self.assertEqual(out["age_groups"], ["Teens", "Adults"])
        self.assertEqual(out["cefr_levels"], ["B1", "B2"])

    def test_cefr_without_exam_and_exam_without_cefr(self):
        plain = self.create_material(
            title="General B2", cefr_levels=["B2"]).get_json()["lesson"]
        self.assertEqual(plain["cefr_levels"], ["B2"])
        self.assertEqual(plain["exam_targets"], [])

        paired = self.create_material(
            title="FCE prep", cefr_levels=["B2"],
            exam_targets=[CAMBRIDGE + "B2 First"]).get_json()["lesson"]
        self.assertEqual(paired["exam_targets"], [CAMBRIDGE + "B2 First"])

        ielts = self.create_material(
            title="IELTS writing", cefr_levels=[],
            exam_targets=["IELTS Academic"]).get_json()["lesson"]
        self.assertEqual(ielts["cefr_levels"], [])
        self.assertEqual(ielts["exam_targets"], ["IELTS Academic"])

    def test_material_saves_with_no_grammar_point(self):
        rec = self.create_material(title="No grammar").get_json()["lesson"]
        self.assertEqual(rec["grammar_points"], [])
        self.assertEqual(self.disk_json(rec["id"])["grammar_points"], [])
        # resave must not invent a blank chip
        resp = self.client.post(
            "/api/lessons/" + rec["id"],
            data={"title": "No grammar", "grammar_points": [""]},
            content_type="multipart/form-data")
        self.assertEqual(resp.get_json()["lesson"]["grammar_points"], [])

    def test_case_insensitive_dedupe_snaps_to_catalog_casing(self):
        rec = self.create_material(
            title="Dedupe",
            grammar_points=["past simple", "Past Simple"],
            topics=["klingon Cuisine", "Klingon cuisine"],
        ).get_json()["lesson"]
        self.assertEqual(rec["grammar_points"], ["Past simple"])
        self.assertEqual(len(rec["topics"]), 1)

    def test_custom_values_survive_and_appear_in_your_library_group(self):
        self.create_material(title="Custom",
                             grammar_points=["Klingon honorifics"],
                             vocab_focuses=["Warp-core jargon"])
        payload = self.client.get("/api/lessons").get_json()
        grammar = payload["taxonomy"]["grammar_points"]
        self.assertEqual(grammar[0]["group"], "Your library")
        self.assertIn("Klingon honorifics", grammar[0]["options"])
        vocab = payload["taxonomy"]["vocab_focuses"]
        self.assertIn("Warp-core jargon", vocab[0]["options"])

    def test_update_existing_notes_map(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf"), (io.BytesIO(b"b"), "b.pdf")],
            file_notes=json.dumps(["old a", "old b"]),
        ).get_json()["lesson"]
        resp = self.client.post(
            "/api/lessons/" + rec["id"],
            data={"title": rec["title"],
                  "existing_notes": json.dumps({"a.pdf": "new a"})},
            content_type="multipart/form-data")
        notes = {f["name"]: f["note"]
                 for f in resp.get_json()["lesson"]["files"]}
        # mapped file updated; unmapped file keeps its stored note
        self.assertEqual(notes, {"a.pdf": "new a", "b.pdf": "old b"})

    def test_add_files_endpoint_pairs_notes_and_keeps_old_ones(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf")],
            file_notes=json.dumps(["first note"]),
        ).get_json()["lesson"]
        resp = self.client.post(
            "/api/lessons/" + rec["id"] + "/files",
            data={"files": [(io.BytesIO(b"c"), "c.pdf")],
                  "file_notes": json.dumps(["third note"])},
            content_type="multipart/form-data")
        out = resp.get_json()
        self.assertEqual(out["saved"][0]["name"], "c.pdf")
        notes = {f["name"]: f["note"] for f in out["lesson"]["files"]}
        self.assertEqual(notes, {"a.pdf": "first note", "c.pdf": "third note"})
        disk_notes = {f["name"]: f["note"]
                      for f in self.disk_json(rec["id"])["files"]}
        self.assertEqual(disk_notes, notes)

    def test_sanitized_and_duplicate_filenames_keep_their_notes(self):
        resp = self.create_material(
            files=[(io.BytesIO(b"1"), 'bad:name?.pdf'),
                   (io.BytesIO(b"2"), "a.pdf"),
                   (io.BytesIO(b"3"), "a.pdf")],
            file_notes=json.dumps(["weird", "first a", "second a"]),
        )
        notes = {f["name"]: f["note"]
                 for f in resp.get_json()["lesson"]["files"]}
        self.assertEqual(notes, {"badname.pdf": "weird",
                                 "a.pdf": "first a",
                                 "a (2).pdf": "second a"})

    def test_notes_survive_restart(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf")],
            file_notes=json.dumps(["sticky note"]),
        ).get_json()["lesson"]
        # simulate restart: throw the in-memory index away and rescan disk
        with server.LOCK:
            server.STATE["lessons"] = {}
            server.STATE["needs"] = {}
        server.rebuild_index()
        again = server.STATE["lessons"][rec["id"]]
        self.assertEqual(again["files"][0]["note"], "sticky note")


class TestUploadsAndSafety(LibraryTestCase):
    def test_save_uploads_returns_original_and_final_names(self):
        folder = self.write_folder("kit", meta={"title": "Kit"},
                                   files=[("a.pdf", b"old")])

        class Fake:
            filename = "a.pdf"
            stream = io.BytesIO(b"new")

        saved = server.save_uploads(folder, [Fake()])
        self.assertEqual(saved,
                         [{"original_name": "a.pdf", "name": "a (2).pdf"}])

    def test_title_is_required(self):
        resp = self.create_material(title="")
        self.assertEqual(resp.status_code, 400)

    def test_path_traversal_is_rejected(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf")]).get_json()["lesson"]
        self.assertIsNone(server.resolve_lesson_dir(".."))
        self.assertIsNone(server.resolve_lesson_dir("kit/../.."))
        resp = self.client.get(
            "/files/%2e%2e/" + rec["id"] + "/a.pdf")
        self.assertEqual(resp.status_code, 404)
        resp = self.client.get(
            "/files/" + rec["id"] + "/%2e%2e/%2e%2e/secret.txt")
        self.assertEqual(resp.status_code, 404)

    def test_trash_moves_folder(self):
        rec = self.create_material().get_json()["lesson"]
        resp = self.client.post("/api/lessons/" + rec["id"] + "/trash")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse((server.LESSONS_DIR / rec["id"]).exists())
        self.assertTrue((server.TRASH_DIR / rec["id"]).exists())


class TestTaxonomyCatalog(LibraryTestCase):
    def test_taxonomy_loaded_and_valid(self):
        for field in ("grammar_points", "vocab_focuses", "topics",
                      "themes", "exam_targets"):
            groups = server.TAXONOMY[field]
            self.assertTrue(groups, msg=field)
            for g in groups:
                self.assertTrue(g["group"])
                self.assertTrue(g["options"])

    def test_index_payload_shape(self):
        payload = self.client.get("/api/lessons").get_json()
        self.assertEqual(payload["options"]["cefr_levels"],
                         ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"])
        self.assertIn("Pronunciation", payload["options"]["skills"])
        self.assertIn("taxonomy", payload)
        flat_exams = [o for g in payload["taxonomy"]["exam_targets"]
                      for o in g["options"]]
        self.assertIn("IELTS Academic", flat_exams)
        self.assertIn(CAMBRIDGE + "Pre A1 Starters", flat_exams)


class TestUsageLog(LibraryTestCase):
    def test_log_use_appends_and_persists(self):
        rec = self.create_material().get_json()["lesson"]
        resp = self.client.post(
            "/api/lessons/" + rec["id"] + "/usage",
            data={"date": "2026-06-12", "group": "Tue B2", "note": "warmer"},
            content_type="multipart/form-data")
        out = resp.get_json()["lesson"]
        self.assertEqual(out["usage"],
                         [{"date": "2026-06-12", "group": "Tue B2",
                           "note": "warmer"}])
        self.assertEqual(self.disk_json(rec["id"])["usage"], out["usage"])

    def test_bad_date_falls_back_to_today(self):
        rec = self.create_material().get_json()["lesson"]
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/usage",
            data={"date": "whenever", "group": ""},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertRegex(out["usage"][0]["date"], r"^\d{4}-\d{2}-\d{2}$")

    def test_usage_survives_metadata_edit(self):
        rec = self.create_material().get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-10", "group": "g"},
                         content_type="multipart/form-data")
        # the edit form never posts usage; it must be carried over
        out = self.client.post(
            "/api/lessons/" + rec["id"],
            data={"title": "Renamed"},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual(len(out["usage"]), 1)
        self.assertEqual(self.disk_json(rec["id"])["usage"], out["usage"])

    def test_delete_usage_entry(self):
        rec = self.create_material().get_json()["lesson"]
        for d in ("2026-06-01", "2026-06-02"):
            self.client.post("/api/lessons/" + rec["id"] + "/usage",
                             data={"date": d},
                             content_type="multipart/form-data")
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/usage/delete",
            data={"index": "0"},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual([u["date"] for u in out["usage"]], ["2026-06-02"])

    def test_malformed_usage_in_json_is_dropped_not_fatal(self):
        self.write_folder("kit", meta={
            "title": "Kit",
            "usage": [{"date": "not-a-date", "group": "x"},
                      {"date": "2026-01-05", "group": "ok"},
                      "garbage"],
        })
        server.rebuild_index()
        rec = server.STATE["lessons"]["kit"]
        self.assertEqual(rec["usage"],
                         [{"date": "2026-01-05", "group": "ok", "note": ""}])


class TestReflections(LibraryTestCase):
    """Feature A: the reflection trio on usage entries and the feed."""

    def test_normalize_accepts_reflection_trio(self):
        usage = server.normalize_usage([
            {"date": "2026-06-01", "rating": 4,
             "reflection": "  Paced too fast.  ", "needs_revision": True}])
        self.assertEqual(usage, [{
            "date": "2026-06-01", "group": "", "note": "",
            "rating": 4, "reflection": "Paced too fast.",
            "needs_revision": True}])

    def test_normalize_rejects_out_of_range_rating(self):
        for bad in (0, 6, -1, "x", 4.5, None):
            usage = server.normalize_usage([{"date": "2026-06-01",
                                             "rating": bad}])
            self.assertNotIn("rating", usage[0], msg=repr(bad))
        # in-range values are kept
        usage = server.normalize_usage([{"date": "2026-06-01", "rating": "5"}])
        self.assertEqual(usage[0]["rating"], 5)

    def test_normalize_empty_reflection_is_unset(self):
        usage = server.normalize_usage([{"date": "2026-06-01",
                                         "reflection": "   "}])
        self.assertNotIn("reflection", usage[0])

    def test_normalize_needs_revision_defaults_false_and_omitted(self):
        usage = server.normalize_usage([{"date": "2026-06-01"}])
        self.assertNotIn("needs_revision", usage[0])
        usage = server.normalize_usage([{"date": "2026-06-01",
                                         "needs_revision": False}])
        self.assertNotIn("needs_revision", usage[0])
        usage = server.normalize_usage([{"date": "2026-06-01",
                                         "needs_revision": 1}])
        self.assertTrue(usage[0]["needs_revision"])

    def test_v1_usage_without_reflection_still_loads(self):
        self.write_folder("kit", meta={
            "title": "Kit",
            "usage": [{"date": "2026-01-05", "group": "ok", "note": "n"}]})
        server.rebuild_index()
        rec = server.STATE["lessons"]["kit"]
        self.assertEqual(rec["usage"],
                         [{"date": "2026-01-05", "group": "ok", "note": "n"}])

    def test_log_usage_persists_reflection_fields(self):
        rec = self.create_material().get_json()["lesson"]
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/usage",
            data={"date": "2026-06-12", "rating": "4",
                  "reflection": "Needs more CCQs", "needs_revision": "true"},
            content_type="multipart/form-data").get_json()["lesson"]
        entry = out["usage"][0]
        self.assertEqual(entry["rating"], 4)
        self.assertEqual(entry["reflection"], "Needs more CCQs")
        self.assertTrue(entry["needs_revision"])
        self.assertEqual(self.disk_json(rec["id"])["usage"], out["usage"])

    def test_update_usage_edits_and_clears_reflection(self):
        rec = self.create_material().get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-12"},
                         content_type="multipart/form-data")
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/usage/update",
            data={"index": "0", "rating": "5", "reflection": "Great",
                  "needs_revision": "true"},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual(out["usage"][0]["rating"], 5)
        # clearing: empty reflection + falsey flag remove the keys
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/usage/update",
            data={"index": "0", "reflection": "", "needs_revision": "false"},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertNotIn("reflection", out["usage"][0])
        self.assertNotIn("needs_revision", out["usage"][0])
        self.assertEqual(out["usage"][0]["rating"], 5)

    def test_reflections_feed_only_includes_reflective_entries(self):
        rec = self.create_material().get_json()["lesson"]
        # plain use -> excluded
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-01"},
                         content_type="multipart/form-data")
        # rated use -> included
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-02", "rating": "2"},
                         content_type="multipart/form-data")
        feed = self.client.get("/api/reflections").get_json()["reflections"]
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["material_id"], rec["id"])
        self.assertEqual(feed[0]["rating"], 2)

    def test_reflections_feed_needs_revision_filter(self):
        rec = self.create_material().get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-02", "rating": "5"},
                         content_type="multipart/form-data")
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-03", "needs_revision": "true"},
                         content_type="multipart/form-data")
        flagged = self.client.get(
            "/api/reflections?needs_revision=true").get_json()["reflections"]
        self.assertEqual(len(flagged), 1)
        self.assertTrue(flagged[0]["needs_revision"])

    def test_health_counts_materials_needing_revision(self):
        rec = self.create_material().get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-03", "needs_revision": "true"},
                         content_type="multipart/form-data")
        h = self.client.get("/api/health").get_json()
        self.assertEqual(h["needs_revision"], 1)


class TestPlans(LibraryTestCase):
    def make_plan(self, **over):
        data = {"title": "Tuesday B2", "group": "B2 evening",
                "plan_date": "2026-06-16", "notes": ""}
        data.update(over)
        return self.client.post("/api/plans", data=data,
                                content_type="multipart/form-data")

    def test_create_plan_writes_sidecar(self):
        resp = self.make_plan()
        self.assertEqual(resp.status_code, 201)
        plan = resp.get_json()["plan"]
        self.assertEqual(plan["id"], "tuesday-b2")
        disk = json.loads((server.PLANS_DIR / plan["id"] / "plan.json")
                          .read_text(encoding="utf-8"))
        self.assertEqual(disk["title"], "Tuesday B2")
        self.assertEqual(disk["items"], [])

    def test_plan_title_is_required(self):
        self.assertEqual(self.make_plan(title="").status_code, 400)

    def test_update_items_and_round_trip_through_rescan(self):
        rec = self.create_material().get_json()["lesson"]
        plan = self.make_plan().get_json()["plan"]
        items = [{"material_id": rec["id"], "done": True, "note": "first"}]
        out = self.client.post(
            "/api/plans/" + plan["id"],
            data={"title": plan["title"], "items": json.dumps(items)},
            content_type="multipart/form-data").get_json()["plan"]
        self.assertEqual(out["items"][0]["material_id"], rec["id"])
        self.assertTrue(out["items"][0]["done"])
        server.rebuild_index()
        again = server.STATE["plans"][plan["id"]]
        self.assertEqual(again["items"], out["items"])
        self.assertEqual(again["date_added"], out["date_added"])

    def test_dangling_material_reference_is_kept(self):
        plan = self.make_plan().get_json()["plan"]
        items = [{"material_id": "ghost-material", "done": False}]
        out = self.client.post(
            "/api/plans/" + plan["id"],
            data={"title": plan["title"], "items": json.dumps(items)},
            content_type="multipart/form-data").get_json()["plan"]
        self.assertEqual(out["items"][0]["material_id"], "ghost-material")

    def test_plans_in_index_payload_sorted_by_date(self):
        self.make_plan(title="Later", plan_date="2026-07-01")
        self.make_plan(title="Sooner", plan_date="2026-06-13")
        self.make_plan(title="Undated", plan_date="")
        payload = self.client.get("/api/lessons").get_json()
        titles = [p["title"] for p in payload["plans"]]
        self.assertEqual(titles, ["Sooner", "Later", "Undated"])

    def test_trash_plan_moves_folder_with_prefix(self):
        plan = self.make_plan().get_json()["plan"]
        resp = self.client.post("/api/plans/" + plan["id"] + "/trash")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse((server.PLANS_DIR / plan["id"]).exists())
        self.assertTrue((server.TRASH_DIR / ("plan-" + plan["id"])).exists())

    def test_unreadable_plan_is_flagged_not_dropped(self):
        folder = server.PLANS_DIR / "broken"
        folder.mkdir()
        (folder / "plan.json").write_text("{nope", encoding="utf-8")
        server.rebuild_index()
        plan = server.STATE["plans"]["broken"]
        self.assertTrue(plan["unreadable"])
        self.assertEqual(plan["title"], "broken")

    def test_stage_durations_accepted_and_validated(self):
        plan = self.make_plan().get_json()["plan"]
        out = self.client.post(
            "/api/plans/" + plan["id"],
            data={"title": plan["title"], "stage_durations": json.dumps(
                {"warmer": 8, "break": "5", "cool-down": 10})},
            content_type="multipart/form-data").get_json()["plan"]
        self.assertEqual(out["stage_durations"],
                         {"warmer": 8, "break": 5, "cool-down": 10})
        server.rebuild_index()
        again = server.STATE["plans"][plan["id"]]
        self.assertEqual(again["stage_durations"], out["stage_durations"])

    def test_stage_durations_drops_invalid_values(self):
        plan = self.make_plan().get_json()["plan"]
        out = self.client.post(
            "/api/plans/" + plan["id"],
            data={"title": plan["title"], "stage_durations": json.dumps(
                {"warmer": -3, "break": "soon", "cool-down": 999,
                 "bogus": 5})},
            content_type="multipart/form-data").get_json()["plan"]
        # all invalid or unknown keys dropped, never written
        self.assertEqual(out["stage_durations"], {})

    def test_plan_without_stage_durations_defaults_empty(self):
        plan = self.make_plan().get_json()["plan"]
        self.assertEqual(plan["stage_durations"], {})

    def test_placeholder_items_round_trip(self):
        plan = self.make_plan().get_json()["plan"]
        items = [{"placeholder": "Warmer", "duration_min": 5},
                 {"material_id": "some-material", "done": False},
                 {"placeholder": "", "duration_min": 3},
                 {"placeholder": "Break", "duration_min": "soon"}]
        out = self.client.post(
            "/api/plans/" + plan["id"],
            data={"title": plan["title"], "items": json.dumps(items)},
            content_type="multipart/form-data").get_json()["plan"]
        # blank placeholder dropped; bad duration tolerated as None
        self.assertEqual(len(out["items"]), 3)
        self.assertEqual(out["items"][0],
                         {"placeholder": "Warmer", "duration_min": 5,
                          "done": False, "note": ""})
        self.assertEqual(out["items"][1]["material_id"], "some-material")
        self.assertEqual(out["items"][2]["placeholder"], "Break")
        self.assertIsNone(out["items"][2]["duration_min"])
        server.rebuild_index()
        again = server.STATE["plans"][plan["id"]]
        self.assertEqual(again["items"], out["items"])


class TestFileRoles(LibraryTestCase):
    """Feature D: per-file role + transcript on files[]."""

    def test_normalize_accepts_role_and_transcript(self):
        raw = {"title": "t", "files": [
            {"name": "a.pdf", "note": "n", "role": "Answer key"},
            {"name": "b.mp3", "role": "Audio", "transcript": "  Hello.  "}]}
        files = [{"name": "a.pdf", "size": 1}, {"name": "b.mp3", "size": 2}]
        rec = server.normalize_record("x", raw, files)
        by = {f["name"]: f for f in rec["files"]}
        self.assertEqual(by["a.pdf"]["role"], "Answer key")
        self.assertEqual(by["b.mp3"]["role"], "Audio")
        self.assertEqual(by["b.mp3"]["transcript"], "Hello.")

    def test_v1_files_have_no_role_keys(self):
        rec = server.normalize_record(
            "x", {"title": "t", "files": [{"name": "a.pdf", "note": "n"}]},
            [{"name": "a.pdf", "size": 1}])
        self.assertNotIn("role", rec["files"][0])
        self.assertNotIn("transcript", rec["files"][0])
        # blank role/transcript are dropped, not stored as keys
        rec = server.normalize_record(
            "x", {"title": "t",
                  "files": [{"name": "a.pdf", "role": "  ", "transcript": ""}]},
            [{"name": "a.pdf", "size": 1}])
        self.assertNotIn("role", rec["files"][0])
        self.assertNotIn("transcript", rec["files"][0])

    def test_payload_includes_curated_file_roles(self):
        payload = self.client.get("/api/lessons").get_json()
        flat = [o for g in payload["file_roles"] for o in g["options"]]
        self.assertIn("Student handout", flat)
        self.assertIn("Answer key", flat)
        self.assertIn("Audio", flat)

    def test_upload_with_role_persists(self):
        resp = self.create_material(
            files=[(io.BytesIO(b"k"), "answer-key.pdf")],
            file_roles=json.dumps(["Answer key"]))
        rec = resp.get_json()["lesson"]
        self.assertEqual(rec["files"][0]["role"], "Answer key")
        disk = {f["name"]: f for f in self.disk_json(rec["id"])["files"]}
        self.assertEqual(disk["answer-key.pdf"]["role"], "Answer key")

    def test_edit_file_sets_role_and_transcript(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.mp3")]).get_json()["lesson"]
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/edit",
            data={"old": "a.mp3", "name": "a.mp3", "role": "Audio",
                  "transcript": "Speaker 1: Hi."},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual(out["files"][0]["role"], "Audio")
        self.assertEqual(out["files"][0]["transcript"], "Speaker 1: Hi.")
        # clearing the role removes the key
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/edit",
            data={"old": "a.mp3", "name": "a.mp3", "role": ""},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertNotIn("role", out["files"][0])
        self.assertEqual(out["files"][0]["transcript"], "Speaker 1: Hi.")

    def test_role_survives_rename_and_metadata_edit(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf")]).get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/files/edit",
                         data={"old": "a.pdf", "name": "a.pdf",
                               "role": "Student handout"},
                         content_type="multipart/form-data")
        # rename keeps the role
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/edit",
            data={"old": "a.pdf", "name": "handout.pdf"},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual(out["files"][0]["role"], "Student handout")
        # editing the material's metadata (no role posted) keeps the role
        out = self.client.post(
            "/api/lessons/" + rec["id"],
            data={"title": "Renamed", "skills": ["Reading"]},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual(out["files"][0]["role"], "Student handout")
        self.assertEqual(self.disk_json(rec["id"])["files"][0]["role"],
                         "Student handout")

    def test_role_survives_add_files_and_reorder(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf")]).get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/files/edit",
                         data={"old": "a.pdf", "name": "a.pdf",
                               "role": "Answer key"},
                         content_type="multipart/form-data")
        self.client.post(
            "/api/lessons/" + rec["id"] + "/files",
            data={"files": [(io.BytesIO(b"b"), "b.pdf")]},
            content_type="multipart/form-data")
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/reorder",
            data={"order": json.dumps(["b.pdf", "a.pdf"])},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertEqual([f["name"] for f in out["files"]], ["b.pdf", "a.pdf"])
        roles = {f["name"]: f.get("role") for f in out["files"]}
        self.assertEqual(roles["a.pdf"], "Answer key")
        self.assertIsNone(roles["b.pdf"])

    def test_custom_role_preserved_and_in_catalog(self):
        rec = self.create_material(
            files=[(io.BytesIO(b"a"), "a.pdf")]).get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/files/edit",
                         data={"old": "a.pdf", "name": "a.pdf",
                               "role": "Realia photo"},
                         content_type="multipart/form-data")
        payload = self.client.get("/api/lessons").get_json()
        self.assertEqual(payload["file_roles"][0]["group"], "Your library")
        self.assertIn("Realia photo", payload["file_roles"][0]["options"])


class TestInbox(LibraryTestCase):
    def stage(self, name, content=b"x"):
        (server.INBOX_DIR / name).write_bytes(content)

    def test_inbox_listing(self):
        self.stage("shared.pdf")
        self.stage(".hidden")
        self.stage("partial.tmp")
        files = self.client.get("/api/inbox").get_json()["files"]
        self.assertEqual([f["name"] for f in files], ["shared.pdf"])

    def test_create_attaches_inbox_files_and_moves_them(self):
        self.stage("from-whatsapp.pdf", b"shared")
        resp = self.create_material(
            inbox_files=json.dumps(["from-whatsapp.pdf"]),
            inbox_notes=json.dumps({"from-whatsapp.pdf": "From parents chat"}),
        )
        rec = resp.get_json()["lesson"]
        notes = {f["name"]: f["note"] for f in rec["files"]}
        self.assertEqual(notes, {"from-whatsapp.pdf": "From parents chat"})
        self.assertFalse((server.INBOX_DIR / "from-whatsapp.pdf").exists())
        self.assertTrue(
            (server.LESSONS_DIR / rec["id"] / "from-whatsapp.pdf").exists())

    def test_update_attaches_inbox_files(self):
        rec = self.create_material().get_json()["lesson"]
        self.stage("extra.pdf")
        out = self.client.post(
            "/api/lessons/" + rec["id"],
            data={"title": rec["title"],
                  "inbox_files": json.dumps(["extra.pdf"])},
            content_type="multipart/form-data").get_json()["lesson"]
        self.assertIn("extra.pdf", [f["name"] for f in out["files"]])
        self.assertFalse((server.INBOX_DIR / "extra.pdf").exists())

    def test_unknown_and_traversal_names_are_skipped(self):
        self.stage("real.pdf")
        resp = self.create_material(
            inbox_files=json.dumps(["ghost.pdf", "../real.pdf", "real.pdf"]))
        rec = resp.get_json()["lesson"]
        self.assertEqual([f["name"] for f in rec["files"]], ["real.pdf"])

    def test_inbox_files_kept_on_name_collision(self):
        self.stage("a.pdf", b"inbox version")
        resp = self.create_material(
            files=[(io.BytesIO(b"uploaded"), "a.pdf")],
            inbox_files=json.dumps(["a.pdf"]))
        names = sorted(f["name"] for f in resp.get_json()["lesson"]["files"])
        self.assertEqual(names, ["a (2).pdf", "a.pdf"])


class TestInboxBatchAndImport(LibraryTestCase):
    """The share-batch marker, inbox file serving/trash, and the
    attach/undo routes behind the Inbox import screen."""

    def stage(self, name, content=b"x"):
        (server.INBOX_DIR / name).write_bytes(content)

    def write_batch(self, names):
        (server.INBOX_DIR / server.INBOX_BATCH_FILE).write_text(
            json.dumps({"ts": 0, "names": names}), encoding="utf-8")

    def test_batch_lists_only_files_still_in_inbox(self):
        self.stage("a.pdf")
        self.stage("b.pdf")
        self.write_batch(["a.pdf", "gone.pdf"])
        out = self.client.get("/api/inbox").get_json()
        self.assertEqual(out["batch"], ["a.pdf"])
        payload = self.client.get("/api/lessons").get_json()
        self.assertEqual(payload["inbox_batch"], ["a.pdf"])

    def test_batch_self_heals_when_file_is_attached(self):
        self.stage("a.pdf")
        self.write_batch(["a.pdf"])
        self.create_material(inbox_files=json.dumps(["a.pdf"]))
        self.assertEqual(self.client.get("/api/inbox").get_json()["batch"], [])

    def test_batch_clear_endpoint(self):
        self.stage("a.pdf")
        self.write_batch(["a.pdf"])
        self.client.post("/api/inbox/batch/clear")
        self.assertEqual(self.client.get("/api/inbox").get_json()["batch"], [])

    def test_malformed_batch_marker_is_ignored(self):
        self.stage("a.pdf")
        (server.INBOX_DIR / server.INBOX_BATCH_FILE).write_text(
            "{nope", encoding="utf-8")
        self.assertEqual(self.client.get("/api/inbox").get_json()["batch"], [])

    def test_serve_inbox_file_and_reject_traversal(self):
        self.stage("pic.png", b"png-bytes")
        resp = self.client.get("/inbox-files/pic.png")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, b"png-bytes")
        resp = self.client.get("/inbox-files/%2e%2e/secret.txt")
        self.assertEqual(resp.status_code, 404)

    def test_inbox_trash_moves_named_files_only(self):
        self.stage("junk.pdf")
        out = self.client.post(
            "/api/inbox/trash",
            data={"names": json.dumps(["junk.pdf", "../evil", "ghost.pdf"])},
            content_type="multipart/form-data").get_json()
        self.assertEqual(out["trashed"], ["junk.pdf"])
        self.assertTrue((server.TRASH_DIR / "junk.pdf").exists())
        self.assertFalse((server.INBOX_DIR / "junk.pdf").exists())

    def test_attach_inbox_route_keeps_metadata_intact(self):
        rec = self.create_material().get_json()["lesson"]
        self.stage("extra.pdf")
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/inbox",
            data={"inbox_files": json.dumps(["extra.pdf"]),
                  "inbox_notes": json.dumps({"extra.pdf": "from share"})},
            content_type="multipart/form-data").get_json()
        self.assertEqual(out["attached"], ["extra.pdf"])
        lesson = out["lesson"]
        # no metadata fields were posted, none may be lost
        self.assertEqual(lesson["age_groups"], ["Teens", "Adults"])
        self.assertEqual(lesson["skills"], ["Speaking", "Pronunciation"])
        notes = {f["name"]: f["note"] for f in lesson["files"]}
        self.assertEqual(notes, {"extra.pdf": "from share"})
        disk = self.disk_json(rec["id"])
        self.assertEqual(disk["cefr_levels"], ["B1", "B2"])

    def test_files_to_inbox_returns_files(self):
        self.stage("a.pdf", b"shared")
        rec = self.create_material(
            inbox_files=json.dumps(["a.pdf"])).get_json()["lesson"]
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/to-inbox",
            data={"names": json.dumps(["a.pdf", "../evil", "ghost.pdf"])},
            content_type="multipart/form-data").get_json()
        self.assertEqual(out["moved"], ["a.pdf"])
        self.assertTrue((server.INBOX_DIR / "a.pdf").exists())
        self.assertEqual(out["lesson"]["files"], [])

    def test_files_to_inbox_can_trash_emptied_material(self):
        self.stage("a.pdf")
        rec = self.create_material(
            inbox_files=json.dumps(["a.pdf"])).get_json()["lesson"]
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/to-inbox",
            data={"names": json.dumps(["a.pdf"]), "trash_if_empty": "1"},
            content_type="multipart/form-data").get_json()
        self.assertIsNone(out["lesson"])
        self.assertTrue((server.INBOX_DIR / "a.pdf").exists())
        self.assertFalse((server.LESSONS_DIR / rec["id"]).exists())
        self.assertTrue((server.TRASH_DIR / rec["id"]).exists())
        with server.LOCK:
            self.assertNotIn(rec["id"], server.STATE["lessons"])


class TestBackup(LibraryTestCase):
    """Feature E: zip/restore, merge strategies, config, and the 503 gate."""

    def setUp(self):
        super().setUp()
        self.dest = self.data / "drive"
        self.dest.mkdir()

    def configure(self, **over):
        body = {"destination_type": "local",
                "destination_path": str(self.dest)}
        body.update(over)
        return self.client.put("/api/backup/config", json=body)

    def test_routes_503_until_configured(self):
        for path in ("/api/backup/status", "/api/backup/list"):
            self.assertEqual(self.client.get(path).status_code, 503)
        self.assertEqual(self.client.post("/api/backup/now").status_code, 503)
        self.assertEqual(self.client.post(
            "/api/backup/restore",
            data={"backup_name": "x", "strategy": "merge_skip"},
            content_type="multipart/form-data").status_code, 503)
        # the rest of the app is unaffected
        self.assertEqual(self.client.get("/api/lessons").status_code, 200)
        self.assertFalse((self.data / "backup.json").exists())

    def test_backup_now_writes_valid_zip(self):
        self.create_material(title="Zipped",
                             files=[(io.BytesIO(b"hello"), "a.pdf")])
        self.configure()
        out = self.client.post("/api/backup/now").get_json()
        self.assertTrue(out["ok"])
        self.assertEqual(out["material_count"], 1)
        zips = list(self.dest.glob("lesson-library-backup-*.zip"))
        self.assertEqual(len(zips), 1)
        import zipfile
        with zipfile.ZipFile(zips[0]) as zf:
            self.assertIsNone(zf.testzip())
            names = zf.namelist()
            self.assertIn("lessons/zipped/a.pdf", names)
            self.assertIn("lessons/zipped/lesson.json", names)
            self.assertIn("health.json", names)

    def make_backup(self):
        self.configure()
        return self.client.post("/api/backup/now").get_json()["name"]

    def write_backup_file(self, name, members):
        path = self.dest / name
        with zipfile.ZipFile(path, "w") as zf:
            for member, content in members:
                zf.writestr(member, content)
        return path

    def test_restore_replace_all_moves_current_aside(self):
        self.create_material(title="Keeper")
        name = self.make_backup()
        # add a material that exists only locally (not in the backup)
        self.create_material(title="Local only")
        out = self.client.post(
            "/api/backup/restore",
            data={"backup_name": name, "strategy": "replace_all"},
            content_type="multipart/form-data").get_json()
        self.assertTrue(out["moved_aside"].startswith("Trash-restore-"))
        self.assertTrue((self.data / out["moved_aside"]).is_dir())
        # only the backed-up material remains
        ids = set(server.STATE["lessons"])
        self.assertIn("keeper", ids)
        self.assertNotIn("local-only", ids)

    def test_restore_merge_skip_keeps_existing(self):
        self.create_material(title="Shared")
        name = self.make_backup()
        # change the local copy after the backup
        self.client.post("/api/lessons/shared",
                         data={"title": "Shared", "notes": "edited locally"},
                         content_type="multipart/form-data")
        self.client.post(
            "/api/backup/restore",
            data={"backup_name": name, "strategy": "merge_skip"},
            content_type="multipart/form-data")
        self.assertEqual(self.disk_json("shared")["notes"], "edited locally")

    def test_restore_merge_overwrite_replaces_existing(self):
        self.create_material(title="Shared")
        name = self.make_backup()
        self.client.post("/api/lessons/shared",
                         data={"title": "Shared", "notes": "edited locally"},
                         content_type="multipart/form-data")
        self.client.post(
            "/api/backup/restore",
            data={"backup_name": name, "strategy": "merge_overwrite"},
            content_type="multipart/form-data")
        # the backup had no notes, so overwrite wipes the local edit
        self.assertEqual(self.disk_json("shared")["notes"], "")

    def test_conflict_detection(self):
        self.create_material(title="Shared")
        name = self.make_backup()
        self.client.post("/api/lessons/shared",
                         data={"title": "Shared", "notes": "diverged"},
                         content_type="multipart/form-data")
        out = self.client.post(
            "/api/backup/restore",
            data={"backup_name": name, "strategy": "merge_skip"},
            content_type="multipart/form-data").get_json()
        self.assertIn("shared", out["conflicts"])

    def test_materials_added_counter_increments_and_resets(self):
        self.configure()
        self.create_material(title="One")
        self.create_material(title="Two")
        cfg = json.loads((self.data / "backup.json").read_text())
        self.assertEqual(cfg["materials_added_since_last_backup"], 2)
        self.client.post("/api/backup/now")
        cfg = json.loads((self.data / "backup.json").read_text())
        self.assertEqual(cfg["materials_added_since_last_backup"], 0)

    def test_is_due_for_reminder_and_after_n(self):
        self.configure(reminder_days=7, auto_frequency="after_n_materials",
                       after_n_value=2)
        # never backed up -> due on the reminder
        self.assertTrue(self.client.get(
            "/api/backup/status").get_json()["is_due"])
        self.client.post("/api/backup/now")
        status = self.client.get("/api/backup/status").get_json()
        self.assertFalse(status["is_due"])
        # two new materials hits the after-N threshold
        self.create_material(title="A")
        self.create_material(title="B")
        self.assertTrue(self.client.get(
            "/api/backup/status").get_json()["is_due"])

    def test_disconnect_clears_destination(self):
        self.configure()
        self.client.post("/api/backup/disconnect")
        self.assertEqual(self.client.get(
            "/api/backup/status").status_code, 503)

    def test_backup_names_are_unique_and_legacy_names_remain_visible(self):
        self.configure()
        first = self.client.post("/api/backup/now").get_json()["name"]
        second = self.client.post("/api/backup/now").get_json()["name"]
        self.assertNotEqual(first, second)
        self.assertRegex(first,
                         r"^lesson-library-backup-\d{8}-\d{6}-\d{6}\.zip$")
        legacy = "lesson-library-backup-20260102-030405.zip"
        self.write_backup_file(legacy, [("health.json", "{}")])
        names = {b["name"] for b in self.client.get(
            "/api/backup/list").get_json()["backups"]}
        self.assertIn(legacy, names)

    def test_unsafe_archive_paths_are_rejected_without_touching_data(self):
        self.create_material(title="Keeper")
        self.configure()
        unsafe = [
            "lessons/../pwned.txt",
            "/lessons/evil/a.txt",
            "C:/lessons/evil/a.txt",
            "unknown/evil/a.txt",
        ]
        for i, member in enumerate(unsafe):
            with self.subTest(member=member):
                name = f"lesson-library-backup-20260102-0304{i:02d}.zip"
                self.write_backup_file(name, [(member, "bad")])
                resp = self.client.post(
                    "/api/backup/restore",
                    data={"backup_name": name, "strategy": "merge_overwrite"},
                    content_type="multipart/form-data")
                self.assertEqual(resp.status_code, 400)
                self.assertTrue((server.LESSONS_DIR / "keeper").is_dir())
                self.assertFalse((self.data / "pwned.txt").exists())

    def test_backslash_archive_member_is_rejected(self):
        # zipfile's Windows writer normalizes backslashes before writing, so
        # exercise the reader-side guard with the member shape Android/Linux
        # would expose for a hand-crafted archive.
        info = mock.Mock(filename="lessons\\evil\\lesson.json",
                         external_attr=0, flag_bits=0)
        info.is_dir.return_value = False
        archive = mock.Mock()
        archive.infolist.return_value = [info]
        with self.assertRaises(server.UnsafeBackupError):
            server.validate_backup_archive(archive)

    def test_symlink_and_casefold_duplicate_members_are_rejected(self):
        self.create_material(title="Keeper")
        self.configure()
        symlink_name = "lesson-library-backup-20260102-040000.zip"
        symlink = zipfile.ZipInfo("lessons/link/lesson.json")
        symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(self.dest / symlink_name, "w") as zf:
            zf.writestr(symlink, "target")
        duplicate_name = "lesson-library-backup-20260102-040001.zip"
        self.write_backup_file(duplicate_name, [
            ("lessons/Same/lesson.json", "{}"),
            ("lessons/same/LESSON.JSON", "{}"),
        ])
        for name in (symlink_name, duplicate_name):
            with self.subTest(name=name):
                resp = self.client.post(
                    "/api/backup/restore",
                    data={"backup_name": name, "strategy": "merge_overwrite"},
                    content_type="multipart/form-data")
                self.assertEqual(resp.status_code, 400)
                self.assertTrue((server.LESSONS_DIR / "keeper").is_dir())

    def test_corrupt_archive_is_a_400_and_leaves_library_intact(self):
        self.create_material(title="Keeper")
        self.configure()
        name = "lesson-library-backup-20260102-050000.zip"
        (self.dest / name).write_bytes(b"not a zip")
        resp = self.client.post(
            "/api/backup/restore",
            data={"backup_name": name, "strategy": "replace_all"},
            content_type="multipart/form-data")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue((server.LESSONS_DIR / "keeper").is_dir())

    def test_safety_backup_failure_aborts_before_live_changes(self):
        self.create_material(title="Shared")
        name = self.make_backup()
        self.client.post("/api/lessons/shared",
                         data={"title": "Shared", "notes": "keep me"},
                         content_type="multipart/form-data")
        with mock.patch.object(server, "perform_backup",
                               side_effect=OSError("destination unavailable")):
            resp = self.client.post(
                "/api/backup/restore",
                data={"backup_name": name, "strategy": "merge_overwrite"},
                content_type="multipart/form-data")
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(self.disk_json("shared")["notes"], "keep me")

    def test_merge_overwrite_rolls_back_if_install_fails(self):
        self.create_material(title="Alpha")
        self.create_material(title="Beta")
        name = self.make_backup()
        for lid in ("alpha", "beta"):
            self.client.post(
                "/api/lessons/" + lid,
                data={"title": lid.title(), "notes": "local " + lid},
                content_type="multipart/form-data")
        original = server._install_staged_path

        def fail_on_beta(source, target):
            if target.name == "beta":
                raise OSError("injected install failure")
            return original(source, target)

        with mock.patch.object(server, "_install_staged_path",
                               side_effect=fail_on_beta):
            resp = self.client.post(
                "/api/backup/restore",
                data={"backup_name": name, "strategy": "merge_overwrite"},
                content_type="multipart/form-data")
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(self.disk_json("alpha")["notes"], "local alpha")
        self.assertEqual(self.disk_json("beta")["notes"], "local beta")

    def test_replace_all_rolls_back_if_install_fails(self):
        self.create_material(title="Keeper")
        name = self.make_backup()
        self.create_material(title="Local only")
        original = server._install_staged_path

        def fail_on_plans(source, target):
            if target.name == "plans":
                raise OSError("injected install failure")
            return original(source, target)

        with mock.patch.object(server, "_install_staged_path",
                               side_effect=fail_on_plans):
            resp = self.client.post(
                "/api/backup/restore",
                data={"backup_name": name, "strategy": "replace_all"},
                content_type="multipart/form-data")
        self.assertEqual(resp.status_code, 500)
        self.assertTrue((server.LESSONS_DIR / "keeper").is_dir())
        self.assertTrue((server.LESSONS_DIR / "local-only").is_dir())

    def test_saf_bridge_streams_backup_paths_in_both_directions(self):
        source = self.data / "source.zip"
        source.write_bytes(b"streamed archive")

        class FakeBridge:
            written = None
            read = None

            @classmethod
            def writeBackupFileToUri(cls, path, name):
                cls.written = (path, name, Path(path).read_bytes())

            @classmethod
            def readBackupFileToPath(cls, name, path):
                cls.read = (name, path)
                Path(path).write_bytes(b"restored archive")

        cfg = {"destination_type": "saf",
               "destination_uri": "content://example/tree"}
        name = "lesson-library-backup-20260102-060000.zip"
        with mock.patch.object(server, "_saf_bridge",
                               return_value=FakeBridge):
            server.deliver_backup(cfg, source, name)
            materialized = server.materialize_backup(cfg, name)
        try:
            self.assertEqual(FakeBridge.written,
                             (str(source), name, b"streamed archive"))
            self.assertEqual(FakeBridge.read, (name, str(materialized)))
            self.assertEqual(materialized.read_bytes(), b"restored archive")
        finally:
            materialized.unlink(missing_ok=True)


class TestHealthAndMaintenance(LibraryTestCase):
    def test_health_reports_untagged_and_sizes(self):
        self.create_material(title="Tagged", topics=["Animals"],
                             files=[(io.BytesIO(b"12345"), "a.pdf")])
        self.client.post("/api/lessons", data={"title": "Bare"},
                         content_type="multipart/form-data")
        h = self.client.get("/api/health").get_json()
        self.assertEqual(h["materials"], 2)
        self.assertEqual(h["bytes"], 5)
        untagged = {u["title"]: u["missing"] for u in h["untagged"]}
        self.assertIn("Bare", untagged)
        self.assertIn("level", untagged["Bare"])
        # "Tagged" has level+skills+format+topics, so only Bare is listed
        self.assertNotIn("Tagged", untagged)

    def test_empty_trash_removes_everything(self):
        rec = self.create_material().get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/trash")
        h = self.client.get("/api/health").get_json()
        self.assertEqual(len(h["trash"]), 1)
        out = self.client.post("/api/trash/empty", data={},
                               content_type="multipart/form-data").get_json()
        self.assertEqual(out["removed"], 1)
        self.assertEqual(list(server.TRASH_DIR.iterdir()), [])

    def test_csv_export_includes_usage(self):
        rec = self.create_material(title="Exported").get_json()["lesson"]
        self.client.post("/api/lessons/" + rec["id"] + "/usage",
                         data={"date": "2026-06-01", "group": "g"},
                         content_type="multipart/form-data")
        resp = self.client.get("/api/export.csv")
        self.assertEqual(resp.status_code, 200)
        text = resp.get_data(as_text=True)
        self.assertIn("Exported", text)
        self.assertIn("2026-06-01", text)
        self.assertIn("attachment", resp.headers["Content-Disposition"])


class TestFileManagement(LibraryTestCase):
    """In-app rename / note (/files/edit), reorder, and single-file remove."""

    def make(self, names, notes=None):
        notes = notes if notes is not None else [""] * len(names)
        return self.create_material(
            files=[(io.BytesIO(n.encode()), n) for n in names],
            file_notes=json.dumps(notes),
        ).get_json()["lesson"]

    def edit(self, lid, old, name, note=None):
        data = {"old": old, "name": name}
        if note is not None:  # omit to keep the existing note (as the UI does)
            data["note"] = note
        return self.client.post(
            "/api/lessons/" + lid + "/files/edit",
            data=data, content_type="multipart/form-data")

    def reorder(self, lid, order):
        return self.client.post(
            "/api/lessons/" + lid + "/files/reorder",
            data={"order": json.dumps(order)},
            content_type="multipart/form-data")

    def names(self, rec):
        return [f["name"] for f in rec["files"]]

    # -- rename + note ------------------------------------------------------
    def test_rename_moves_file_keeps_note_and_rewrites_sidecar(self):
        rec = self.make(["messy 1.pdf"], ["handout"])
        out = self.edit(rec["id"], "messy 1.pdf", "Unit 4 reading.pdf").get_json()
        self.assertEqual(out["new"], "Unit 4 reading.pdf")
        folder = server.LESSONS_DIR / rec["id"]
        self.assertTrue((folder / "Unit 4 reading.pdf").exists())
        self.assertFalse((folder / "messy 1.pdf").exists())
        notes = {f["name"]: f["note"] for f in out["lesson"]["files"]}
        self.assertEqual(notes, {"Unit 4 reading.pdf": "handout"})
        disk = {f["name"]: f["note"] for f in self.disk_json(rec["id"])["files"]}
        self.assertEqual(disk, {"Unit 4 reading.pdf": "handout"})

    def test_note_only_edit_keeps_name(self):
        rec = self.make(["a.pdf"], ["old"])
        out = self.edit(rec["id"], "a.pdf", "a.pdf", "new note").get_json()
        self.assertEqual(out["old"], out["new"])
        self.assertEqual(out["lesson"]["files"][0]["note"], "new note")

    def test_rename_sanitizes_forbidden_chars(self):
        rec = self.make(["a.pdf"])
        out = self.edit(rec["id"], "a.pdf", "bad:name?.pdf").get_json()
        self.assertEqual(out["new"], "badname.pdf")
        self.assertTrue((server.LESSONS_DIR / rec["id"] / "badname.pdf").exists())

    def test_rename_collision_is_rejected(self):
        rec = self.make(["a.pdf", "b.pdf"])
        resp = self.edit(rec["id"], "a.pdf", "B.PDF")  # case-insensitive clash
        self.assertEqual(resp.status_code, 400)
        self.assertIn("already here", resp.get_json()["error"])
        self.assertTrue((server.LESSONS_DIR / rec["id"] / "a.pdf").exists())

    def test_rename_unknown_file_is_404(self):
        rec = self.make(["a.pdf"])
        self.assertEqual(self.edit(rec["id"], "ghost.pdf", "x.pdf").status_code, 404)

    def test_rename_empty_name_is_400(self):
        rec = self.make(["a.pdf"])
        self.assertEqual(self.edit(rec["id"], "a.pdf", "   ").status_code, 400)

    def test_case_only_rename_works(self):
        rec = self.make(["report.pdf"], ["r"])
        out = self.edit(rec["id"], "report.pdf", "Report.pdf").get_json()
        self.assertEqual(out["new"], "Report.pdf")
        kit = [p.name for p in (server.LESSONS_DIR / rec["id"]).iterdir()
               if p.name != "lesson.json"]
        self.assertEqual(kit, ["Report.pdf"])
        self.assertEqual(out["lesson"]["files"][0]["note"], "r")

    # -- reorder ------------------------------------------------------------
    def test_reorder_persists_and_survives_rescan(self):
        rec = self.make(["a.pdf", "b.pdf", "c.pdf"])
        order = ["c.pdf", "a.pdf", "b.pdf"]
        out = self.reorder(rec["id"], order).get_json()
        self.assertEqual(self.names(out["lesson"]), order)
        self.assertEqual([f["name"] for f in self.disk_json(rec["id"])["files"]],
                         order)
        with server.LOCK:
            server.STATE["lessons"] = {}
            server.STATE["needs"] = {}
        server.rebuild_index()
        again = server.STATE["lessons"][rec["id"]]
        self.assertEqual([f["name"] for f in again["files"]], order)

    def test_reorder_unmentioned_files_keep_tail(self):
        rec = self.make(["a.pdf", "b.pdf", "c.pdf"])
        out = self.reorder(rec["id"], ["c.pdf", "ghost.pdf"]).get_json()
        self.assertEqual(self.names(out["lesson"]), ["c.pdf", "a.pdf", "b.pdf"])

    def test_added_file_keeps_custom_order_and_lands_last(self):
        rec = self.make(["a.pdf", "b.pdf"])
        self.reorder(rec["id"], ["b.pdf", "a.pdf"])
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files",
            data={"files": [(io.BytesIO(b"z"), "z.pdf")]},
            content_type="multipart/form-data").get_json()
        self.assertEqual(self.names(out["lesson"]), ["b.pdf", "a.pdf", "z.pdf"])

    # -- remove a single file (to-inbox) ------------------------------------
    def test_remove_one_file_returns_inbox_names_and_can_be_undone(self):
        rec = self.make(["a.pdf", "b.pdf"], ["na", "nb"])
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/to-inbox",
            data={"names": json.dumps(["a.pdf"])},
            content_type="multipart/form-data").get_json()
        self.assertEqual(out["moved"], ["a.pdf"])
        self.assertEqual(out["inbox_names"], ["a.pdf"])
        self.assertTrue((server.INBOX_DIR / "a.pdf").exists())
        self.assertEqual(self.names(out["lesson"]), ["b.pdf"])
        back = self.client.post(
            "/api/lessons/" + rec["id"] + "/inbox",
            data={"inbox_files": json.dumps(["a.pdf"]),
                  "inbox_notes": json.dumps({"a.pdf": "na"})},
            content_type="multipart/form-data").get_json()["lesson"]
        notes = {f["name"]: f["note"] for f in back["files"]}
        self.assertEqual(notes.get("a.pdf"), "na")

    def test_remove_dedupes_inbox_name_on_collision(self):
        (server.INBOX_DIR / "a.pdf").write_bytes(b"existing")
        rec = self.make(["a.pdf"])
        out = self.client.post(
            "/api/lessons/" + rec["id"] + "/files/to-inbox",
            data={"names": json.dumps(["a.pdf"])},
            content_type="multipart/form-data").get_json()
        self.assertEqual(out["inbox_names"], ["a (2).pdf"])
        self.assertTrue((server.INBOX_DIR / "a (2).pdf").exists())

    # -- v1 sidecar is unaffected by the ordering change --------------------
    def test_v1_sidecar_orders_alphabetically_and_is_not_rewritten(self):
        folder = self.write_folder(
            "legacy", meta={"title": "Legacy", "files": ["b.pdf", "a.pdf"]},
            files=[("b.pdf", b"b"), ("a.pdf", b"a")])
        before = (folder / "lesson.json").read_text(encoding="utf-8")
        with server.LOCK:
            server.STATE["lessons"] = {}
            server.STATE["needs"] = {}
        server.rebuild_index()
        rec = server.STATE["lessons"]["legacy"]
        self.assertEqual([f["name"] for f in rec["files"]], ["a.pdf", "b.pdf"])
        self.assertEqual((folder / "lesson.json").read_text(encoding="utf-8"),
                         before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
