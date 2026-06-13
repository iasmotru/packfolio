// ================================================================
//  Packfolio Design System — Figma Plugin
//  Создаёт: Color Variables, Text Styles, Components
// ================================================================

(async () => {

// ────────────────────────────────────────────────────────────────
//  УТИЛИТЫ ЦВЕТА
// ────────────────────────────────────────────────────────────────

function hex(h, a = 1) {
  return {
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
    a,
  };
}

function paint(c) {
  return [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: (c.a != null ? c.a : 1) }];
}

// withAlpha — создаёт копию цвета с другой прозрачностью (вместо spread)
function wa(c, a) { return { r:c.r, g:c.g, b:c.b, a:a }; }

function gradRadial(stops) {
  return [{
    type: 'GRADIENT_RADIAL',
    gradientStops: stops,
    gradientTransform: [[0.7, 0, 0.7], [0, 1.1, 1.1]],
  }];
}

function applyFill(node, c)         { node.fills = paint(c); }
function clearFill(node)             { node.fills = []; }
function applyStroke(node, c, w=1)  {
  node.strokes = paint(c);
  node.strokeWeight = w;
  node.strokeAlign = 'INSIDE';
}
function clearStroke(node)           { node.strokes = []; }

// ────────────────────────────────────────────────────────────────
//  ТОКЕНЫ
// ────────────────────────────────────────────────────────────────

const C = {
  // Фоны
  bg:            hex('#0A0B18'),
  bgCard:        hex('#13152C'),
  bgElevated:    hex('#1C1E3A'),
  bgInput:       { r:1, g:1, b:1, a:0.07 },
  // Обводки
  border:        { r:1, g:1, b:1, a:0.10 },
  borderStrong:  { r:1, g:1, b:1, a:0.18 },
  // Текст
  text:          hex('#FFFFFF'),
  textSec:       { r:0.922, g:0.922, b:0.961, a:0.60 },
  textHint:      { r:0.922, g:0.922, b:0.961, a:0.30 },
  // Акцент
  accent:        hex('#464DF5'),
  accentDim:     { r:0.275, g:0.302, b:0.961, a:0.15 },
  accentTeal:    hex('#30D158'),
  // Опасность
  danger:        hex('#EF4444'),
  dangerDim:     { r:0.937, g:0.267, b:0.267, a:0.12 },
  dangerBorder:  { r:0.937, g:0.267, b:0.267, a:0.20 },
  dangerText:    hex('#F87171'),
  // Белые оттенки
  white6:        { r:1, g:1, b:1, a:0.06 },
  white8:        { r:1, g:1, b:1, a:0.08 },
  white10:       { r:1, g:1, b:1, a:0.10 },
  white15:       { r:1, g:1, b:1, a:0.15 },
  // Типы документов
  flight:        hex('#60A5FA'),
  hotel:         hex('#34D399'),
  train:         hex('#FBBF24'),
  bus:           hex('#F97316'),
  car:           hex('#C084FC'),
  insurance:     hex('#F472B6'),
  passport:      hex('#38BDF8'),
  unknown:       hex('#6B7280'),
  // Confidence
  confHigh:      hex('#34D399'),
  confHighBg:    { r:0.204, g:0.827, b:0.600, a:0.12 },
  confMed:       hex('#FBBF24'),
  confMedBg:     { r:0.984, g:0.749, b:0.141, a:0.12 },
  confLow:       hex('#EF4444'),
  confLowBg:     { r:0.937, g:0.267, b:0.267, a:0.12 },
  // Дубликат
  dupText:       hex('#FB923C'),
  dupBg:         { r:0.976, g:0.447, b:0.086, a:0.12 },
  dupBorder:     { r:0.976, g:0.447, b:0.086, a:0.30 },
};

const R = { xl:24, lg:20, md:16, sm:12, xs:8 };

// ────────────────────────────────────────────────────────────────
//  ШРИФТЫ
// ────────────────────────────────────────────────────────────────

let FF = 'Onest';
try {
  for (const s of ['Regular','Medium','SemiBold','Bold']) {
    await figma.loadFontAsync({ family:'Onest', style:s });
  }
} catch(_) {
  FF = 'Inter';
  for (const s of ['Regular','Medium','SemiBold','Bold']) {
    await figma.loadFontAsync({ family:'Inter', style:s });
  }
}

const FW = { 400:'Regular', 500:'Medium', 600:'SemiBold', 700:'Bold' };

function makeText(chars, size, weight, color, opts = {}) {
  const t = figma.createText();
  t.fontName = { family:FF, style:FW[weight] };
  t.fontSize = size;
  t.characters = String(chars);
  t.fills = paint(color);
  if (opts.uppercase)    t.textCase = 'UPPER';
  if (opts.ls != null)   t.letterSpacing = { unit:'PIXELS', value:opts.ls };
  if (opts.lh)           t.lineHeight = { unit:'PIXELS', value:opts.lh };
  if (opts.align)        t.textAlignHorizontal = opts.align;
  if (opts.truncate)     t.textTruncation = 'ENDING';
  return t;
}

// ────────────────────────────────────────────────────────────────
//  AUTO-LAYOUT УТИЛИТЫ
// ────────────────────────────────────────────────────────────────

function setAL(node, dir, gap, pt, pr, pb, pl) {
  node.layoutMode = dir;
  node.itemSpacing = (gap != null ? gap : 0);
  const _pt = (pt != null ? pt : 0), _pr = (pr != null ? pr : (pt != null ? pt : 0)), _pb = (pb != null ? pb : (pt != null ? pt : 0)), _pl = (pl != null ? pl : (pr != null ? pr : (pt != null ? pt : 0)));
  node.paddingTop = _pt; node.paddingRight = _pr; node.paddingBottom = _pb; node.paddingLeft = _pl;
  node.primaryAxisSizingMode = 'AUTO';
  node.counterAxisSizingMode = 'AUTO';
}

function center(node) {
  node.primaryAxisAlignItems = 'CENTER';
  node.counterAxisAlignItems = 'CENTER';
}

function spaceBetween(node) { node.primaryAxisAlignItems = 'SPACE_BETWEEN'; }

function fixedW(node, w) {
  node.primaryAxisSizingMode = 'FIXED';
  node.counterAxisSizingMode = 'AUTO';
  node.resize(w, node.height || 10);
}

function ghostFrame(gap = 0) {
  const f = figma.createFrame();
  clearFill(f); clearStroke(f);
  f.layoutMode = 'HORIZONTAL';
  f.itemSpacing = gap;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  return f;
}

function vFrame(gap = 0) {
  const f = figma.createFrame();
  clearFill(f); clearStroke(f);
  f.layoutMode = 'VERTICAL';
  f.itemSpacing = gap;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  return f;
}

function hFrame(gap = 0) {
  const f = figma.createFrame();
  clearFill(f); clearStroke(f);
  f.layoutMode = 'HORIZONTAL';
  f.itemSpacing = gap;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.counterAxisAlignItems = 'CENTER';
  return f;
}

function dividerH(w = 200) {
  const r = figma.createRectangle();
  r.resize(w, 1);
  r.layoutAlign = 'STRETCH';
  applyFill(r, C.border);
  clearStroke(r);
  return r;
}

// ────────────────────────────────────────────────────────────────
//  1. ПЕРЕМЕННЫЕ
// ────────────────────────────────────────────────────────────────

const varCol = figma.variables.createVariableCollection('Packfolio Tokens');
const modeId = varCol.defaultModeId;
varCol.renameMode(modeId, 'Dark');

const colorVarDefs = [
  ['Color/BG/Default',      C.bg],
  ['Color/BG/Card',         C.bgCard],
  ['Color/BG/Elevated',     C.bgElevated],
  ['Color/BG/Input',        C.bgInput],
  ['Color/Border/Default',  C.border],
  ['Color/Border/Strong',   C.borderStrong],
  ['Color/Text/Primary',    C.text],
  ['Color/Text/Secondary',  C.textSec],
  ['Color/Text/Hint',       C.textHint],
  ['Color/Accent/Default',  C.accent],
  ['Color/Accent/Dim',      C.accentDim],
  ['Color/Accent/Teal',     C.accentTeal],
  ['Color/Danger/Default',  C.danger],
  ['Color/Danger/Dim',      C.dangerDim],
  ['Color/Doc/Flight',      C.flight],
  ['Color/Doc/Hotel',       C.hotel],
  ['Color/Doc/Train',       C.train],
  ['Color/Doc/Bus',         C.bus],
  ['Color/Doc/Car',         C.car],
  ['Color/Doc/Insurance',   C.insurance],
  ['Color/Doc/Passport',    C.passport],
  ['Color/Doc/Unknown',     C.unknown],
];

for (const [name, val] of colorVarDefs) {
  const v = figma.variables.createVariable(name, varCol.id, 'COLOR');
  v.setValueForMode(modeId, { r:val.r, g:val.g, b:val.b, a:(val.a != null ? val.a : 1) });
}

const floatVarDefs = [
  ['Radius/XL',24], ['Radius/LG',20], ['Radius/MD',16], ['Radius/SM',12], ['Radius/XS',8],
  ['Spacing/4',4], ['Spacing/8',8], ['Spacing/12',12], ['Spacing/16',16], ['Spacing/20',20], ['Spacing/24',24],
];

for (const [name, val] of floatVarDefs) {
  const v = figma.variables.createVariable(name, varCol.id, 'FLOAT');
  v.setValueForMode(modeId, val);
}

// ────────────────────────────────────────────────────────────────
//  2. ТЕКСТОВЫЕ СТИЛИ
// ────────────────────────────────────────────────────────────────

const textStyleDefs = [
  { name:'Page Title',       size:16, w:400, desc:'Tab Bar — заголовок страницы' },
  { name:'Heading 2',        size:20, w:400, desc:'Trip Card (название), Modal Sheet (заголовок), Empty State' },
  { name:'Heading 3',        size:16, w:500, desc:'Doc Card (название документа)' },
  { name:'Paragraph M',      size:16, w:400, desc:'Формы (input/textarea), Autocomplete, Виджет (значение поля)' },
  { name:'Paragraph S',      size:15, w:400, desc:'Doc Card (значение поля)' },
  { name:'Body Secondary',   size:14, w:400, desc:'GDPR (текст), Upload Area (подсказка)' },
  { name:'Doc Subtitle',     size:12, w:400, desc:'Doc Card (подзаголовок), Trip Card (заметка)' },
  { name:'Button Label',     size:16, w:600, desc:'Кнопки — все варианты' },
  { name:'Dialog Message',   size:16, w:600, desc:'Modal Sheet (текст подтверждения)' },
  { name:'Caption M',        size:12, w:500, uppercase:true, ls:0.4, desc:'Формы (label), Doc Card (ключ поля), Trip Card (мета-чип)' },
  { name:'Caption S',        size:12, w:500, uppercase:true, ls:0.6, desc:'Section Title' },
  { name:'Field Label',      size:10, w:500, uppercase:true, ls:0.5, desc:'Doc Card (лейбл поля)' },
  { name:'UI Micro',         size:10, w:500, uppercase:true, ls:0.5, desc:'Doc Card Back (лейбл строки)' },
  { name:'Tag Pill',         size:11, w:500, desc:'Doc Card (теги)' },
  { name:'Filter Chip',      size:13, w:500, desc:'Filter Chips / Tab Switcher' },
  { name:'Nav Label',        size:10, w:500, desc:'Tab Bar (подпись таба)' },
  { name:'FAB Label',        size:15, w:600, desc:'FAB (плавающая кнопка)' },
  { name:'Pro Plan Name',    size:14, w:500, desc:'Pro Plan Cards (название тарифа)' },
  { name:'Pro Plan Price',   size:18, w:600, desc:'Pro Plan Cards (цена)' },
  { name:'Badge/Confidence', size:11, w:600, desc:'Badges (уверенность распознавания)' },
  { name:'PRO Badge',        size:9,  w:700, uppercase:true, ls:0.4, desc:'Badges, Pro Plan Cards' },
  { name:'GDPR Title',       size:20, w:600, desc:'GDPR Consent Sheet (заголовок)' },
  { name:'Edit Btn Inline',  size:11, w:600, desc:'Doc Card / Виджет (кнопка редактирования)' },
];

for (const d of textStyleDefs) {
  const s = figma.createTextStyle();
  s.name = d.name;
  s.description = d.desc || '';
  s.fontName = { family:FF, style:FW[d.w] };
  s.fontSize = d.size;
  if (d.uppercase) s.textCase = 'UPPER';
  if (d.ls)        s.letterSpacing = { unit:'PIXELS', value:d.ls };
}

// ────────────────────────────────────────────────────────────────
//  3. СТРАНИЦА КОМПОНЕНТОВ
// ────────────────────────────────────────────────────────────────

let dsPage = figma.root.children.find(p => p.name === '🧩 Packfolio DS');
if (!dsPage) { dsPage = figma.createPage(); dsPage.name = '🧩 Packfolio DS'; }
Array.from(dsPage.children).forEach(function(ch) { ch.remove(); });
figma.currentPage = dsPage;

// Сетка размещения: 4 колонки по 480px
const COL_W = 480, COL_GAP = 40, ROW_GAP = 32;
const colY = [40, 40, 40, 40];
let colIdx = 0;

function place(frame) {
  const ci = colIdx % 4;
  frame.x = ci * (COL_W + COL_GAP) + 40;
  frame.y = colY[ci];
  colY[ci] += frame.height + ROW_GAP;
  colIdx++;
  dsPage.appendChild(frame);
}

// Обёртка-секция
function section(title) {
  const f = figma.createFrame();
  f.name = title;
  setAL(f, 'VERTICAL', 16, 24, 24, 24, 24);
  applyFill(f, C.bgCard);
  clearStroke(f);
  f.cornerRadius = R.lg;

  const head = makeText(title, 11, 700, C.accent, { uppercase:true, ls:1.2 });
  f.appendChild(head);
  f.appendChild(dividerH());
  return f;
}

// ── Кнопки ────────────────────────────────────────────────────

function makeBtn(name, label, bg, textColor, borderC = null) {
  const c = figma.createComponent();
  c.name = name;
  setAL(c, 'HORIZONTAL', 8, 16, 24, 16, 24);
  center(c);
  applyFill(c, bg);
  c.cornerRadius = R.sm;
  if (borderC) applyStroke(c, borderC);
  else clearStroke(c);
  c.appendChild(makeText(label, 16, 600, textColor));
  return c;
}

const btnSec = section('Кнопки');
const btnRow = hFrame(12);
btnRow.appendChild(makeBtn('Button/Primary',   'Сохранить', C.accent,    C.text));
btnRow.appendChild(makeBtn('Button/Secondary', 'Отменить',  C.white6,    C.text, C.borderStrong));
btnRow.appendChild(makeBtn('Button/Danger',    'Удалить',   C.dangerDim, C.danger, C.dangerBorder));

const btnGhost = figma.createComponent();
btnGhost.name = 'Button/Ghost';
setAL(btnGhost, 'HORIZONTAL', 0, 8, 8, 8, 8); clearFill(btnGhost); clearStroke(btnGhost);
btnGhost.appendChild(makeText('✕', 18, 400, C.textSec));
btnRow.appendChild(btnGhost);

const btnIcon = figma.createComponent();
btnIcon.name = 'Button/Icon';
setAL(btnIcon, 'HORIZONTAL', 0, 10, 10, 10, 10); center(btnIcon);
applyFill(btnIcon, C.white6); applyStroke(btnIcon, C.border); btnIcon.cornerRadius = R.xs;
btnIcon.appendChild(makeText('🔗', 18, 400, C.text));
btnRow.appendChild(btnIcon);
btnSec.appendChild(btnRow);

const btnFull = figma.createComponent();
btnFull.name = 'Button/Full-Primary';
btnFull.layoutMode = 'HORIZONTAL'; center(btnFull);
btnFull.paddingTop = 16; btnFull.paddingBottom = 16; btnFull.paddingLeft = 24; btnFull.paddingRight = 24;
btnFull.primaryAxisSizingMode = 'FIXED'; btnFull.counterAxisSizingMode = 'AUTO';
btnFull.resize(380, 56);
applyFill(btnFull, C.accent); clearStroke(btnFull); btnFull.cornerRadius = R.sm;
btnFull.appendChild(makeText('🔗 Создать ссылку', 16, 600, C.text));
btnSec.appendChild(btnFull);

const btnFullDanger = figma.createComponent();
btnFullDanger.name = 'Button/Full-Danger';
btnFullDanger.layoutMode = 'HORIZONTAL'; center(btnFullDanger);
btnFullDanger.paddingTop = 16; btnFullDanger.paddingBottom = 16; btnFullDanger.paddingLeft = 24; btnFullDanger.paddingRight = 24;
btnFullDanger.primaryAxisSizingMode = 'FIXED'; btnFullDanger.counterAxisSizingMode = 'AUTO';
btnFullDanger.resize(380, 56);
applyFill(btnFullDanger, C.dangerDim); applyStroke(btnFullDanger, C.dangerBorder);
btnFullDanger.cornerRadius = R.sm;
btnFullDanger.appendChild(makeText('🗑 Удалить профиль', 16, 600, C.danger));
btnSec.appendChild(btnFullDanger);

place(btnSec);

// ── Filter Chips ───────────────────────────────────────────────

function makeChip(name, label, active) {
  const c = figma.createFrame();
  c.name = name;
  setAL(c, 'HORIZONTAL', 0, 7, 16, 7, 16); center(c);
  applyFill(c, active ? C.accent : { r:0, g:0, b:0, a:0 });
  clearStroke(c);
  c.cornerRadius = R.xl - 2;
  c.appendChild(makeText(label, 13, active ? 600 : 500, C.text));
  return c;
}

const chipSec = section('Filter Chips / Tab Switcher');
const chipTrack = figma.createComponent();
chipTrack.name = 'Filter Chips/Track';
setAL(chipTrack, 'HORIZONTAL', 2, 3, 3, 3, 3);
applyFill(chipTrack, C.bgInput); clearStroke(chipTrack);
chipTrack.cornerRadius = R.xl;
chipTrack.appendChild(makeChip('Chip/Default', 'Все', false));
chipTrack.appendChild(makeChip('Chip/Active', 'Личные', true));
chipTrack.appendChild(makeChip('Chip/Default2', 'Совместные', false));
chipSec.appendChild(chipTrack);
place(chipSec);

// ── Trip Card ─────────────────────────────────────────────────

function metaChip(text) {
  const ch = figma.createFrame();
  setAL(ch, 'HORIZONTAL', 5, 5, 12, 5, 12); center(ch);
  applyFill(ch, C.white8); applyStroke(ch, C.border);
  ch.cornerRadius = R.xl;
  ch.appendChild(makeText(text, 12, 500, C.textSec));
  return ch;
}

function makeTripCard(name, title, chips) {
  const c = figma.createComponent();
  c.name = name;
  setAL(c, 'VERTICAL', 12, 20, 20, 20, 20);
  c.fills = gradRadial([
    { position:0,    color:{ r:0.180, g:0.188, b:0.376, a:1 } },
    { position:0.55, color:{ r:0.075, g:0.082, b:0.173, a:1 } },
    { position:1,    color:{ r:0.039, g:0.043, b:0.094, a:1 } },
  ]);
  applyStroke(c, C.border); c.cornerRadius = R.lg;
  c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'AUTO';
  c.resize(380, 10);

  const hdr = hFrame(8);
  hdr.layoutAlign = 'STRETCH'; spaceBetween(hdr); hdr.counterAxisAlignItems = 'MIN';
  const titleT = makeText(title, 20, 400, C.text); titleT.layoutGrow = 1;
  hdr.appendChild(titleT);
  hdr.appendChild(makeText('🔗', 18, 400, C.text));
  c.appendChild(hdr);

  const metaRow = figma.createFrame();
  setAL(metaRow, 'HORIZONTAL', 8, 0); metaRow.layoutAlign = 'STRETCH';
  metaRow.layoutWrap = 'WRAP'; clearFill(metaRow); clearStroke(metaRow);
  for (const ch of chips) metaRow.appendChild(metaChip(ch));
  c.appendChild(metaRow);
  return c;
}

const tripSec = section('Trip Card');
const tripRow = hFrame(16);
tripRow.appendChild(makeTripCard(
  'Trip Card/Personal', 'Евротрип',
  ['📅 19.09.25 — 10.10.25', '🇮🇹 Милан → Рим', '📄 10 документов']
));
tripRow.appendChild(makeTripCard(
  'Trip Card/Shared', 'Испания',
  ['📅 25.08.26 — 01.11.26', '🇪🇸 Мадрид → Барселона', '👥 Совместная']
));
tripSec.appendChild(tripRow);
place(tripSec);

// ── Doc Card ──────────────────────────────────────────────────

function makeDocBadge(emoji, rgb) {
  var r = rgb[0], g = rgb[1], b = rgb[2];
  const badge = figma.createFrame();
  badge.primaryAxisSizingMode = 'FIXED'; badge.counterAxisSizingMode = 'FIXED';
  badge.resize(44, 44);
  setAL(badge, 'HORIZONTAL', 0, 0); center(badge);
  applyFill(badge, { r, g, b, a:0.12 }); clearStroke(badge);
  badge.cornerRadius = R.sm;
  badge.appendChild(makeText(emoji, 22, 400, C.text));
  return badge;
}

function makeTagPillFrame(text, textC, bgC, borderC) {
  const f = figma.createFrame();
  setAL(f, 'HORIZONTAL', 0, 4, 12, 4, 12);
  applyFill(f, bgC); applyStroke(f, borderC);
  f.cornerRadius = R.xl;
  f.appendChild(makeText(text, 11, 500, textC));
  return f;
}

function makeDocCard(name, emoji, badgeRGB, docTitle, subtitle, fields, tags) {
  const c = figma.createComponent();
  c.name = name;
  setAL(c, 'VERTICAL', 0, 0);
  applyFill(c, C.bgCard); applyStroke(c, C.border); c.cornerRadius = R.lg;
  c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'AUTO';
  c.resize(300, 10);

  // Шапка карточки
  const hdr = hFrame(14);
  hdr.paddingTop = 10; hdr.paddingRight = 16; hdr.paddingBottom = 6; hdr.paddingLeft = 16;
  hdr.primaryAxisSizingMode = 'AUTO'; hdr.layoutAlign = 'STRETCH';
  hdr.appendChild(makeDocBadge(emoji, badgeRGB));
  const info = vFrame(3); info.layoutGrow = 1;
  const tt = makeText(docTitle, 16, 500, C.text, { truncate:true });
  tt.layoutAlign = 'STRETCH';
  info.appendChild(tt);
  info.appendChild(makeText(subtitle, 12, 400, C.textSec));
  hdr.appendChild(info);
  c.appendChild(hdr);

  c.appendChild(dividerH());

  // Тело с полями (сетка 2 колонки)
  const body = figma.createFrame();
  setAL(body, 'VERTICAL', 14, 14, 16, 16, 16);
  body.layoutAlign = 'STRETCH'; clearFill(body); clearStroke(body);
  for (let i = 0; i < fields.length; i += 2) {
    const pr = hFrame(8); pr.layoutAlign = 'STRETCH';
    for (let j = i; j < Math.min(i+2, fields.length); j++) {
      const box = vFrame(3); box.layoutGrow = 1;
      box.appendChild(makeText(fields[j][0], 10, 500, C.textHint, { uppercase:true, ls:0.5 }));
      box.appendChild(makeText(fields[j][1], 15, 400, C.text));
      pr.appendChild(box);
    }
    body.appendChild(pr);
  }
  c.appendChild(body);

  // Теги
  if (tags && tags.length) {
    const tagsRow = figma.createFrame();
    setAL(tagsRow, 'HORIZONTAL', 6, 0, 16, 16, 16);
    tagsRow.layoutAlign = 'STRETCH'; tagsRow.layoutWrap = 'WRAP';
    clearFill(tagsRow); clearStroke(tagsRow);
    for (const [text, tC, bC, bdrC] of tags) tagsRow.appendChild(makeTagPillFrame(text, tC, bC, bdrC));
    c.appendChild(tagsRow);
  }
  return c;
}

const docSec = section('Doc Card');
const docRow = hFrame(16);
docRow.appendChild(makeDocCard(
  'Doc Card/Flight', '✈️', [0.376, 0.647, 0.980],
  'Москва → Мадрид', 'Аэрофлот SU 2130 · 25 авг',
  [['Вылет','25.08.26 07:40'],['Прилёт','25.08.26 09:55'],['Рейс','SU 2130'],['Место','14A']],
  [
    ['Испания',        C.accent,     C.accentDim,            wa(C.accent, 0.25)],
    ['✈️ Испания 2026', C.accentTeal, wa(C.accentTeal, 0.12), wa(C.accentTeal, 0.25)],
  ]
));
docRow.appendChild(makeDocCard(
  'Doc Card/Hotel', '🏨', [0.204, 0.827, 0.600],
  'Hilton Madrid Airport', 'Бронирование · 2 ночи',
  [['Заезд','25.08.26'],['Выезд','27.08.26'],['Номер','Standard'],['Гости','2']],
  [['Истёк', C.dangerText, C.dangerDim, C.dangerBorder]]
));
docSec.appendChild(docRow);
place(docSec);

// ── Теги и чипы ───────────────────────────────────────────────

function makeTagComp(name, text, tC, bgC, borderC) {
  const c = figma.createComponent();
  c.name = name;
  setAL(c, 'HORIZONTAL', 0, 4, 12, 4, 12);
  applyFill(c, bgC); applyStroke(c, borderC); c.cornerRadius = R.xl;
  c.appendChild(makeText(text, 11, 500, tC));
  return c;
}

const tagSec = section('Теги и чипы');
const tagRow1 = hFrame(8);
tagRow1.appendChild(makeTagComp('Tag/Default',   'Испания',     C.accent,     C.accentDim,            wa(C.accent, 0.25)));
tagRow1.appendChild(makeTagComp('Tag/Trip',      '✈️ Евротрип', C.accentTeal, wa(C.accentTeal, 0.12), wa(C.accentTeal, 0.25)));
tagRow1.appendChild(makeTagComp('Tag/Expired',   'Истёк',       C.dangerText, C.dangerDim,             C.dangerBorder));
tagRow1.appendChild(makeTagComp('Tag/Duplicate', 'Дубликат',    C.dupText,    C.dupBg,                 C.dupBorder));
tagSec.appendChild(tagRow1);

// Selected tag (с × кнопкой)
const selTag = figma.createComponent();
selTag.name = 'Tag/Selected';
setAL(selTag, 'HORIZONTAL', 5, 6, 12, 6, 12); selTag.counterAxisAlignItems = 'CENTER';
applyFill(selTag, C.accentDim); applyStroke(selTag, wa(C.accent, 0.30)); selTag.cornerRadius = R.xl;
selTag.appendChild(makeText('Испания', 12, 500, C.accent));
selTag.appendChild(makeText('×', 15, 400, C.accent));
const selTagRow = hFrame(8);
selTagRow.appendChild(selTag);
tagSec.appendChild(selTagRow);
place(tagSec);

// ── Инпуты и формы ────────────────────────────────────────────

function makeInputComp(name, value, focused = false, isHint = false) {
  const c = figma.createComponent();
  c.name = name;
  c.layoutMode = 'HORIZONTAL';
  c.paddingTop = 12; c.paddingBottom = 12; c.paddingLeft = 16; c.paddingRight = 16;
  c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'AUTO';
  c.resize(380, 10);
  c.counterAxisAlignItems = 'CENTER';
  applyFill(c, focused ? wa(C.accent, 0.05) : C.bgInput);
  applyStroke(c, focused ? C.accent : C.border, 1.5);
  c.cornerRadius = R.md;
  c.appendChild(makeText(value, 16, 400, isHint ? C.textHint : C.text));
  return c;
}

const inputSec = section('Инпуты и формы');
const inputCol = vFrame(12);

function formGroup(labelText, inputNode) {
  const g = vFrame(7);
  g.appendChild(makeText(labelText, 12, 500, C.textSec, { uppercase:true, ls:0.4 }));
  g.appendChild(inputNode);
  return g;
}

inputCol.appendChild(formGroup('Название поездки', makeInputComp('Input/Default', 'Евротрип')));
inputCol.appendChild(formGroup('Активный инпут', makeInputComp('Input/Focus', 'Барселона', true)));

const placeholder = makeInputComp('Input/Placeholder', 'Например, Испания 2026', false, true);
inputCol.appendChild(formGroup('Инпут с плейсхолдером', placeholder));

// Textarea
const ta = figma.createComponent();
ta.name = 'Input/Textarea';
ta.layoutMode = 'HORIZONTAL';
ta.paddingTop = 12; ta.paddingBottom = 12; ta.paddingLeft = 16; ta.paddingRight = 16;
ta.primaryAxisSizingMode = 'FIXED'; ta.counterAxisSizingMode = 'FIXED';
ta.resize(380, 80);
ta.counterAxisAlignItems = 'MIN';
applyFill(ta, C.bgInput); applyStroke(ta, C.border, 1.5); ta.cornerRadius = R.md;
ta.appendChild(makeText('Взять адаптер для розеток', 16, 400, C.text));
inputCol.appendChild(formGroup('Заметки (textarea)', ta));

// Search input
const search = figma.createComponent();
search.name = 'Input/Search';
search.layoutMode = 'HORIZONTAL';
search.paddingTop = 0; search.paddingBottom = 0; search.paddingLeft = 34; search.paddingRight = 12;
search.primaryAxisSizingMode = 'FIXED'; search.counterAxisSizingMode = 'FIXED';
search.resize(380, 40); search.counterAxisAlignItems = 'CENTER';
applyFill(search, C.bgInput); applyStroke(search, C.border); search.cornerRadius = R.md;
search.appendChild(makeText('Поиск поездок...', 16, 400, C.textHint));
inputCol.appendChild(search);

inputSec.appendChild(inputCol);
place(inputSec);

// ── Modal Sheet ───────────────────────────────────────────────

const modalSec = section('Modal Sheet');
const modalRow = hFrame(16);
modalRow.counterAxisAlignItems = 'MIN';

// Bottom Sheet
const bsheet = figma.createComponent();
bsheet.name = 'Modal/BottomSheet';
setAL(bsheet, 'VERTICAL', 0, 0);
applyFill(bsheet, C.bgCard); applyStroke(bsheet, C.border);
bsheet.topLeftRadius = R.xl; bsheet.topRightRadius = R.xl; bsheet.bottomLeftRadius = 0; bsheet.bottomRightRadius = 0;
bsheet.primaryAxisSizingMode = 'FIXED'; bsheet.counterAxisSizingMode = 'AUTO';
bsheet.resize(320, 10);

// drag handle
const dhWrap = figma.createFrame(); setAL(dhWrap, 'HORIZONTAL', 0, 12, 12, 0, 12);
dhWrap.primaryAxisAlignItems = 'CENTER'; dhWrap.layoutAlign = 'STRETCH'; clearFill(dhWrap); clearStroke(dhWrap);
const dh = figma.createRectangle(); dh.resize(40, 4); dh.cornerRadius = 2;
applyFill(dh, C.white15); clearStroke(dh);
dhWrap.appendChild(dh); bsheet.appendChild(dhWrap);

// Modal header
const mhdr = hFrame(12);
mhdr.paddingTop = 14; mhdr.paddingRight = 16; mhdr.paddingBottom = 14; mhdr.paddingLeft = 16;
mhdr.layoutAlign = 'STRETCH'; spaceBetween(mhdr);
clearFill(mhdr); mhdr.strokes = paint(C.border); mhdr.strokeWeight = 1; mhdr.strokeAlign = 'OUTSIDE';
const mTitle = makeText('👥 Доступ: Испания', 20, 400, C.text); mTitle.layoutGrow = 1;
mhdr.appendChild(mTitle);
mhdr.appendChild(makeText('✕', 18, 400, C.textSec));
bsheet.appendChild(mhdr);

// Member card
const mbodyWrap = vFrame(8);
mbodyWrap.paddingTop = 16; mbodyWrap.paddingRight = 16; mbodyWrap.paddingBottom = 8; mbodyWrap.paddingLeft = 16;
mbodyWrap.layoutAlign = 'STRETCH'; clearFill(mbodyWrap); clearStroke(mbodyWrap);
mbodyWrap.appendChild(makeText('УЧАСТНИКИ', 12, 500, C.textHint, { uppercase:true, ls:0.6 }));

const memberCard = vFrame(10);
memberCard.paddingTop = 12; memberCard.paddingRight = 16; memberCard.paddingBottom = 12; memberCard.paddingLeft = 16;
memberCard.layoutAlign = 'STRETCH'; applyFill(memberCard, C.bgElevated); applyStroke(memberCard, C.border);
memberCard.cornerRadius = R.md;

const memberTop = hFrame(10); memberTop.layoutAlign = 'STRETCH';
const av = figma.createFrame(); av.primaryAxisSizingMode = 'FIXED'; av.counterAxisSizingMode = 'FIXED';
av.resize(40, 40); setAL(av, 'HORIZONTAL', 0, 0); center(av);
applyFill(av, C.accent); av.cornerRadius = 20;
av.appendChild(makeText('В', 17, 600, C.text));
memberTop.appendChild(av);
const mInfo = vFrame(2); mInfo.layoutGrow = 1;
mInfo.appendChild(makeText('Влада Цуркан', 15, 500, C.text));
mInfo.appendChild(makeText('@andgako', 13, 400, C.textHint));
memberTop.appendChild(mInfo);
memberTop.appendChild(makeText('✕', 16, 400, C.textHint));
memberCard.appendChild(memberTop);

const roleSelect = figma.createFrame();
setAL(roleSelect, 'HORIZONTAL', 0, 6, 10, 6, 10);
roleSelect.layoutAlign = 'STRETCH'; applyFill(roleSelect, C.bgInput); applyStroke(roleSelect, C.border);
roleSelect.cornerRadius = R.md;
const roleT = makeText('Читатель — только просмотр', 16, 400, C.text); roleT.layoutGrow = 1;
roleSelect.appendChild(roleT);
memberCard.appendChild(roleSelect);
mbodyWrap.appendChild(memberCard);
bsheet.appendChild(mbodyWrap);

// Footer
const mfooter = figma.createFrame();
setAL(mfooter, 'HORIZONTAL', 0, 14, 16, 14, 16);
mfooter.layoutAlign = 'STRETCH'; clearFill(mfooter); clearStroke(mfooter);
const shareBtn = figma.createFrame();
setAL(shareBtn, 'HORIZONTAL', 8, 16, 24, 16, 24); center(shareBtn);
shareBtn.primaryAxisAlignItems = 'CENTER'; shareBtn.layoutGrow = 1;
applyFill(shareBtn, C.accent); shareBtn.cornerRadius = R.sm;
shareBtn.appendChild(makeText('🔗 Создать ссылку', 16, 600, C.text));
mfooter.appendChild(shareBtn);
bsheet.appendChild(mfooter);
modalRow.appendChild(bsheet);

// Confirm dialog
const confirmD = figma.createComponent();
confirmD.name = 'Modal/Confirm';
setAL(confirmD, 'VERTICAL', 0, 24, 16, 16, 16);
applyFill(confirmD, C.bgCard); applyStroke(confirmD, C.border);
confirmD.cornerRadius = R.xl;

const cdhWrap = figma.createFrame(); setAL(cdhWrap, 'HORIZONTAL', 0, 0, 0, 12, 0);
cdhWrap.primaryAxisAlignItems = 'CENTER'; cdhWrap.layoutAlign = 'STRETCH'; clearFill(cdhWrap); clearStroke(cdhWrap);
const cdh = figma.createRectangle(); cdh.resize(40, 4); cdh.cornerRadius = 2;
applyFill(cdh, C.white15); clearStroke(cdh);
cdhWrap.appendChild(cdh); confirmD.appendChild(cdhWrap);

const confMsg = makeText('Удалить участника из поездки?', 16, 600, C.text, { align:'CENTER' });
confMsg.layoutAlign = 'STRETCH'; confMsg.textAlignHorizontal = 'CENTER';
confirmD.appendChild(confMsg);

const cbRow = hFrame(8); cbRow.layoutAlign = 'STRETCH';
function makeSmallBtn(text, bg, tC, bdrC) {
  const b = figma.createFrame();
  setAL(b, 'HORIZONTAL', 0, 16, 24, 16, 24); center(b);
  b.layoutGrow = 1; b.primaryAxisAlignItems = 'CENTER';
  applyFill(b, bg); if (bdrC) applyStroke(b, bdrC); else clearStroke(b);
  b.cornerRadius = R.sm;
  b.appendChild(makeText(text, 16, 600, tC));
  return b;
}
cbRow.appendChild(makeSmallBtn('Отменить', C.white6, C.text, C.borderStrong));
cbRow.appendChild(makeSmallBtn('Удалить', C.dangerDim, C.danger, C.dangerBorder));
confirmD.appendChild(cbRow);
modalRow.appendChild(confirmD);

modalSec.appendChild(modalRow);
place(modalSec);

// ── Badges ────────────────────────────────────────────────────

const badgeSec = section('Badges');
const badgeRow = hFrame(8);

function makeBadge(name, text, bgC, tC, r = 20) {
  const c = figma.createComponent(); c.name = name;
  setAL(c, 'HORIZONTAL', 4, 4, 10, 4, 10); center(c);
  applyFill(c, bgC); clearStroke(c); c.cornerRadius = r;
  c.appendChild(makeText(text, 11, 600, tC));
  return c;
}

badgeRow.appendChild(makeBadge('Badge/Confidence-High',   '● Высокая',  C.confHighBg, C.confHigh));
badgeRow.appendChild(makeBadge('Badge/Confidence-Medium', '● Средняя',  C.confMedBg,  C.confMed));
badgeRow.appendChild(makeBadge('Badge/Confidence-Low',    '● Низкая',   C.confLowBg,  C.confLow));
badgeSec.appendChild(badgeRow);

const badgeRow2 = hFrame(8);
const modBadge = figma.createComponent(); modBadge.name = 'Badge/Modified';
setAL(modBadge, 'HORIZONTAL', 0, 2, 6, 2, 6);
applyFill(modBadge, wa(C.danger, 0.15)); applyStroke(modBadge, wa(C.danger, 0.30)); modBadge.cornerRadius = 4;
modBadge.appendChild(makeText('ИЗМЕНЕНО', 9, 600, C.dangerText, { uppercase:true, ls:0.3 }));
badgeRow2.appendChild(modBadge);

const proBadge = figma.createComponent(); proBadge.name = 'Badge/PRO';
setAL(proBadge, 'HORIZONTAL', 0, 1, 5, 1, 5);
applyFill(proBadge, C.accent); clearStroke(proBadge); proBadge.cornerRadius = 4;
proBadge.appendChild(makeText('PRO', 9, 700, C.text, { uppercase:true, ls:0.4 }));
badgeRow2.appendChild(proBadge);

badgeSec.appendChild(badgeRow2);
place(badgeSec);

// ── Toast ─────────────────────────────────────────────────────

const toastSec = section('Toast');
const toastC = figma.createComponent(); toastC.name = 'Toast';
setAL(toastC, 'HORIZONTAL', 0, 10, 20, 10, 20); center(toastC);
applyFill(toastC, C.bgElevated); applyStroke(toastC, C.borderStrong); toastC.cornerRadius = 20;
toastC.appendChild(makeText('✅ Ссылка скопирована в буфер', 14, 500, C.text));
toastSec.appendChild(toastC);
place(toastSec);

// ── Empty State ───────────────────────────────────────────────

const emptySec = section('Empty State');
const emptyC = figma.createComponent(); emptyC.name = 'Empty State';
setAL(emptyC, 'VERTICAL', 14, 72, 16, 40, 16); center(emptyC);
clearFill(emptyC); clearStroke(emptyC);
emptyC.primaryAxisSizingMode = 'FIXED'; emptyC.counterAxisSizingMode = 'AUTO';
emptyC.resize(380, 10);

const eIcon = figma.createFrame(); eIcon.primaryAxisSizingMode = 'FIXED'; eIcon.counterAxisSizingMode = 'FIXED';
eIcon.resize(80, 80); setAL(eIcon, 'HORIZONTAL', 0, 0); center(eIcon);
applyFill(eIcon, C.bgCard); applyStroke(eIcon, C.border); eIcon.cornerRadius = 24;
eIcon.appendChild(makeText('✈️', 36, 400, C.text));
emptyC.appendChild(eIcon);

const eTitle = makeText('Нет поездок', 20, 400, C.text, { align:'CENTER' });
eTitle.layoutAlign = 'STRETCH'; eTitle.textAlignHorizontal = 'CENTER';
emptyC.appendChild(eTitle);

const eDesc = makeText('Создайте первую поездку, чтобы начать собирать документы', 12, 400, C.textSec, { lh:18 });
eDesc.layoutAlign = 'STRETCH'; eDesc.textAlignHorizontal = 'CENTER';
emptyC.appendChild(eDesc);

const eBtn = figma.createFrame(); setAL(eBtn, 'HORIZONTAL', 0, 12, 20, 12, 20); center(eBtn);
applyFill(eBtn, C.accent); eBtn.cornerRadius = R.xl;
eBtn.appendChild(makeText('+ Новая поездка', 16, 600, C.text));
emptyC.appendChild(eBtn);

emptySec.appendChild(emptyC);
place(emptySec);

// ── Tab Bar + FAB ─────────────────────────────────────────────

const navSec = section('Tab Bar + FAB');

const navBar = figma.createComponent(); navBar.name = 'Tab Bar';
navBar.layoutMode = 'HORIZONTAL'; spaceBetween(navBar); navBar.counterAxisAlignItems = 'CENTER';
navBar.primaryAxisSizingMode = 'FIXED'; navBar.counterAxisSizingMode = 'FIXED';
navBar.resize(312, 64);
navBar.paddingTop = 0; navBar.paddingBottom = 0; navBar.paddingLeft = 0; navBar.paddingRight = 0;
applyFill(navBar, { r:0.075, g:0.082, b:0.173, a:0.92 });
applyStroke(navBar, C.white10); navBar.cornerRadius = R.xl;

for (const [emoji, label, active] of [['✈️','Поездки',true],['📄','Документы',false],['📅','Календарь',false],['👤','Профиль',false]]) {
  const btn = figma.createFrame(); setAL(btn, 'VERTICAL', 3, 8, 4, 8, 4); center(btn);
  btn.primaryAxisAlignItems = 'CENTER'; btn.layoutGrow = 1;
  clearFill(btn); clearStroke(btn);
  btn.appendChild(makeText(emoji, 24, 400, C.text));
  btn.appendChild(makeText(label, 10, 500, active ? C.text : C.textSec));
  navBar.appendChild(btn);
}
navSec.appendChild(navBar);

const fabC = figma.createComponent(); fabC.name = 'FAB';
setAL(fabC, 'HORIZONTAL', 8, 14, 20, 14, 20); center(fabC);
fabC.primaryAxisSizingMode = 'FIXED'; fabC.counterAxisSizingMode = 'AUTO';
fabC.resize(312, 10);
applyFill(fabC, C.white6); applyStroke(fabC, C.white10); fabC.cornerRadius = R.lg;
fabC.appendChild(makeText('+', 20, 400, C.textHint));
fabC.appendChild(makeText('Новая поездка', 15, 600, C.textHint));
navSec.appendChild(fabC);

place(navSec);

// ── Профиль ───────────────────────────────────────────────────

const profSec = section('Профиль');

const profHeader = figma.createComponent(); profHeader.name = 'Profile/Header';
setAL(profHeader, 'HORIZONTAL', 16, 16, 16, 16, 16);
profHeader.counterAxisAlignItems = 'CENTER';
applyFill(profHeader, C.bgCard); applyStroke(profHeader, C.border); profHeader.cornerRadius = R.lg;
profHeader.primaryAxisSizingMode = 'FIXED'; profHeader.counterAxisSizingMode = 'AUTO';
profHeader.resize(380, 10);

const pAv = figma.createFrame(); pAv.primaryAxisSizingMode = 'FIXED'; pAv.counterAxisSizingMode = 'FIXED';
pAv.resize(60, 60); setAL(pAv, 'HORIZONTAL', 0, 0); center(pAv);
applyFill(pAv, C.accent); pAv.cornerRadius = 30;
pAv.appendChild(makeText('М', 22, 700, C.text));
profHeader.appendChild(pAv);

const pName = vFrame(4); pName.layoutGrow = 1;
pName.appendChild(makeText('Мария Денисовна', 18, 700, C.text));
pName.appendChild(makeText('@mariadenisovna', 13, 400, C.textHint));
profHeader.appendChild(pName);
profSec.appendChild(profHeader);

const profStats = figma.createComponent(); profStats.name = 'Profile/Stats';
profStats.layoutMode = 'HORIZONTAL'; spaceBetween(profStats); profStats.counterAxisAlignItems = 'CENTER';
profStats.paddingTop = 18; profStats.paddingBottom = 18; profStats.paddingLeft = 16; profStats.paddingRight = 16;
profStats.primaryAxisSizingMode = 'FIXED'; profStats.counterAxisSizingMode = 'AUTO';
profStats.resize(380, 10);
applyFill(profStats, C.bgCard); applyStroke(profStats, C.border); profStats.cornerRadius = R.lg;

function makeStat(value, label) {
  const s = vFrame(4); s.layoutGrow = 1; s.primaryAxisAlignItems = 'CENTER'; s.counterAxisAlignItems = 'CENTER';
  s.appendChild(makeText(value, 24, 700, C.text, { align:'CENTER' }));
  s.appendChild(makeText(label, 12, 400, C.textHint, { align:'CENTER' }));
  return s;
}
const statDiv = figma.createRectangle(); statDiv.resize(1, 36); applyFill(statDiv, C.border); clearStroke(statDiv);
profStats.appendChild(makeStat('5', 'поездок')); profStats.appendChild(statDiv); profStats.appendChild(makeStat('24', 'документов'));
profSec.appendChild(profStats);
place(profSec);

// ── Pro Plan Cards ────────────────────────────────────────────

const proSec = section('Pro Plan Cards');
const proRow = hFrame(10);

function makeProPlan(name, planName, price, active) {
  const c = figma.createComponent(); c.name = name;
  setAL(c, 'VERTICAL', 6, 16, 12, 16, 12); center(c);
  applyFill(c, active ? C.accentDim : C.bgCard);
  applyStroke(c, active ? C.accent : C.border, 1.5);
  c.cornerRadius = R.md;
  c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'AUTO';
  c.resize(155, 10);
  c.appendChild(makeText(planName, 14, 500, C.text));
  c.appendChild(makeText(price, 18, 600, C.text));
  return c;
}

proRow.appendChild(makeProPlan('Pro Plan/Month', 'Месяц', '⭐ 250', false));
proRow.appendChild(makeProPlan('Pro Plan/Year',  'Год',   '⭐ 2100', true));
proSec.appendChild(proRow);
place(proSec);

// ── GDPR Consent ──────────────────────────────────────────────

const gdprSec = section('GDPR Consent Sheet');
const gdprSheet = figma.createComponent(); gdprSheet.name = 'GDPR Consent Sheet';
setAL(gdprSheet, 'VERTICAL', 14, 28, 16, 24, 16);
gdprSheet.primaryAxisAlignItems = 'MIN'; gdprSheet.counterAxisAlignItems = 'CENTER';
applyFill(gdprSheet, C.bgCard); clearStroke(gdprSheet);
gdprSheet.topLeftRadius = R.lg; gdprSheet.topRightRadius = R.lg;
gdprSheet.bottomLeftRadius = 0; gdprSheet.bottomRightRadius = 0;
gdprSheet.primaryAxisSizingMode = 'FIXED'; gdprSheet.counterAxisSizingMode = 'AUTO';
gdprSheet.resize(380, 10);

const gdprIcon = makeText('🔐', 36, 400, C.text, { align:'CENTER' });
gdprIcon.layoutAlign = 'STRETCH'; gdprIcon.textAlignHorizontal = 'CENTER';
gdprSheet.appendChild(gdprIcon);

const gdprTitle = makeText('Согласие на обработку данных', 20, 600, C.text, { align:'CENTER' });
gdprTitle.layoutAlign = 'STRETCH'; gdprTitle.textAlignHorizontal = 'CENTER';
gdprSheet.appendChild(gdprTitle);

const gdprBody = makeText('Для работы Packfolio мы обрабатываем:\n• Данные профиля Telegram — имя, @ник, идентификатор\n• Данные из документов — ФИО, даты, номера из файлов', 14, 400, C.textSec, { lh:22 });
gdprBody.layoutAlign = 'STRETCH';
gdprSheet.appendChild(gdprBody);

const gdprBtn = figma.createFrame();
setAL(gdprBtn, 'HORIZONTAL', 0, 16, 24, 16, 24); center(gdprBtn);
gdprBtn.primaryAxisAlignItems = 'CENTER'; gdprBtn.layoutAlign = 'STRETCH';
applyFill(gdprBtn, C.accent); gdprBtn.cornerRadius = R.sm;
gdprBtn.appendChild(makeText('Принять и продолжить', 16, 600, C.text));
gdprSheet.appendChild(gdprBtn);
gdprSec.appendChild(gdprSheet);
place(gdprSec);

// ────────────────────────────────────────────────────────────────
//  ФИНАЛ
// ────────────────────────────────────────────────────────────────

figma.viewport.scrollAndZoomIntoView(dsPage.children);

const compCount = dsPage.children.length;
figma.notify(
  `✅ Packfolio DS создана! Шрифт: ${FF} · ${colorVarDefs.length} переменных цвета · ${textStyleDefs.length} текстовых стилей · ${compCount} секций компонентов`,
  { timeout: 6000 }
);
figma.closePlugin();

})().catch(err => {
  figma.notify('❌ Ошибка: ' + (err.message || err), { error: true, timeout: 8000 });
  figma.closePlugin();
});
