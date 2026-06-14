// paiol — one-shot converter: an existing "one tab per recipe" balanço spreadsheet → a paiol
// interchange file (src/exchange.js format). Dev tool, not shipped. Re-run when the sheet
// changes:  node tools/xlsx-to-paiol.mjs <input.xlsx> [outDir]
//
// It reads each recipe tab's two tables — "Ingredientes" (Nome|Qtd|Unidade|Custo unit|Custo
// Total) and the overhead "Insumos" block (Gás/Embalagem/Mão de Obra/Custos Fixos, where Gás &
// Mão de Obra quantities are Excel time fractions) — derives yields, prep/oven minutes,
// packaging, the bill of materials, and per-ingredient prices, dedups ingredient-name variants,
// and writes <outDir>/paiol-import.yaml plus a consistency report.

import { readFileSync, writeFileSync } from 'node:fs';
import { sheet } from '../vendor/@gcu/sheet/index.js';
import { toYaml } from '../src/yaml-bridge.js';

const [, , inPath = 'personal/BALANÇO PAIOL.xlsx', outDir = 'personal'] = process.argv;

// Sheets that aren't recipes (financial/summary). INGREDIENTES is handled separately.
const NON_RECIPE = /^(INGREDIENTES|Comparativo|DESPESAS|BALANCO|BALANÇO|COMANDA|Resumo)/i;

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normName = (s) => stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
const titleish = (s) => String(s || '').trim();

// Curated typo corrections (normalized typo → normalized canonical). EXPLICIT and reviewed —
// each is a clear misspelling of the SAME ingredient. We deliberately do NOT fuzzy/edit-distance
// merge (that would fuse genuinely different ingredients: chocolate 50%/70%, mel/sal, milho/ninho,
// azeite/leite, frango/morango, …). Add a line here when you spot another typo in the report.
const ALIASES = {
  '0vos': 'ovos', 'ovo': 'ovos',
  'fainha de trigo': 'farinha de trigo',
  'farina amendoas': 'farinha amendoas',
  'farina integral': 'farinha integral',
  'farina sem gluten': 'farinha sem gluten',
  'farinha trigo interal': 'farinha trigo integral',
  'femento': 'fermento', 'femento quimico': 'fermento quimico',
  'leite condesado': 'leite condensado',
  'oleo girasssol': 'oleo girassol',
  'pstache': 'pistache',
  'bicabornato': 'bicarbonato',
  'demeara': 'demerara', 'demererara': 'demerara',
  'acuca demerara': 'acucar demerara',
  'tempero': 'temperos',
};
const canonKey = (raw) => { const n = normName(raw); return ALIASES[n] || n; };

function normUnit(u) {
  const n = normName(u);
  if (!n) return null;
  if (/^(l|litro|litros|litos)$/.test(n)) return 'l';
  if (/^ml$/.test(n)) return 'ml';
  if (/^kg$/.test(n)) return 'kg';
  if (/^g$/.test(n)) return 'g';
  if (/^(un|und|unid|unidade|unidades)\.?$/.test(n)) return 'un';
  return null; // unknown
}

