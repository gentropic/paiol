// paiol — Excel (.xlsx) import/export (Rev 06). Vendored ExcelJS (UMD, MIT) is loaded LAZILY from a
// sidecar the first time the user touches a spreadsheet, so the ~950 KB never bloats startup; the SW
// precaches it for offline. We do NOT import ExcelJS (it sets a global), so the strip-and-concat
// build never touches it.
//
// The workbook is the friendly, fully-formatted face of the same name-based interchange the YAML
// import/export uses: a tab per recipe (metadata block + Ingredientes table), plus Insumos / Produtos
// front tabs — column widths, frozen headers, bold headers, R$ formats, unit dropdowns, autofilters.
// Import is name-based + merge-only (never deletes), and goes through a preview-before-apply step.

import { applyExchange } from './exchange.js';

let _excel = null;

/** Lazy-load the vendored ExcelJS UMD; resolves the global ExcelJS. Same relative path dev + prod. */
export function loadExcelJS() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (_excel) return _excel;
  _excel = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/exceljs/exceljs.min.js';
    s.onload = () => (globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error('ExcelJS não inicializou')));
    s.onerror = () => { _excel = null; reject(new Error('não foi possível carregar o leitor de planilhas')); };
    document.head.append(s);
  });
  return _excel;
}

const xnorm = (s) => String(s || '').trim().toLowerCase();
const TERRA = 'FF9A4A2F';
const CREAM = 'FFF6E9E1';
const MONEY = '"R$" #,##0.00';
const BASE_UNITS = ['un', 'g', 'kg', 'ml', 'l'];
const EXEMPLO = 'Receita (exemplo)';

/** ExcelJS cell value → a plain string/number (handles formula results + rich text). */
function cv(cell) {
  const v = cell.value;
  if (v == null) return v;
  if (typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

// ── styling helpers ──
const titleCell = (ws, range, text) => { ws.mergeCells(range); const c = ws.getCell(range.split(':')[0]); c.value = text; c.font = { bold: true, size: 13, color: { argb: TERRA } }; };
const sectionCell = (ws, range, text) => { ws.mergeCells(range); const c = ws.getCell(range.split(':')[0]); c.value = text; c.font = { bold: true, size: 10, color: { argb: TERRA } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } }; };
const labelCell = (ws, addr, text) => { const c = ws.getCell(addr); c.value = text; c.font = { bold: true, color: { argb: 'FF6B5D54' } }; };
function headerRow(ws, rowIdx, labels) {
  const r = ws.getRow(rowIdx);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TERRA } };
    c.alignment = { vertical: 'middle' };
  });
  r.height = 18;
}
function sanitizeTab(name, used) {
  let t = String(name).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Receita';
  const base = t; let n = 2;
  while (used.has(t.toLowerCase())) t = `${base.slice(0, 27)} ${n++}`;
  used.add(t.toLowerCase());
  return t;
}

/** Units list for the dropdowns: base units + every unit actually used in her data (capped, dedup). */
function unitsList(store) {
  const set = new Set(BASE_UNITS);
  for (const i of store.state.ingredients) if (i.stockUnit) set.add(i.stockUnit);
  for (const r of store.state.recipes) { if (r.yieldUnit) set.add(r.yieldUnit); for (const c of r.components || []) if (c.unit) set.add(c.unit); }
  const list = [...set].filter(Boolean).slice(0, 40).join(',');
  return list.length <= 250 ? list : BASE_UNITS.join(','); // Excel inline-list cap
}

/**
 * Build the formatted workbook from the store. Pure given the ExcelJS lib `X` (injectable for tests).
 * @returns {object} an ExcelJS Workbook
 */
export function buildWorkbook(store, X) {
  const ingName = (id) => store.get('ingredients', id)?.name || '(insumo)';
  const recNm = (id) => store.get('recipes', id)?.name || '(receita)';
  const compName = (ref) => (ref.kind === 'ingredient' ? ingName(ref.id) : recNm(ref.id));
  const unitDD = `"${unitsList(store)}"`;
  const unitDropdown = (cell) => { cell.dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [unitDD] }; };

  const wb = new X.Workbook();
  wb.creator = 'paiol';

  const insumos = wb.addWorksheet('Insumos', { views: [{ state: 'frozen', ySplit: 3 }] });
  insumos.columns = [{ width: 34 }, { width: 12 }, { width: 14 }];
  titleCell(insumos, 'A1:C1', 'Insumos — sua lista de compras e preços');
  headerRow(insumos, 3, ['Nome', 'Unidade', 'Preço (R$)']);
  insumos.autoFilter = 'A3:C3';
  store.state.ingredients.forEach((i, k) => {
    const r = insumos.getRow(4 + k);
    r.getCell(1).value = i.name; r.getCell(2).value = i.stockUnit; r.getCell(3).value = store.currentPrice(i.id) ?? null;
    unitDropdown(r.getCell(2)); r.getCell(3).numFmt = MONEY;
  });

  const produtos = wb.addWorksheet('Produtos', { views: [{ state: 'frozen', ySplit: 3 }] });
  produtos.columns = [{ width: 28 }, { width: 24 }, { width: 14 }, { width: 24 }];
  titleCell(produtos, 'A1:D1', 'Produtos — o que você vende');
  headerRow(produtos, 3, ['Nome', 'Receita', 'Embalagem (R$)', 'Descrição']);
  produtos.autoFilter = 'A3:D3';
  store.state.products.forEach((p, k) => {
    const c = (p.components || []).find((x) => x.kind === 'recipe');
    const r = produtos.getRow(4 + k);
    r.getCell(1).value = p.name; r.getCell(2).value = c ? recNm(c.id) : ''; r.getCell(3).value = p.packagingCost || 0; r.getCell(4).value = p.packagingDesc || '';
    r.getCell(3).numFmt = MONEY;
  });

  const used = new Set(['insumos', 'produtos', EXEMPLO.toLowerCase()]);
  const recipeTab = (name, rende, runit, ativos, forno, itens) => {
    const ws = wb.addWorksheet(sanitizeTab(name, used), { views: [{ state: 'frozen', ySplit: 7 }] });
    ws.columns = [{ width: 34 }, { width: 10 }, { width: 12 }];
    titleCell(ws, 'A1:C1', name);
    labelCell(ws, 'A2', 'Rendimento'); ws.getCell('B2').value = rende; ws.getCell('C2').value = runit; unitDropdown(ws.getCell('C2'));
    labelCell(ws, 'A3', 'Min. ativos'); ws.getCell('B3').value = ativos;
    labelCell(ws, 'A4', 'Min. forno'); ws.getCell('B4').value = forno;
    sectionCell(ws, 'A6:C6', 'Ingredientes');
    headerRow(ws, 7, ['Insumo', 'Qtd', 'Unidade']);
    itens.forEach((it, k) => {
      const r = ws.getRow(8 + k);
      r.getCell(1).value = it.name; r.getCell(2).value = it.qty; r.getCell(3).value = it.unit;
      unitDropdown(r.getCell(3));
    });
  };
  for (const r of store.state.recipes) {
    recipeTab(r.name, r.yieldNominal, r.yieldUnit, r.activeMinutes, r.ovenMinutes, (r.components || []).map((c) => ({ name: compName(c.ref), qty: c.qty, unit: c.unit })));
  }
  recipeTab('(duplique esta aba e renomeie)', 12, 'un', 30, 20, [{ name: 'Farinha de trigo', qty: 500, unit: 'g' }, { name: 'Ovo', qty: 3, unit: 'un' }, { name: 'Açúcar', qty: 200, unit: 'g' }]);
  wb.worksheets[wb.worksheets.length - 1].name = EXEMPLO;
  return wb;
}

