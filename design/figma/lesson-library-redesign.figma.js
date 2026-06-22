// Lesson Library — editable Figma redesign
// Paste into a Figma plugin / console environment, or run through a Figma automation tool.
// It creates two editable Android portrait screens based on the supplied screenshots:
// 1) Library browse screen
// 2) Material detail screen

const W = 412;
const H = 915;
const GAP = 56;

const C = {
  bg: { r: 0.0, g: 0.0, b: 0.02 },
  surface: { r: 0.035, g: 0.035, b: 0.07 },
  surface2: { r: 0.07, g: 0.07, b: 0.12 },
  stroke: { r: 1, g: 1, b: 1, a: 0.10 },
  stroke2: { r: 1, g: 1, b: 1, a: 0.16 },
  text: { r: 0.95, g: 0.94, b: 1.0 },
  muted: { r: 0.66, g: 0.64, b: 0.78 },
  dim: { r: 0.46, g: 0.45, b: 0.56 },
  purple: { r: 0.46, g: 0.33, b: 1.0 },
  purple2: { r: 0.65, g: 0.55, b: 0.98 },
  chip: { r: 0.18, g: 0.12, b: 0.38 },
  green: { r: 0.04, g: 0.28, b: 0.13 },
  greenText: { r: 0.32, g: 0.91, b: 0.57 },
  gold: { r: 0.34, g: 0.22, b: 0.02 },
  goldText: { r: 0.96, g: 0.73, b: 0.30 },
  danger: { r: 1.0, g: 0.45, b: 0.52 },
};

function solid(c) { return [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a ?? 1 }]; }
function rgba(c, a) { return { ...c, a }; }

async function font(style = 'Regular') {
  await figma.loadFontAsync({ family: 'Inter', style }).catch(async () => {
    await figma.loadFontAsync({ family: 'Roboto', style: style === 'Semi Bold' ? 'Medium' : style }).catch(() => {});
  });
}

function frame(name, x, y, w, h, radius = 0) {
  const n = figma.createFrame();
  n.name = name;
  n.x = x; n.y = y; n.resize(w, h);
  n.fills = solid(C.bg);
  n.clipsContent = true;
  n.cornerRadius = radius;
  return n;
}

function rect(parent, name, x, y, w, h, fill = C.surface, r = 20, stroke = true) {
  const n = figma.createRectangle();
  n.name = name;
  n.x = x; n.y = y; n.resize(w, h);
  n.cornerRadius = r;
  n.fills = solid(fill);
  if (stroke) n.strokes = solid(C.stroke), n.strokeWeight = 1;
  parent.appendChild(n);
  return n;
}

function circle(parent, name, x, y, size, fill = C.surface, stroke = true) {
  const n = figma.createEllipse();
  n.name = name;
  n.x = x; n.y = y; n.resize(size, size);
  n.fills = solid(fill);
  if (stroke) n.strokes = solid(C.stroke), n.strokeWeight = 1;
  parent.appendChild(n);
  return n;
}

async function text(parent, name, value, x, y, size, weight = 'Regular', color = C.text, w = 300, align = 'LEFT') {
  await font(weight);
  const n = figma.createText();
  n.name = name;
  n.characters = value;
  n.fontName = { family: 'Inter', style: weight };
  n.fontSize = size;
  n.lineHeight = { unit: 'AUTO' };
  n.fills = solid(color);
  n.x = x; n.y = y;
  n.resize(w, n.height);
  n.textAlignHorizontal = align;
  parent.appendChild(n);
  return n;
}

function glow(parent, x, y, w, h, a = 0.45) {
  const n = rect(parent, 'violet ambient glow', x, y, w, h, rgba(C.purple, a), Math.min(w, h) / 2, false);
  n.effects = [{ type: 'LAYER_BLUR', radius: 34, visible: true }];
  return n;
}

