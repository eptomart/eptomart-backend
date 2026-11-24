// ============================================
// KOYAMBEDU — shopping-list import
// Reads a customer's list (hand-written photo / image, Excel, CSV), and matches
// each line to a Koyambedu Daily product. Pure helpers are exported for tests;
// the Claude vision call is the only network part (images only).
// ============================================
const { Readable } = require('stream');

const UNIT_ALIASES = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', 'கிலோ': 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', 'கிராம்': 'g',
  bunch: 'bunch', bunches: 'bunch', 'கட்டு': 'bunch',
  pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', nos: 'piece', no: 'piece',
  box: 'box', boxes: 'box', dozen: 'dozen', doz: 'dozen', l: 'l', ltr: 'l', litre: 'l', liter: 'l',
};
const normUnit = (u) => UNIT_ALIASES[String(u || '').trim().toLowerCase().replace(/\.$/, '')] || '';

/** "Tomato 5kg" / "5 kg tomato" / "Onion - 10" → { name, qty, unit } */
function splitQty(text) {
  let t = String(text || '').replace(/[•*•]+/g, ' ').replace(/^\s*\d+[.)]\s+(?=\D)/, '').trim();
  let qty = null, unit = '';
  const u = '(kg|kgs|kilo|kilos|kilogram|g|gm|gms|gram|grams|bunch|bunches|pcs|pc|piece|pieces|nos|box|boxes|dozen|doz|ltr|litre|liter|l)';
  let m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${u}\\b`, 'i'));
  if (m) { qty = parseFloat(m[1]); unit = normUnit(m[2]); t = t.replace(m[0], ' '); }
  else if ((m = t.match(/[-:–]\s*(\d+(?:\.\d+)?)\s*$/)) || (m = t.match(/\s(\d+(?:\.\d+)?)\s*$/)) || (m = t.match(/^(\d+(?:\.\d+)?)\s+(?=\D)/))) {
    qty = parseFloat(m[1]); t = t.replace(m[0], ' ');
  }
  const name = t.replace(/[-:–,]+\s*$/g, '').replace(/\s+/g, ' ').trim();
  return { name, qty, unit };
}

// ── text normalisation + similarity ────────────────────────────────────────
const STOP = new Set(['fresh', 'organic', 'local', 'big', 'small', 'the', 'of', 'and', 'kg', 'gm', 'grams']);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .split(/\s+/).filter(w => w && !STOP.has(w)).join(' ').trim();
const bigrams = (s) => { const t = s.replace(/\s+/g, ''); const out = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b); let inter = 0, sa = 0, sb = 0;
  for (const v of A.values()) sa += v; for (const v of B.values()) sb += v;
  for (const [g, v] of A) if (B.has(g)) inter += Math.min(v, B.get(g));
  return sa + sb ? (2 * inter) / (sa + sb) : 0;
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
  let s = Math.max(dice(a, b), 1 - lev(a, b) / Math.max(a.length, b.length));
  // whole-word containment ("tomato" in "tomato hybrid") is a strong signal
  if (short.length >= 3 && new RegExp(`(^| )${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(long)) s = Math.max(s, 0.88);
  else if (short.length >= 4 && long.includes(short)) s = Math.max(s, 0.78);
  return Math.min(1, s);
}