/** Build the workbook and return its bytes (Uint8Array). `X` defaults to the lazily-loaded global. */
export async function workbookBytes(store, X) {
  const lib = X || (await loadExcelJS());
  const buf = await buildWorkbook(store, lib).xlsx.writeBuffer();
  return new Uint8Array(buf);
}

/** Parse a workbook's bytes back into the name-based interchange `{version,insumos,receitas,produtos}`. */
export async function parseInterchange(bytes, X) {
  const lib = X || (await loadExcelJS());
  const wb = new lib.Workbook();
  await wb.xlsx.load(bytes);
  const data = { version: 1, insumos: [], receitas: [], produtos: [] };
  const recipeSheets = [];
  wb.eachSheet((ws) => {
    const nm = ws.name.trim();
    if (xnorm(nm) === EXEMPLO.toLowerCase() || /^(leia-?me|instru)/i.test(nm)) return;
    if (xnorm(nm) === 'insumos') { for (let r = 4; cv(ws.getCell(r, 1)); r++) data.insumos.push({ nome: cv(ws.getCell(r, 1)), unidade: cv(ws.getCell(r, 2)), preco: cv(ws.getCell(r, 3)) }); return; }
    if (xnorm(nm) === 'produtos') { for (let r = 4; cv(ws.getCell(r, 1)); r++) data.produtos.push({ nome: cv(ws.getCell(r, 1)), receita: cv(ws.getCell(r, 2)) || undefined, porcao: 1, embalagem: cv(ws.getCell(r, 3)), descricaoEmbalagem: cv(ws.getCell(r, 4)) || undefined }); return; }
    recipeSheets.push(ws);
  });
  const recipeNames = new Set(recipeSheets.map((ws) => xnorm(cv(ws.getCell('A1')))));
  for (const ws of recipeSheets) {
    const rec = { nome: cv(ws.getCell('A1')), rende: cv(ws.getCell('B2')), unidade: cv(ws.getCell('C2')) || 'un', minutosAtivos: cv(ws.getCell('B3')), minutosForno: cv(ws.getCell('B4')), itens: [] };
    if (!rec.nome) continue;
    for (let r = 8; cv(ws.getCell(r, 1)); r++) {
      const nm = String(cv(ws.getCell(r, 1))).trim(); const qtd = cv(ws.getCell(r, 2)); const unidade = cv(ws.getCell(r, 3));
      rec.itens.push(recipeNames.has(xnorm(nm)) ? { receita: nm, qtd, unidade } : { insumo: nm, qtd, unidade });
    }
    data.receitas.push(rec);
  }
  return data;
}

/**
 * Dry-run preview of an import — what merging `data` WOULD do, without touching the store. Runs
 * applyExchange on a clone, so it also surfaces warnings and catches a malformed file.
 * @returns {{insumos:{novos:number,att:number,total:number}, receitas:{...}, produtos:{...},
 *   warnings:string[]} | {error:string}}
 */
export function previewExchange(store, data) {
  const before = { ing: store.state.ingredients.length, rec: store.state.recipes.length, prod: store.state.products.length };
  let res; let after;
  try {
    const clone = store.clone();
    res = applyExchange(clone, data);
    after = { ing: clone.state.ingredients.length, rec: clone.state.recipes.length, prod: clone.state.products.length };
  } catch (e) { return { error: String((e && e.message) || e) }; }
  const split = (total, novos) => ({ novos, att: Math.max(0, total - novos), total });
  return {
    insumos: split(res.insumos, after.ing - before.ing),
    receitas: split(res.receitas, after.rec - before.rec),
    produtos: split(res.produtos, after.prod - before.prod),
    warnings: res.warnings || [],
  };
}