function iconBox(parent, x, y, size = 38) {
  glow(parent, x - 4, y - 4, size + 8, size + 8, .22);
  const b = rect(parent, 'brandmark / book icon', x, y, size, size, C.purple, 12, false);
  const book = figma.createVector();
  book.name = 'book glyph';
  book.x = x + size / 2 - 8; book.y = y + size / 2 - 8;
  book.resize(16, 16);
  book.vectorPaths = [{ windingRule: 'NONZERO', data: 'M1 3 C1 2 2 1 3 1 H7 C8 1 8 2 8 3 V15 C8 14 7 13 6 13 H3 C2 13 1 14 1 15 Z M15 3 C15 2 14 1 13 1 H9 C8 1 8 2 8 3 V15 C8 14 9 13 10 13 H13 C14 13 15 14 15 15 Z' }];
  book.fills = solid(C.text);
  parent.appendChild(book);
}

async function header(parent, withBack = false) {
  await text(parent, 'status time', withBack ? '8:17' : '8:16', 16, 12, 13, 'Semi Bold', C.text, 80);
  await text(parent, 'status icons', '⌁  Wi‑Fi  ▮▮ 48%', 292, 12, 12, 'Regular', C.text, 110, 'RIGHT');
  if (withBack) circle(parent, 'back button', 16, 50, 36, C.surface, true), await text(parent, 'back glyph', '‹', 28, 54, 28, 'Regular', C.text, 20);
  iconBox(parent, withBack ? 72 : 16, 50, 38);
  await text(parent, 'app title', 'Lesson Library', withBack ? 124 : 66, 55, withBack ? 17 : 22, 'Extra Bold', C.text, 210);
  await text(parent, 'subtitle', 'Organized, ready to teach', withBack ? 124 : 80, withBack ? 80 : 82, 12, 'Regular', C.muted, 220);
  circle(parent, 'settings', 360, 50, 36, C.surface, true);
  await text(parent, 'settings glyph', '⚙', 369, 57, 16, 'Regular', C.text, 22);
}

async function chip(parent, label, x, y, kind = 'purple', size = 12) {
  const map = {
    purple: [C.chip, C.purple2],
    dark: [C.surface, C.text],
    green: [C.green, C.greenText],
    gold: [C.gold, C.goldText],
    muted: [C.surface2, C.muted],
  };
  const [bg, fg] = map[kind] || map.purple;
  const width = Math.max(42, label.length * size * .58 + 22);
  rect(parent, `chip / ${label}`, x, y, width, 26, bg, 13, false);
  await text(parent, `chip text / ${label}`, label, x + 11, y + 5, size, 'Semi Bold', fg, width - 18);
  return width;
}

async function meta(parent, pieces, x, y) {
  let cx = x;
  for (const p of pieces) {
    await text(parent, `meta / ${p}`, p, cx, y, 11, 'Regular', C.muted, 96);
    cx += p.length * 6 + 22;
  }
}

function thumb(parent, x, y, w, h, type = 'photo') {
  const base = rect(parent, `thumbnail / ${type}`, x, y, w, h, C.surface2, 14, false);
  const colors = type === 'farm' ? ['#F0B84A', '#5FA85A', '#73B7EC', '#D55E38'] :
    type === 'directions' ? ['#54B7F7', '#F3D65B', '#FFFFFF', '#62C184'] :
    type === 'animal' ? ['#F2F2F5', '#C8C7D2', '#FFFFFF', '#9A99A8'] :
    ['#5D6A73', '#557C61', '#A0A7B1', '#6B3E2D'];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const n = rect(parent, 'thumbnail tile', x + c * w / 3 + 1, y + r * h / 2 + 1, w / 3 - 2, h / 2 - 2, hex(colors[(r * 3 + c) % colors.length]), 3, false);
    n.opacity = .88;
  }
  return base;
}

function hex(h) {
  const s = h.replace('#', '');
  return { r: parseInt(s.slice(0, 2), 16) / 255, g: parseInt(s.slice(2, 4), 16) / 255, b: parseInt(s.slice(4, 6), 16) / 255 };
}

