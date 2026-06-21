"use strict";

// Material Library frontend. The server hands us the WHOLE index in one
// payload; every search/filter below runs locally, so results are instant.
// (The /api/lessons routes and the "lessons" payload key are legacy storage
// contracts from schema v1 — the records they carry are materials.)

let DB = null;

const COMPACT_FACETS = [
  ["age_groups", "Age"],
  ["cefr_levels", "CEFR"],
  ["skills", "Skills"],
  ["formats", "Format"],
  ["exam_targets", "Exam"],
];

const MORE_FACETS = [
  ["grammar_points", "Grammar"],
  ["vocab_focuses", "Vocabulary"],
  ["topics", "Topic"],
  ["themes", "Theme"],
];

const ARRAY_SEARCH_FIELDS = ["grammar_points", "vocab_focuses",
                             "topics", "themes"];

const filters = { q: "" };
for (const [key] of [...COMPACT_FACETS, ...MORE_FACETS]) {
  filters[key] = new Set();
}
let moreOpen = false;
let sortMode = "new";          // "new" | "az" | "used"
let lastView = null;           // for list scroll restoration
let listScroll = 0;
let pickSearch = "";           // search text inside the plan material picker

function lsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { /* private mode */ }
}
let filtersOpen = true;        // filter panel on the list view (session only)
let listLayout = lsGet("mlib-list-layout") === "grid" ? "grid" : "list";
let fileLayout = lsGet("mlib-file-layout") === "grid" ? "grid" : "list";
let hideKeys = lsGet("mlib-hide-keys") === "1";   // hide answer-key files (Feature D)

const view = document.getElementById("view");
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- inline SVG icon set (Lucide-style, stroke-based, no emoji) ---- */
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  sliders: '<line x1="21" y1="5" x2="14" y2="5"/><line x1="10" y1="5" x2="3" y2="5"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="19" x2="16" y2="19"/><line x1="12" y1="19" x2="3" y2="19"/><line x1="14" y1="3" x2="14" y2="7"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="17" x2="16" y2="21"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  calcheck: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6"/>',
  filetext: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 9v12"/>',
  slides: '<path d="M2 3h20"/><rect x="4" y="3" width="16" height="13" rx="1"/><path d="m9 21 3-5 3 5"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  tags: '<path d="m9 5 10.5 10.5a2.1 2.1 0 0 1 0 3L16 22a2.1 2.1 0 0 1-3 0L2.5 11.5V5a2 2 0 0 1 2-2H11Z" transform="translate(1,0) scale(.92)"/><circle cx="7.5" cy="7.5" r=".5"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.3" cy="8.3" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.7" cy="8.3" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.3" cy="15.7" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15.7" r="1.4" fill="currentColor" stroke="none"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  circlecheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  calplus: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M12 14v6"/><path d="M9 17h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  rows: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  funnel: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  play: '<path d="m6 3 14 9-14 9V3Z"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  rescan: '<path d="M21 12a9 9 0 1 1-2.6-6.3L21 8"/><path d="M21 3v5h-5"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 1 0 6 15.9"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/>',
  cloudup: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 1 0 6 15.9"/><path d="M12 21v-9"/><path d="m8 16 4-4 4 4"/>',
  timer: '<line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/>',
  shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.7 3.2-1.8l6.8-10.4c.7-1.1 1.9-1.8 3.2-1.8H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M14.5 15.8c.7 1.3 2.1 2.2 3.6 2.2H22"/><path d="m18 14 4 4-4 4"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
};

function icon(name, cls) {
  return `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${ICONS[name] || ICONS.file}</svg>`;
}

/* ---- star ratings (Feature A): filled vs outline, inline SVG only ---- */
function starSVG(filled) {
  return `<svg class="star${filled ? " on" : ""}" viewBox="0 0 24 24" ` +
    `fill="${filled ? "currentColor" : "none"}" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${ICONS.star}</svg>`;
}

function starsHTML(rating) {
  const r = rating || 0;
  let s = "";
  for (let i = 1; i <= 5; i++) s += starSVG(i <= r);
  return `<span class="stars" aria-label="${r ? r + " out of 5 stars" : "no rating"}">${s}</span>`;
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp|svg|bmp|heic)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

/* ---- per-file component roles (Feature D) ---- */
const ROLE_ICONS = {
  "student handout": "filetext", "teacher notes": "pencil",
  "answer key": "circlecheck", "audio": "music", "slides": "slides",
  "cards": "sheet", "other": "file",
};
function roleIcon(role) {
  return ROLE_ICONS[String(role || "").toLowerCase()] || "tags";
}
function isAnswerKey(f) {
  return String(f.role || "").toLowerCase() === "answer key";
}
function isAudioRole(f) {
  return String(f.role || "").toLowerCase() === "audio" || AUDIO_RE.test(f.name);
}

const FILE_KINDS = [
  [/\.(pdf|docx?|txt|rtf|odt|md)$/i, "filetext", ""],
  [/\.(pptx?|odp|key)$/i, "slides", ""],
  [/\.(xlsx?|csv|ods)$/i, "sheet", "ft-sheet"],
  [IMAGE_RE, "image", "ft-img"],
  [/\.(mp3|wav|ogg|m4a|flac|aac)$/i, "music", "ft-av"],
  [/\.(mp4|mkv|webm|mov|avi)$/i, "video", "ft-av"],
  [/\.(zip|rar|7z|tar|gz)$/i, "archive", "ft-zip"],
];

function fileTileHTML(name, lid) {
  if (lid && IMAGE_RE.test(name)) {
    return `<img class="fthumb" loading="lazy" alt=""
      src="/files/${encodeURIComponent(lid)}/${encodeURIComponent(name)}">`;
  }
  for (const [re, ic, cls] of FILE_KINDS) {
    if (re.test(name)) return `<span class="ftile ${cls}">${icon(ic)}</span>`;
  }
  return `<span class="ftile">${icon("file")}</span>`;
}

function fileURL(lid, name) {
  return "/files/" + encodeURIComponent(lid) + "/" + encodeURIComponent(name);
}

/* ---- material thumbnails: first image in the folder, or a gradient
   placeholder tile carrying the material's format icon ---- */
function firstImageName(m) {
  for (const f of m.files || []) {
    if (IMAGE_RE.test(f.name)) return f.name;
  }
  return null;
}

const FORMAT_ICONS = {
  "slides": "slides", "worksheet": "filetext", "flashcards": "image",
  "cut-up cards": "sheet", "html game": "dice",
};

function materialIcon(m) {
  for (const fm of m.formats || []) {
    const ic = FORMAT_ICONS[String(fm).toLowerCase()];
    if (ic) return ic;
  }
  const f = (m.files || [])[0];
  if (f) {
    for (const [re, ic] of FILE_KINDS) {
      if (re.test(f.name)) return ic;
    }
  }
  return "folder";
}

function cardThumbHTML(m) {
  const img = firstImageName(m);
  if (img) {
    return `<img class="cthumb" loading="lazy" alt="" src="${fileURL(m.id, img)}">`;
  }
  return `<span class="cthumb cthumb-ph" aria-hidden="true">${icon(materialIcon(m))}</span>`;
}

function heroThumbHTML(m) {
  const img = firstImageName(m);
  if (img) {
    return `<img class="herothumb" loading="lazy" alt="" src="${fileURL(m.id, img)}">`;
  }
  return `<span class="herothumb cthumb-ph" aria-hidden="true">${icon(materialIcon(m))}</span>`;
}

/* ---- file-type categories for the detail-view filter chips ---- */
const FILE_KIND_CHIPS = [
  ["docs", "Docs", "filetext", /\.(pdf|docx?|txt|rtf|odt|md)$/i],
  ["slides", "Slides", "slides", /\.(pptx?|odp|key)$/i],
  ["sheets", "Sheets", "sheet", /\.(xlsx?|csv|ods)$/i],
  ["images", "Images", "image", IMAGE_RE],
  ["audio", "Audio", "music", /\.(mp3|wav|ogg|m4a|flac|aac)$/i],
  ["video", "Video", "video", /\.(mp4|mkv|webm|mov|avi)$/i],
  ["archives", "Archives", "archive", /\.(zip|rar|7z|tar|gz)$/i],
];

function fileKind(name) {
  for (const [key, , , re] of FILE_KIND_CHIPS) {
    if (re.test(name)) return key;
  }
  return "other";
}

function fileExtLabel(name) {
  const m = String(name).match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : "";
}

function fmtSize(n) {
  if (typeof n !== "number") return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}

function relDate(iso) {
  if (!iso) return "";
  const then = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(then)) return iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return days + " days ago";
  if (days < 60) return Math.round(days / 7) + " wk ago";
  if (days < 365) return Math.round(days / 30) + " mo ago";
  return Math.round(days / 365) + " yr ago";
}

function lastUsed(m) {
  let max = "";
  for (const u of m.usage || []) {
    if (u.date > max) max = u.date;
  }
  return max;
}

/* ---- theme (auto from system, manual override persisted) ---- */
const THEME_KEY = "mlib-theme";

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const meta = $("#thememeta");
  if (meta) meta.content = t === "dark" ? "#000000" : "#F6F4FC";
}

function themePref() {
  return storedTheme() || "system";
}

function setThemePref(pref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch (e) { /* private mode */ }
  const sys = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(pref === "system" ? (sys.matches ? "dark" : "light") : pref);
}

function initTheme() {
  const sys = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(storedTheme() || (sys.matches ? "dark" : "light"));
  sys.addEventListener("change", e => {
    if (!storedTheme()) applyTheme(e.matches ? "dark" : "light");
  });
}

/* ---- toasts (replace alert(); polite so they don't steal focus) ----
   opts.actions: [{label, onClick}] — e.g. View / Undo after an import.
   Action toasts stay longer so there's time to actually tap them. */
function toast(msg, type = "ok", opts) {
  const wrap = $("#toasts");
  const t = document.createElement("div");
  t.className = "toast " + type;
  const actions = (opts && opts.actions) || [];
  t.innerHTML = icon(type === "error" ? "alert" : "check") +
    `<span>${esc(msg)}</span>` +
    (actions.length ? `<span class="toastbtns">${actions.map((a, i) =>
      `<button type="button" class="toastbtn" data-i="${i}">${esc(a.label)}</button>`)
      .join("")}</span>` : "");
  let timer = null;
  function dismiss() {
    clearTimeout(timer);
    t.classList.add("out");
    setTimeout(() => t.remove(), 200);
  }
  if (actions.length) {
    t.addEventListener("click", e => {
      const btn = e.target.closest(".toastbtn");
      if (!btn) return;
      dismiss();
      actions[+btn.dataset.i].onClick();
    });
  }
  wrap.appendChild(t);
  timer = setTimeout(dismiss, (opts && opts.duration) || (actions.length ? 8000 : 4000));
}

/* ---- dialog helpers ---- */
function openDialog(dlg) {
  if (!dlg || typeof dlg.showModal !== "function") return false;
  dlg.showModal();
  return true;
}

function confirmDialog({ title, message, confirmLabel }) {
  const dlg = $("#confirmdlg");
  if (!dlg || typeof dlg.showModal !== "function") {
    return Promise.resolve(window.confirm(title + "\n\n" + message));
  }
  $("#cd-title").textContent = title;
  $("#cd-msg").textContent = message;
  $("#cd-ok").textContent = confirmLabel || "Delete";
  return new Promise(resolve => {
    const ok = $("#cd-ok"), cancel = $("#cd-cancel");
    function finish(val) {
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onEsc);
      if (dlg.open) dlg.close();
      resolve(val);
    }
    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onEsc(e) { e.preventDefault(); finish(false); }
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onEsc);
    dlg.showModal();
  });
}

function fillGroupsDatalist() {
  const groups = new Set();
  for (const m of DB.lessons) {
    for (const u of m.usage || []) {
      if (u.group) groups.add(u.group);
    }
  }
  for (const p of DB.plans || []) {
    if (p.group) groups.add(p.group);
  }
  $("#groupsdl").innerHTML = [...groups].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(g => `<option value="${esc(g)}">`).join("");
}

function fillRolesDatalist() {
  const el = $("#rolesdl");
  if (!el) return;
  const roles = [];
  for (const g of (DB && DB.file_roles) || []) {
    for (const o of g.options || []) roles.push(o);
  }
  el.innerHTML = roles.map(r => `<option value="${esc(r)}">`).join("");
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
  return data;
}

function formBody(obj) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    fd.append(k, v == null ? "" : v);
  }
  return fd;
}

// XHR instead of fetch so big uploads get a progress percentage.
function upload(url, fd, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || "HTTP " + xhr.status));
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(fd);
  });
}

async function refresh() { DB = await api("/api/lessons"); }

/* ---- rescan: manual (Settings, pull-to-refresh) and automatic (on
   returning to the app). Auto runs silently and only on views with no
   user input to lose. ---- */
let lastScanTs = 0;

async function rescan(opts) {
  DB = await api("/api/rescan", { method: "POST" });
  lastScanTs = Date.now();
  render();
  if (!opts || !opts.silent) {
    toast(`Library rescanned — ${DB.lessons.length} material${DB.lessons.length === 1 ? "" : "s"}`);
  }
}

const AUTO_RESCAN_VIEWS = ["list", "plans", "inbox", "settings", "health",
                           "lesson", "plan"];

function replaceMaterial(rec) {
  const i = DB.lessons.findIndex(m => m.id === rec.id);
  if (i >= 0) DB.lessons[i] = rec; else DB.lessons.push(rec);
  return rec;
}

function replacePlan(plan) {
  const i = (DB.plans || []).findIndex(p => p.id === plan.id);
  if (i >= 0) DB.plans[i] = plan; else (DB.plans = DB.plans || []).push(plan);
  return plan;
}

/* ---- sharing (Android bridge -> Web Share -> external viewer) ---- */
async function shareFile(lid, name) {
  if (window.MLBridge && typeof MLBridge.shareFile === "function") {
    MLBridge.shareFile(lid, name);
    return;
  }
  const url = fileURL(lid, name);
  if (navigator.share) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], name,
        { type: blob.type || "application/octet-stream" });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  window.open(url, "_blank");
  toast("Opening the file — share it from that app");
}

async function shareFiles(lid, names) {
  if (!names.length) return;
  if (names.length === 1) { shareFile(lid, names[0]); return; }
  if (window.MLBridge && typeof MLBridge.shareFiles === "function") {
    MLBridge.shareFiles(lid, JSON.stringify(names));
    return;
  }
  if (navigator.share) {
    try {
      const files = [];
      for (const name of names) {
        const res = await fetch(fileURL(lid, name));
        const blob = await res.blob();
        files.push(new File([blob], name,
          { type: blob.type || "application/octet-stream" }));
      }
      if (!navigator.canShare || navigator.canShare({ files })) {
        await navigator.share({ files });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  toast("This browser can't share several files at once — sharing the first one");
  shareFile(lid, names[0]);
}

/* The hero Share button never silently picks a file: one attachment is
   unambiguous and shares directly, anything more opens this picker. */
function openShareSheet(m) {
  const files = m.files || [];
  if (!files.length) return;
  if (files.length === 1) { shareFile(m.id, files[0].name); return; }
  const dlg = $("#sharesheet");
  if (!openDialog(dlg)) { shareFile(m.id, files[0].name); return; }
  $("#sh-mat").textContent = m.title;
  $("#sh-list").innerHTML = files.map(f => `
    <label class="sharerow">
      <input type="checkbox" checked data-name="${esc(f.name)}">
      ${fileTileHTML(f.name, m.id)}
      <span class="fcol"><span class="fname">${esc(f.name)}</span></span>
      <span class="fsize">${fmtSize(f.size)}</span>
    </label>`).join("");
  const okBtn = $("#sh-ok");
  function selected() {
    return $$("#sh-list input:checked").map(cb => cb.dataset.name);
  }
  function updateBtn() {
    const n = selected().length;
    okBtn.textContent = n ? `Share ${n} file${n === 1 ? "" : "s"}` : "Share";
    okBtn.disabled = !n;
  }
  updateBtn();
  function cleanup() {
    $("#sh-list").removeEventListener("change", updateBtn);
    okBtn.removeEventListener("click", onOk);
    $("#sh-cancel").removeEventListener("click", onCancel);
    dlg.removeEventListener("cancel", onEsc);
    if (dlg.open) dlg.close();
  }
  function onOk() {
    const names = selected();
    cleanup();
    shareFiles(m.id, names);
  }
  function onCancel() { cleanup(); }
  function onEsc(e) { e.preventDefault(); cleanup(); }
  $("#sh-list").addEventListener("change", updateBtn);
  okBtn.addEventListener("click", onOk);
  $("#sh-cancel").addEventListener("click", onCancel);
  dlg.addEventListener("cancel", onEsc);
}

/* ---- usage logging ---- */
async function postUsage(mid, entry) {
  const out = await api("/api/lessons/" + encodeURIComponent(mid) + "/usage",
    { method: "POST", body: formBody(entry) });
  return replaceMaterial(out.lesson);
}

async function deleteUsage(mid, index) {
  const out = await api("/api/lessons/" + encodeURIComponent(mid) +
    "/usage/delete", { method: "POST", body: formBody({ index }) });
  return replaceMaterial(out.lesson);
}

/* Feature A: write the reflection trio onto an existing usage entry. */
async function saveReflection(mid, index, fields) {
  const out = await api("/api/lessons/" + encodeURIComponent(mid) +
    "/usage/update", { method: "POST", body: formBody({
      index,
      rating: fields.rating == null ? "" : fields.rating,
      reflection: fields.reflection || "",
      needs_revision: fields.needs_revision ? "true" : "false",
    }) });
  return replaceMaterial(out.lesson);
}

// Lightweight reflection sheet. Resolves {rating, reflection, needs_revision}
// on Save, or null on Skip / dismiss.
function openReflectDialog(material, preset) {
  const dlg = $("#reflectdlg");
  if (!openDialog(dlg)) return Promise.resolve(null);
  preset = preset || {};
  $("#rf-heading").textContent = preset.editing ? "Edit reflection" : "Quick reflection";
  $("#rf-mat").textContent = material.title;
  let rating = preset.rating || 0;
  const starsEl = $("#rf-stars");
  function paintStars() {
    starsEl.innerHTML = [1, 2, 3, 4, 5].map(i =>
      `<button type="button" class="starbtn${i <= rating ? " on" : ""}"
               data-star="${i}" role="radio" aria-checked="${i === rating}"
               aria-label="${i} star${i === 1 ? "" : "s"}">${starSVG(i <= rating)}</button>`).join("");
  }
  paintStars();
  $("#rf-note").value = preset.reflection || "";
  $("#rf-revision").checked = !!preset.needs_revision;
  $("#rf-skip").textContent = preset.editing ? "Cancel" : "Skip";
  return new Promise(resolve => {
    const form = $("#rf-form"), skip = $("#rf-skip");
    function onStars(e) {
      const b = e.target.closest("[data-star]");
      if (!b) return;
      const v = +b.dataset.star;
      rating = v === rating ? 0 : v;  // tap the same star again to clear
      paintStars();
    }
    function finish(val) {
      starsEl.removeEventListener("click", onStars);
      form.removeEventListener("submit", onSubmit);
      skip.removeEventListener("click", onSkip);
      dlg.removeEventListener("cancel", onEsc);
      if (dlg.open) dlg.close();
      resolve(val);
    }
    function onSubmit(e) {
      e.preventDefault();
      finish({ rating: rating || null,
               reflection: $("#rf-note").value.trim(),
               needs_revision: $("#rf-revision").checked });
    }
    function onSkip() { finish(null); }
    function onEsc(e) { e.preventDefault(); finish(null); }
    starsEl.addEventListener("click", onStars);
    form.addEventListener("submit", onSubmit);
    skip.addEventListener("click", onSkip);
    dlg.addEventListener("cancel", onEsc);
  });
}

// Open the reflection sheet for a material's usage entry, then persist.
async function reflectOnEntry(material, index, preset) {
  const fresh = DB.lessons.find(x => x.id === material.id) || material;
  const fields = await openReflectDialog(fresh, preset);
  if (!fields) return false;
  try {
    await saveReflection(material.id, index, fields);
    toast("Reflection saved");
    return true;
  } catch (err) {
    toast("Could not save reflection: " + err.message, "error");
    return false;
  }
}

function openUsageDialog(material, preset) {
  const dlg = $("#usagedlg");
  if (!openDialog(dlg)) return Promise.resolve(null);
  fillGroupsDatalist();
  $("#ud-mat").textContent = material.title;
  $("#ud-date").value = todayISO();
  $("#ud-group").value = (preset && preset.group) || "";
  $("#ud-note").value = "";
  return new Promise(resolve => {
    const form = $("#ud-form"), cancel = $("#ud-cancel");
    function finish(val) {
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onEsc);
      if (dlg.open) dlg.close();
      resolve(val);
    }
    function onSubmit(e) {
      e.preventDefault();
      finish({ date: $("#ud-date").value || todayISO(),
               group: $("#ud-group").value.trim(),
               note: $("#ud-note").value.trim() });
    }
    function onCancel() { finish(null); }
    function onEsc(e) { e.preventDefault(); finish(null); }
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onEsc);
  });
}

// Resolves {name, note} on Save, {remove:true} on Remove, or null on cancel.
function openFileEditDialog(file) {
  const dlg = $("#fileeditdlg");
  if (!openDialog(dlg)) {
    const name = window.prompt("File name", file.name);
    if (name == null) return Promise.resolve(null);
    return Promise.resolve({ name: name.trim() || file.name, note: file.note || "" });
  }
  fillRolesDatalist();
  $("#fe-name").value = file.name;
  $("#fe-note").value = file.note || "";
  $("#fe-role").value = file.role || "";
  $("#fe-transcript").value = file.transcript || "";
  // the transcript field only makes sense for audio (or anything already
  // carrying one) — keep the dialog tidy for documents
  $("#fe-transcript-field").hidden = !(isAudioRole(file) || file.transcript);
  const nameEl = $("#fe-name");
  nameEl.focus();
  // place the caret before the extension so the readable part is easiest to fix
  const dot = file.name.lastIndexOf(".");
  try { nameEl.setSelectionRange(0, dot > 0 ? dot : file.name.length); } catch (e) { /* type=text only */ }
  return new Promise(resolve => {
    const form = $("#fe-form"), cancel = $("#fe-cancel"), remove = $("#fe-remove");
    const roleEl = $("#fe-role");
    function syncTranscript() {
      $("#fe-transcript-field").hidden =
        !(String(roleEl.value).toLowerCase() === "audio"
          || AUDIO_RE.test(file.name) || $("#fe-transcript").value.trim());
    }
    function finish(val) {
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      remove.removeEventListener("click", onRemove);
      roleEl.removeEventListener("input", syncTranscript);
      dlg.removeEventListener("cancel", onEsc);
      if (dlg.open) dlg.close();
      resolve(val);
    }
    function onSubmit(e) {
      e.preventDefault();
      const name = $("#fe-name").value.trim();
      if (!name) { $("#fe-name").focus(); return; }
      finish({ name: name, note: $("#fe-note").value.trim(),
               role: $("#fe-role").value.trim(),
               transcript: $("#fe-transcript").value.trim() });
    }
    roleEl.addEventListener("input", syncTranscript);
    function onCancel() { finish(null); }
    function onRemove() { finish({ remove: true }); }
    function onEsc(e) { e.preventDefault(); finish(null); }
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    remove.addEventListener("click", onRemove);
    dlg.addEventListener("cancel", onEsc);
  });
}

/* ---- plans ---- */
async function savePlan(plan) {
  const out = await api("/api/plans/" + encodeURIComponent(plan.id), {
    method: "POST",
    body: formBody({
      title: plan.title, group: plan.group || "",
      plan_date: plan.plan_date || "", notes: plan.notes || "",
      items: JSON.stringify(plan.items || []),
      stage_durations: JSON.stringify(plan.stage_durations || {}),
    }),
  });
  return replacePlan(out.plan);
}

function openPlanDialog(plan) {
  const dlg = $("#plandlg");
  if (!openDialog(dlg)) return Promise.resolve(null);
  fillGroupsDatalist();
  const editing = !!plan;
  $("#pd-heading").textContent = editing ? "Edit plan" : "New plan";
  $("#pd-save").textContent = editing ? "Save" : "Create";
  $("#pd-name").value = editing ? plan.title : "";
  $("#pd-group").value = editing ? plan.group : "";
  $("#pd-date").value = editing && /^\d{4}-\d{2}-\d{2}$/.test(plan.plan_date)
    ? plan.plan_date : "";
  $("#pd-notes").value = editing ? plan.notes : "";
  return new Promise(resolve => {
    const form = $("#pd-form"), cancel = $("#pd-cancel");
    function finish(val) {
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onEsc);
      if (dlg.open) dlg.close();
      resolve(val);
    }
    function onSubmit(e) {
      e.preventDefault();
      const title = $("#pd-name").value.trim();
      if (!title) return;
      finish({ title, group: $("#pd-group").value.trim(),
               plan_date: $("#pd-date").value,
               notes: $("#pd-notes").value.trim() });
    }
    function onCancel() { finish(null); }
    function onEsc(e) { e.preventDefault(); finish(null); }
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onEsc);
  });
}