// Gás / Mão de Obra quantities are stored as a fraction of a day (Excel time) or "H:MM".
function timeToMinutes(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  const hm = s.match(/^(\d+):(\d{1,2})/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return Math.round(n * 1440); // day fraction → minutes
  return Math.round(n * 60);              // >= 1 → assume hours (flagged in report)
}

const numOr = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// Header-block / overhead labels that must never be read as ingredients (some tabs are laid out
// so these fall under the parser's row scan).
const LABELS = new Set([
  'unidades por receita', 'preco de venda', 'mao de obra', 'custo unidade', 'lucro unidade',
  'ingredientes', 'insumos', 'nome', 'qtd', 'unidade', 'total', 'custo total', 'custo unit',
  'custo unit.', 'custo receita', 'venda receita', 'lucro por receita', 'lucro por hora',
  'impostos', 'comissao', 'lucro desejado', 'media do mercado', 'custos fixos', 'gas', 'embalagem',
]);

async function main() {
  const wb = await sheet.read(readFileSync(inPath));
  const sheets = wb.sheets;
  const cell = (sh, c, r) => { const k = sh.headers[c]; const col = sh.columns[k]; return col ? col[r] : undefined; };
  const colLen = (sh) => Math.max(...sh.headers.map((k) => (sh.columns[k] || []).length), 0);

  const warnings = [];
  const W = (m) => warnings.push(m);

  // ── Per-ingredient accumulators (keyed by normalized name) ──
  /** @type {Map<string, { names: Map<string,number>, units: Map<string,number>, prices: number[] }>} */
  const ingAcc = new Map();
  const touchIng = (raw) => {
    const k = canonKey(raw); // collapse curated typos to one canonical key
    if (!ingAcc.has(k)) ingAcc.set(k, { names: new Map(), units: new Map(), prices: [] });
    return ingAcc.get(k);
  };
  const bump = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
  const mode = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // ── Parse INGREDIENTES master (for price cross-check) ──
  const master = new Map(); // normName -> price
  const ingSheet = sheets.find((s) => /^INGREDIENTES/i.test(s.name));
  if (ingSheet) {
    const rows = colLen(ingSheet);
    for (let c = 0; c + 1 < ingSheet.headers.length; c += 3) { // name col, value col, gap
      let cur = null;
      for (let r = 0; r < rows; r++) {
        const v = titleish(cell(ingSheet, c, r));
        if (!v) continue;
        if (/^total media$/i.test(v)) {
          const price = Number(cell(ingSheet, c + 1, r));
          if (cur && Number.isFinite(price)) master.set(normName(cur), price);
        } else if (!/^(data|valor\/kg)$/i.test(v)) {
          cur = v; // ingredient name or section title (titles get overwritten before a TOTAL MEDIA)
        }
      }
    }
  }

  // ── Parse recipe tabs ──
  const receitas = [];
  const produtos = [];
  let skipped = 0;

  for (const sh of sheets) {
    if (NON_RECIPE.test(sh.name)) { skipped++; continue; }
    const rows = colLen(sh);
    const findRow = (pred) => { for (let r = 0; r < rows; r++) if (pred(r)) return r; return -1; };

    const hdr = findRow((r) => titleish(cell(sh, 0, r)) === 'Nome' && titleish(cell(sh, 1, r)) === 'Qtd');
    if (hdr < 0) { W(`"${sh.name}": sem tabela de ingredientes — pulada`); skipped++; continue; }

    // Yield.
    const yRow = findRow((r) => /^unidades por/i.test(normName(cell(sh, 0, r))));
    const rende = yRow >= 0 ? numOr(cell(sh, 1, yRow), 1) : 1; // value sits in col B next to the label
    if (yRow < 0) W(`"${sh.name}": "Unidades por receita" não encontrada — rende=1`);
    if (yRow >= 0 && !(rende > 0)) W(`"${sh.name}": rende inválido (${cell(sh, 1, yRow)}) — usando 1`);

    // Ingredients (bill of materials).
    const itens = [];
    for (let r = hdr + 1; r < rows; r++) {
      const rawName = titleish(cell(sh, 0, r));
      const qty = Number(cell(sh, 1, r));
      if (!rawName || !Number.isFinite(qty)) continue;
      if (LABELS.has(normName(rawName))) continue; // skip header/overhead labels that leak in
      let unit = normUnit(cell(sh, 2, r));
      const custoUnit = Number(cell(sh, 3, r));
      const altTotal = Number(cell(sh, 5, r)); // some rows put the cost in col F with custoUnit=0
      const custoTotal = Number(cell(sh, 4, r));

      const acc = touchIng(rawName);
      bump(acc.names, rawName);
      if (unit) bump(acc.units, unit);
      else W(`"${sh.name}" / "${rawName}": unidade em branco`);
      // Derive a unit price for this occurrence.
      let p = null;
      if (Number.isFinite(custoUnit) && custoUnit > 0) p = custoUnit;
      else if (Number.isFinite(altTotal) && altTotal > 0 && qty > 0) p = altTotal / qty;
      if (p != null) acc.prices.push(p);
      // Consistency: Custo Total ≈ Qtd × Custo unit.
      if (Number.isFinite(custoUnit) && custoUnit > 0 && Number.isFinite(custoTotal)
          && Math.abs(custoTotal - qty * custoUnit) > 0.02 + 0.01 * Math.abs(custoTotal)) {
        W(`"${sh.name}" / "${rawName}": Custo Total ${custoTotal} ≠ Qtd×unit ${(qty * custoUnit).toFixed(2)}`);
      }
      itens.push({ insumoRaw: rawName, qtd: qty, unidade: unit }); // unit filled to canonical later
    }
    if (itens.length === 0) W(`"${sh.name}": nenhum ingrediente lido`);

    // Overhead block: Gás (oven time), Mão de Obra (prep time), Embalagem (packaging).
    let activeMinutes = 0; let ovenMinutes = 0; let packaging = 0;
    const ihdr = findRow((r) => titleish(cell(sh, 6, r)) === 'Nome' && titleish(cell(sh, 7, r)) === 'Qtd');
    if (ihdr >= 0) {
      for (let r = ihdr + 1; r < rows; r++) {
        const nm = normName(cell(sh, 6, r));
        if (!nm) continue;
        const qtd = cell(sh, 7, r);
        const cu = Number(cell(sh, 9, r));
        if (/gas/.test(nm)) ovenMinutes = timeToMinutes(qtd) ?? 0;
        else if (/mao de obra/.test(nm)) activeMinutes = timeToMinutes(qtd) ?? 0;
        else if (/embalagem/.test(nm)) packaging = Number.isFinite(cu) ? cu : 0;
      }
    } else {
      W(`"${sh.name}": bloco "Insumos" (gás/embalagem/mão de obra) não encontrado`);
    }
    if (activeMinutes >= 24 * 60) W(`"${sh.name}": minutosAtivos=${activeMinutes} suspeito (verifique a unidade de tempo)`);

    receitas.push({ nome: sh.name, rende: rende > 0 ? rende : 1, unidade: 'un', minutosAtivos: activeMinutes, minutosForno: ovenMinutes, itens });
    produtos.push({ nome: sh.name, receita: sh.name, porcao: 1, embalagem: round2(packaging) });
  }

  // ── Resolve canonical ingredient names + prices ──
  const canonical = new Map();   // canonKey -> display name
  const stockUnitOf = new Map(); // canonKey -> stock unit
  const insumos = [];
  for (const [k, acc] of ingAcc) {
    // Prefer a non-typo spelling for the display name (exclude raw names that are known typos);
    // fall back to the most common spelling only if every occurrence was a typo.
    const good = new Map([...acc.names].filter(([nm]) => !ALIASES[normName(nm)]));
    const name = mode(good.size ? good : acc.names) || k;
    canonical.set(k, name);
    const unit = mode(acc.units) || 'un';
    stockUnitOf.set(k, unit);
    const price = acc.prices.length ? modeNumber(acc.prices) : (master.get(k) ?? null);
    if (price == null) W(`insumo "${name}": sem preço derivável (custo 0 em todas as receitas)`);
    // Cross-check against the INGREDIENTES master.
    const mp = master.get(k);
    if (price != null && mp != null && Math.abs(mp - price) > 0.01 + 0.05 * Math.abs(mp)) {
      W(`insumo "${name}": preço receitas ${round2(price)} vs INGREDIENTES ${round2(mp)}`);
    }
    insumos.push({ nome: name, unidade: unit, ...(price != null ? { preco: round2(price) } : {}) });
  }
  insumos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));

  // Map recipe items to canonical insumo names + reconcile units. An insumo has one stock unit;
  // if a recipe used a DIFFERENT-dimension unit (she used óleo as kg here, l there), coerce to the
  // insumo's unit (qty unchanged — she treats them interchangeably) and flag it. Same-dimension
  // units (g for a kg insumo) are kept and converted properly by the engine.
  const DIM = { g: 'm', kg: 'm', ml: 'v', l: 'v', un: 'c' };
  for (const r of receitas) {
    r.itens = r.itens.map((it) => {
      const key = canonKey(it.insumoRaw);
      const su = stockUnitOf.get(key) || 'un';
      let u = it.unidade || su;
      if (DIM[u] !== DIM[su]) {
        W(`"${r.nome}" / "${canonical.get(key) || it.insumoRaw}": unidade ${u} incompatível com ${su} do insumo — usando ${su}`);
        u = su;
      }
      return { insumo: canonical.get(key) || it.insumoRaw, qtd: it.qtd, unidade: u };
    });
  }

  // ── Emit ──
  const doc = { version: 1, insumos, receitas, produtos };
  const yaml = toYaml(doc);
  writeFileSync(`${outDir}/paiol-import.yaml`, yaml);

  const report = [
    `paiol import report — ${inPath}`,
    `recipes: ${receitas.length} | products: ${produtos.length} | ingredients: ${insumos.length} | sheets skipped: ${skipped}`,
    `INGREDIENTES master prices parsed: ${master.size}`,
    ``,
    `WARNINGS (${warnings.length}):`,
    ...warnings.map((w) => `  - ${w}`),
  ].join('\n');
  writeFileSync(`${outDir}/import-report.txt`, report);

  console.log(`Wrote ${outDir}/paiol-import.yaml`);
  console.log(`  ${receitas.length} receitas, ${produtos.length} produtos, ${insumos.length} insumos`);
  console.log(`  ${warnings.length} warnings → ${outDir}/import-report.txt`);
}

const round2 = (n) => Math.round(n * 100) / 100;
function modeNumber(arr) {
  const c = new Map();
  for (const v of arr) { const k = round2(v); c.set(k, (c.get(k) || 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

main().catch((e) => { console.error('convert failed:', e); process.exit(1); });