async function searchBar(parent) {
  rect(parent, 'search bar', 16, 110, 380, 44, C.surface, 22, true);
  await text(parent, 'search icon', '⌕', 30, 115, 28, 'Regular', C.muted, 28);
  await text(parent, 'search placeholder', 'Search materials, e.g., B2, IELTS, listening…', 58, 123, 13, 'Regular', C.muted, 270);
  glow(parent, 345, 106, 55, 55, .35);
  circle(parent, 'filter button', 352, 113, 42, C.purple, false);
  await text(parent, 'filter glyph', '▽', 365, 120, 18, 'Regular', C.text, 20);
}

async function filterPanel(parent) {
  rect(parent, 'filter panel', 16, 170, 380, 196, C.surface, 20, true);
  const rows = [
    ['👥', 'Age', ['Young Learners', 'Teens', 'Adults']],
    ['Aa', 'CEFR', ['Pre-A1', 'A1', 'A2', 'B1', 'B2+']],
    ['◔', 'Skills', ['Speaking', 'Listening', 'Reading', '+2']],
    ['□', 'Format', ['Slides', 'Worksheet', 'Flashcard', '+1']],
    ['◇', 'Exam', ['Cambridge English: Pre A1 Starters']],
  ];
  let y = 184;
  for (const [ic, label, chips] of rows) {
    await text(parent, `filter icon ${label}`, ic, 30, y + 6, 17, 'Semi Bold', C.purple2, 28);
    await text(parent, `filter label ${label}`, label, 58, y + 9, 13, 'Semi Bold', C.purple2, 70);
    let x = 106;
    for (const c of chips) x += await chip(parent, c, x, y + 2, 'dark', 11) + 6;
    await text(parent, `chevron ${label}`, '⌄', 370, y + 7, 14, 'Regular', C.muted, 18);
    y += 38;
  }
}

async function materialCard(parent, y, title, imgType, tags, metaText) {
  rect(parent, `material card / ${title}`, 16, y, 380, 96, C.surface, 18, true);
  thumb(parent, 24, y + 10, 82, 76, imgType);
  await text(parent, `title / ${title}`, title, 118, y + 13, 16, 'Extra Bold', C.text, 220);
  let x = 118;
  for (const [t, k] of tags) x += await chip(parent, t, x, y + 42, k, 10) + 5;
  await meta(parent, metaText, 118, y + 72);
  await text(parent, `chevron / ${title}`, '›', 376, y + 31, 27, 'Regular', C.text, 16);
}

async function bottomNav(parent, active = 'Library') {
  rect(parent, 'bottom navigation / glass', 0, H - 66, W, 66, rgba(C.surface, .95), 24, true);
  const items = [['▱', 'Library'], ['☑', 'Classes'], ['☆', 'Reflect'], ['▣', 'Inbox']];
  let x = 54;
  for (const [ic, lab] of items) {
    if (lab === active) rect(parent, 'active nav pill', x - 26, H - 58, 68, 50, C.chip, 18, false);
    await text(parent, `nav icon ${lab}`, ic, x, H - 49, 20, 'Regular', lab === active ? C.purple2 : C.muted, 30, 'CENTER');
    await text(parent, `nav label ${lab}`, lab, x - 20, H - 23, 10, 'Semi Bold', lab === active ? C.purple2 : C.muted, 52, 'CENTER');
    if (lab === 'Inbox') { circle(parent, 'inbox badge', x + 18, H - 52, 16, C.purple, false); await text(parent, 'badge 3', '3', x + 23, H - 50, 9, 'Semi Bold', C.text, 8, 'CENTER'); }
    x += 94;
  }
}