async function createPlanFlow(firstMaterialId) {
  const meta = await openPlanDialog(null);
  if (!meta) return null;
  const body = formBody({ ...meta,
    items: JSON.stringify(firstMaterialId
      ? [{ material_id: firstMaterialId, done: false, note: "" }] : []) });
  try {
    const out = await api("/api/plans", { method: "POST", body });
    replacePlan(out.plan);
    toast(`Plan “${out.plan.title}” created`);
    return out.plan;
  } catch (err) {
    toast("Could not create plan: " + err.message, "error");
    return null;
  }
}

function openPlanSheet(material) {
  const dlg = $("#plansheet");
  if (!openDialog(dlg)) return;
  $("#ps-mat").textContent = material.title;
  const plans = DB.plans || [];
  $("#ps-list").innerHTML = plans.length ? plans.map(p => {
    const inPlan = p.items.some(it => it.material_id === material.id);
    return `<button type="button" class="sheetrow" data-pid="${esc(p.id)}"
                    ${inPlan ? "disabled" : ""}>
      ${icon(inPlan ? "circlecheck" : "calcheck")}
      <span class="srcol"><span class="srtitle">${esc(p.title)}</span>
        <span class="srsub">${esc([p.group, fmtDate(p.plan_date)]
          .filter(Boolean).join(" · ") || p.items.length + " item(s)")}</span></span>
      ${inPlan ? `<span class="srflag">added</span>` : ""}
    </button>`;
  }).join("") : `<p class="hint">No plans yet — create your first one.</p>`;

  function cleanup() {
    $("#ps-list").removeEventListener("click", onPick);
    $("#ps-cancel").removeEventListener("click", onCancel);
    $("#ps-new").removeEventListener("click", onNew);
    dlg.removeEventListener("cancel", onEsc);
    if (dlg.open) dlg.close();
  }
  async function onPick(e) {
    const row = e.target.closest(".sheetrow[data-pid]");
    if (!row || row.disabled) return;
    const plan = (DB.plans || []).find(p => p.id === row.dataset.pid);
    if (!plan) return;
    cleanup();
    plan.items.push({ material_id: material.id, done: false, note: "" });
    try {
      await savePlan(plan);
      toast(`Added to “${plan.title}”`);
    } catch (err) {
      toast("Could not update plan: " + err.message, "error");
    }
  }
  function onCancel() { cleanup(); }
  function onEsc(e) { e.preventDefault(); cleanup(); }
  async function onNew() {
    cleanup();
    const plan = await createPlanFlow(material.id);
    if (plan) location.hash = "#/plan/" + encodeURIComponent(plan.id);
  }
  $("#ps-list").addEventListener("click", onPick);
  $("#ps-cancel").addEventListener("click", onCancel);
  $("#ps-new").addEventListener("click", onNew);
  dlg.addEventListener("cancel", onEsc);
}

/* ---- lightbox ---- */
function openLightbox(lid, name) {
  const dlg = $("#lightbox");
  const url = fileURL(lid, name);
  if (!openDialog(dlg)) { window.open(url, "_blank"); return; }
  $("#lb-img").src = url;
  $("#lb-name").textContent = name;
  $("#lb-open").href = url;
  $("#lb-share").onclick = () => shareFile(lid, name);
  $("#lb-close").onclick = () => dlg.close();
  $("#lb-img").onclick = () => dlg.close();
}