const MATCHED = 0.8, SUGGESTED = 0.5;
/** products: [{_id,name,nameTamil,tags,unit,currentPrice}] */
function matchOne(rawName, products, limit = 3) {
  const scored = [];
  for (const p of products) {
    const names = [p.name, p.nameTamil, ...(p.tags || [])].filter(Boolean);
    let best = 0;
    for (const n of names) best = Math.max(best, similarity(rawName, n));
    if (best >= 0.4) scored.push({ productId: String(p._id), name: p.name, nameTamil: p.nameTamil || '', unit: p.unit, price: p.currentPrice, score: Math.round(best * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const best = top[0];
  // two near-identical top scores = ambiguous → ask the admin
  const ambiguous = best && top[1] && best.score < 1 && best.score - top[1].score < 0.04;
  const status = !best ? 'notfound' : (best.score >= MATCHED && !ambiguous) ? 'matched' : best.score >= SUGGESTED ? 'suggested' : 'notfound';
  return { status, match: status === 'notfound' ? null : best, candidates: top };
}

/** grams → kg etc. so "500 g" lands as 0.5 on a kg product */
function convertQty(qty, fromUnit, toUnit) {
  if (qty == null) return null;
  const f = normUnit(fromUnit), t = normUnit(toUnit);
  if (f === 'g' && t === 'kg') return Math.round(qty) / 1000;
  if (f === 'kg' && t === 'g') return qty * 1000;
  return qty;
}

function buildLines(rawLines, products) {
  return rawLines.map((r, i) => {
    const parsed = r.qty != null && r.name ? r : { ...splitQty(r.text || r.name), ...(r.unit ? { unit: normUnit(r.unit) || r.unit } : {}) };
    const name = parsed.name || String(r.text || '').trim();
    if (!name) return null;
    const m = matchOne(name, products);
    const qty = parsed.qty != null ? parsed.qty : 1;
    const product = m.match ? products.find(p => String(p._id) === m.match.productId) : null;
    return {
      id: i + 1, raw: name, qty: product ? convertQty(qty, parsed.unit, product.unit) : qty, unit: parsed.unit || '',
      qtyAssumed: parsed.qty == null, ...m,
    };
  }).filter(Boolean);
}

// ── file readers ──────────────────────────────────────────────────────────
async function readSheet(buffer, mimetype, filename) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const isCsv = /csv/i.test(mimetype) || /\.csv$/i.test(filename || '');
  if (isCsv) await wb.csv.read(Readable.from(buffer)); else await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map(v => (v && typeof v === 'object' && 'text' in v ? v.text : v == null ? '' : String(v)).trim())));
  if (!rows.length) return [];
  // header detection
  const hdr = rows[0].map(h => h.toLowerCase());
  const col = (re) => hdr.findIndex(h => re.test(h));
  let nameC = col(/^(item|items|product|products|name|particular|particulars|description|vegetable|vegetables|பெயர்)\b/), qtyC = col(/^(qty|quantity|weight|amount|kg|kgs|அளவு)\b/), unitC = col(/^(unit|uom)\b/);
  const hasHeader = nameC !== -1 || qtyC !== -1;
  const body = hasHeader ? rows.slice(1) : rows;
  if (nameC === -1) nameC = 0;
  if (qtyC === -1) qtyC = rows.some(r => r.length > 1) ? 1 : -1;
  return body.map(r => {
    const cell = r[nameC] || '';
    const qtyCell = qtyC >= 0 ? r[qtyC] : '';
    if (!cell) return null;
    const inline = splitQty(cell);
    const q = qtyCell !== '' && !isNaN(parseFloat(qtyCell)) ? { qty: parseFloat(qtyCell), unit: unitC >= 0 ? normUnit(r[unitC]) : (normUnit(String(qtyCell).replace(/[\d.\s]/g, '')) || inline.unit) } : inline;
    return { name: inline.name || cell, qty: q.qty, unit: q.unit || inline.unit || '' };
  }).filter(Boolean);
}

async function readImage(buffer, mimetype, callClaude) {
  const media = /png/.test(mimetype) ? 'image/png' : /webp/.test(mimetype) ? 'image/webp' : /gif/.test(mimetype) ? 'image/gif' : 'image/jpeg';
  const system = 'You read shopping lists for a vegetable/fruit/grocery wholesale market in Chennai. The list may be hand-written in English, Tamil or a mix. '
    + 'Return ONLY a JSON array, no prose: [{"name": "<item name, in English if you can tell, else as written>", "qty": <number or null>, "unit": "<kg|g|bunch|piece|box|dozen|l or empty>"}]. '
    + 'One element per line item, in order. Do not invent items. If a quantity is missing use null.';
  const body = { system, max_tokens: 2000, temperature: 0, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } },
    { type: 'text', text: 'Extract every item with its quantity from this list.' },
  ] }] };
  let out;
  try { out = await callClaude({ ...body, model: process.env.LIST_IMPORT_MODEL || 'claude-sonnet-5-5' }); }
  catch (e) { out = await callClaude(body); }          // fall back to the default model
  const m = out.text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Could not read any items from this image');
  const arr = JSON.parse(m[0]);
  return arr.filter(x => x && x.name).map(x => ({ name: String(x.name), qty: x.qty != null && !isNaN(Number(x.qty)) ? Number(x.qty) : null, unit: normUnit(x.unit) || '' }));
}

async function readList({ buffer, mimetype, filename }, deps = {}) {
  const callClaude = deps.callClaude || require('../utils/claudeApi').callClaude;
  if (/^image\//.test(mimetype)) return readImage(buffer, mimetype, callClaude);
  if (/sheet|excel|csv|officedocument|vnd.ms-excel|text\/plain/.test(mimetype) || /\.(xlsx|xls|csv)$/i.test(filename || '')) return readSheet(buffer, mimetype, filename);
  throw Object.assign(new Error('Upload an image (photo of the list), Excel (.xlsx) or CSV file'), { statusCode: 400 });
}

module.exports = { splitQty, normUnit, norm, similarity, matchOne, buildLines, convertQty, readList, readSheet, MATCHED, SUGGESTED };