async function libraryScreen() {
  const f = frame('01 Library / browse — Lesson Library', 0, 0, W, H, 0);
  glow(f, 330, 95, 80, 80, .16);
  await header(f, false);
  await searchBar(f);
  await filterPanel(f);
  await text(f, 'sort control', '⇅  Sort: Newest  ⌄', 16, 382, 13, 'Semi Bold', C.muted, 132);
  rect(f, 'view toggle', 178, 374, 74, 34, C.surface, 17, true);
  rect(f, 'list selected', 182, 378, 32, 26, C.purple, 13, false);
  await text(f, 'list icon', '☷', 191, 382, 13, 'Semi Bold', C.text, 16);
  await text(f, 'grid icon', '▦', 222, 382, 13, 'Regular', C.muted, 16);
  await text(f, 'count', '12 materials', 322, 384, 12, 'Regular', C.muted, 78, 'RIGHT');
  await materialCard(f, 420, 'Starters plural', 'farm', [['Pre-A1', 'green'], ['Cambridge English: Pre A1 Starters', 'gold'], ['Young Learners', 'purple'], ['Speaking', 'purple'], ['Reading', 'purple']], ['◷ 60 min', '□ 14 files', '▣ Jun 22, 2026', '◇ Plural']);
  await materialCard(f, 530, 'Environment IELTS speaking', 'photo', [['IELTS Academic', 'gold'], ['Adults', 'purple'], ['Speaking', 'purple']], ['□ 8 files', '▣ Jun 22, 2026', '◇ Environment']);
  await materialCard(f, 640, 'Directions', 'directions', [['A1', 'green'], ['Young Learners', 'purple'], ['Teens', 'purple'], ['Speaking', 'purple'], ['Grammar', 'purple']], ['□ 15 files', '▣ Jun 21, 2026', '◇ Nature and wildlife']);
  await materialCard(f, 750, 'Animals Starters Kids', 'animal', [['Pre-A1', 'green'], ['Cambridge English: Pre A1 Starters', 'gold'], ['Young Learners', 'purple']], ['□ 12 files', '▣ Jun 20, 2026', '◇ Animals']);
  glow(f, 282, 753, 112, 54, .36);
  rect(f, 'floating CTA / Add material', 282, 760, 112, 46, C.purple, 23, false);
  await text(f, 'add material text', '+  Add material', 298, 773, 13, 'Semi Bold', C.text, 92);
  await bottomNav(f);
  return f;
}

async function actionButton(parent, label, x, y, w, icon) {
  rect(parent, `quick action / ${label}`, x, y, w, 52, C.surface, 14, true);
  await text(parent, `quick icon / ${label}`, icon, x, y + 10, 19, 'Regular', C.purple2, w, 'CENTER');
  await text(parent, `quick label / ${label}`, label, x, y + 32, 11, 'Semi Bold', label === 'Add to plan' ? C.purple2 : C.text, w, 'CENTER');
}

async function infoRow(parent, y, label, value) {
  await text(parent, `info label ${label}`, label, 26, y + 10, 12, 'Semi Bold', C.muted, 86);
  await chip(parent, value, 126, y + 5, 'dark', 11);
  await text(parent, `info chevron ${label}`, '›', 378, y + 5, 20, 'Regular', C.muted, 14);
}

async function fileCard(parent, x, y, name, size, type) {
  rect(parent, `file card / ${name}`, x, y, 180, 62, C.surface, 16, true);
  if (type === 'img') thumb(parent, x + 8, y + 8, 66, 46, 'photo');
  else {
    rect(parent, `file icon / ${type}`, x + 8, y + 8, 58, 46, C.surface2, 14, false);
    await text(parent, `file glyph / ${name}`, type === 'audio' ? '♫' : '□', x + 24, y + 13, 23, 'Regular', C.purple2, 22);
    await text(parent, `file type / ${name}`, type.toUpperCase(), x + 23, y + 38, 9, 'Semi Bold', C.purple2, 28);
  }
  await text(parent, `file name / ${name}`, name, x + 80, y + 11, 11, 'Semi Bold', C.text, 88);
  await text(parent, `file size / ${name}`, size, x + 80, y + 38, 10, 'Regular', C.muted, 52);
  await text(parent, `file actions / ${name}`, '✎  ⟲', x + 132, y + 36, 12, 'Regular', C.muted, 42);
}