// ---- routing (hash-based so the Android back button works) ----
function route() {
  const h = location.hash || "#/";
  if (h === "#/add") return { view: "add" };
  if (h === "#/plans") return { view: "plans" };
  if (h === "#/reflections") return { view: "reflections" };
  if (h === "#/inbox") return { view: "inbox" };
  if (h === "#/settings") return { view: "settings" };
  if (h === "#/health") return { view: "health" };
  let m = h.match(/^#\/plan\/([^/]+)(\/pick|\/run)?$/);
  if (m) {
    let id = m[1];
    try { id = decodeURIComponent(id); } catch (e) { /* raw % */ }
    return { view: m[2] === "/pick" ? "pick" : m[2] === "/run" ? "run" : "plan", id };
  }
  m = h.match(/^#\/(lesson|edit|repair)\/(.+)$/);
  if (m) {
    let id = m[2];
    try { id = decodeURIComponent(id); } catch (e) { /* raw % in a hand-typed hash */ }
    return { view: m[1], id };
  }
  return { view: "list" };
}

const NAV_GROUP = {
  list: "library", lesson: "library", add: "library", edit: "library",
  repair: "library", plans: "plans", plan: "plans", pick: "plans",
  run: "plans", reflections: "reflections", inbox: "inbox",
  health: "settings", settings: "settings",
};

function updateInboxBadge() {
  const badge = $("#inboxbadge");
  if (!badge || !DB) return;
  const n = (DB.inbox || []).length;
  badge.textContent = n > 9 ? "9+" : n;
  badge.hidden = !n;
}

function configureChrome(r) {
  document.body.dataset.view = r.view;
  const group = NAV_GROUP[r.view] || "library";
  $$(".bottomnav a").forEach(a =>
    a.classList.toggle("on", a.dataset.nav === group));
  const label = $("#fablabel");
  if (r.view === "list") label.textContent = "Add material";
  else if (r.view === "plans") label.textContent = "New plan";
  updateInboxBadge();
}

let _runTicker = null;   // the single run-mode countdown interval (Feature B)
function stopRunTicker() {
  if (_runTicker) { clearInterval(_runTicker); _runTicker = null; }
}

function render() {
  if (!DB) return;
  stopRunTicker();  // leaving any view tears down a running class timer
  const r = route();
  if (lastView === "list" && r.view !== "list") listScroll = window.scrollY;
  configureChrome(r);
  view.classList.remove("view-enter");
  void view.offsetWidth; // restart the enter animation
  view.classList.add("view-enter");
  if (r.view === "list") {
    renderList();
    window.scrollTo(0, lastView && lastView !== "list" ? listScroll : 0);
  } else {
    if (r.view === "lesson") renderDetail(r.id);
    else if (r.view === "plans") renderPlans();
    else if (r.view === "plan") renderPlan(r.id);
    else if (r.view === "pick") renderPick(r.id);
    else if (r.view === "run") renderRun(r.id);
    else if (r.view === "reflections") renderReflections();
    else if (r.view === "inbox") renderInbox();
    else if (r.view === "settings") renderSettings();
    else if (r.view === "health") renderHealth();
    else renderForm(r);
    window.scrollTo(0, 0);
  }
  lastView = r.view;
}

// ---- option helpers: canonical lists plus anything in use ----
function inUseValues(field) {
  const seen = new Map();
  for (const m of DB.lessons) {
    for (const v of m[field] || []) {
      const k = v.toLowerCase();
      if (!seen.has(k)) seen.set(k, v);
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()));
}

function withInUse(base, field) {
  const out = [...base];
  for (const v of inUseValues(field)) {
    if (!out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

function filterOptions() {
  return {
    age_groups: withInUse(DB.options.age_groups, "age_groups"),
    cefr_levels: withInUse(DB.options.cefr_levels, "cefr_levels"),
    skills: withInUse(DB.options.skills, "skills"),
    formats: withInUse(DB.options.formats, "formats"),
    exam_targets: inUseValues("exam_targets"),
  };
}

// ---- reusable searchable multi-select combobox ----
// One component for CEFR, exams, grammar, vocabulary, topics, themes —
// and for the "More filters" pickers. Native <select> is unusable for
// catalogs this size on a phone and cannot take custom values.
function combobox({ key, label, helper, groups, selected, allowCustom,
                    placeholder, onChange }) {
  const values = [];
  const el = document.createElement("div");
  el.className = "field cbx";
  el.dataset.key = key;
  el.innerHTML = `
    ${label ? `<span>${esc(label)}</span>` : ""}
    <div class="cbx-box">
      <div class="cbx-chips"></div>
      <input type="text" autocomplete="off" autocapitalize="off"
             placeholder="${esc(placeholder || "Tap to search…")}">
    </div>
    <div class="cbx-panel" hidden></div>
    ${helper ? `<div class="hint">${esc(helper)}</div>` : ""}`;
  const input = $(".cbx-box input", el);
  const chipsEl = $(".cbx-chips", el);
  const panel = $(".cbx-panel", el);

  const has = v => values.some(x => x.toLowerCase() === v.toLowerCase());

  function snapToCatalog(v) {
    for (const g of groups) {
      for (const o of g.options) {
        if (o.toLowerCase() === v.toLowerCase()) return o;
      }
    }
    return v;
  }

  function renderChips() {
    chipsEl.innerHTML = values.map(v => `
      <span class="cbx-chip">${esc(v)}<button type="button" class="cbx-x"
        data-v="${esc(v)}" aria-label="Remove ${esc(v)}">×</button></span>`).join("");
  }

  function renderPanel() {
    const typed = input.value.trim().replace(/\s+/g, " ");
    const q = typed.toLowerCase();
    let html = "";
    let exact = has(typed);
    for (const g of groups) {
      const opts = g.options.filter(o =>
        !has(o) && (!q || o.toLowerCase().includes(q)));
      if (g.options.some(o => o.toLowerCase() === q)) exact = true;
      if (opts.length) {
        html += `<div class="cbx-group">${esc(g.group)}</div>` + opts.map(o =>
          `<button type="button" class="cbx-opt" data-v="${esc(o)}">${esc(o)}</button>`).join("");
      }
    }
    if (allowCustom && typed && !exact) {
      html += `<button type="button" class="cbx-opt cbx-add" data-add="1">
        Add “${esc(typed)}”</button>`;
    }
    if (!html) {
      html = `<div class="cbx-none">${allowCustom
        ? "No matches — keep typing to add your own." : "Nothing to pick."}</div>`;
    }
    panel.innerHTML = html;
  }

  function add(v) {
    v = v.trim().replace(/\s+/g, " ");
    if (!v || has(v)) return;
    values.push(snapToCatalog(v));
    input.value = "";
    renderChips();
    renderPanel();
    if (onChange) onChange(values);
  }

  function remove(v) {
    const i = values.findIndex(x => x.toLowerCase() === v.toLowerCase());
    if (i < 0) return;
    values.splice(i, 1);
    renderChips();
    renderPanel();
    if (onChange) onChange(values);
  }

  input.addEventListener("focus", () => { renderPanel(); panel.hidden = false; });
  input.addEventListener("input", () => { renderPanel(); panel.hidden = false; });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (allowCustom && input.value.trim()) add(input.value);
    } else if (e.key === "Escape") {
      panel.hidden = true;
    }
  });
  panel.addEventListener("click", e => {
    const opt = e.target.closest(".cbx-opt");
    if (!opt) return;
    add(opt.dataset.add ? input.value : opt.dataset.v);
    input.focus();
  });
  chipsEl.addEventListener("click", e => {
    const x = e.target.closest(".cbx-x");
    if (x) remove(x.dataset.v);
  });

  for (const v of selected || []) {
    if (v && !has(v)) values.push(v);
  }
  renderChips();
  return { el, values, add, remove, has };
}

// ---- filtering: AND across facet types, OR within a facet ----
function intersects(set, arr) {
  return !set.size || (arr || []).some(v => set.has(v));
}

/* ---- text search ----
   Every query word must match somewhere (AND). The haystack covers title,
   notes, every facet (CEFR, age, skills, formats, exams, grammar, vocab,
   topics, themes), attachment file names, and attachment notes. A word
   matches by substring (covers prefixes), via a teacher-jargon alias
   (deck → slides, YL → young learners), or fuzzily — 1 typo from 5
   letters, 2 from 8 — so "lisening" still finds Listening. */
const SEARCH_ALIASES = {
  yl: "young learners", yls: "young learners",
  deck: "slides", decks: "slides", ppt: "slides", powerpoint: "slides",
  presentation: "slides",
  ws: "worksheet", handout: "worksheet", printable: "worksheet",
  cards: "flashcards", vocab: "vocabulary", pron: "pronunciation",
  starters: "pre a1 starters", movers: "a1 movers", flyers: "a2 flyers",
  ket: "a2 key", pet: "b1 preliminary", fce: "b2 first",
  cae: "c1 advanced", cpe: "c2 proficiency",
};

function searchHay(m) {
  return [m.title || "", m.notes || "",
          ...(m.age_groups || []), ...(m.cefr_levels || []),
          ...(m.exam_targets || []), ...(m.skills || []),
          ...(m.formats || []),
          ...ARRAY_SEARCH_FIELDS.flatMap(f => m[f] || []),
          ...(m.files || []).map(f => [f.name, f.note || "", f.role || "",
                                       f.transcript || ""].join("\n"))]
    .join("\n").toLowerCase();
}

function queryTokens(q) {
  return String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
}

// bounded edit distance: true when a and b are within `max` edits
function withinEdits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1,
                        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

function tokenMatches(token, hay, hayWords) {
  if (hay.includes(token)) return true;
  const alias = SEARCH_ALIASES[token];
  if (alias && hay.includes(alias)) return true;
  const budget = token.length >= 8 ? 2 : token.length >= 5 ? 1 : 0;
  if (!budget) return false;
  for (const w of hayWords) {
    if (withinEdits(token, w, budget)) return true;
    // typo-tolerant prefix: "grammer" should still find "grammatical"
    if (w.length > token.length &&
        withinEdits(token, w.slice(0, token.length + budget), budget)) {
      return true;
    }
  }
  return false;
}

function matches(m) {
  for (const [key] of [...COMPACT_FACETS, ...MORE_FACETS]) {
    if (!intersects(filters[key], m[key])) return false;
  }
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  const hay = searchHay(m);
  let hayWords = null;
  for (const t of queryTokens(q)) {
    if (hayWords === null && !hay.includes(t)) {
      hayWords = hay.split(/[^a-z0-9']+/).filter(w => w.length >= 3);
    }
    if (!tokenMatches(t, hay, hayWords || [])) return false;
  }
  return true;
}

/* escape + wrap query matches in <mark>, working on the raw string so
   entities are never split */
function highlight(text, q) {
  const s = String(text ?? "");
  const parts = [];
  for (const t of queryTokens(q)) {
    if (t.length >= 2) parts.push(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const alias = SEARCH_ALIASES[t];
    if (alias) parts.push(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  if (!parts.length) return esc(s);
  let re;
  try { re = new RegExp(parts.join("|"), "gi"); } catch (e) { return esc(s); }
  let out = "", last = 0, match;
  while ((match = re.exec(s)) !== null) {
    out += esc(s.slice(last, match.index)) + "<mark>" + esc(match[0]) + "</mark>";
    last = match.index + match[0].length;
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return out + esc(s.slice(last));
}

/* ---- recent searches (localStorage, newest first, max 8) ---- */
const RECENT_KEY = "mlib-recent-q";

function recentSearches() {
  try {
    const list = JSON.parse(lsGet(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter(x => typeof x === "string") : [];
  } catch (e) { return []; }
}

function saveRecentSearch(q) {
  q = q.trim();
  if (q.length < 2) return;
  const list = recentSearches().filter(x =>
    x.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  lsSet(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
}

function isFiltered() {
  return !!filters.q.trim() ||
    [...COMPACT_FACETS, ...MORE_FACETS].some(([k]) => filters[k].size);
}

// ---- list view ----
function renderList() {
  const opts = filterOptions();
  view.innerHTML = `
    <div class="searchwrap">
      <div class="searchbox">
        ${icon("search")}
        <input id="q" type="search" autocomplete="off" enterkeyhint="search"
               aria-label="Search materials"
               placeholder="Search anything — B2, IELTS, listening, a file name…"
               value="${esc(filters.q)}">
        <button id="qclear" class="iconbtn" type="button" aria-label="Clear search"
                ${filters.q ? "" : "hidden"}>${icon("x")}</button>
        <button id="filterfx" class="filterfx" type="button"
                aria-label="Show or hide filters" aria-expanded="${filtersOpen}">
          ${icon("funnel")}<span id="ffxcount" class="fcount" hidden></span>
        </button>
      </div>
      <div id="recentwrap" class="recentwrap" hidden></div>
    </div>
    <div id="inboxbanner"></div>
    <div id="backupbanner"></div>
    <div id="filterpanel" class="filterpanel" ${filtersOpen ? "" : "hidden"}>
      <div id="facets">
        ${COMPACT_FACETS.map(([key, label]) => !opts[key].length ? "" : `
          <div class="facetrow">
            <span class="facetlabel">${label}</span>
            <div class="chips" data-facet="${key}">
              ${opts[key].map(v =>
                `<button type="button" class="chip${filters[key].has(v) ? " on" : ""}"
                         aria-pressed="${filters[key].has(v)}"
                         data-v="${esc(v)}"><span>${esc(v)}</span>${icon("circlecheck", "chip-ic")}</button>`).join("")}
            </div>
          </div>`).join("")}
      </div>
      <div class="morewrap">
        <button id="morebtn" type="button"></button>
        <div id="morefilters" ${moreOpen ? "" : "hidden"}></div>
      </div>
    </div>
    <div class="resultbar">
      <div class="countwrap">
        <span id="count" class="count"></span>
        <button id="clearbtn" class="textbtn" type="button" hidden>Reset</button>
      </div>
      <div class="sortwrap">
        <div class="viewseg" role="group" aria-label="List layout">
          <button type="button" data-layout="list" class="${listLayout === "list" ? "on" : ""}"
                  aria-pressed="${listLayout === "list"}" aria-label="List view"
                  title="List view">${icon("rows")}</button>
          <button type="button" data-layout="grid" class="${listLayout === "grid" ? "on" : ""}"
                  aria-pressed="${listLayout === "grid"}" aria-label="Grid view"
                  title="Grid view">${icon("grid")}</button>
        </div>
        <button id="dicebtn" class="iconbtn" type="button"
                aria-label="Open a random matching material"
                title="Surprise me">${icon("dice")}</button>
        <div class="sortseg" role="group" aria-label="Sort materials">
          <button type="button" data-sort="new" class="${sortMode === "new" ? "on" : ""}">New</button>
          <button type="button" data-sort="az" class="${sortMode === "az" ? "on" : ""}">A–Z</button>
          <button type="button" data-sort="used" class="${sortMode === "used" ? "on" : ""}">Used</button>
        </div>
      </div>
    </div>
    <div id="needs"></div>
    <div id="results" class="results"></div>`;

  renderInboxBanner();
  renderBackupBanner();

  // "More filters" pickers reuse the combobox over values actually in use.
  const moreBox = $("#morefilters");
  let anyMore = false;
  for (const [key, label] of MORE_FACETS) {
    const used = inUseValues(key);
    if (!used.length) continue;
    anyMore = true;
    const box = combobox({
      key, label,
      groups: [{ group: "In your library", options: used }],
      selected: [...filters[key]],
      allowCustom: false,
      placeholder: "Tap to search…",
      onChange: values => {
        filters[key] = new Set(values);
        updateResults();
        updateMoreBtn();
      },
    });
    moreBox.appendChild(box.el);
  }
  if (!anyMore) {
    moreBox.innerHTML = `<p class="hint">Grammar, vocabulary, topic, and theme
      filters appear once your materials use those fields.</p>`;
  }

  function updateMoreBtn() {
    const n = MORE_FACETS.reduce((t, [k]) => t + filters[k].size, 0);
    $("#morebtn").innerHTML = icon("sliders") +
      `<span>${moreOpen ? "Hide more filters" : "More filters"}</span>` +
      (n ? `<span class="fcount">${n}</span>` : "") +
      icon(moreOpen ? "up" : "down");
  }
  updateMoreBtn();

  $("#morebtn").addEventListener("click", () => {
    moreOpen = !moreOpen;
    $("#morefilters").hidden = !moreOpen;
    updateMoreBtn();
  });
  $("#filterfx").addEventListener("click", () => {
    filtersOpen = !filtersOpen;
    $("#filterpanel").hidden = !filtersOpen;
    $("#filterfx").setAttribute("aria-expanded", filtersOpen);
  });
  $(".viewseg").addEventListener("click", e => {
    const btn = e.target.closest("button[data-layout]");
    if (!btn || btn.dataset.layout === listLayout) return;
    listLayout = btn.dataset.layout;
    lsSet("mlib-list-layout", listLayout);
    $$(".viewseg button").forEach(b => {
      const on = b.dataset.layout === listLayout;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
    updateResults();
  });
  // recent searches drop under the box while it's focused and empty
  function refreshRecent() {
    const wrap = $("#recentwrap");
    const recents = recentSearches();
    const show = document.activeElement === $("#q") &&
      !$("#q").value.trim() && recents.length;
    wrap.hidden = !show;
    if (show) {
      wrap.innerHTML = recents.map(r => `
        <button type="button" class="recentrow" data-q="${esc(r)}">
          ${icon("history")}<span>${esc(r)}</span></button>`).join("");
    }
  }
  $("#recentwrap").addEventListener("pointerdown", e => {
    const row = e.target.closest(".recentrow");
    if (!row) return;
    e.preventDefault(); // keep focus so the panel logic stays simple
    filters.q = row.dataset.q;
    $("#q").value = filters.q;
    $("#qclear").hidden = false;
    $("#recentwrap").hidden = true;
    updateResults();
  });
  $("#q").addEventListener("focus", refreshRecent);
  $("#q").addEventListener("blur", () => {
    setTimeout(() => { const w = $("#recentwrap"); if (w) w.hidden = true; }, 150);
  });
  $("#q").addEventListener("keydown", e => {
    if (e.key === "Enter") saveRecentSearch($("#q").value);
  });
  $("#q").addEventListener("input", e => {
    filters.q = e.target.value;
    $("#qclear").hidden = !filters.q;
    refreshRecent();
    updateResults();
  });
  $("#qclear").addEventListener("click", () => {
    filters.q = "";
    $("#q").value = "";
    $("#qclear").hidden = true;
    updateResults();
    $("#q").focus();
  });
  $("#results").addEventListener("click", () => {
    if (filters.q.trim()) saveRecentSearch(filters.q);
  });
  $("#facets").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const set = filters[chip.closest(".chips").dataset.facet];
    const v = chip.dataset.v;
    if (set.has(v)) set.delete(v); else set.add(v);
    chip.classList.toggle("on");
    chip.setAttribute("aria-pressed", chip.classList.contains("on"));
    updateResults();
  });
  $("#clearbtn").addEventListener("click", () => {
    filters.q = "";
    [...COMPACT_FACETS, ...MORE_FACETS].forEach(([k]) => filters[k].clear());
    renderList();
  });
  $(".sortseg").addEventListener("click", e => {
    const btn = e.target.closest("button[data-sort]");
    if (!btn || btn.dataset.sort === sortMode) return;
    sortMode = btn.dataset.sort;
    $$(".sortseg button").forEach(b =>
      b.classList.toggle("on", b.dataset.sort === sortMode));
    updateResults();
  });
  $("#dicebtn").addEventListener("click", () => {
    const hits = DB.lessons.filter(matches);
    if (!hits.length) { toast("Nothing matches these filters", "error"); return; }
    const pick = hits[Math.floor(Math.random() * hits.length)];
    toast(`Random pick from ${hits.length} match${hits.length === 1 ? "" : "es"}`);
    location.hash = "#/lesson/" + encodeURIComponent(pick.id);
  });

  renderNeeds();
  updateResults();
}

function renderInboxBanner() {
  const inbox = DB.inbox || [];
  const el = $("#inboxbanner");
  if (!el) return;
  el.innerHTML = !inbox.length ? "" : `
    <a class="banner" href="#/inbox">
      ${icon("inbox")}
      <span class="bannertext"><strong>${inbox.length} file${inbox.length === 1 ? "" : "s"}
        waiting in Inbox</strong> — tap to sort them</span>
      ${icon("chevron")}
    </a>`;
}

function sorted(arr) {
  const out = [...arr];
  const byTitle = (a, b) => (a.title || "").toLowerCase()
    .localeCompare((b.title || "").toLowerCase());
  if (sortMode === "az") {
    out.sort(byTitle);
  } else if (sortMode === "used") {
    out.sort((a, b) => lastUsed(b).localeCompare(lastUsed(a)) || byTitle(a, b));
  } else {
    out.sort((a, b) => (b.date_added || "").localeCompare(a.date_added || "")
      || byTitle(a, b));
  }
  return out;
}

function updateResults() {
  const all = DB.lessons;
  const hits = sorted(all.filter(matches));
  const active = isFiltered();
  $("#count").textContent = active
    ? `${hits.length} of ${all.length} materials`
    : `${all.length} material${all.length === 1 ? "" : "s"}`;
  $("#clearbtn").hidden = !active;
  const nSel = [...COMPACT_FACETS, ...MORE_FACETS]
    .reduce((t, [k]) => t + filters[k].size, 0);
  const ffx = $("#ffxcount");
  if (ffx) {
    ffx.textContent = nSel;
    ffx.hidden = !nSel;
  }
  $("#results").className = listLayout === "grid" ? "results grid" : "results";
  if (hits.length) {
    $("#results").innerHTML = hits.map((m, i) =>
      cardHTML(m, Math.min(i, 8))).join("");
  } else if (all.length) {
    $("#results").innerHTML = `
      <div class="emptystate">
        ${emptyArt()}
        <h3>No matches</h3>
        <p>Nothing fits this search and filter combination. Try removing a filter or two.</p>
        <button class="btn" type="button"
                onclick="document.getElementById('clearbtn').click()">Reset filters</button>
      </div>`;
  } else {
    $("#results").innerHTML = `
      <div class="emptystate">
        ${emptyArt()}
        <h3>Your library is empty</h3>
        <p>Add your first worksheet, lesson plan, or flashcard set and it will be searchable forever.</p>
        <a class="btn primary" href="#/add">${icon("plus")}<span>Add material</span></a>
      </div>`;
  }
}

function emptyArt() {
  // Tiny inline illustration: stacked papers, all theme-token colors.
  return `<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <rect x="26" y="34" width="58" height="70" rx="8" fill="var(--surface-2)"/>
    <rect x="34" y="26" width="58" height="70" rx="8" fill="var(--surface)"
          stroke="var(--border-strong)" stroke-width="2"/>
    <path d="M44 44h38M44 56h38M44 68h24" stroke="var(--border-strong)"
          stroke-width="3" stroke-linecap="round"/>
    <circle cx="86" cy="88" r="17" fill="var(--primary)"/>
    <path d="M79 88h14M86 81v14" stroke="var(--on-primary)"
          stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function cefrClass(level) {
  const k = String(level || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (k.includes("prea1")) return "cefr-prea1";
  const m = k.match(/^([abc][12])/);
  return m ? "cefr-" + m[1] : "";
}

function badgesHTML(m) {
  const b = [];
  for (const lv of m.cefr_levels || []) {
    b.push(`<span class="badge ${cefrClass(lv)}">${esc(lv)}</span>`);
  }
  for (const ex of m.exam_targets || []) {
    b.push(`<span class="badge exam">${esc(ex)}</span>`);
  }
  for (const ag of m.age_groups || []) {
    b.push(`<span class="badge">${esc(ag)}</span>`);
  }
  return b.length ? `<div class="badges">${b.join("")}</div>` : "";
}

function cardHTML(m, i) {
  const skills = (m.skills || []).map(s =>
    `<span class="badge">${esc(s)}</span>`).join("");
  const foot = [];
  if (m.duration_min) foot.push(`<span>${icon("clock")}${m.duration_min} min</span>`);
  const nFiles = (m.files || []).length;
  if (nFiles) foot.push(`<span>${icon("file")}${nFiles} file${nFiles === 1 ? "" : "s"}</span>`);
  if (m.date_added) foot.push(`<span>${icon("calendar")}${esc(fmtDate(m.date_added))}</span>`);
  const used = lastUsed(m);
  if (used) foot.push(`<span>${icon("history")}${(m.usage || []).length}× · ${esc(relDate(used))}</span>`);
  const topics = (m.topics || []).join(", ");
  if (topics) foot.push(`<span class="topics">${icon("tags")}${highlight(topics, filters.q)}</span>`);
  // surface WHY a search hit when the match lives in a file name
  const q = filters.q.trim();
  if (q && !queryTokens(q).every(t => (m.title || "").toLowerCase().includes(t))) {
    const hitFile = (m.files || []).find(f => queryTokens(q).some(t =>
      f.name.toLowerCase().includes(t) ||
      (f.note || "").toLowerCase().includes(t)));
    if (hitFile) foot.push(`<span class="topics">${icon("file")}${highlight(hitFile.name, q)}</span>`);
  }
  return `<a class="card pop" style="--i:${i || 0}" href="#/lesson/${encodeURIComponent(m.id)}">
    ${cardThumbHTML(m)}
    <div class="card-body">
      <div class="card-title">${highlight(m.title, filters.q)}</div>
      ${badgesHTML(m)}
      ${skills ? `<div class="badges">${skills}</div>` : ""}
      ${foot.length ? `<div class="card-foot">${foot.join("")}</div>` : ""}
    </div>
    ${icon("chevron", "card-chev")}
  </a>`;
}

function renderNeeds() {
  const needs = DB.needs_attention || [];
  $("#needs").innerHTML = !needs.length ? "" : `
    <h2 class="warn-title">${icon("alert")}Needs attention</h2>
    ${needs.map(e => `
      <div class="ncard">
        <div class="ntext">
          <strong>${esc(e.id)}</strong>
          <div class="nprob">${esc(e.problem)} — ${e.files.length} file(s)</div>
        </div>
        <a class="btn" href="#/repair/${encodeURIComponent(e.id)}">Fix metadata</a>
      </div>`).join("")}`;
}

// ---- detail view ----
// A teaching-log row, with the Feature-A reflection: stars, italic note,
// and a red "Needs revision" badge. `i` is the entry's index in m.usage.
function usageRowHTML(u, i) {
  const decorated = u.rating || u.reflection || u.needs_revision;
  return `<div class="filerow usagerow">
    <span class="ftile ft-use">${icon("circlecheck")}</span>
    <span class="fcol">
      <span class="fname">${esc(fmtDate(u.date))}${u.group ? ` — ${esc(u.group)}` : ""}${
        u.rating ? " " + starsHTML(u.rating) : ""}${
        u.needs_revision ? ` <span class="revbadge">${icon("alert")}Needs revision</span>` : ""}</span>
      ${u.note ? `<span class="fnotetext">${esc(u.note)}</span>` : ""}
      ${u.reflection ? `<span class="reflectext">${esc(u.reflection)}</span>` : ""}
    </span>
    <button type="button" class="fsharebtn iconbtn" data-reflect="${i}"
            aria-label="${decorated ? "Edit" : "Add"} reflection"
            title="${decorated ? "Edit reflection" : "Add reflection"}">${icon("star")}</button>
    <button type="button" class="fsharebtn iconbtn" data-unlog="${i}"
            aria-label="Remove this log entry" title="Remove entry">${icon("x")}</button>
  </div>`;
}

function renderDetail(id) {
  const m = DB.lessons.find(x => x.id === id);
  if (!m) {
    if ((DB.needs_attention || []).some(x => x.id === id)) {
      location.replace("#/repair/" + encodeURIComponent(id));
      return;
    }
    view.innerHTML = `<a class="back" href="#/">${icon("back")}Library</a>
      <p class="empty">Material not found — it may have been moved or renamed. Try Rescan.</p>`;
    return;
  }

  const facetItems = [
    ["Skills", m.skills],
    ["Format", m.formats],
    ["Grammar", m.grammar_points],
    ["Vocabulary", m.vocab_focuses],
    ["Topics", m.topics],
    ["Themes", m.themes],
  ].filter(([, arr]) => arr && arr.length);

  const usage = m.usage || [];
  const totalBytes = (m.files || []).reduce((t, f) => t + (f.size || 0), 0);
  const metaline = [];
  metaline.push(`<span>${icon("file")}${m.files.length} file${m.files.length === 1 ? "" : "s"}</span>`);
  if (totalBytes) metaline.push(`<span>${icon("database")}${fmtSize(totalBytes)}</span>`);
  if (m.duration_min) metaline.push(`<span>${icon("clock")}${m.duration_min} min</span>`);
  if (m.date_added) metaline.push(`<span>${icon("calendar")}Added ${esc(fmtDate(m.date_added))}</span>`);
  if (usage.length) {
    metaline.push(`<span>${icon("history")}Used ${usage.length}× · ${esc(relDate(lastUsed(m)))}</span>`);
  }

  // file-type chips: only the kinds actually present in this folder
  const KIND_META = { other: ["Other", "file"] };
  for (const [key, label, ic] of FILE_KIND_CHIPS) KIND_META[key] = [label, ic];
  const kinds = [];
  for (const f of m.files || []) {
    const k = fileKind(f.name);
    if (!kinds.includes(k)) kinds.push(k);
  }
  let kindSel = "all";
  let reordering = false;

  view.innerHTML = `
    <a class="back" href="#/" id="backlink">${icon("back")}Back</a>
    <div class="detail">
      <div class="herocard">
        ${heroThumbHTML(m)}
        <h2>${esc(m.title)}</h2>
        ${badgesHTML(m)}
        <div class="metaline">${metaline.join("")}</div>
        ${m.files.length ? `<button id="herosharebtn" class="btn heroshare" type="button">
          ${icon("share")}<span>${m.files.length === 1
            ? "Share file" : "Share files…"}</span></button>` : ""}
      </div>
      ${m.notes ? `<div class="notecallout"><span class="notelabel">Notes</span>${esc(m.notes)}</div>` : ""}
      <div class="quickactions">
        <button id="logusebtn" class="btn soft" type="button">${icon("history")}<span>Log use</span></button>
        <button id="toplanbtn" class="btn soft" type="button">${icon("calplus")}<span>Add to plan</span></button>
      </div>
      ${facetItems.length ? `<div class="facetgrid">
        ${facetItems.map(([label, arr]) => `
          <div class="facetitem">
            <div class="flabel">${label}</div>
            <div class="badges">${arr.map(v => `<span class="tag">${esc(v)}</span>`).join("")}</div>
          </div>`).join("")}
      </div>` : ""}
      <h3 class="section-title">${icon("folder")}Files (${m.files.length})</h3>
      ${m.files.length ? `
        <div class="filetools">
          ${kinds.length > 1 ? `<div class="chips kindchips" id="kindchips">
            <button type="button" class="chip on" data-kind="all" aria-pressed="true">
              ${icon("grid")}<span>All</span></button>
            ${kinds.map(k => `<button type="button" class="chip" data-kind="${k}"
              aria-pressed="false">${icon(KIND_META[k][1])}<span>${KIND_META[k][0]}</span></button>`).join("")}
          </div>` : `<div class="chips"></div>`}
          <div class="viewseg" id="fileseg" role="group" aria-label="File layout">
            <button type="button" data-flayout="list" class="${fileLayout === "list" ? "on" : ""}"
                    aria-pressed="${fileLayout === "list"}" aria-label="List view"
                    title="List view">${icon("rows")}</button>
            <button type="button" data-flayout="grid" class="${fileLayout === "grid" ? "on" : ""}"
                    aria-pressed="${fileLayout === "grid"}" aria-label="Grid view"
                    title="Grid view">${icon("grid")}</button>
          </div>
          ${(m.files || []).some(isAnswerKey) ? `<button type="button" id="hidekeysbtn"
            class="iconbtn keytoggle ${hideKeys ? "on" : ""}" aria-pressed="${hideKeys}"
            aria-label="${hideKeys ? "Show" : "Hide"} answer keys"
            title="${hideKeys ? "Show" : "Hide"} answer keys">${icon("circlecheck")}</button>` : ""}
          ${m.files.length > 1 ? `<button type="button" id="reorderbtn"
            class="iconbtn reordertoggle" aria-pressed="false"
            aria-label="Reorder files" title="Reorder files">${icon("grip")}</button>` : ""}
        </div>
        <div id="filewrap"></div>` : `<p class="empty">No files in this material's folder.</p>`}
      ${usage.length ? `
        <h3 class="section-title">${icon("history")}Teaching log (${usage.length})</h3>
        <div class="filelist" id="usagelist">
          ${usage.map((u, i) => ({ u, i }))
            .sort((a, b) => (b.u.date || "").localeCompare(a.u.date || ""))
            .map(({ u, i }) => usageRowHTML(u, i)).join("")}
        </div>` : ""}
      <div class="detail-actions">
        <a class="btn primary" href="#/edit/${encodeURIComponent(m.id)}">${icon("pencil")}<span>Edit</span></a>
        <button id="delbtn" class="btn danger" type="button">${icon("trash")}<span>Delete</span></button>
      </div>
    </div>`;

  function fileRowHTML(f) {
    const isImg = IMAGE_RE.test(f.name);
    const inner = `
      ${fileTileHTML(f.name, m.id)}
      <span class="fcol">
        <span class="fname">${esc(f.name)}</span>
        ${f.role ? `<span class="frole">${icon(roleIcon(f.role))}${esc(f.role)}</span>` : ""}
        ${f.note ? `<span class="fnotetext">${esc(f.note)}</span>` : ""}
      </span>
      <span class="fsize">${fmtSize(f.size)}</span>`;
    const main = isImg
      ? `<button type="button" class="fmain" data-img="${esc(f.name)}">${inner}</button>`
      : `<a class="fmain" target="_blank" rel="noopener"
            href="${fileURL(m.id, f.name)}">${inner}</a>`;
    return `<div class="filerowwrap">
      <div class="filerow">${main}
        <button type="button" class="fsharebtn iconbtn" data-edit="${esc(f.name)}"
                aria-label="Edit ${esc(f.name)}" title="Rename / role / note">${icon("pencil")}</button>
        <button type="button" class="fsharebtn iconbtn" data-share="${esc(f.name)}"
                aria-label="Share ${esc(f.name)}" title="Share">${icon("share")}</button>
      </div>
      ${f.transcript ? `<details class="ftranscript">
        <summary>${icon("music")}<span>Transcript</span></summary>
        <div class="ftranscripttext">${esc(f.transcript)}</div></details>` : ""}
    </div>`;
  }

  function fileReorderRowHTML(f, i, n) {
    return `<div class="filerow reorderrow">
      ${fileTileHTML(f.name, m.id)}
      <span class="fcol"><span class="fname">${esc(f.name)}</span></span>
      <span class="reordbtns">
        <button type="button" class="fsharebtn iconbtn" data-move="up" data-name="${esc(f.name)}"
                aria-label="Move ${esc(f.name)} up" title="Move up" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
        <button type="button" class="fsharebtn iconbtn" data-move="down" data-name="${esc(f.name)}"
                aria-label="Move ${esc(f.name)} down" title="Move down" ${i === n - 1 ? "disabled" : ""}>${icon("down")}</button>
      </span>
    </div>`;
  }

  function fileCardHTML(f) {
    const isImg = IMAGE_RE.test(f.name);
    const thumb = isImg
      ? `<img class="fcthumb" loading="lazy" alt="" src="${fileURL(m.id, f.name)}">`
      : `<span class="fcthumb cthumb-ph" aria-hidden="true">${icon(KIND_META[fileKind(f.name)][1])}</span>`;
    const ext = fileExtLabel(f.name);
    const inner = `${thumb}
      ${ext ? `<span class="ftype">${esc(ext)}</span>` : ""}
      <span class="fname">${esc(f.name)}</span>
      ${f.role ? `<span class="frole">${icon(roleIcon(f.role))}${esc(f.role)}</span>` : ""}`;
    const main = isImg
      ? `<button type="button" class="fcmain" data-img="${esc(f.name)}">${inner}</button>`
      : `<a class="fcmain" target="_blank" rel="noopener"
            href="${fileURL(m.id, f.name)}">${inner}</a>`;
    return `<div class="filecard">${main}
      <div class="fcfoot">
        <span class="fsize">${fmtSize(f.size)}</span>
        <span class="fcfoot-btns">
          <button type="button" class="fsharebtn iconbtn small" data-edit="${esc(f.name)}"
                  aria-label="Rename or note ${esc(f.name)}" title="Rename / note">${icon("pencil")}</button>
          <button type="button" class="fsharebtn iconbtn small" data-share="${esc(f.name)}"
                  aria-label="Share ${esc(f.name)}" title="Share">${icon("share")}</button>
        </span>
      </div>
    </div>`;
  }

  function renderFiles() {
    const wrap = $("#filewrap");
    if (!wrap) return;
    if (reordering) {
      const all = m.files || [];
      wrap.innerHTML =
        `<p class="reorderhint">Use the arrows to set the order — saved as you go.</p>
         <div class="filelist reordering">${all.map((f, i) =>
           fileReorderRowHTML(f, i, all.length)).join("")}</div>`;
      return;
    }
    let files = (m.files || []).filter(f =>
      kindSel === "all" || fileKind(f.name) === kindSel);
    const hidden = hideKeys ? files.filter(isAnswerKey).length : 0;
    if (hideKeys) files = files.filter(f => !isAnswerKey(f));
    const hint = hidden ? `<p class="keyshint">${icon("circlecheck")}${hidden}
      answer key${hidden === 1 ? "" : "s"} hidden</p>` : "";
    if (!files.length) {
      wrap.innerHTML = hint + `<p class="empty">No matching files.</p>`;
    } else if (fileLayout === "grid") {
      wrap.innerHTML = hint + `<div class="filegrid">${files.map(fileCardHTML).join("")}</div>`;
    } else {
      wrap.innerHTML = hint + `<div class="filelist">${files.map(fileRowHTML).join("")}</div>`;
    }
  }
  renderFiles();

  async function moveFile(name, dir) {
    const files = m.files || [];
    const i = files.findIndex(f => f.name === name);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= files.length) return;
    [files[i], files[j]] = [files[j], files[i]];  // m === DB row, so DB stays in sync
    renderFiles();
    try {
      await api("/api/lessons/" + encodeURIComponent(m.id) + "/files/reorder",
        { method: "POST", body: formBody({ order: JSON.stringify(files.map(f => f.name)) }) });
    } catch (err) {
      toast("Could not save order: " + err.message, "error");
      await refresh();
      renderDetail(m.id);
    }
  }

  async function removeFile(file) {
    try {
      const out = await api("/api/lessons/" + encodeURIComponent(m.id) + "/files/to-inbox",
        { method: "POST", body: formBody({ names: JSON.stringify([file.name]) }) });
      if (out.lesson) replaceMaterial(out.lesson);
      renderDetail(m.id);
      const inboxName = (out.inbox_names && out.inbox_names[0]) || file.name;
      toast(`Moved “${file.name}” to the Inbox`, "ok", { actions: [
        { label: "Undo", onClick: async () => {
          try {
            await api("/api/lessons/" + encodeURIComponent(m.id) + "/inbox",
              { method: "POST", body: formBody({
                inbox_files: JSON.stringify([inboxName]),
                inbox_notes: JSON.stringify({ [inboxName]: file.note || "" }),
              }) });
            await refresh();
            renderDetail(m.id);
            toast("File restored");
          } catch (err) { toast("Could not undo: " + err.message, "error"); }
        } },
      ] });
    } catch (err) {
      toast("Could not remove file: " + err.message, "error");
    }
  }

  const kindEl = $("#kindchips");
  if (kindEl) {
    kindEl.addEventListener("click", e => {
      const chip = e.target.closest(".chip[data-kind]");
      if (!chip || chip.dataset.kind === kindSel) return;
      kindSel = chip.dataset.kind;
      $$(".chip", kindEl).forEach(c => {
        const on = c.dataset.kind === kindSel;
        c.classList.toggle("on", on);
        c.setAttribute("aria-pressed", on);
      });
      renderFiles();
    });
  }
  const segEl = $("#fileseg");
  if (segEl) {
    segEl.addEventListener("click", e => {
      const btn = e.target.closest("button[data-flayout]");
      if (!btn || btn.dataset.flayout === fileLayout) return;
      fileLayout = btn.dataset.flayout;
      lsSet("mlib-file-layout", fileLayout);
      $$("button", segEl).forEach(b => {
        const on = b.dataset.flayout === fileLayout;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on);
      });
      renderFiles();
    });
  }
  const hideKeysBtn = $("#hidekeysbtn");
  if (hideKeysBtn) {
    hideKeysBtn.addEventListener("click", () => {
      hideKeys = !hideKeys;
      lsSet("mlib-hide-keys", hideKeys ? "1" : "0");
      hideKeysBtn.classList.toggle("on", hideKeys);
      hideKeysBtn.setAttribute("aria-pressed", hideKeys);
      hideKeysBtn.title = (hideKeys ? "Show" : "Hide") + " answer keys";
      hideKeysBtn.setAttribute("aria-label", hideKeysBtn.title);
      renderFiles();
    });
  }
  const reorderBtn = $("#reorderbtn");
  if (reorderBtn) {
    reorderBtn.addEventListener("click", () => {
      reordering = !reordering;
      reorderBtn.classList.toggle("on", reordering);
      reorderBtn.setAttribute("aria-pressed", reordering);
      const tools = $(".filetools");
      if (tools) tools.classList.toggle("reordering", reordering);
      renderFiles();
    });
  }
  const heroShare = $("#herosharebtn");
  if (heroShare) {
    heroShare.addEventListener("click", () => openShareSheet(m));
  }

  $("#backlink").addEventListener("click", e => {
    e.preventDefault();
    if (history.length > 1) history.back(); else location.hash = "#/";
  });

  $(".detail").addEventListener("click", async e => {
    const img = e.target.closest("[data-img]");
    if (img) { openLightbox(m.id, img.dataset.img); return; }
    const share = e.target.closest("[data-share]");
    if (share) { shareFile(m.id, share.dataset.share); return; }
    const move = e.target.closest("[data-move]");
    if (move) { moveFile(move.dataset.name, move.dataset.move); return; }
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      const file = (m.files || []).find(f => f.name === edit.dataset.edit);
      if (!file) return;
      const res = await openFileEditDialog(file);
      if (!res) return;
      if (res.remove) { await removeFile(file); return; }
      try {
        const body = { old: file.name, name: res.name, note: res.note };
        if (res.role !== undefined) body.role = res.role;
        if (res.transcript !== undefined) body.transcript = res.transcript;
        const out = await api("/api/lessons/" + encodeURIComponent(m.id) + "/files/edit",
          { method: "POST", body: formBody(body) });
        if (out.lesson) replaceMaterial(out.lesson);
        renderDetail(m.id);
        toast(out.old === out.new ? "File updated" : "Renamed to " + out.new);
      } catch (err) {
        toast("Could not save: " + err.message, "error");
      }
      return;
    }
    const reflect = e.target.closest("[data-reflect]");
    if (reflect) {
      const i = +reflect.dataset.reflect;
      const u = (m.usage || [])[i];
      if (!u) return;
      const ok = await reflectOnEntry(m, i, {
        editing: true, rating: u.rating || 0,
        reflection: u.reflection || "", needs_revision: !!u.needs_revision });
      if (ok) renderDetail(m.id);
      return;
    }
    const unlog = e.target.closest("[data-unlog]");
    if (unlog) {
      try {
        await deleteUsage(m.id, +unlog.dataset.unlog);
        toast("Log entry removed");
        renderDetail(m.id);
      } catch (err) {
        toast("Could not remove entry: " + err.message, "error");
      }
    }
  });

  $("#logusebtn").addEventListener("click", async () => {
    const entry = await openUsageDialog(m);
    if (!entry) return;
    try {
      await postUsage(m.id, entry);
      toast("Logged — " + fmtDate(entry.date));
      renderDetail(m.id);
    } catch (err) {
      toast("Could not log use: " + err.message, "error");
    }
  });

  $("#toplanbtn").addEventListener("click", () => openPlanSheet(m));

  $("#delbtn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: `Delete “${m.title}”?`,
      message: "The folder moves to LessonLibrary/Trash — nothing is erased. " +
        "To restore it, move the folder back into LessonLibrary/lessons " +
        "with a file manager and tap Rescan.",
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    $("#delbtn").disabled = true;
    try {
      await api("/api/lessons/" + encodeURIComponent(m.id) + "/trash", { method: "POST" });
      await refresh();
      location.hash = "#/";
      toast("Moved to Trash");
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
      $("#delbtn").disabled = false;
    }
  });
}

// ---- plans ("Classes") views ----
function planProgress(p) {
  const total = p.items.length;
  const done = p.items.filter(it => it.done).length;
  return { total, done };
}

function itemMinutes(it, mats) {
  if (it.placeholder) return it.duration_min || 0;
  const m = mats.get(it.material_id);
  return (m && m.duration_min) || 0;
}

function planMinutes(p, mats) {
  let total = 0, left = 0;
  for (const it of p.items) {
    const min = itemMinutes(it, mats);
    total += min;
    if (!it.done) left += min;
  }
  return { total, left };
}

const PLACEHOLDER_KINDS = [
  ["Warmer", "flame"], ["Break", "coffee"], ["Cool-down", "wind"],
];

/* ---- run-mode timer helpers (Feature B) ---- */
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Default seconds for an item's timer: a material's duration_min, a stage's
// plan-level default (stage_durations) or the item's own duration, else 5 min.
function runItemDefaultSecs(it, mats, p) {
  if (it.placeholder) {
    const key = String(it.placeholder).toLowerCase();
    const mins = it.duration_min ||
      (p.stage_durations && p.stage_durations[key]) || 5;
    return mins * 60;
  }
  const m = mats.get(it.material_id);
  return ((m && m.duration_min) || 5) * 60;
}

function splitNames(text) {
  return String(text || "").split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function placeholderIcon(label) {
  const hit = PLACEHOLDER_KINDS.find(([l]) =>
    l.toLowerCase() === String(label).toLowerCase());
  return hit ? hit[1] : "sparkles";
}

async function duplicatePlan(p) {
  const fd = formBody({
    title: p.title.replace(/ \(copy( \d+)?\)$/i, "") + " (copy)",
    group: p.group || "",
    plan_date: "",
    notes: p.notes || "",
    items: JSON.stringify((p.items || []).map(it => it.placeholder
      ? { placeholder: it.placeholder, duration_min: it.duration_min || "",
          done: false, note: it.note || "" }
      : { material_id: it.material_id, done: false, note: it.note || "" })),
  });
  try {
    const out = await api("/api/plans", { method: "POST", body: fd });
    replacePlan(out.plan);
    toast(`Copied “${p.title}” — set a date and go`, "ok", {
      actions: [{ label: "Open", onClick: () => {
        location.hash = "#/plan/" + encodeURIComponent(out.plan.id); } }],
    });
    return out.plan;
  } catch (err) {
    toast("Could not duplicate: " + err.message, "error");
    return null;
  }
}

function renderPlans() {
  const plans = DB.plans || [];
  view.innerHTML = `
    <h2 class="pagetitle">Classes</h2>
    <div id="planlist">
      ${plans.length ? plans.map((p, i) => {
        const { total, done } = planProgress(p);
        const sub = [p.group, fmtDate(p.plan_date)].filter(Boolean).join(" · ");
        return `<div class="card pop plancard" style="--i:${Math.min(i, 8)}">
          <a class="planmain" href="#/plan/${encodeURIComponent(p.id)}">
            <div class="card-body">
              <div class="card-title">${esc(p.title)}</div>
              ${sub ? `<div class="card-foot"><span>${icon("users")}${esc(sub)}</span></div>` : ""}
              ${total ? `
                <div class="progresswrap">
                  <div class="progressbar"><span style="width:${total ? (done / total) * 100 : 0}%"></span></div>
                  <span class="progresslabel">${done}/${total}</span>
                </div>` : `<div class="card-foot"><span>Empty plan — add materials</span></div>`}
            </div>
          </a>
          <button type="button" class="iconbtn plandup" data-dup="${esc(p.id)}"
                  aria-label="Duplicate ${esc(p.title)}" title="Duplicate — reuse for the next class">
            ${icon("copy")}</button>
        </div>`;
      }).join("") : `
        <div class="emptystate">
          ${emptyArt()}
          <h3>No classes planned yet</h3>
          <p>A plan is the queue for one class: pick materials, reorder them, then check them off as you teach.</p>
          <button class="btn primary" type="button" id="newplanbtn">${icon("plus")}<span>New plan</span></button>
        </div>`}
    </div>`;
  const btn = $("#newplanbtn");
  if (btn) btn.addEventListener("click", newPlanFromFab);
  $("#planlist").addEventListener("click", e => {
    const dup = e.target.closest("[data-dup]");
    if (!dup) return;
    const p = (DB.plans || []).find(x => x.id === dup.dataset.dup);
    if (p) duplicatePlan(p).then(() => renderPlans());
  });
}

async function newPlanFromFab() {
  const plan = await createPlanFlow(null);
  if (plan) location.hash = "#/plan/" + encodeURIComponent(plan.id);
}

/* Checking off = you taught it: the teaching log stays in sync, and the
   side effect is announced in a toast instead of happening silently. */
async function setPlanItemDone(p, i, done, mats) {
  const it = p.items[i];
  it.done = done;
  try {
    await savePlan(p);
  } catch (err) {
    toast("Could not save plan: " + err.message, "error");
    await refresh();
    return;
  }
  if (it.placeholder) return;
  const m = mats.get(it.material_id);
  if (!m) return;
  const planNote = "Plan: " + p.title;
  try {
    if (done) {
      const rec = await postUsage(m.id, { date: todayISO(),
                                          group: p.group || "", note: planNote });
      const idx = (rec.usage || []).length - 1;
      toast(`Done — logged in “${m.title}”`, "ok", { actions: [
        { label: "Reflect", onClick: () => reflectOnEntry(rec, idx) },
      ] });
    } else {
      const fresh = DB.lessons.find(x => x.id === m.id);
      const idx = (fresh.usage || []).map((u, j) => [u, j])
        .filter(([u]) => u.note === planNote && u.group === (p.group || ""))
        .map(([, j]) => j).pop();
      if (idx !== undefined) {
        await deleteUsage(m.id, idx);
        toast("Teaching-log entry removed");
      }
    }
  } catch (err) {
    toast("Teaching log not updated: " + err.message, "error");
  }
}

/* Pointer-based drag-to-reorder for plan items. The handle has
   touch-action:none so the gesture never fights page scroll. */
function enablePlanDrag(container, onReorder) {
  let drag = null;
  container.addEventListener("pointerdown", e => {
    const handle = e.target.closest(".draghandle");
    if (!handle) return;
    const row = handle.closest(".planitem");
    if (!row) return;
    e.preventDefault();
    const rows = $$(".planitem", container);
    const rects = rows.map(r => r.getBoundingClientRect());
    drag = { row, rows, rects, from: rows.indexOf(row),
             to: rows.indexOf(row), startY: e.clientY };
    row.classList.add("dragging");
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* old WebView */ }
  });
  container.addEventListener("pointermove", e => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    drag.row.style.transform = `translateY(${dy}px)`;
    const center = drag.rects[drag.from].top +
      drag.rects[drag.from].height / 2 + dy;
    let to = 0;
    for (let i = 0; i < drag.rects.length; i++) {
      if (i === drag.from) continue;
      if (center > drag.rects[i].top + drag.rects[i].height / 2) to++;
    }
    drag.to = to;
    const h = drag.rects[drag.from].height + 8;
    drag.rows.forEach((r, i) => {
      if (r === drag.row) return;
      let shift = 0;
      if (i > drag.from && i <= drag.to) shift = -h;
      else if (i < drag.from && i >= drag.to) shift = h;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  });
  function finish(commit) {
    if (!drag) return;
    const { from, to } = drag;
    drag.rows.forEach(r => { r.style.transform = ""; });
    drag.row.classList.remove("dragging");
    drag = null;
    if (commit && from !== to) onReorder(from, to);
  }
  container.addEventListener("pointerup", () => finish(true));
  container.addEventListener("pointercancel", () => finish(false));
}

function planItemHTML(it, i, mats) {
  if (it.placeholder) {
    return `<div class="planitem ph${it.done ? " done" : ""}">
      <button type="button" class="checkbtn" data-toggle="${i}"
              aria-label="${it.done ? "Mark as not done" : "Mark as done"}">
        ${icon(it.done ? "circlecheck" : "circle")}
      </button>
      <span class="picol">
        <span class="pititle">${icon(placeholderIcon(it.placeholder), "ph-ic")}${esc(it.placeholder)}</span>
        ${it.duration_min ? `<span class="pisub">${it.duration_min} min</span>` : ""}
      </span>
      <span class="pibtns">
        <button type="button" class="iconbtn small draghandle" data-i="${i}"
                aria-label="Drag to reorder">${icon("grip")}</button>
        <button type="button" class="iconbtn small" data-remove="${i}"
                aria-label="Remove from plan">${icon("x")}</button>
      </span>
    </div>`;
  }
  const m = mats.get(it.material_id);
  return `<div class="planitem${it.done ? " done" : ""}${m ? "" : " missing"}">
    <button type="button" class="checkbtn" data-toggle="${i}"
            aria-label="${it.done ? "Mark as not done" : "Mark as done"}">
      ${icon(it.done ? "circlecheck" : "circle")}
    </button>
    ${m ? `
      <a class="picol" href="#/lesson/${encodeURIComponent(m.id)}">
        <span class="pititle">${esc(m.title)}</span>
        <span class="pisub">${esc([(m.cefr_levels || []).join("/"),
          m.duration_min ? m.duration_min + " min" : "",
          (m.formats || []).join(", ")].filter(Boolean).join(" · "))}</span>
      </a>` : `
      <span class="picol">
        <span class="pititle">${esc(it.material_id)}</span>
        <span class="pisub miss">Missing — renamed or deleted?</span>
      </span>`}
    <span class="pibtns">
      <button type="button" class="iconbtn small draghandle" data-i="${i}"
              aria-label="Drag to reorder">${icon("grip")}</button>
      <button type="button" class="iconbtn small" data-remove="${i}"
              aria-label="Remove from plan">${icon("x")}</button>
    </span>
  </div>`;
}

function renderPlan(id) {
  const p = (DB.plans || []).find(x => x.id === id);
  if (!p) {
    view.innerHTML = `<a class="back" href="#/plans">${icon("back")}Classes</a>
      <p class="empty">Plan not found.</p>`;
    return;
  }
  const { total, done } = planProgress(p);
  const mats = new Map(DB.lessons.map(m => [m.id, m]));
  const mins = planMinutes(p, mats);
  const sub = [p.group, fmtDate(p.plan_date)].filter(Boolean).join(" · ");

  view.innerHTML = `
    <a class="back" href="#/plans">${icon("back")}Classes</a>
    <div class="detail">
      <h2>${esc(p.title)}</h2>
      <div class="metaline">
        ${sub ? `<span>${icon("users")}${esc(sub)}</span>` : ""}
        <span>${icon("calcheck")}${done}/${total} done</span>
        ${mins.total ? `<span>${icon("clock")}~${mins.total} min total${
          done && mins.left ? ` · ${mins.left} left` : ""}</span>` : ""}
      </div>
      ${p.unreadable ? `<div class="problem">${icon("alert")}<div>
        This plan's file was unreadable — what you see was recovered. Saving rewrites it cleanly.</div></div>` : ""}
      ${p.notes ? `<div class="notecallout"><span class="notelabel">Notes</span>${esc(p.notes)}</div>` : ""}
      ${total ? `
        <a class="btn primary wide startclass" href="#/plan/${encodeURIComponent(p.id)}/run">
          ${icon("play")}<span>Start class</span></a>
        <div class="progresswrap big">
          <div class="progressbar"><span style="width:${(done / Math.max(total, 1)) * 100}%"></span></div>
        </div>
        <div class="planitems" id="planitems">
          ${p.items.map((it, i) => planItemHTML(it, i, mats)).join("")}
        </div>
        <div class="phrow">
          ${PLACEHOLDER_KINDS.map(([label, ic]) =>
            `<button type="button" class="chip" data-ph="${esc(label)}">
              ${icon(ic, "chip-ic-plus")}<span>${esc(label)}</span></button>`).join("")}
        </div>` : `
        <div class="emptystate">
          ${emptyArt()}
          <h3>Nothing here yet</h3>
          <p>Add materials from your library to build this lesson.</p>
          <a class="btn primary" href="#/plan/${encodeURIComponent(p.id)}/pick">
            ${icon("plus")}<span>Add materials</span></a>
        </div>`}
      ${total ? `<a class="btn wide addmore" href="#/plan/${encodeURIComponent(p.id)}/pick">
        ${icon("plus")}<span>Add materials</span></a>` : ""}
      <div class="detail-actions">
        <button id="planedit" class="btn" type="button">${icon("pencil")}<span>Edit details</span></button>
        <button id="plandup" class="btn" type="button">${icon("copy")}<span>Duplicate</span></button>
        <button id="plandel" class="btn danger" type="button">${icon("trash")}<span>Delete</span></button>
      </div>
    </div>`;

  async function persist(mutate) {
    mutate();
    try {
      await savePlan(p);
    } catch (err) {
      toast("Could not save plan: " + err.message, "error");
      await refresh();
    }
    renderPlan(id);
  }

  const itemsEl = $("#planitems");
  if (itemsEl) {
    enablePlanDrag(itemsEl, (from, to) => persist(() => {
      const [it] = p.items.splice(from, 1);
      p.items.splice(to, 0, it);
    }));
  }

  $(".detail").addEventListener("click", async e => {
    const tog = e.target.closest("[data-toggle]");
    if (tog) {
      const i = +tog.dataset.toggle;
      await setPlanItemDone(p, i, !p.items[i].done, mats);
      renderPlan(id);
      return;
    }
    const ph = e.target.closest("[data-ph]");
    if (ph) {
      await persist(() => {
        p.items.push({ placeholder: ph.dataset.ph, duration_min: 5,
                       done: false, note: "" });
      });
      return;
    }
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      await persist(() => { p.items.splice(+rm.dataset.remove, 1); });
    }
  });

  $("#plandup").addEventListener("click", () => duplicatePlan(p));

  $("#planedit").addEventListener("click", async () => {
    const meta = await openPlanDialog(p);
    if (!meta) return;
    Object.assign(p, meta);
    try {
      await savePlan(p);
      toast("Plan updated");
    } catch (err) {
      toast("Could not save plan: " + err.message, "error");
    }
    renderPlan(id);
  });

  $("#plandel").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: `Delete plan “${p.title}”?`,
      message: "The plan moves to LessonLibrary/Trash. Your materials are " +
        "not touched — only this plan's list of them.",
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    try {
      await api("/api/plans/" + encodeURIComponent(p.id) + "/trash", { method: "POST" });
      DB.plans = (DB.plans || []).filter(x => x.id !== p.id);
      location.hash = "#/plans";
      toast("Plan moved to Trash");
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  });
}

function renderPick(id) {
  const p = (DB.plans || []).find(x => x.id === id);
  if (!p) {
    view.innerHTML = `<a class="back" href="#/plans">${icon("back")}Classes</a>
      <p class="empty">Plan not found.</p>`;
    return;
  }
  // Multi-select: tap to stage, nothing is saved until Done — one write,
  // no network round-trip per tap.
  const initial = new Set(p.items.filter(it => it.material_id)
    .map(it => it.material_id));
  const staged = new Set(initial);

  view.innerHTML = `
    <a class="back" href="#/plan/${encodeURIComponent(p.id)}">${icon("back")}${esc(p.title)}</a>
    <h2 class="pagetitle">Add materials</h2>
    <div class="searchwrap">
      <div class="searchbox">
        ${icon("search")}
        <input id="pickq" type="search" autocomplete="off" enterkeyhint="search"
               aria-label="Search materials" placeholder="Search your library…"
               value="${esc(pickSearch)}">
      </div>
    </div>
    <div id="pickresults"></div>
    <div class="savebar">
      <button id="pickdone" class="btn primary big wide" type="button">Done</button>
    </div>`;

  function updateDone() {
    const added = [...staged].filter(x => !initial.has(x)).length;
    const removed = [...initial].filter(x => !staged.has(x)).length;
    $("#pickdone").textContent = !added && !removed ? "Done"
      : "Save — " + [added ? `add ${added}` : "",
                     removed ? `remove ${removed}` : ""]
        .filter(Boolean).join(", ");
  }

  function pickList() {
    const q = pickSearch.trim().toLowerCase();
    const hits = DB.lessons.filter(m => !q || searchHay(m).includes(q));
    $("#pickresults").innerHTML = hits.length ? hits.map(m => {
      const added = staged.has(m.id);
      return `<button type="button" class="card pickrow${added ? " added" : ""}"
                      data-mid="${esc(m.id)}" aria-pressed="${added}">
        <span class="pickmark">${icon(added ? "circlecheck" : "circle")}</span>
        <div class="card-body">
          <div class="card-title">${esc(m.title)}</div>
          ${badgesHTML(m)}
        </div>
      </button>`;
    }).join("") : `<p class="empty">No materials match.</p>`;
  }
  pickList();
  updateDone();

  $("#pickq").addEventListener("input", e => {
    pickSearch = e.target.value;
    pickList();
  });
  $("#pickresults").addEventListener("click", e => {
    const row = e.target.closest(".pickrow");
    if (!row) return;
    const mid = row.dataset.mid;
    if (staged.has(mid)) staged.delete(mid); else staged.add(mid);
    const on = staged.has(mid);
    row.classList.toggle("added", on);
    row.setAttribute("aria-pressed", String(on));
    $(".pickmark", row).innerHTML = icon(on ? "circlecheck" : "circle");
    updateDone();
  });
  $("#pickdone").addEventListener("click", async () => {
    const added = [...staged].filter(x => !initial.has(x));
    const removed = [...initial].filter(x => !staged.has(x));
    if (added.length || removed.length) {
      p.items = p.items.filter(it =>
        it.placeholder || staged.has(it.material_id));
      for (const mid of added) {
        p.items.push({ material_id: mid, done: false, note: "" });
      }
      try {
        await savePlan(p);
        toast([added.length ? `${added.length} added` : "",
               removed.length ? `${removed.length} removed` : ""]
          .filter(Boolean).join(" · "));
      } catch (err) {
        toast("Could not save plan: " + err.message, "error");
        await refresh();
      }
    }
    location.hash = "#/plan/" + encodeURIComponent(p.id);
  });
}

// ---- start class (run) mode: one item at a time, huge controls ----
function renderRun(id) {
  const p = (DB.plans || []).find(x => x.id === id);
  if (!p || !p.items.length) {
    location.replace("#/plan/" + encodeURIComponent(id));
    return;
  }
  const mats = new Map(DB.lessons.map(m => [m.id, m]));
  let cur = p.items.findIndex(it => !it.done);
  if (cur < 0) cur = 0;

  // run-session-only state, intentionally lost when leaving run mode
  const timers = new Map();   // item object -> {remaining, running, auto, started}
  let panelOpen = false;      // timer panel expanded inline?
  let jumpQ = "";             // quick-jump search text
  let pickAnim = null;        // picker "spin" interval, cleared on close
  const picker = { names: [], excluded: new Set(), teams: 4, tab: "one" };

  function timerFor(it) {
    let t = timers.get(it);
    if (!t) {
      t = { remaining: runItemDefaultSecs(it, mats, p), running: false,
            auto: false, started: false };
      timers.set(it, t);
    }
    return t;
  }
  function timerTone(t) {
    if (t.remaining <= 0) return "danger";
    if (t.remaining <= 120) return "warn";
    return "";
  }
  function syncTimer() {
    const t = timerFor(p.items[cur]);
    const tone = timerTone(t);
    const chip = $("#timerchip");
    if (chip) {
      chip.className = "timerchip " + tone;
      $("#timerchipval", chip).textContent = t.started ? fmtClock(t.remaining) : "--:--";
    }
    const disp = $("#timerdisp");
    if (disp) { disp.textContent = fmtClock(t.remaining); disp.className = "timerdisp " + tone; }
    const sb = $("#tm-start");
    if (sb) sb.innerHTML = icon(t.running ? "timer" : "play") +
      `<span>${t.running ? "Pause" : "Start"}</span>`;
    const ab = $("#tm-auto");
    if (ab) { ab.classList.toggle("on", t.auto); ab.setAttribute("aria-pressed", String(t.auto)); }
  }
  function tick() {
    const t = timerFor(p.items[cur]);
    if (!t.running) { stopRunTicker(); return; }
    t.remaining -= 1;
    if (t.remaining <= 0) {
      t.remaining = 0; t.running = false; stopRunTicker(); syncTimer();
      if (t.auto) advance(1);   // auto-advance; item is NOT auto-marked done
      return;
    }
    syncTimer();
  }
  function pauseCurrent() {
    const t = timers.get(p.items[cur]);
    if (t) t.running = false;
    stopRunTicker();
  }
  function advance(dir) {
    pauseCurrent();
    const ni = cur + dir;
    if (ni < 0 || ni >= p.items.length) return;
    cur = ni; panelOpen = false; paint();
  }

  function jumpResultsHTML() {
    const q = jumpQ.trim().toLowerCase();
    if (!q) return "";
    const hits = DB.lessons.filter(m => searchHay(m).includes(q)).slice(0, 8);
    return `<div class="jumpresults">${hits.length ? hits.map(m => `
      <button type="button" class="jumprow" data-jump="${esc(m.id)}">
        <span class="jumptitle">${esc(m.title)}</span>
        <span class="jumpmeta">${(m.cefr_levels || []).map(lv =>
          `<span class="badge ${cefrClass(lv)}">${esc(lv)}</span>`).join("")}
          ${icon(materialIcon(m), "jumpfmt")}</span>
      </button>`).join("") : `<div class="jumpnone">No materials match.</div>`}</div>`;
  }

  function timerPanelHTML(t) {
    return `<div class="timerpanel" id="timerpanel">
      <div class="timerdisp ${timerTone(t)}" id="timerdisp">${fmtClock(t.remaining)}</div>
      <div class="timerbtns">
        <button type="button" class="btn" id="tm-minus" aria-label="Subtract one minute">−1:00</button>
        <button type="button" class="btn primary" id="tm-start">${icon(t.running ? "timer" : "play")}<span>${t.running ? "Pause" : "Start"}</span></button>
        <button type="button" class="btn" id="tm-plus" aria-label="Add one minute">+1:00</button>
      </div>
      <div class="timerbtns">
        <button type="button" class="btn" id="tm-reset">${icon("rescan")}<span>Reset</span></button>
        <button type="button" class="chip toggle ${t.auto ? "on" : ""}" id="tm-auto"
                aria-pressed="${t.auto}">${icon("chevron")}<span>Auto-advance at 0:00</span></button>
      </div>
    </div>`;
  }

  function stepHTML() {
    const it = p.items[cur];
    const t = timerFor(it);
    const { total, done } = planProgress(p);
    const m = it.placeholder ? null : mats.get(it.material_id);
    const body = it.placeholder ? `
      <span class="runtile">${icon(placeholderIcon(it.placeholder))}</span>
      <h2>${esc(it.placeholder)}</h2>`
    : m ? `
      ${heroThumbHTML(m)}
      <h2>${esc(m.title)}</h2>
      ${badgesHTML(m)}
      <div class="metaline center">
        ${m.duration_min ? `<span>${icon("clock")}${m.duration_min} min</span>` : ""}
        ${m.files.length ? `<span>${icon("file")}${m.files.length} file${m.files.length === 1 ? "" : "s"}</span>` : ""}
      </div>
      ${m.notes ? `<div class="notecallout"><span class="notelabel">Notes</span>${esc(m.notes)}</div>` : ""}
      ${(() => {
        // in class the teacher projects this; honor "Hide answer keys"
        const rf = (m.files || []).filter(f => !(hideKeys && isAnswerKey(f)));
        return rf.length ? `<div class="runfiles">${rf.slice(0, 6).map(f => `
          <a class="chip" target="_blank" rel="noopener" href="${fileURL(m.id, f.name)}">
            ${icon(f.role ? roleIcon(f.role) : "external", "chip-ic-plus")}<span>${esc(f.name)}</span></a>`).join("")}
        </div>` : "";
      })()}`
    : `
      <span class="runtile">${icon("alert")}</span>
      <h2>${esc(it.material_id)}</h2>
      <p class="hint">This material is missing — renamed or deleted?</p>`;
    return `
      <a class="back" href="#/plan/${encodeURIComponent(p.id)}">${icon("back")}Exit class mode</a>
      <div class="searchwrap runjump">
        <div class="searchbox">
          ${icon("search")}
          <input id="runjumpq" type="search" autocomplete="off" enterkeyhint="search"
                 aria-label="Search library to insert a side-track"
                 placeholder="Search library to insert…" value="${esc(jumpQ)}">
        </div>
        ${jumpResultsHTML()}
      </div>
      <div class="runhead">
        <span class="runcount">${cur + 1} of ${total}</span>
        <div class="progressbar"><span style="width:${(done / total) * 100}%"></span></div>
      </div>
      <div class="runcard${it.done ? " done" : ""}">
        <div class="runcardtop">
          ${it.side_track ? `<span class="sidetrack">${icon("shuffle")}Side-track</span>` : "<span></span>"}
          <button type="button" class="timerchip ${timerTone(t)}" id="timerchip"
                  aria-label="Timer">${icon("timer")}<span id="timerchipval">${t.started ? fmtClock(t.remaining) : "--:--"}</span></button>
          ${it.side_track ? `<button type="button" class="iconbtn small" id="runremove"
                  aria-label="Remove side-track">${icon("x")}</button>` : "<span></span>"}
        </div>
        ${body}
        ${it.done ? `<div class="rundone">${icon("circlecheck")}Done</div>` : ""}
        ${panelOpen ? timerPanelHTML(t) : ""}
      </div>
      <div class="runctrls">
        <button id="runprev" class="btn big" type="button" ${cur === 0 ? "disabled" : ""}
                aria-label="Previous item">${icon("back")}</button>
        <button id="rundone" class="btn primary big" type="button">
          ${icon(it.done ? "circle" : "check")}<span>${it.done ? "Not done" : "Done"}</span></button>
        <button id="runnext" class="btn big" type="button" ${cur === p.items.length - 1 ? "disabled" : ""}
                aria-label="Next item">${icon("chevron")}</button>
      </div>
      <button type="button" id="runpickbtn" class="runpick"
              aria-label="Random picker">${icon("hand")}<span>Pick</span></button>`;
  }

  // ---- random student / team picker (in-memory, no roster, no logging) ----
  function openPicker() {
    let dlg = $("#runpickerdlg");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "runpickerdlg";
      dlg.className = "dlg formdlg pickerdlg";
      document.body.appendChild(dlg);
    }
    function bodyHTML() {
      if (picker.tab === "teams") {
        return `<label class="field"><span>Number of teams</span>
            <input type="number" id="pk-teams" min="2" max="12" value="${picker.teams}"></label>
          <button type="button" id="pk-shuffle" class="btn primary big wide">${icon("shuffle")}<span>Shuffle</span></button>
          <div id="pk-teamsout" class="pk-teams"></div>`;
      }
      return `<button type="button" id="pk-pick" class="btn primary big wide">${icon("hand")}<span>Pick</span></button>
        <div id="pk-result" class="pk-result"></div>
        <button type="button" id="pk-reset" class="btn wide" ${picker.excluded.size ? "" : "disabled"}>Reset</button>`;
    }
    function paintPicker() {
      dlg.innerHTML = `
        <div class="pickertabs" role="tablist">
          <button type="button" class="ptab ${picker.tab === "one" ? "on" : ""}" data-tab="one">Pick one</button>
          <button type="button" class="ptab ${picker.tab === "teams" ? "on" : ""}" data-tab="teams">Make teams</button>
        </div>
        <textarea id="pk-names" class="pk-names" rows="3"
          placeholder="Type or paste names — one per line">${esc(picker.names.join("\n"))}</textarea>
        <div class="pk-count">${picker.names.length} name${picker.names.length === 1 ? "" : "s"}</div>
        <div id="pk-body">${bodyHTML()}</div>
        <div class="dlg-actions"><button type="button" id="pk-close" class="btn">Close</button></div>`;
      wire();
    }
    function pickOne() {
      const pool = picker.names.filter(n => !picker.excluded.has(n));
      const res = $("#pk-result");
      if (!pool.length) {
        res.textContent = picker.names.length
          ? "Everyone's had a turn — tap Reset to go again." : "Add some names first.";
        return;
      }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const land = () => {
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        picker.excluded.add(chosen);
        res.innerHTML = `<span class="pk-name landed">${esc(chosen)}</span>`;
        const rb = $("#pk-reset"); if (rb) rb.disabled = false;
      };
      if (reduce) { land(); return; }
      let ticks = 0;
      if (pickAnim) clearInterval(pickAnim);
      pickAnim = setInterval(() => {
        res.innerHTML = `<span class="pk-name spin">${esc(pool[Math.floor(Math.random() * pool.length)])}</span>`;
        if (++ticks >= 12) { clearInterval(pickAnim); pickAnim = null; land(); }
      }, 80);
    }
    function shuffleTeams() {
      const n = Math.max(2, Math.min(12, parseInt($("#pk-teams").value, 10) || 4));
      picker.teams = n;
      const names = shuffled(picker.names);
      const out = $("#pk-teamsout");
      if (!names.length) { out.innerHTML = `<p class="hint">Add some names first.</p>`; return; }
      const teams = Array.from({ length: n }, () => []);
      names.forEach((nm, i) => teams[i % n].push(nm));
      out.innerHTML = teams.map((t, i) => `<div class="pk-team">
        <div class="pk-teamhead">Team ${i + 1}</div>
        ${t.map(nm => `<div class="pk-member">${esc(nm)}</div>`).join("")}</div>`).join("");
    }
    function wire() {
      $$(".ptab", dlg).forEach(b => b.addEventListener("click", () => {
        picker.tab = b.dataset.tab; paintPicker();
      }));
      $("#pk-names", dlg).addEventListener("input", e => {
        picker.names = splitNames(e.target.value);
        picker.excluded = new Set([...picker.excluded].filter(n => picker.names.includes(n)));
        const c = $(".pk-count", dlg);
        if (c) c.textContent = picker.names.length + " name" + (picker.names.length === 1 ? "" : "s");
      });
      const pick = $("#pk-pick"); if (pick) pick.addEventListener("click", pickOne);
      const reset = $("#pk-reset"); if (reset) reset.addEventListener("click", () => {
        picker.excluded.clear(); $("#pk-result").textContent = ""; reset.disabled = true;
      });
      const sh = $("#pk-shuffle"); if (sh) sh.addEventListener("click", shuffleTeams);
      $("#pk-close", dlg).addEventListener("click", () => {
        if (pickAnim) { clearInterval(pickAnim); pickAnim = null; }
        dlg.close();
      });
    }
    paintPicker();
    if (!openDialog(dlg)) { /* no dialog support: nothing else to do */ }
  }

  function wireStep() {
    $("#runprev").addEventListener("click", () => advance(-1));
    $("#runnext").addEventListener("click", () => advance(1));
    $("#rundone").addEventListener("click", async () => {
      const marking = !p.items[cur].done;
      await setPlanItemDone(p, cur, marking, mats);
      if (marking) {
        const next = p.items.findIndex((it, i) => i > cur && !it.done);
        if (next >= 0) { pauseCurrent(); cur = next; panelOpen = false; }
      }
      paint();
    });
    $("#timerchip").addEventListener("click", () => { panelOpen = !panelOpen; paint(); });
    $("#runpickbtn").addEventListener("click", openPicker);

    const remove = $("#runremove");
    if (remove) remove.addEventListener("click", () => {
      timers.delete(p.items[cur]);
      p.items.splice(cur, 1);
      if (!p.items.length) { location.hash = "#/plan/" + encodeURIComponent(p.id); return; }
      if (cur >= p.items.length) cur = p.items.length - 1;
      panelOpen = false; paint();
      toast("Side-track removed");
    });

    // quick-jump
    const jq = $("#runjumpq");
    jq.addEventListener("input", e => {
      jumpQ = e.target.value;
      const wrap = $(".runjump");
      const old = $(".jumpresults", wrap);
      if (old) old.remove();
      wrap.insertAdjacentHTML("beforeend", jumpResultsHTML());
    });
    $(".runjump").addEventListener("click", e => {
      const row = e.target.closest("[data-jump]");
      if (!row) return;
      const m = DB.lessons.find(x => x.id === row.dataset.jump);
      if (!m) return;
      pauseCurrent();
      p.items.splice(cur, 0, { material_id: m.id, done: false, note: "", side_track: true });
      jumpQ = ""; panelOpen = false; paint();
      toast(`Inserted “${m.title}” — save the plan to keep it`);
    });

    // timer panel controls
    const start = $("#tm-start");
    if (start) {
      const t = timerFor(p.items[cur]);
      start.addEventListener("click", () => {
        if (t.running) { t.running = false; stopRunTicker(); }
        else {
          if (t.remaining <= 0) t.remaining = runItemDefaultSecs(p.items[cur], mats, p);
          t.running = true; t.started = true; stopRunTicker(); _runTicker = setInterval(tick, 1000);
        }
        syncTimer();
      });
      $("#tm-reset").addEventListener("click", () => {
        t.running = false; t.started = false; stopRunTicker();
        t.remaining = runItemDefaultSecs(p.items[cur], mats, p); syncTimer();
      });
      $("#tm-minus").addEventListener("click", () => {
        t.remaining = Math.max(0, t.remaining - 60); t.started = true; syncTimer();
      });
      $("#tm-plus").addEventListener("click", () => {
        t.remaining += 60; t.started = true; syncTimer();
      });
      $("#tm-auto").addEventListener("click", () => { t.auto = !t.auto; syncTimer(); });
    }
  }

  function paint() {
    stopRunTicker();
    if ((p.items || []).every(it => it.done)) {
      const mins = planMinutes(p, mats);
      view.innerHTML = `
        <a class="back" href="#/plan/${encodeURIComponent(p.id)}">${icon("back")}Exit class mode</a>
        <div class="emptystate">
          ${emptyArt()}
          <h3>Class complete</h3>
          <p>All ${p.items.length} items done${mins.total ? ` — about ${mins.total} minutes of material` : ""}.
            Every material was logged in its teaching log.</p>
          <a class="btn primary" href="#/plan/${encodeURIComponent(p.id)}">Back to the plan</a>
        </div>`;
      return;
    }
    view.innerHTML = stepHTML();
    wireStep();
    // a running timer survives a repaint (insert/toggle); resume its ticking
    const t = timers.get(p.items[cur]);
    if (t && t.running) { stopRunTicker(); _runTicker = setInterval(tick, 1000); }
    syncTimer();
  }
  paint();
}

// ---- inbox / import view ----
// Files shared into the app (or dropped into LessonLibrary/Inbox) land
// here. Nothing is ever bundled silently: only the most recent share
// batch is preselected, and every outcome is announced with View/Undo.
let importSelection = null; // names handed from Inbox to Quick Add

function titleFromFileNames(names) {
  const base = String(names[0] || "").replace(/\.[a-z0-9]{1,5}$/i, "");
  const words = base.replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatsFromFileNames(names) {
  const out = [];
  const add = v => { if (!out.includes(v)) out.push(v); };
  let images = 0;
  for (const n of names) {
    if (/\.(pptx?|odp|key)$/i.test(n)) add("Slides");
    else if (/\.(pdf|docx?|odt|rtf)$/i.test(n)) add("Worksheet");
    else if (/\.html?$/i.test(n)) add("HTML game");
    else if (IMAGE_RE.test(n)) images++;
  }
  if (images >= 2) add("Flashcards");
  return out;
}

function inboxTileHTML(name) {
  if (IMAGE_RE.test(name)) {
    return `<img class="fthumb" loading="lazy" alt=""
      src="/inbox-files/${encodeURIComponent(name)}">`;
  }
  return fileTileHTML(name);
}

function openMaterialPicker(subtitle) {
  const dlg = $("#matpicker");
  if (!openDialog(dlg)) return Promise.resolve(null);
  $("#mp-sub").textContent = subtitle || "";
  const input = $("#mp-q");
  input.value = "";
  function listHTML(q) {
    q = (q || "").trim().toLowerCase();
    const hits = DB.lessons.filter(m => !q || searchHay(m).includes(q))
      .slice(0, 50);
    return hits.length ? hits.map(m => `
      <button type="button" class="sheetrow" data-mid="${esc(m.id)}">
        ${icon("folder")}
        <span class="srcol"><span class="srtitle">${esc(m.title)}</span>
          <span class="srsub">${esc([(m.cefr_levels || []).join("/"),
            (m.formats || []).join(", "),
            m.files.length + " file(s)"].filter(Boolean).join(" · "))}</span></span>
      </button>`).join("") : `<p class="hint">No materials match.</p>`;
  }
  $("#mp-list").innerHTML = listHTML("");
  return new Promise(resolve => {
    function finish(val) {
      input.removeEventListener("input", onInput);
      $("#mp-list").removeEventListener("click", onPick);
      $("#mp-cancel").removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onEsc);
      if (dlg.open) dlg.close();
      resolve(val);
    }
    function onInput() { $("#mp-list").innerHTML = listHTML(input.value); }
    function onPick(e) {
      const row = e.target.closest(".sheetrow[data-mid]");
      if (!row) return;
      finish(DB.lessons.find(m => m.id === row.dataset.mid) || null);
    }
    function onCancel() { finish(null); }
    function onEsc(e) { e.preventDefault(); finish(null); }
    input.addEventListener("input", onInput);
    $("#mp-list").addEventListener("click", onPick);
    $("#mp-cancel").addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onEsc);
  });
}

function renderInbox() {
  const inbox = DB.inbox || [];
  const batch = new Set(DB.inbox_batch || []);
  if (!inbox.length) {
    view.innerHTML = `
      <h2 class="pagetitle">Inbox</h2>
      <div class="emptystate">
        ${emptyArt()}
        <h3>Nothing waiting</h3>
        <p>Share files to Material Library from any app — or drop them into
          LessonLibrary/Inbox with a file manager — and sort them from here.</p>
      </div>`;
    return;
  }
  const totalBytes = inbox.reduce((t, f) => t + (f.size || 0), 0);
  view.innerHTML = `
    <h2 class="pagetitle">Inbox</h2>
    <p class="hint pagehint">${inbox.length} file${inbox.length === 1 ? "" : "s"}
      · ${fmtSize(totalBytes)} waiting to be filed.</p>
    ${batch.size ? `<div class="banner static">${icon("sparkles")}
      <span class="bannertext"><strong>Just shared</strong> — that batch is
        selected below; older inbox files are not.</span></div>` : ""}
    <div class="selectbar">
      <span id="selcount" class="count"></span>
      <button id="selall" class="textbtn" type="button">Select all</button>
      <button id="selnone" class="textbtn" type="button">None</button>
    </div>
    <div class="filelist" id="inboxlist">
      ${inbox.map(f => `
        <div class="filerow inboxfile">
          <label class="inboxcheck">
            <input type="checkbox" class="ibpick" data-name="${esc(f.name)}"
                   ${batch.has(f.name) ? "checked" : ""}>
            ${inboxTileHTML(f.name)}
          </label>
          <span class="fcol">
            <span class="fname">${esc(f.name)}</span>
            ${batch.has(f.name) ? `<span class="fnotetext">just shared</span>` : ""}
          </span>
          <span class="fsize">${fmtSize(f.size)}</span>
          <button type="button" class="fsharebtn iconbtn" data-ibtrash="${esc(f.name)}"
                  aria-label="Move ${esc(f.name)} to Trash" title="Move to Trash">
            ${icon("trash")}</button>
        </div>`).join("")}
    </div>
    <div class="importactions">
      <button id="ib-one" class="btn primary wide" type="button">
        ${icon("plus")}<span>New material from selected</span></button>
      <button id="ib-each" class="btn wide" type="button">
        ${icon("copy")}<span>One material per file</span></button>
      <button id="ib-existing" class="btn wide" type="button">
        ${icon("folder")}<span>Add to existing material…</span></button>
      ${batch.size ? `<button id="ib-keep" class="textbtn wide" type="button">
        Keep in Inbox for later</button>` : ""}
    </div>`;

  const selected = () => $$("#inboxlist .ibpick:checked").map(cb => cb.dataset.name);

  function updateBar() {
    const n = selected().length;
    $("#selcount").textContent = n ? `${n} selected` : "Nothing selected";
    $("#ib-one").disabled = !n;
    $("#ib-each").disabled = n < 1;
    $("#ib-existing").disabled = !n;
  }
  updateBar();

  $("#inboxlist").addEventListener("change", updateBar);
  $("#selall").addEventListener("click", () => {
    $$("#inboxlist .ibpick").forEach(cb => { cb.checked = true; });
    updateBar();
  });
  $("#selnone").addEventListener("click", () => {
    $$("#inboxlist .ibpick").forEach(cb => { cb.checked = false; });
    updateBar();
  });

  $("#inboxlist").addEventListener("click", async e => {
    const btn = e.target.closest("[data-ibtrash]");
    if (!btn) return;
    const name = btn.dataset.ibtrash;
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      message: "The file moves to LessonLibrary/Trash — nothing is erased.",
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    try {
      const out = await api("/api/inbox/trash", {
        method: "POST", body: formBody({ names: JSON.stringify([name]) }) });
      DB.inbox = out.files;
      DB.inbox_batch = out.batch;
      toast("Moved to Trash");
      renderInbox();
      updateInboxBadge();
    } catch (err) {
      toast("Could not delete: " + err.message, "error");
    }
  });

  // one material holding all selected files -> hand over to Quick Add
  $("#ib-one").addEventListener("click", () => {
    importSelection = selected();
    location.hash = "#/add";
  });

  // one material per file, created right away, undoable
  $("#ib-each").addEventListener("click", async () => {
    const names = selected();
    const ok = await confirmDialog({
      title: `Create ${names.length} material${names.length === 1 ? "" : "s"}?`,
      message: "Each selected file becomes its own material, titled after " +
        "the file. You can enrich the details any time.",
      confirmLabel: "Create",
    });
    if (!ok) return;
    const created = [];
    try {
      for (const name of names) {
        const fd = new FormData();
        fd.append("title", titleFromFileNames([name]) || name);
        for (const fmt of formatsFromFileNames([name])) fd.append("formats", fmt);
        fd.append("inbox_files", JSON.stringify([name]));
        const out = await api("/api/lessons", { method: "POST", body: fd });
        created.push(out.lesson);
      }
    } catch (err) {
      toast("Import failed: " + err.message, "error");
    }
    if (!created.length) return;
    await refresh();
    render();
    toast(`${created.length} material${created.length === 1 ? "" : "s"} created`, "ok", {
      actions: [
        { label: "View", onClick: () => { location.hash = created.length === 1
            ? "#/lesson/" + encodeURIComponent(created[0].id) : "#/"; } },
        { label: "Undo", onClick: async () => {
            try {
              for (const rec of created) {
                await api("/api/lessons/" + encodeURIComponent(rec.id) +
                  "/files/to-inbox", { method: "POST",
                  body: formBody({ names: JSON.stringify(
                    rec.files.map(f => f.name)), trash_if_empty: "1" }) });
              }
              await refresh();
              render();
              toast("Import undone — the files are back in your Inbox");
            } catch (err) {
              toast("Could not undo: " + err.message, "error");
            }
          } },
      ],
    });
  });

  // attach to an existing material without touching its metadata
  $("#ib-existing").addEventListener("click", async () => {
    const names = selected();
    const target = await openMaterialPicker(
      `${names.length} file${names.length === 1 ? "" : "s"} from your Inbox`);
    if (!target) return;
    try {
      const out = await api("/api/lessons/" + encodeURIComponent(target.id) +
        "/inbox", { method: "POST",
        body: formBody({ inbox_files: JSON.stringify(names),
                         inbox_notes: "{}" }) });
      const attached = out.attached || [];
      await refresh();
      render();
      toast(`${attached.length} file${attached.length === 1 ? "" : "s"} added to “${target.title}”`, "ok", {
        actions: [
          { label: "View", onClick: () => {
              location.hash = "#/lesson/" + encodeURIComponent(target.id); } },
          { label: "Undo", onClick: async () => {
              try {
                await api("/api/lessons/" + encodeURIComponent(target.id) +
                  "/files/to-inbox", { method: "POST",
                  body: formBody({ names: JSON.stringify(attached) }) });
                await refresh();
                render();
                toast("Undone — the files are back in your Inbox");
              } catch (err) {
                toast("Could not undo: " + err.message, "error");
              }
            } },
        ],
      });
    } catch (err) {
      toast("Could not attach: " + err.message, "error");
    }
  });

  const keep = $("#ib-keep");
  if (keep) {
    keep.addEventListener("click", async () => {
      try {
        await api("/api/inbox/batch/clear", { method: "POST", body: formBody({}) });
        DB.inbox_batch = [];
        renderInbox();
        toast("No rush — they'll wait in your Inbox");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }
}

// ---- reflections feed (Feature A) ----
let reflectFilter = "all";   // "all" | "needs" | "low"

async function renderReflections() {
  view.innerHTML = `<h2 class="pagetitle">Reflections</h2>
    <div class="skel row"></div><div class="skel row"></div>`;
  let feed;
  try {
    feed = (await api("/api/reflections")).reflections || [];
  } catch (err) {
    view.innerHTML = `<h2 class="pagetitle">Reflections</h2>
      <p class="empty">Could not load reflections: ${esc(err.message)}</p>`;
    return;
  }
  if (route().view !== "reflections") return;  // navigated away meanwhile

  const counts = {
    all: feed.length,
    needs: feed.filter(r => r.needs_revision).length,
    low: feed.filter(r => r.rating && r.rating <= 2).length,
  };
  const CHIPS = [["all", "All"], ["needs", "Needs revision"], ["low", "1★–2★"]];

  function shown() {
    if (reflectFilter === "needs") return feed.filter(r => r.needs_revision);
    if (reflectFilter === "low") return feed.filter(r => r.rating && r.rating <= 2);
    return feed;
  }

  function rowHTML(r) {
    return `<a class="card reflectrow" href="#/lesson/${encodeURIComponent(r.material_id)}">
      <div class="card-body">
        <div class="reflecthead">
          <span class="reflectdate">${esc(fmtDate(r.date))}</span>
          ${r.rating ? starsHTML(r.rating) : ""}
          ${r.needs_revision ? `<span class="revbadge">${icon("alert")}Needs revision</span>` : ""}
        </div>
        <div class="card-title">${esc(r.material_name)}</div>
        ${r.group ? `<div class="card-foot"><span>${icon("users")}${esc(r.group)}</span></div>` : ""}
        ${r.reflection ? `<div class="reflectext">${esc(r.reflection)}</div>` : ""}
      </div>
      ${icon("chevron", "card-chev")}
    </a>`;
  }

  function paint() {
    const rows = shown();
    view.innerHTML = `
      <h2 class="pagetitle">Reflections</h2>
      <p class="hint pagehint">How your materials went in class — tap one to open it.</p>
      <div class="chips reflectchips" id="reflectchips">
        ${CHIPS.map(([k, label]) => `<button type="button"
          class="chip${reflectFilter === k ? " on" : ""}" data-rf="${k}"
          aria-pressed="${reflectFilter === k}"><span>${label}</span>
          <span class="fcount">${counts[k]}</span></button>`).join("")}
      </div>
      ${rows.length ? `<div class="results">${rows.map(rowHTML).join("")}</div>`
        : `<div class="emptystate">${emptyArt()}<h3>Nothing here yet</h3>
            <p>${reflectFilter === "all"
              ? "Rate and reflect after a class: in class mode tap Done then Reflect, or use the ★ on any teaching-log entry."
              : "No entries match this filter."}</p></div>`}`;
    $("#reflectchips").addEventListener("click", e => {
      const c = e.target.closest("[data-rf]");
      if (!c || c.dataset.rf === reflectFilter) return;
      reflectFilter = c.dataset.rf;
      paint();
    });
  }
  paint();
}

// ---- health view ----
async function renderHealth() {
  view.innerHTML = `<h2 class="pagetitle">Library health</h2>
    <div class="skel row"></div><div class="skel row"></div>`;
  let h;
  try {
    h = await api("/api/health");
  } catch (err) {
    view.innerHTML = `<h2 class="pagetitle">Library health</h2>
      <p class="empty">Could not load health data: ${esc(err.message)}</p>`;
    return;
  }
  if (route().view !== "health") return; // user navigated away meanwhile

  const trashRows = (h.trash || []).map(t => `
    <div class="filerow">
      <span class="ftile ft-zip">${icon("trash")}</span>
      <span class="fcol">
        <span class="fname">${esc(t.name)}</span>
        <span class="fnotetext">trashed ${esc(relDate(t.trashed))}</span>
      </span>
      <span class="fsize">${fmtSize(t.size)}</span>
    </div>`).join("");

  view.innerHTML = `
    <h2 class="pagetitle">Library health</h2>

    <div class="formcard">
      <h3>${icon("database")}Storage</h3>
      <div class="statgrid">
        <div class="stat"><b>${h.materials}</b><span>materials</span></div>
        <div class="stat"><b>${h.files}</b><span>files</span></div>
        <div class="stat"><b>${fmtSize(h.bytes) || "0 B"}</b><span>used</span></div>
        <div class="stat"><b>${h.plans}</b><span>plans</span></div>
      </div>
      <p class="hint">Everything lives in plain folders at ${esc(h.data_dir)} —
        visible to your file manager and backed up with it.</p>
      <a class="btn wide" href="/api/export.csv" target="_blank" rel="noopener">
        ${icon("download")}<span>Export index as CSV</span></a>
    </div>

    <div class="formcard">
      <h3>${icon("inbox")}Inbox</h3>
      ${(h.inbox || []).length ? `
        <p class="hint">${h.inbox.length} file${h.inbox.length === 1 ? "" : "s"}
          (${fmtSize(h.inbox_bytes)}) waiting to be filed.</p>
        <a class="btn wide" href="#/inbox">${icon("inbox")}<span>Open Inbox</span></a>`
      : `<p class="hint">Empty. Share files to Material Library from any app —
          or drop them into LessonLibrary/Inbox with a file manager — and
          they'll wait here until you attach them.</p>`}
    </div>

    ${h.needs_revision ? `
    <div class="formcard">
      <h3>${icon("star")}Reflections</h3>
      <a class="filerow" href="#/reflections" id="needsrevstat">
        <span class="ftile ft-use">${icon("alert")}</span>
        <span class="fcol">
          <span class="fname">${h.needs_revision} material${h.needs_revision === 1 ? "" : "s"}
            need${h.needs_revision === 1 ? "s" : ""} revision</span>
          <span class="fnotetext">Flagged in a teaching-log reflection</span>
        </span>
        ${icon("chevron", "card-chev")}
      </a>
    </div>` : ""}

    <div class="formcard">
      <h3>${icon("tags")}Tagging gaps</h3>
      ${(h.untagged || []).length ? `
        <p class="hint">These can't be found by some filters yet:</p>
        <div class="filelist">
          ${h.untagged.map(u => `
            <a class="filerow" href="#/edit/${encodeURIComponent(u.id)}">
              <span class="fcol">
                <span class="fname">${esc(u.title)}</span>
                <span class="fnotetext">missing: ${esc(u.missing.join(", "))}</span>
              </span>
              ${icon("chevron", "card-chev")}
            </a>`).join("")}
        </div>`
      : `<p class="hint">Every material has a level, skills, format, and topics. Nice.</p>`}
    </div>

    <div class="formcard" id="health-backup">
      <h3>${icon("cloud")}Backup</h3>
      <p class="hint">Loading backup status…</p>
    </div>

    <div class="formcard">
      <h3>${icon("trash")}Trash</h3>
      ${(h.trash || []).length ? `
        <p class="hint">${h.trash.length} item${h.trash.length === 1 ? "" : "s"}
          · ${fmtSize(h.trash_bytes)}. Restore by moving a folder back into
          LessonLibrary/lessons with a file manager, then Rescan.</p>
        <div class="filelist">${trashRows}</div>
        <button id="emptytrash" class="btn danger wide" type="button">
          ${icon("trash")}<span>Empty Trash permanently</span></button>`
      : `<p class="hint">Trash is empty.</p>`}
    </div>`;

  const nrs = $("#needsrevstat");
  if (nrs) nrs.addEventListener("click", () => { reflectFilter = "needs"; });

  // backup status card (async — fills in once /api/backup/status resolves)
  refreshBackupInfo().then(() => {
    const card = $("#health-backup");
    if (!card || route().view !== "health") return;
    const info = backupInfo;
    card.innerHTML = `<h3>${icon("cloud")}Backup</h3>` + (info.configured ? `
      <div class="bkstat"><span class="bkdot ${info.is_due ? "due" : "ok"}"></span>
        <span>${info.last_backup_at
          ? "Last backup " + esc(relDate(info.last_backup_at)) +
            (info.last_backup_size_bytes ? " · " + fmtSize(info.last_backup_size_bytes) : "")
          : "Never backed up yet"}</span></div>
      ${(info.materials_added_since_last_backup || 0)
        ? `<p class="hint">${info.materials_added_since_last_backup} material(s) added since the last backup.</p>` : ""}
      <div class="bkrow">
        <button id="hb-now" class="btn primary" type="button">${icon("cloudup")}<span>Back up now</span></button>
        <button id="hb-restore" class="btn" type="button">${icon("cloud")}<span>Restore…</span></button>
      </div>`
    : `<p class="hint">Not set up yet — keep your library safe on Drive.</p>
       <a class="btn wide" href="#/settings">${icon("cloud")}<span>Set up backup</span></a>`);
    const hbnow = $("#hb-now");
    if (hbnow) hbnow.addEventListener("click", async () => { await doBackupNow(); renderHealth(); });
    const hbr = $("#hb-restore");
    if (hbr) hbr.addEventListener("click", openRestore);
  });

  const emptyBtn = $("#emptytrash");
  if (emptyBtn) {
    emptyBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Empty Trash?",
        message: `This permanently deletes ${h.trash.length} item(s) ` +
          `(${fmtSize(h.trash_bytes)}). This is the only action in the app ` +
          "that cannot be undone.",
        confirmLabel: "Delete forever",
      });
      if (!ok) return;
      try {
        const out = await api("/api/trash/empty", { method: "POST", body: formBody({}) });
        toast(`Trash emptied — ${out.removed} item(s) removed`);
        renderHealth();
      } catch (err) {
        toast("Could not empty Trash: " + err.message, "error");
      }
    });
  }
}

// ---- backup & restore (Feature E) ----
// The only feature that can reach a network, and only via a destination the
// teacher explicitly configured. backupInfo caches /api/backup/status so the
// home banner and settings stay in sync without refetching constantly.
let backupInfo = null;
let backupDismissed = false;   // reminder banner dismissed this session

function onAndroid() {
  return !!(window.MLBridge && typeof MLBridge.pickBackupFolder === "function");
}

async function refreshBackupInfo() {
  try {
    const res = await fetch("/api/backup/status");
    backupInfo = res.ok ? await res.json() : { configured: false };
  } catch (e) {
    backupInfo = { configured: false };
  }
  return backupInfo;
}

async function putBackupConfig(patch) {
  const out = await api("/api/backup/config", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch) });
  backupInfo = out;
  return out;
}

// Android calls this back from the SAF folder picker (see MainActivity).
window.onBackupFolderPicked = function (uri) {
  if (!uri) return;
  putBackupConfig({ destination_type: "saf", destination_uri: uri })
    .then(() => { toast("Backup folder connected"); if (route().view === "settings") renderSettings(); })
    .catch(err => toast("Could not connect: " + err.message, "error"));
};

async function doBackupNow() {
  if (!backupInfo || !backupInfo.configured) {
    toast("Set up a backup destination first");
    location.hash = "#/settings";
    return null;
  }
  toast("Backing up…", "ok", { duration: 2000 });
  try {
    const out = await api("/api/backup/now", { method: "POST", body: formBody({}) });
    await refreshBackupInfo();
    toast(`Backed up ${out.material_count} material${out.material_count === 1 ? "" : "s"} · ${fmtSize(out.bytes)}`);
    return out;
  } catch (err) {
    toast("Backup failed: " + err.message, "error");
    return null;
  }
}

function backupReminderText(info) {
  if (!info.last_backup_at) return "You haven't backed up yet.";
  if (info.auto_frequency === "after_n_materials" &&
      (info.materials_added_since_last_backup || 0) >= (info.after_n_value || 0) &&
      (info.after_n_value || 0) > 0) {
    return `${info.materials_added_since_last_backup} new materials since your last backup.`;
  }
  return `Last backup was ${relDate(info.last_backup_at)}.`;
}

// Non-blocking reminder on the library home; only when a backup is actually due.
function renderBackupBanner() {
  const el = $("#backupbanner");
  if (!el) return;
  const info = backupInfo;
  const due = info && info.configured && info.is_due && !backupDismissed;
  if (!due) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="banner static backupbanner">
    ${icon("cloudup")}
    <span class="bannertext"><strong>Time to back up</strong> — ${esc(backupReminderText(info))}</span>
    <span class="bannerbtns">
      <button type="button" class="textbtn" id="bk-now">Back up now</button>
      <button type="button" class="textbtn" id="bk-dismiss">Dismiss</button>
    </span>
  </div>`;
  $("#bk-now").addEventListener("click", async () => {
    await doBackupNow();
    renderBackupBanner();
  });
  $("#bk-dismiss").addEventListener("click", () => {
    backupDismissed = true;
    renderBackupBanner();
  });
}

// Restore flow: list backups, pick a strategy, confirm. Built on demand.
async function openRestore() {
  if (!backupInfo || !backupInfo.configured) { toast("Set up backup first"); return; }
  let backups;
  try {
    backups = (await api("/api/backup/list")).backups || [];
  } catch (err) {
    toast("Could not list backups: " + err.message, "error");
    return;
  }
  if (!backups.length) { toast("No backups found in the destination yet"); return; }
  let dlg = $("#restoredlg");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "restoredlg";
    dlg.className = "dlg formdlg";
    document.body.appendChild(dlg);
  }
  let picked = backups[0].name;
  let strategy = "merge_skip";
  const STRAT = [
    ["merge_skip", "Merge — keep mine", "Add new materials from the backup; keep my versions of any that clash."],
    ["merge_overwrite", "Merge — use backup", "Add new materials and replace my versions with the backup's."],
    ["replace_all", "Replace everything", "Move my current library aside and restore the backup wholesale."],
  ];
  function paintRestore() {
    dlg.innerHTML = `
      <h2>Restore from backup</h2>
      <p class="dlg-sub">Your current library is backed up automatically first, so this is undoable.</p>
      <label class="field"><span>Backup</span>
        <select id="rs-pick">${backups.map(b =>
          `<option value="${esc(b.name)}">${esc(b.name.replace(/^lesson-library-backup-/, "").replace(/\.zip$/, ""))}${
            b.size_bytes ? " · " + fmtSize(b.size_bytes) : ""}</option>`).join("")}</select>
      </label>
      <div class="field"><span>How to merge</span>
        <div class="stratlist">${STRAT.map(([k, label, desc]) =>
          `<button type="button" class="stratopt ${k === strategy ? "on" : ""}" data-strat="${k}">
            <span class="stratmark">${icon(k === strategy ? "circlecheck" : "circle")}</span>
            <span class="stratcol"><span class="strattitle">${esc(label)}</span>
              <span class="stratdesc">${esc(desc)}</span></span>
          </button>`).join("")}</div>
      </div>
      <div class="dlg-actions">
        <button type="button" id="rs-cancel" class="btn">Cancel</button>
        <button type="button" id="rs-go" class="btn primary">Restore</button>
      </div>`;
    $("#rs-pick").addEventListener("change", e => { picked = e.target.value; });
    $$(".stratopt", dlg).forEach(b => b.addEventListener("click", () => {
      strategy = b.dataset.strat; paintRestore();
    }));
    $("#rs-cancel").addEventListener("click", () => dlg.close());
    $("#rs-go").addEventListener("click", onRestore);
  }
  async function onRestore() {
    const destructive = strategy === "replace_all";
    const ok = await confirmDialog({
      title: destructive ? "Replace your whole library?" : "Restore from backup?",
      message: destructive
        ? "Your current library moves to a Trash-restore folder first, then the backup is restored. You can undo by moving it back."
        : "New materials are added from the backup. Your current library is backed up first.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    dlg.close();
    toast("Restoring…", "ok", { duration: 2000 });
    try {
      const out = await api("/api/backup/restore", { method: "POST",
        body: formBody({ backup_name: picked, strategy }) });
      await refresh();
      await refreshBackupInfo();
      render();
      const parts = [];
      if (out.restored) parts.push(`${out.restored.length} restored`);
      if (out.added) parts.push(`${out.added.length} added`);
      if (out.overwritten && out.overwritten.length) parts.push(`${out.overwritten.length} replaced`);
      if (out.skipped && out.skipped.length) parts.push(`${out.skipped.length} kept`);
      let msg = "Restore complete" + (parts.length ? " — " + parts.join(", ") : "");
      toast(msg);
      if (out.conflicts && out.conflicts.length) {
        toast(`${out.conflicts.length} material${out.conflicts.length === 1 ? "" : "s"} differed between devices — review them`, "error", { duration: 8000 });
      }
    } catch (err) {
      toast("Restore failed: " + err.message, "error");
    }
  }
  paintRestore();
  openDialog(dlg);
}

function backupDestinationLabel(info) {
  if (info.destination_type === "saf") return "Cloud folder (Drive / SAF)";
  if (info.destination_type === "local") return info.destination_path || "Local folder";
  return "";
}

function backupSettingsHTML() {
  const info = backupInfo;
  if (!info) return `<p class="hint">Checking backup status…</p>`;
  if (!info.configured) {
    return `<p class="hint">Keep a copy of your whole library on Google Drive
      (or any cloud) and restore it on another phone. Nothing leaves your
      device until you connect a destination.</p>
      ${onAndroid()
        ? `<button id="bk-pick" class="btn primary wide" type="button">${icon("cloud")}<span>Choose a Drive folder…</span></button>`
        : `<label class="field"><span>Backup folder path</span>
            <input type="text" id="bk-path" autocomplete="off" spellcheck="false"
                   placeholder="e.g. /sdcard/Download/lesson-backups">
           </label>
           <button id="bk-connect" class="btn primary wide" type="button">${icon("cloud")}<span>Connect this folder</span></button>
           <p class="hint">On Termux/desktop, point this at a folder your own
             sync tool (rclone, Insync…) keeps on Drive.</p>`}`;
  }
  const last = info.last_backup_at
    ? `Last backup ${relDate(info.last_backup_at)}${info.last_backup_size_bytes ? " · " + fmtSize(info.last_backup_size_bytes) : ""}`
    : "Never backed up yet";
  const reminderOpts = [["0", "Never"], ["3", "Every 3 days"], ["7", "Weekly"],
                        ["14", "Every 2 weeks"], ["30", "Monthly"]];
  const autoOpts = [["never", "Off"], ["weekly", "Weekly"],
                    ["after_n_materials", "After N new materials"]];
  const nOpts = ["5", "10", "20"];
  const rd = String(info.reminder_days == null ? 7 : info.reminder_days);
  const af = info.auto_frequency || "never";
  const nv = String(info.after_n_value || 10);
  return `
    <div class="bkstat"><span class="bkdot ${info.is_due ? "due" : "ok"}"></span>
      <span>${esc(last)}</span></div>
    <p class="hint">Destination: <b>${esc(backupDestinationLabel(info))}</b></p>
    <div class="bkrow">
      <button id="bk-now" class="btn primary" type="button">${icon("cloudup")}<span>Back up now</span></button>
      <button id="bk-restore" class="btn" type="button">${icon("cloud")}<span>Restore…</span></button>
    </div>
    <label class="field"><span>Remind me to back up</span>
      <select id="bk-remind">${reminderOpts.map(([v, l]) =>
        `<option value="${v}" ${v === rd ? "selected" : ""}>${l}</option>`).join("")}</select>
    </label>
    <label class="field"><span>Auto-backup</span>
      <select id="bk-auto">${autoOpts.map(([v, l]) =>
        `<option value="${v}" ${v === af ? "selected" : ""}>${l}</option>`).join("")}</select>
    </label>
    <label class="field" id="bk-nfield" ${af === "after_n_materials" ? "" : "hidden"}>
      <span>After how many new materials</span>
      <select id="bk-n">${nOpts.map(v =>
        `<option value="${v}" ${v === nv ? "selected" : ""}>${v}</option>`).join("")}</select>
    </label>
    <button id="bk-disconnect" class="textbtn wide" type="button">Disconnect</button>`;
}

function wireBackupSettings() {
  const pick = $("#bk-pick");
  if (pick) pick.addEventListener("click", () => {
    try { MLBridge.pickBackupFolder(); }
    catch (e) { toast("Folder picker unavailable", "error"); }
  });
  const connect = $("#bk-connect");
  if (connect) connect.addEventListener("click", async () => {
    const path = $("#bk-path").value.trim();
    if (!path) { toast("Enter a folder path"); return; }
    try {
      await putBackupConfig({ destination_type: "local", destination_path: path });
      toast("Backup folder connected");
      renderSettings();
    } catch (err) { toast("Could not connect: " + err.message, "error"); }
  });
  const now = $("#bk-now");
  if (now) now.addEventListener("click", async () => { await doBackupNow(); renderSettings(); });
  const restore = $("#bk-restore");
  if (restore) restore.addEventListener("click", openRestore);
  const disc = $("#bk-disconnect");
  if (disc) disc.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Disconnect backup?",
      message: "This stops backups and forgets the destination. Backups " +
        "already saved there are not deleted.",
      confirmLabel: "Disconnect" });
    if (!ok) return;
    try {
      await api("/api/backup/disconnect", { method: "POST", body: formBody({}) });
      if (window.MLBridge && typeof MLBridge.forgetBackupFolder === "function") {
        try { MLBridge.forgetBackupFolder(); } catch (e) { /* off-device */ }
      }
      await refreshBackupInfo();
      renderSettings();
      toast("Backup disconnected");
    } catch (err) { toast(err.message, "error"); }
  });
  const remind = $("#bk-remind");
  if (remind) remind.addEventListener("change", () => {
    putBackupConfig({ reminder_days: parseInt(remind.value, 10) }).catch(() => {});
  });
  const auto = $("#bk-auto");
  if (auto) auto.addEventListener("change", () => {
    const f = $("#bk-nfield"); if (f) f.hidden = auto.value !== "after_n_materials";
    putBackupConfig({ auto_frequency: auto.value,
                      after_n_value: parseInt(($("#bk-n") || { value: "10" }).value, 10) })
      .catch(() => {});
  });
  const n = $("#bk-n");
  if (n) n.addEventListener("change", () => {
    putBackupConfig({ auto_frequency: "after_n_materials",
                      after_n_value: parseInt(n.value, 10) }).catch(() => {});
  });
}

// ---- settings view ----
// Maintenance lives here, not in daily navigation: theme, manual rescan,
// health & diagnostics, backup/export, storage location.
function renderSettings() {
  const pref = themePref();
  view.innerHTML = `
    <h2 class="pagetitle">Settings</h2>

    <div class="formcard">
      <h3>${icon("sparkles")}Appearance</h3>
      <div class="field"><span>Theme</span>
        <div class="sortseg themeseg" role="group" aria-label="Theme">
          <button type="button" data-pref="system" class="${pref === "system" ? "on" : ""}"
                  aria-pressed="${pref === "system"}">${icon("monitor")}<span>Auto</span></button>
          <button type="button" data-pref="light" class="${pref === "light" ? "on" : ""}"
                  aria-pressed="${pref === "light"}">${icon("sun")}<span>Light</span></button>
          <button type="button" data-pref="dark" class="${pref === "dark" ? "on" : ""}"
                  aria-pressed="${pref === "dark"}">${icon("moon")}<span>Dark</span></button>
        </div>
      </div>
    </div>

    <div class="formcard">
      <h3>${icon("rescan")}Library</h3>
      <p class="hint">The library rescans itself when you return to the app,
        and you can pull down on the Library list to refresh. Use this if a
        file-manager change still isn't showing.</p>
      <button id="rescannow" class="btn wide" type="button">
        ${icon("rescan")}<span>Rescan folders now</span></button>
    </div>

    <div class="formcard">
      <h3>${icon("activity")}Health &amp; maintenance</h3>
      <p class="hint">Storage use, tagging gaps, and the Trash — including
        restore instructions and the only permanent delete.</p>
      <a class="btn wide" href="#/health">${icon("activity")}<span>Open health &amp; diagnostics</span></a>
    </div>

    <div class="formcard">
      <h3>${icon("cloud")}Backup &amp; restore</h3>
      <div id="backupcard">${backupSettingsHTML()}</div>
    </div>

    <div class="formcard">
      <h3>${icon("download")}Export</h3>
      <p class="hint">Everything also lives in plain folders at
        <b id="set-dir">…</b>, so your file manager and USB transfer see every
        file. The CSV export adds a spreadsheet-friendly index of all metadata.</p>
      <a class="btn wide" href="/api/export.csv" target="_blank" rel="noopener">
        ${icon("download")}<span>Export index as CSV</span></a>
    </div>`;

  $$(".themeseg button").forEach(b => b.addEventListener("click", () => {
    setThemePref(b.dataset.pref);
    $$(".themeseg button").forEach(x => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
  }));

  $("#rescannow").addEventListener("click", async () => {
    const btn = $("#rescannow");
    btn.disabled = true;
    try {
      await rescan();
    } catch (err) {
      toast("Rescan failed: " + err.message, "error");
      btn.disabled = false;
    }
  });

  wireBackupSettings();
  refreshBackupInfo().then(() => {
    if (route().view !== "settings") return;
    const c = $("#backupcard");
    if (c) { c.innerHTML = backupSettingsHTML(); wireBackupSettings(); }
  });

  api("/api/health").then(h => {
    const el = $("#set-dir");
    if (el) el.textContent = h.data_dir;
  }).catch(() => { /* offline against its own server: unlikely */ });
}

// ---- add / edit / repair form ----
// Quick Add presets: one tap fills the teacher's recurring contexts.
// Values must exist in the option catalogs (or taxonomy.json for exams).
const PRESETS = [
  { label: "Cambridge Starters",
    fields: { age_groups: ["Young Learners"], cefr_levels: ["Pre-A1"],
              exam_targets: ["Cambridge English: Pre A1 Starters"] } },
  { label: "Pre-K",
    fields: { age_groups: ["Young Learners"], cefr_levels: ["Pre-A1"],
              skills: ["Vocabulary"] } },
  { label: "A2 Teens",
    fields: { age_groups: ["Teens"], cefr_levels: ["A2"] } },
  { label: "IELTS Writing",
    fields: { age_groups: ["Adults"], exam_targets: ["IELTS Academic"],
              skills: ["Writing"] } },
  { label: "IELTS Speaking",
    fields: { age_groups: ["Adults"], exam_targets: ["IELTS Academic"],
              skills: ["Speaking"] } },
  { label: "Printable activity",
    fields: { formats: ["Worksheet"] } },
  { label: "Classroom game",
    fields: { formats: ["Cut-up cards"], skills: ["Speaking"] } },
];

function blankMaterial() {
  return { title: "", age_groups: [], cefr_levels: [], exam_targets: [],
           skills: [], grammar_points: [], vocab_focuses: [], topics: [],
           themes: [], formats: [], duration_min: null, notes: "", files: [],
           usage: [] };
}

function chipGroupHTML(key, label, options, selected) {
  const sel = (selected || []).filter(Boolean);
  const isOn = v => sel.some(s => s.toLowerCase() === v.toLowerCase());
  return `<div class="field facetrow"><span class="facetlabel">${label}</span>
    <div class="chips" data-key="${key}">
      ${options.map(v =>
        `<button type="button" class="chip${isOn(v) ? " on" : ""}"
                 aria-pressed="${isOn(v)}"
                 data-v="${esc(v)}"><span>${esc(v)}</span>${icon("circlecheck", "chip-ic")}</button>`).join("")}
    </div></div>`;
}

function renderForm({ view: mode, id }) {
  let material = blankMaterial();
  let problem = "";
  if (mode === "edit") {
    const m = DB.lessons.find(x => x.id === id);
    if (!m) {
      view.innerHTML = `<a class="back" href="#/">${icon("back")}Library</a>
        <p class="empty">Material not found.</p>`;
      return;
    }
    material = m;
  } else if (mode === "repair") {
    const e = (DB.needs_attention || []).find(x => x.id === id);
    if (!e) { location.replace("#/lesson/" + encodeURIComponent(id)); return; }
    material = Object.assign(blankMaterial(), e.draft);
    if (!material.title) material.title = id.replace(/-+/g, " ");
    material.files = e.files;
    problem = e.problem;
  }

  const ageOptions = withInUse(DB.options.age_groups, "age_groups");
  const skillOptions = withInUse(DB.options.skills, "skills");
  const formatOptions = withInUse(DB.options.formats, "formats");
  const inbox = DB.inbox || [];

  const heading = mode === "add" ? "Add material"
                : mode === "edit" ? "Edit material" : "Fix metadata";
  const saveLabel = mode === "add" ? "Save material" : "Save changes";
  const backHash = mode === "edit" ? "#/lesson/" + encodeURIComponent(id) : "#/";

  // Quick Add: capture first (files + title + format fit one screen), the
  // full cataloguing form stays one tap away. Edit/repair show everything.
  const quick = mode === "add";
  // Only the most recently shared batch (or an explicit Inbox selection)
  // is preselected — never the whole Inbox.
  const preselect = new Set(quick ? importSelection || DB.inbox_batch || [] : []);
  importSelection = null;

  view.innerHTML = `
    <a class="back" href="${backHash}">${icon("back")}Back</a>
    <h2>${heading}${mode === "add" ? "" : " — " + esc(id)}</h2>
    ${quick ? `<p class="hint pagehint">A title is enough — save now, enrich later.</p>` : ""}
    ${problem ? `<div class="problem">${icon("alert")}<div>
       <strong>Problem:</strong> ${esc(problem)}. Saving writes a fresh lesson.json.</div></div>` : ""}
    <form id="f">
      <div class="formcard">
        <h3>${icon("folder")}Files<span id="attmeta" class="attmeta"></span></h3>
        ${!inbox.length ? "" : `
          <div class="field"><span>From your Inbox</span>
            <div id="inboxrows">
              ${inbox.map(fl => `
                <div class="frow inboxrow">
                  <div class="fmain">
                    <label class="inboxcheck">
                      <input type="checkbox" class="inboxpick" data-name="${esc(fl.name)}"
                             ${preselect.has(fl.name) ? "checked" : ""}>
                      ${fileTileHTML(fl.name)}
                    </label>
                    <span class="fname">${esc(fl.name)}</span>
                    <span class="fsize">${fmtSize(fl.size)}</span>
                  </div>
                  <input type="text" class="fnote inboxnote" data-name="${esc(fl.name)}"
                         placeholder="Optional note — e.g. Student handout">
                </div>`).join("")}
            </div>
            <div class="hint">Ticked files move from LessonLibrary/Inbox into
              this material's folder when you save.</div>
          </div>`}
        ${mode === "add" ? "" : `
          <div class="field"><span>Already in the folder</span>
            <div id="existingrows">
              ${material.files.map(fl => `
                <div class="frow">
                  <div class="fmain">
                    ${fileTileHTML(fl.name)}
                    <span class="fname">${esc(fl.name)}</span>
                    <span class="fsize">${fmtSize(fl.size)}</span>
                  </div>
                  <input type="text" class="fnote" data-name="${esc(fl.name)}"
                         placeholder="Optional note — e.g. Teacher answer key"
                         value="${esc(fl.note || "")}">
                </div>`).join("") || `<div class="hint">No files yet.</div>`}
            </div>
          </div>`}
        <div class="field"><span>${mode === "add" ? "Attach files" : "Add more files"}</span>
          <label class="filebtn">${icon("plus")}<span>Add files</span>
            <input type="file" id="filepick" multiple hidden>
          </label>
          <div id="filerows"></div>
        </div>
      </div>
      <div class="formcard">
        <h3>${icon("info")}Basics</h3>
        <label class="ofield">
          <input type="text" name="title" required autocomplete="off"
                 value="${esc(material.title)}" placeholder=" ">
          <span class="oflabel">Title *</span>
          <span class="ofield-ic" aria-hidden="true">${icon("filetext")}</span>
          <button type="button" id="titleclear" class="ofield-x"
                  aria-label="Clear title" ${material.title ? "" : "hidden"}>${icon("x")}</button>
        </label>
        <div id="suggestwrap" hidden>
          <div class="suggestlabel">${icon("sparkles")}Suggested tags</div>
          <div class="chips wrap" id="suggestrow"></div>
        </div>
        ${!quick ? "" : `
        <div class="field"><span>Presets — one tap fills the details</span>
          <div class="chips wrap" id="presetrow">
            ${PRESETS.map((p, i) => `<button type="button" class="chip preset"
              data-p="${i}" aria-pressed="false"><span>${esc(p.label)}</span>${icon("circlecheck", "chip-ic")}</button>`).join("")}
          </div>
        </div>`}
        ${chipGroupHTML("formats", "Format", formatOptions, material.formats)}
      </div>
      ${!quick ? "" : `
      <button type="button" id="moredetails" class="btn wide expander" aria-expanded="false">
        ${icon("sliders")}<span>Add details — level, skills, topics</span>${icon("down")}
      </button>`}
      <div id="detailwrap" ${quick ? "hidden" : ""}>
        <div class="formcard">
          <h3>${icon("user")}Learners</h3>
          ${chipGroupHTML("age_groups", "Age", ageOptions, material.age_groups)}
          ${chipGroupHTML("cefr_levels", "CEFR",
            withInUse(DB.options.cefr_levels, "cefr_levels"), material.cefr_levels)}
          <div data-slot="exam_targets"></div>
        </div>
        <div class="formcard">
          <h3>${icon("target")}Language focus</h3>
          ${chipGroupHTML("skills", "Skills", skillOptions, material.skills)}
          <div data-slot="grammar_points"></div>
          <div data-slot="vocab_focuses"></div>
          <div data-slot="topics"></div>
          <div data-slot="themes"></div>
        </div>
        <div class="formcard">
          <h3>${icon("pencil")}Extras</h3>
          <label class="field"><span>Duration (minutes)</span>
            <input type="number" name="duration_min" min="1" step="1" inputmode="numeric"
                   value="${material.duration_min || ""}">
          </label>
          <label class="field"><span>Memory hooks</span>
            <textarea name="notes" placeholder="how the class went, what to reuse…">${esc(material.notes)}</textarea>
          </label>
        </div>
      </div>
      <div class="savebar">
        <button id="savebtn" class="btn primary big wide" type="submit">
          ${icon("check")}<span>${esc(saveLabel)}</span></button>
      </div>
    </form>`;

  // searchable multi-select comboboxes (one shared component)
  const boxes = new Map();
  const cbxDefs = [
    ["exam_targets", "Exam targets",
      "Optional. Leave empty for general CEFR-level material.",
      DB.taxonomy.exam_targets],
    ["grammar_points", "Grammar points",
      "Optional. Leave empty if this material has no grammar focus.",
      DB.taxonomy.grammar_points],
    ["vocab_focuses", "Vocabulary focuses", null, DB.taxonomy.vocab_focuses],
    ["topics", "Topics", null, DB.taxonomy.topics],
    ["themes", "Themes", null, DB.taxonomy.themes],
  ];
  for (const [key, label, helper, groups] of cbxDefs) {
    const box = combobox({
      key, label, helper, groups,
      selected: material[key],
      allowCustom: true,
      placeholder: "Tap to search or add…",
      onChange: () => refreshSuggestions(),
    });
    $(`[data-slot="${key}"]`).replaceWith(box.el);
    boxes.set(key, box);
  }

  // multi-select chip groups (ages, skills, formats)
  $("#f").addEventListener("click", e => {
    const chip = e.target.closest(".chips[data-key] .chip");
    if (chip) {
      chip.classList.toggle("on");
      chip.setAttribute("aria-pressed", chip.classList.contains("on"));
      refreshSuggestions();
    }
  });

  // ---- offline tag suggestions: match title + file names against the
  // catalogs the library already knows. No network, no magic — word matching.
  const CHIP_FIELDS = ["age_groups", "cefr_levels", "skills", "formats"];
  function chipApplied(key, value) {
    return $$(`.chips[data-key="${key}"] .chip.on`, $("#f"))
      .some(c => c.dataset.v.toLowerCase() === value.toLowerCase());
  }
  function suggestionCandidates() {
    const out = [];
    for (const key of CHIP_FIELDS) {
      const opts = key === "age_groups" ? ageOptions
                 : key === "skills" ? skillOptions
                 : key === "formats" ? formatOptions
                 : withInUse(DB.options.cefr_levels, "cefr_levels");
      for (const v of opts) out.push({ field: key, value: v });
    }
    for (const [field] of [["exam_targets"], ["grammar_points"],
                           ["vocab_focuses"], ["topics"], ["themes"]]) {
      for (const g of DB.taxonomy[field] || []) {
        for (const v of g.options) out.push({ field, value: v });
      }
    }
    return out;
  }
  const CANDIDATES = suggestionCandidates();

  function refreshSuggestions() {
    const wrap = $("#suggestwrap");
    if (!wrap) return;
    const names = [
      ...pickedFiles.map(pf => pf.file.name),
      ...material.files.map(fl => fl.name),
      ...$$("#inboxrows .inboxpick:checked").map(cb => cb.dataset.name),
    ];
    const hay = ($("#f").elements.namedItem("title").value + " " +
      names.join(" ")).toLowerCase();
    if (hay.trim().length < 3) { wrap.hidden = true; return; }
    const found = [];
    for (const cand of CANDIDATES) {
      const v = cand.value;
      if (v.length < 2 || (v.length < 3 && cand.field !== "cefr_levels")) continue;
      const applied = CHIP_FIELDS.includes(cand.field)
        ? chipApplied(cand.field, v)
        : boxes.get(cand.field) && boxes.get(cand.field).has(v);
      if (applied) continue;
      const re = new RegExp("(^|[^a-z0-9])" +
        v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "([^a-z0-9]|$)", "i");
      if (re.test(hay)) found.push(cand);
      if (found.length >= 8) break;
    }
    wrap.hidden = !found.length;
    $("#suggestrow").innerHTML = found.map(c =>
      `<button type="button" class="chip suggest" data-field="${esc(c.field)}"
               data-v="${esc(c.value)}">${icon("plus", "chip-ic-plus")}<span>${esc(c.value)}</span></button>`).join("");
  }

  $("#suggestrow") && $("#suggestrow").addEventListener("click", e => {
    const chip = e.target.closest(".chip.suggest");
    if (!chip) return;
    const { field, v } = { field: chip.dataset.field, v: chip.dataset.v };
    if (CHIP_FIELDS.includes(field)) {
      const target = $(`.chips[data-key="${field}"] .chip[data-v="${CSS.escape ? CSS.escape(v) : v}"]`);
      // fall back to a scan when CSS.escape is unavailable
      const btn = target || $$(`.chips[data-key="${field}"] .chip`)
        .find(c => c.dataset.v === v);
      if (btn && !btn.classList.contains("on")) btn.click();
    } else {
      const box = boxes.get(field);
      if (box) box.add(v);
    }
    refreshSuggestions();
  });

  let suggestTimer = null;
  // once the teacher edits the title themselves, stop auto-suggesting it
  let titleTouched = !quick || !!material.title;
  const titleInput = $("#f").elements.namedItem("title");
  const titleClear = $("#titleclear");
  titleInput.addEventListener("input", () => {
    titleTouched = true;
    titleClear.hidden = !titleInput.value;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(refreshSuggestions, 250);
  });
  titleClear.addEventListener("click", () => {
    titleInput.value = "";
    titleClear.hidden = true;
    titleInput.focus();
    refreshSuggestions();
  });
  $$("#inboxrows .inboxpick").forEach(cb =>
    cb.addEventListener("change", () => {
      applyImportSuggestions();
      refreshSuggestions();
      updateAttMeta();
    }));

  // newly picked files, each with its own note
  const pickedFiles = [];
  const filepick = $("#filepick");
  const inboxSizes = {};
  for (const fl of inbox) inboxSizes[fl.name] = fl.size || 0;
  function updateAttMeta() {
    const el = $("#attmeta");
    if (!el) return;
    let n = material.files.length;
    let bytes = 0;
    for (const fl of material.files) bytes += fl.size || 0;
    for (const p of pickedFiles) { n++; bytes += p.file.size || 0; }
    for (const cb of $$("#inboxrows .inboxpick:checked")) {
      n++;
      bytes += inboxSizes[cb.dataset.name] || 0;
    }
    el.textContent = n ? `${n} file${n === 1 ? "" : "s"} · ${fmtSize(bytes)}` : "";
  }
  function renderPicked() {
    $("#filerows").innerHTML = pickedFiles.map((p, i) => `
      <div class="frow">
        <div class="fmain">
          ${fileTileHTML(p.file.name)}
          <span class="fname">${esc(p.file.name)}</span>
          <span class="fsize">${fmtSize(p.file.size)}</span>
          <button type="button" class="fremove" data-i="${i}"
                  aria-label="Remove ${esc(p.file.name)}">${icon("x")}</button>
        </div>
        <div class="frowmeta">
          <input type="text" class="frole-in" data-i="${i}" list="rolesdl"
                 placeholder="Role — e.g. Answer key" value="${esc(p.role || "")}">
          <input type="text" class="fnote" data-i="${i}"
                 placeholder="Optional note" value="${esc(p.note)}">
        </div>
      </div>`).join("");
    updateAttMeta();
  }
  updateAttMeta();
  fillRolesDatalist();
  filepick.addEventListener("change", () => {
    for (const f of filepick.files) pickedFiles.push({ file: f, note: "", role: "" });
    filepick.value = "";
    renderPicked();
    applyImportSuggestions();
    refreshSuggestions();
  });
  $("#filerows").addEventListener("click", e => {
    const btn = e.target.closest(".fremove");
    if (!btn) return;
    pickedFiles.splice(+btn.dataset.i, 1);
    renderPicked();
    refreshSuggestions();
  });
  $("#filerows").addEventListener("input", e => {
    const note = e.target.closest(".fnote");
    if (note) { pickedFiles[+note.dataset.i].note = note.value; return; }
    const role = e.target.closest(".frole-in");
    if (role) pickedFiles[+role.dataset.i].role = role.value;
  });

  if (mode === "edit" || mode === "repair") refreshSuggestions();

  // ---- quick add: suggested title + format from the attached files ----
  function setChipState(key, value, on) {
    const btn = $$(`.chips[data-key="${key}"] .chip`, $("#f"))
      .find(c => c.dataset.v.toLowerCase() === value.toLowerCase());
    if (btn && btn.classList.contains("on") !== on) {
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  function applyImportSuggestions() {
    if (!quick) return;
    const names = [...pickedFiles.map(p => p.file.name),
                   ...$$("#inboxrows .inboxpick:checked").map(cb => cb.dataset.name)];
    if (!names.length) return;
    if (!titleTouched) {
      titleInput.value = titleFromFileNames(names);
      titleClear.hidden = !titleInput.value;
    }
    if (!$$(".chips[data-key='formats'] .chip.on", $("#f")).length) {
      for (const fmt of formatsFromFileNames(names)) {
        setChipState("formats", fmt, true);
      }
    }
  }
  if (preselect.size) {
    applyImportSuggestions();
    refreshSuggestions();
  }

  // ---- quick add: presets + collapsed details ----
  const presetRow = $("#presetrow");
  if (presetRow) {
    const presetApplied = p => Object.entries(p.fields).every(([key, vals]) =>
      vals.every(v => key === "exam_targets"
        ? boxes.get(key).has(v) : chipApplied(key, v)));
    const refreshPresets = () => {
      $$(".chip.preset", presetRow).forEach(c => {
        const on = presetApplied(PRESETS[+c.dataset.p]);
        c.classList.toggle("on", on);
        c.setAttribute("aria-pressed", String(on));
      });
    };
    presetRow.addEventListener("click", e => {
      const chipEl = e.target.closest(".chip.preset");
      if (!chipEl) return;
      const p = PRESETS[+chipEl.dataset.p];
      const on = !presetApplied(p);
      const filled = [];
      for (const [key, vals] of Object.entries(p.fields)) {
        for (const v of vals) {
          if (key === "exam_targets") {
            const box = boxes.get(key);
            if (on) box.add(v); else box.remove(v);
          } else {
            setChipState(key, v, on);
          }
          if (on) filled.push(v);
        }
      }
      refreshPresets();
      refreshSuggestions();
      if (on) toast("Filled: " + filled.join(" · "));
    });
    // tapping any facet chip can complete/break a preset — keep them honest
    $("#f").addEventListener("click", e => {
      if (e.target.closest(".chips[data-key] .chip")) refreshPresets();
    });
  }

  const moreBtn = $("#moredetails");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      const wrap = $("#detailwrap");
      const open = wrap.hidden;
      wrap.hidden = !open;
      moreBtn.setAttribute("aria-expanded", String(open));
      moreBtn.innerHTML = icon("sliders") +
        `<span>${open ? "Hide details" : "Add details — level, skills, topics"}</span>` +
        icon(open ? "up" : "down");
    });
  }

  function inboxSelection(form) {
    const names = $$("#inboxrows .inboxpick:checked", form)
      .map(cb => cb.dataset.name);
    const notes = {};
    $$("#inboxrows .inboxnote", form).forEach(el => {
      if (names.includes(el.dataset.name) && el.value.trim()) {
        notes[el.dataset.name] = el.value.trim();
      }
    });
    return { names, notes };
  }

  $("#f").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const btn = $("#savebtn");
    const pickedChips = key =>
      $$(`.chips[data-key="${key}"] .chip.on`, f).map(c => c.dataset.v);
    // f.elements, not f.<name>: "title" collides with HTMLElement.title
    const fieldValue = name => f.elements.namedItem(name).value;

    const fd = new FormData();
    fd.append("title", fieldValue("title"));
    pickedChips("age_groups").forEach(v => fd.append("age_groups", v));
    pickedChips("cefr_levels").forEach(v => fd.append("cefr_levels", v));
    pickedChips("skills").forEach(v => fd.append("skills", v));
    pickedChips("formats").forEach(v => fd.append("formats", v));
    for (const [key, box] of boxes) {
      box.values.forEach(v => fd.append(key, v));
    }
    fd.append("duration_min", fieldValue("duration_min"));
    fd.append("notes", fieldValue("notes"));
    const inboxSel = inboxSelection(f);
    fd.append("inbox_files", JSON.stringify(inboxSel.names));
    fd.append("inbox_notes", JSON.stringify(inboxSel.notes));

    const onProgress = p => { btn.textContent = "Uploading " + Math.round(p * 100) + "%"; };
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      let materialId = id;
      if (mode === "add") {
        pickedFiles.forEach(p => fd.append("files", p.file));
        fd.append("file_notes", JSON.stringify(pickedFiles.map(p => p.note)));
        fd.append("file_roles", JSON.stringify(pickedFiles.map(p => p.role || "")));
        const out = await upload("/api/lessons", fd, onProgress);
        materialId = out.lesson.id;
      } else {
        if (pickedFiles.length) {
          const ff = new FormData();
          pickedFiles.forEach(p => ff.append("files", p.file));
          ff.append("file_notes", JSON.stringify(pickedFiles.map(p => p.note)));
          ff.append("file_roles", JSON.stringify(pickedFiles.map(p => p.role || "")));
          await upload("/api/lessons/" + encodeURIComponent(id) + "/files",
                       ff, onProgress);
          btn.textContent = "Saving…";
        }
        const noteMap = {};
        $$("#existingrows .fnote", f).forEach(el => {
          noteMap[el.dataset.name] = el.value;
        });
        fd.append("existing_notes", JSON.stringify(noteMap));
        await api("/api/lessons/" + encodeURIComponent(id), { method: "POST", body: fd });
      }
      await refresh();
      location.hash = "#/lesson/" + encodeURIComponent(materialId);
      toast("Material saved");
    } catch (err) {
      toast("Save failed: " + err.message, "error");
      btn.disabled = false;
      btn.innerHTML = icon("check") + `<span>${esc(saveLabel)}</span>`;
    }
  });
}

// ---- pull-to-refresh (Library / Classes / Inbox lists, top of page) ----
function initPullToRefresh() {
  const ptr = document.createElement("div");
  ptr.id = "ptr";
  ptr.setAttribute("aria-hidden", "true");
  ptr.innerHTML = icon("rescan");
  document.body.appendChild(ptr);
  const THRESHOLD = 70;
  let startY = null, dist = 0, pulling = false, busy = false;
  function reset() {
    ptr.style.opacity = 0;
    ptr.style.transform = "";
    ptr.classList.remove("ready");
  }
  window.addEventListener("touchstart", e => {
    startY = null;
    if (busy || window.scrollY > 0) return;
    if (!["list", "plans", "inbox"].includes(route().view)) return;
    startY = e.touches[0].clientY;
    dist = 0;
    pulling = false;
  }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (startY === null || busy) return;
    dist = e.touches[0].clientY - startY;
    if (dist > 8 && window.scrollY === 0) {
      pulling = true;
      const d = Math.min(dist - 8, 120);
      ptr.style.opacity = Math.min(d / THRESHOLD, 1);
      ptr.style.transform =
        `translate(-50%, ${Math.min(d * .6, 80)}px) rotate(${d * 2}deg)`;
      ptr.classList.toggle("ready", d >= THRESHOLD);
    } else if (pulling) {
      pulling = false;
      reset();
    }
  }, { passive: true });
  window.addEventListener("touchend", async () => {
    const fire = pulling && dist - 8 >= THRESHOLD && !busy;
    startY = null;
    pulling = false;
    if (!fire) { reset(); return; }
    busy = true;
    ptr.classList.add("busy");
    try {
      await rescan();
    } catch (err) {
      toast("Rescan failed: " + err.message, "error");
    }
    busy = false;
    ptr.classList.remove("busy");
    reset();
  });
}

// ---- boot ----
(async function init() {
  initTheme();
  $("#fab").addEventListener("click", () => {
    const v = document.body.dataset.view;
    if (v === "plans") newPlanFromFab();
    else location.hash = "#/add";
  });
  // close any open combobox panel when tapping elsewhere
  document.addEventListener("click", e => {
    $$(".cbx").forEach(c => {
      if (!c.contains(e.target)) $(".cbx-panel", c).hidden = true;
    });
  });
  window.addEventListener("hashchange", render);

  // coming back to the app picks up file-manager changes automatically
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !DB) return;
    if (Date.now() - lastScanTs < 30000) return;
    if (!AUTO_RESCAN_VIEWS.includes(route().view)) return;
    rescan({ silent: true }).catch(() => { /* next resume retries */ });
  });
  initPullToRefresh();

  // skeleton while the index loads
  view.innerHTML = `<div class="searchwrap"><div class="skel bar"></div></div>` +
    `<div class="skel row"></div>`.repeat(5);
  try {
    await refresh();
    lastScanTs = Date.now();
    render();
    refreshBackupInfo().then(() => {
      if (route().view === "list") renderBackupBanner();
    });
  } catch (err) {
    view.innerHTML = `
      <div class="emptystate">
        ${emptyArt()}
        <h3>Could not load the library</h3>
        <p>${esc(err.message)}</p>
        <button class="btn" type="button" onclick="location.reload()">Try again</button>
      </div>`;
  }
})();