async function detailScreen() {
  const f = frame('02 Material detail — Environment IELTS speaking', W + GAP, 0, W, H, 0);
  await header(f, true);
  rect(f, 'hero material card', 16, 112, 380, 214, C.surface, 20, true);
  thumb(f, 28, 126, 162, 104, 'photo');
  await text(f, 'detail title', 'Environment IELTS\nspeaking', 206, 133, 24, 'Extra Bold', C.text, 170);
  await chip(f, 'IELTS Academic', 206, 213, 'gold', 11);
  await chip(f, 'Adults', 294, 213, 'purple', 11);
  await chip(f, 'Speaking', 206, 243, 'purple', 11);
  await chip(f, 'Environment', 274, 243, 'purple', 11);
  await meta(f, ['□  8 files', '▣  13.1 MB', '▤  Added Jun 22, 2026', '◇  plural'], 28, 281);
  await actionButton(f, 'Preview', 28, 298, 82, '◉');
  await actionButton(f, 'Share', 114, 298, 82, '⌯');
  await actionButton(f, 'Log use', 200, 298, 82, '↺');
  await actionButton(f, 'Add to plan', 286, 298, 94, '▣');
  rect(f, 'taxonomy info panel', 16, 338, 380, 128, C.surface, 18, true);
  await infoRow(f, 342, 'Skills', 'Speaking');
  await infoRow(f, 374, 'Format', 'Slides');
  await infoRow(f, 406, 'Vocabulary', 'Environment');
  await infoRow(f, 438, 'Topics', 'Environment');
  rect(f, 'files panel', 16, 480, 380, 322, C.surface, 18, true);
  await text(f, 'files title', 'Files (8)', 26, 495, 16, 'Extra Bold', C.text, 120);
  await chip(f, 'All', 118, 493, 'purple', 11);
  await chip(f, 'Images', 160, 493, 'dark', 11);
  await chip(f, 'Audio', 224, 493, 'dark', 11);
  await chip(f, 'HTML', 284, 493, 'dark', 11);
  rect(f, 'grid selected', 346, 491, 30, 30, C.purple, 12, false);
  await text(f, 'grid glyph detail', '▦', 354, 497, 12, 'Regular', C.text, 14);
  await fileCard(f, 26, 530, 'Lead-in.png', '2.7 MB', 'img');
  await fileCard(f, 206, 530, 'Elicit vocab.png', '2.4 MB', 'img');
  await fileCard(f, 26, 602, 'Part 1.png', '2.0 MB', 'img');
  await fileCard(f, 206, 602, 'Jeopardy_Vocabulary_Game.html', '30 KB', 'html');
  await fileCard(f, 26, 674, 'Something you did for the environment.mp3', '1.9 MB', 'audio');
  await fileCard(f, 206, 674, 'Part2.png', '1.9 MB', 'img');
  await fileCard(f, 26, 746, 'IWSE_Practice.html', '28 KB', 'html');
  await fileCard(f, 206, 746, 'Part3.png', '2.1 MB', 'img');
  glow(f, 20, 818, 176, 44, .30);
  rect(f, 'primary action / Edit', 16, 822, 180, 46, C.purple, 23, false);
  await text(f, 'edit button text', '✎  Edit', 70, 834, 15, 'Semi Bold', C.text, 80);
  rect(f, 'danger action / Delete', 206, 822, 190, 46, C.bg, 23, true).strokes = solid(C.danger);
  await text(f, 'delete button text', '⌫  Delete', 270, 834, 15, 'Semi Bold', C.danger, 100);
  await bottomNav(f);
  return f;
}

async function main() {
  await Promise.all(['Regular', 'Semi Bold', 'Extra Bold'].map(font));
  figma.currentPage.name = 'Lesson Library redesign';
  const title = await text(figma.currentPage, 'cover label', 'Lesson Library — AMOLED redesign from screenshots', 0, -56, 24, 'Extra Bold', C.text, 780);
  title.fills = solid(C.text);
  const a = await libraryScreen();
  const b = await detailScreen();
  figma.currentPage.selection = [a, b];
  figma.viewport.scrollAndZoomIntoView([a, b]);
}

main().catch(err => {
  console.error(err);
  figma.notify('Lesson Library Figma script failed: ' + err.message);
});
