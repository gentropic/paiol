// paiol — PDF generation (Rev 04). Vendored pdf-lib (UMD) is loaded LAZILY from a sidecar the first
// time a PDF is generated, so the heavyweight (~525 KB) never bloats startup; the SW precaches it
// for offline. pdf-lib's standard Helvetica uses WinAnsi → PT-BR accents (ç ã õ é …) render fine,
// but emoji do NOT — keep PDF text plain. We do NOT import pdf-lib (it sets a global), so paiol's
// strip-and-concat build never touches it.

let _pdfLib = null;

/** Lazy-load the vendored pdf-lib UMD; resolves the global PDFLib. Same relative path works dev + prod. */
export function loadPdfLib() {
  if (globalThis.PDFLib) return Promise.resolve(globalThis.PDFLib);
  if (_pdfLib) return _pdfLib;
  _pdfLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/pdf-lib/pdf-lib.min.js';
    s.onload = () => (globalThis.PDFLib ? resolve(globalThis.PDFLib) : reject(new Error('pdf-lib não inicializou')));
    s.onerror = () => { _pdfLib = null; reject(new Error('não foi possível carregar o gerador de PDF')); };
    document.head.append(s);
  });
  return _pdfLib;
}

const A4 = [595.28, 841.89];           // pt, portrait
const M = 36;                          // margin
const SLOT_H = (A4[1] - 2 * M) / 3;    // 3 fichas per page
const money = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Build a PDF of client fichas, 3 per A4 page (print-cut-file). Each ficha: business header, client
 * data, their orders (data · resumo · total · pago/deve), and the saldo devedor.
 * @param {Array<{client:{name?:string,phone?:string,address?:string}|null, orders:Array<{date:string,resumo:string,total:number,saldo:number}>, saldoTotal:number}>} fichas
 * @returns {Promise<Uint8Array>}
 */
export async function generateFichasPdf(fichas) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const terr = rgb(0.604, 0.290, 0.184);
  const soft = rgb(0.42, 0.36, 0.33);
  const fg = rgb(0.165, 0.129, 0.11);
  const bad = rgb(0.70, 0.15, 0.12);
  const right = A4[0] - M;

  let page = null;
  fichas.forEach((f, i) => {
    if (i % 3 === 0) page = doc.addPage(A4);
    const top = A4[1] - M - (i % 3) * SLOT_H;
    const bottom = top - SLOT_H;

    page.drawLine({ start: { x: M, y: top }, end: { x: right, y: top }, thickness: 2, color: terr });
    let y = top - 16;
    page.drawText('Quitutes do Paiol', { x: M, y: y - 2, size: 11, font: bold, color: terr });
    page.drawText('Ficha do cliente', { x: right - 96, y: y - 2, size: 9, font, color: soft });
    y -= 19;
    page.drawText(trunc((f.client && f.client.name) || 'Sem cliente', 40), { x: M, y, size: 13, font: bold, color: fg });
    y -= 14;
    const contato = [f.client && f.client.phone, f.client && f.client.address].filter(Boolean).join('   ·   ');
    if (contato) { page.drawText(trunc(contato, 70), { x: M, y, size: 9, font, color: soft }); y -= 15; } else { y -= 3; }

    for (const o of f.orders.slice(0, 4)) {
      page.drawText(trunc(`${o.date}   ${o.resumo}`, 58), { x: M, y, size: 9, font, color: fg });
      page.drawText(money(o.total), { x: right - 150, y, size: 9, font, color: fg });
      const pend = o.saldo > 0.005;
      page.drawText(pend ? `deve ${money(o.saldo)}` : 'pago', { x: right - 80, y, size: 9, font, color: pend ? bad : soft });
      y -= 13;
    }
    if (f.orders.length > 4) { page.drawText(`+ ${f.orders.length - 4} pedido(s)…`, { x: M, y, size: 8, font, color: soft }); }

    page.drawText('Saldo devedor:', { x: M, y: bottom + 24, size: 10, font: bold, color: fg });
    page.drawText(money(f.saldoTotal), { x: M + 92, y: bottom + 24, size: 11, font: bold, color: f.saldoTotal > 0.005 ? bad : fg });

    page.drawLine({ start: { x: M, y: bottom + 8 }, end: { x: right, y: bottom + 8 }, thickness: 0.5, color: soft, dashArray: [3, 3] });
  });

  return doc.save();
}

/**
 * Build a single-page recibo (payment proof). Explicitly NOT a nota fiscal — a recibo has no rigid
 * legal format; this attests "recebemos de X a quantia de R$Y". Framed card with the empresa header
 * (logo + nome + CNPJ/endereço/telefone), the recebemos sentence, optional item table, totals
 * (pago/saldo/forma), optional observações, and a signature line (responsável) + disclaimer.
 * @param {{numero?:string, date:string, clientName:string, clientContato?:string,
 *   items?:Array<{name:string,qty:number,unitPrice:number,total:number}>, referente:string,
 *   total:number, pago:number, saldo:number, forma?:string, observacoes?:string,
 *   empresa?:{nome?:string,cnpj?:string,endereco?:string,telefone?:string,responsavel?:string,logo?:string}}} r
 * @returns {Promise<Uint8Array>}
 */
export async function generateReciboPdf(r) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const terr = rgb(0.604, 0.290, 0.184);
  const soft = rgb(0.42, 0.36, 0.33);
  const fg = rgb(0.165, 0.129, 0.11);
  const line = rgb(0.86, 0.80, 0.74);
  const page = doc.addPage(A4);
  const right = A4[0] - M;
  const padL = M + 22, padR = right - 22;
  const textW = (t, s, f = font) => f.widthOfTextAtSize(t, s);
  const rightText = (t, x, y, s, f = font, color = fg) => page.drawText(t, { x: x - textW(t, s, f), y, size: s, font: f, color });

  // Content is drawn first (tracking y); the framing rectangle is drawn LAST, sized to the content,
  // so a short recibo doesn't leave a big empty box.
  const emp = r.empresa || {};
  const cardTop = A4[1] - M;
  let y = cardTop - 10;

  // Logo (optional) — top-left, aspect-preserved. Bad/unsupported image just skips.
  if (emp.logo) {
    try {
      const img = /^data:image\/jpe?g/i.test(emp.logo) ? await doc.embedJpg(emp.logo) : await doc.embedPng(emp.logo);
      const w = Math.min(130, img.width); const h = img.height * (w / img.width);
      page.drawImage(img, { x: padL, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch { /* unreadable logo → skip */ }
  }

  // Empresa name (left) + RECIBO (right); then CNPJ/endereço/telefone; then data + número; rule.
  const nome = emp.nome || 'Quitutes do Paiol';
  page.drawText(trunc(nome, 46), { x: padL, y: y - 13, size: 14, font: bold, color: terr });
  rightText('RECIBO', padR, y - 11, 13, bold, soft);
  y -= 28;
  for (const ln of [emp.cnpj && `CNPJ ${emp.cnpj}`, emp.endereco, emp.telefone].filter(Boolean)) {
    page.drawText(trunc(ln, 84), { x: padL, y, size: 8.5, font, color: soft }); y -= 11;
  }
  page.drawText(`Data: ${r.date}`, { x: padL, y: y - 2, size: 9, font, color: soft });
  if (r.numero) rightText(r.numero, padR, y - 2, 9, font, soft);
  y -= 11;
  page.drawLine({ start: { x: padL, y }, end: { x: padR, y }, thickness: 2, color: terr });
  y -= 22;

  // The recebemos sentence.
  page.drawText('Recebemos de', { x: padL, y, size: 11, font, color: fg });
  page.drawText(trunc(r.clientName || 'cliente', 46), { x: padL + textW('Recebemos de ', 11), y, size: 11, font: bold, color: fg });
  y -= 18;
  page.drawText('a quantia de', { x: padL, y, size: 11, font, color: fg });
  page.drawText(money(r.pago), { x: padL + textW('a quantia de ', 11), y, size: 12, font: bold, color: terr });
  y -= 18;
  page.drawText(trunc(`referente a ${r.referente}.`, 80), { x: padL, y, size: 11, font, color: fg });
  y -= 26;

  // Optional item table.
  if (r.items && r.items.length) {
    page.drawText('ITENS', { x: padL, y, size: 8, font: bold, color: soft });
    y -= 4;
    page.drawLine({ start: { x: padL, y }, end: { x: padR, y }, thickness: 0.5, color: line });
    y -= 14;
    for (const it of r.items.slice(0, 8)) {
      page.drawText(trunc(`${it.qty}×  ${it.name}`, 52), { x: padL, y, size: 9.5, font, color: fg });
      rightText(money(it.total), padR, y, 9.5, font, fg);
      y -= 14;
    }
    if (r.items.length > 8) { page.drawText(`+ ${r.items.length - 8} item(ns)…`, { x: padL, y, size: 8, font, color: soft }); y -= 14; }
    y -= 4;
  }

  // Totals block.
  page.drawLine({ start: { x: padL, y: y + 4 }, end: { x: padR, y: y + 4 }, thickness: 0.5, color: line });
  y -= 12;
  const kv = (label, val, b = false, color = fg) => { page.drawText(label, { x: padR - 200, y, size: 10, font: b ? bold : font, color }); rightText(val, padR, y, 10, b ? bold : font, color); y -= 16; };
  if (r.total && Math.abs(r.total - r.pago) > 0.005) kv('Total do pedido', money(r.total));
  kv('Valor pago' + (r.forma ? ` (${r.forma})` : ''), money(r.pago), true);
  if (r.saldo > 0.005) kv('Saldo restante', money(r.saldo), false, rgb(0.70, 0.15, 0.12));
  else kv('Situação', 'QUITADO', true, rgb(0.18, 0.45, 0.20));

  // Optional observações.
  if (r.observacoes) {
    y -= 2;
    page.drawText(trunc(`Obs.: ${r.observacoes}`, 92), { x: padL, y, size: 9, font, color: soft });
    y -= 14;
  }

  // Frame the card around the content just drawn (border only — page is already white).
  const cardBottom = y - 4;
  page.drawRectangle({ x: M, y: cardBottom, width: right - M, height: cardTop - cardBottom, borderColor: line, borderWidth: 1 });

  // Signature line + responsável + disclaimer (below the card).
  const sy = cardBottom - 48;
  page.drawLine({ start: { x: padL, y: sy }, end: { x: padL + 220, y: sy }, thickness: 0.7, color: soft });
  page.drawText(trunc(emp.responsavel || nome, 50), { x: padL, y: sy - 12, size: 9, font, color: soft });
  page.drawText('Comprovante de pagamento — não substitui nota fiscal.', { x: M, y: cardBottom - 84, size: 8, font, color: soft });

  return doc.save();
}

/**
 * Branded A4 budget or non-fiscal receipt created manually from Financeiro. Unlike the compact
 * order receipt above, this document supports an arbitrary item list and multiple pages.
 * @param {{type:'orcamento'|'recibo',numero?:string,date:string,validUntil?:string,
 *   clientName:string,clientPhone?:string,clientAddress?:string,
 *   items:Array<{name:string,qty:number,unitPrice:number,total:number}>,total:number,
 *   paid?:number,balance?:number,paymentCondition?:string,notes?:string,
 *   empresa?:{nome?:string,cnpj?:string,endereco?:string,telefone?:string,responsavel?:string,logo?:string}}} spec
 * @returns {Promise<Uint8Array>}
 */
export async function generateCommercialDocumentPdf(spec) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.23, 0.32, 0.44); const teal = rgb(0.08, 0.45, 0.51);
  const terr = rgb(0.604, 0.290, 0.184); const soft = rgb(0.37, 0.39, 0.39);
  const line = rgb(0.85, 0.82, 0.78); const good = rgb(0.18, 0.45, 0.20); const bad = rgb(0.70, 0.15, 0.12);
  const right = A4[0] - M; const emp = spec.empresa || {};
  const isBudget = spec.type === 'orcamento'; const title = isBudget ? 'ORÇAMENTO' : 'RECIBO NÃO FISCAL';
  const ptDate = (value) => { const [yy, mm, dd] = String(value || '').slice(0, 10).split('-'); return yy && mm && dd ? `${dd}/${mm}/${yy}` : String(value || ''); };
  const width = (text, size, face = font) => face.widthOfTextAtSize(String(text), size);
  let page; let y; let pageNo = 0; let logo = null;
  if (emp.logo) {
    try { logo = /^data:image\/jpe?g/i.test(emp.logo) ? await doc.embedJpg(emp.logo) : await doc.embedPng(emp.logo); }
    catch { logo = null; }
  }
  const rightText = (text, valueY, size = 9, face = font, color = navy) => page.drawText(String(text), { x: right - width(text, size, face), y: valueY, size, font: face, color });
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 17, width: right - M, height: 22, color: rgb(0.95, 0.97, 0.96) });
    page.drawText('ITEM', { x: M + 7, y: y - 10, size: 8, font: bold, color: navy });
    page.drawText('QTD.', { x: 355, y: y - 10, size: 8, font: bold, color: navy });
    page.drawText('VALOR UNIT.', { x: 405, y: y - 10, size: 8, font: bold, color: navy });
    rightText('TOTAL', y - 10, 8, bold, navy); y -= 29;
  };
  const newPage = (continuation = false, includeTable = true) => {
    page = doc.addPage(A4); pageNo += 1; y = A4[1] - M;
    const logoScale = logo ? Math.min(72 / logo.width, 48 / logo.height, 1) : 0;
    const logoW = logo ? logo.width * logoScale : 0; const logoH = logo ? logo.height * logoScale : 0;
    if (logo) page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH });
    const companyX = logo ? M + logoW + 12 : M;
    page.drawText(trunc(emp.nome || 'Quitutes do Paiol', 36), { x: companyX, y: y - 13, size: 14, font: bold, color: terr });
    rightText(continuation ? `${title} — CONTINUAÇÃO` : title, y - 12, continuation ? 9 : 13, bold, teal);
    let infoY = y - 28;
    for (const info of [emp.cnpj && `CNPJ ${emp.cnpj}`, emp.telefone && `Telefone ${emp.telefone}`, emp.endereco].filter(Boolean).slice(0, 3)) {
      page.drawText(trunc(info, 58), { x: companyX, y: infoY, size: 8, font, color: soft }); infoY -= 10;
    }
    y -= 63;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 2, color: teal }); y -= 18;
    if (!continuation) {
      page.drawText(`Data: ${ptDate(spec.date)}`, { x: M, y, size: 9, font, color: soft });
      if (spec.numero) rightText(spec.numero, y, 9, font, soft); y -= 20;
      page.drawText('CLIENTE', { x: M, y, size: 8, font: bold, color: soft }); y -= 16;
      page.drawText(trunc(spec.clientName || 'Cliente não identificado', 65), { x: M, y, size: 12, font: bold, color: navy }); y -= 14;
      const contact = [spec.clientPhone, spec.clientAddress].filter(Boolean).join(' · ');
      if (contact) { page.drawText(trunc(contact, 88), { x: M, y, size: 8.5, font, color: soft }); y -= 15; }
      y -= 5;
    }
    if (includeTable) tableHeader();
  };
  const ensure = (height, includeTable = true) => { if (!page || y - height < M + 55) newPage(true, includeTable); };
  newPage(false);
  for (const item of spec.items || []) {
    ensure(24);
    page.drawText(trunc(item.name || 'Item', 48), { x: M + 7, y, size: 9.5, font, color: navy });
    page.drawText(String(Number(item.qty) || 0).replace('.', ','), { x: 358, y, size: 9, font, color: navy });
    page.drawText(money(item.unitPrice), { x: 405, y, size: 9, font, color: navy });
    rightText(money(item.total), y, 9.5, bold, navy);
    y -= 18;
    page.drawLine({ start: { x: M, y: y + 5 }, end: { x: right, y: y + 5 }, thickness: 0.35, color: line });
  }
  ensure(150, false);
  y -= 8;
  page.drawLine({ start: { x: M, y: y + 5 }, end: { x: right, y: y + 5 }, thickness: 1, color: teal }); y -= 13;
  const summary = (label, value, options = {}) => {
    page.drawText(label, { x: right - 215, y, size: options.bold ? 11 : 9.5, font: options.bold ? bold : font, color: options.color || navy });
    rightText(value, y, options.bold ? 11 : 9.5, options.bold ? bold : font, options.color || navy); y -= options.bold ? 19 : 16;
  };
  summary('Total', money(spec.total), { bold: true });
  if (isBudget) {
    if (spec.validUntil) summary('Validade', `até ${ptDate(spec.validUntil)}`);
  } else {
    summary('Valor pago', money(spec.paid), { bold: true, color: good });
    if ((Number(spec.balance) || 0) > 0.005) summary('Valor a pagar', money(spec.balance), { color: bad });
    else summary('Situação', 'QUITADO', { bold: true, color: good });
  }
  y -= 5;
  if (spec.paymentCondition) {
    page.drawText('CONDIÇÃO DE PAGAMENTO', { x: M, y, size: 8, font: bold, color: soft }); y -= 14;
    page.drawText(trunc(spec.paymentCondition, 92), { x: M, y, size: 9.5, font, color: navy }); y -= 20;
  }
  if (spec.notes) {
    page.drawText('OBSERVAÇÕES', { x: M, y, size: 8, font: bold, color: soft }); y -= 14;
    page.drawText(trunc(spec.notes, 94), { x: M, y, size: 9, font, color: soft }); y -= 20;
  }
  if (!isBudget) {
    y -= 20;
    page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.7, color: soft });
    page.drawText(trunc(emp.responsavel || emp.nome || 'Responsável', 50), { x: M, y: y - 13, size: 8.5, font, color: soft });
  }
  const disclaimer = isBudget ? 'Orçamento comercial — não substitui nota fiscal.' : 'Comprovante de pagamento não fiscal — não substitui nota fiscal.';
  for (let index = 0; index < doc.getPageCount(); index += 1) {
    const current = doc.getPage(index);
    current.drawText(disclaimer, { x: M, y: 21, size: 7.5, font, color: soft });
    current.drawText(`Página ${index + 1} de ${doc.getPageCount()}`, { x: right - 72, y: 21, size: 7.5, font, color: soft });
  }
  return doc.save();
}

/**
 * A4 daily comanda grouped by client. Multiple orders from the same client/date are already merged
 * by the caller, preventing duplicate production slips.
 * @param {{date:string, groups:Array<{clientName:string,contact?:string,items:Array<{name:string,qty:number}>,notes?:string}>, production:Array<{name:string,prevista:number,produzido:number}>}} spec
 */
export async function generateComandaPdf(spec) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.23, 0.32, 0.44);
  const teal = rgb(0.08, 0.45, 0.51);
  const soft = rgb(0.37, 0.39, 0.39);
  const line = rgb(0.85, 0.86, 0.84);
  let page; let y;

  const newPage = () => {
    page = doc.addPage(A4); y = A4[1] - M;
    page.drawText('Quitutes do Paiol', { x: M, y: y - 12, size: 16, font: bold, color: navy });
    page.drawText(`COMANDA DO DIA  ${spec.date}`, { x: M, y: y - 34, size: 10, font: bold, color: teal });
    page.drawLine({ start: { x: M, y: y - 43 }, end: { x: A4[0] - M, y: y - 43 }, thickness: 2, color: teal });
    y -= 62;
  };
  const ensure = (need) => { if (!page || y - need < M) newPage(); };
  newPage();

  page.drawText('RESUMO DE PRODUCAO', { x: M, y, size: 9, font: bold, color: navy }); y -= 17;
  for (const item of spec.production || []) {
    ensure(16);
    page.drawText(trunc(item.name, 54), { x: M, y, size: 9.5, font, color: soft });
    page.drawText(`previsto ${item.prevista}   produzido ${item.produzido}`, { x: A4[0] - 205, y, size: 9, font, color: navy });
    y -= 14;
  }
  y -= 12;

  for (const group of spec.groups || []) {
    ensure(58 + Math.min(8, group.items.length) * 14);
    page.drawRectangle({ x: M, y: y - 24, width: A4[0] - 2 * M, height: 29, color: rgb(0.95, 0.97, 0.96) });
    page.drawText(trunc(group.clientName || 'Sem cliente', 48), { x: M + 9, y: y - 13, size: 12, font: bold, color: navy });
    if (group.contact) page.drawText(trunc(group.contact, 42), { x: A4[0] - 245, y: y - 12, size: 8.5, font, color: soft });
    y -= 38;
    for (const item of group.items || []) {
      ensure(15);
      page.drawText(`${item.qty} x`, { x: M + 10, y, size: 10, font: bold, color: teal });
      page.drawText(trunc(item.name, 62), { x: M + 45, y, size: 10, font, color: navy });
      y -= 15;
    }
    if (group.notes) { ensure(16); page.drawText(trunc(`Obs.: ${group.notes}`, 86), { x: M + 10, y, size: 8.5, font, color: soft }); y -= 15; }
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: line });
    y -= 18;
  }

  if (!(spec.groups || []).length) page.drawText('Nenhuma encomenda ativa nesta data.', { x: M, y, size: 11, font, color: soft });
  return doc.save();
}

/**
 * Detailed A4 client statement, with every purchase item and payment in the selected period.
 * The current all-time balance is shown separately so a period filter never hides prior debt.
 * @param {{client:{name?:string,phone?:string,address?:string}|null,start?:string,end?:string,
 *   movements:Array<object>,periodPurchases:number,periodPayments:number,periodBalance:number,
 *   totalCharged:number,totalPaid:number,currentBalance:number}} statement
 */
export async function generateClientStatementPdf(statement) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.23, 0.32, 0.44);
  const teal = rgb(0.08, 0.45, 0.51);
  const soft = rgb(0.37, 0.39, 0.39);
  const line = rgb(0.85, 0.82, 0.78);
  const good = rgb(0.18, 0.45, 0.20);
  const bad = rgb(0.70, 0.15, 0.12);
  const right = A4[0] - M;
  const textWidth = (text, size, face = font) => face.widthOfTextAtSize(text, size);
  const rightText = (page, text, x, y, size, face = font, color = navy) => page.drawText(text, { x: x - textWidth(text, size, face), y, size, font: face, color });
  const ptDate = (value) => { const [y, m, d] = String(value || '').slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : ''; };
  const period = statement.start || statement.end
    ? `${statement.start ? ptDate(statement.start) : 'início'} até ${statement.end ? ptDate(statement.end) : 'hoje'}`
    : 'Histórico geral';
  let page; let y; let pageNo = 0;

  const newPage = () => {
    page = doc.addPage(A4); pageNo += 1; y = A4[1] - M;
    page.drawText('Quitutes do Paiol', { x: M, y: y - 12, size: 15, font: bold, color: navy });
    rightText(page, 'FICHA FINANCEIRA DO CLIENTE', right, y - 11, 10, bold, teal);
    y -= 29;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 2, color: teal });
    y -= 23;
    page.drawText(trunc(statement.client?.name || 'Cliente não identificado', 55), { x: M, y, size: 13, font: bold, color: navy });
    y -= 14;
    const contact = [statement.client?.phone, statement.client?.address].filter(Boolean).join(' - ');
    if (contact) { page.drawText(trunc(contact, 88), { x: M, y, size: 8.5, font, color: soft }); y -= 13; }
    page.drawText(`Período: ${period}`, { x: M, y, size: 8.5, font, color: soft });
    y -= 21;
  };
  const ensure = (height) => { if (!page || y - height < M + 24) newPage(); };
  newPage();

  const summary = [
    ['Compras no filtro', statement.periodPurchases, navy],
    ['Pagamentos no filtro', statement.periodPayments, good],
    ['Saldo do filtro', statement.periodBalance, statement.periodBalance > 0.005 ? bad : navy],
    ['Saldo atual geral', statement.currentBalance, statement.currentBalance > 0.005 ? bad : good],
  ];
  const boxW = (right - M - 12) / 2; const boxH = 42;
  summary.forEach(([label, value, color], index) => {
    const col = index % 2; const row = Math.floor(index / 2); const x = M + col * (boxW + 12); const top = y - row * (boxH + 8);
    page.drawRectangle({ x, y: top - boxH, width: boxW, height: boxH, borderColor: line, borderWidth: 0.8 });
    page.drawText(label, { x: x + 9, y: top - 14, size: 8, font, color: soft });
    page.drawText(money(value), { x: x + 9, y: top - 31, size: 11, font: bold, color });
  });
  y -= 2 * (boxH + 8) + 9;
  page.drawText('MOVIMENTAÇÕES', { x: M, y, size: 8.5, font: bold, color: navy }); y -= 13;

  for (const movement of statement.movements || []) {
    if (movement.type === 'payment') {
      ensure(38);
      page.drawLine({ start: { x: M, y: y + 5 }, end: { x: right, y: y + 5 }, thickness: 0.5, color: line });
      page.drawText(`${ptDate(movement.at)}  PAGAMENTO`, { x: M, y: y - 8, size: 9, font: bold, color: good });
      rightText(page, money(movement.amount), right, y - 8, 10, bold, good);
      y -= 21;
      page.drawText(trunc(`${movement.description}${movement.method ? ` - ${movement.method}` : ''}`, 82), { x: M + 12, y, size: 8.5, font, color: soft });
      y -= 17;
      continue;
    }

    ensure(55);
    page.drawLine({ start: { x: M, y: y + 5 }, end: { x: right, y: y + 5 }, thickness: 0.5, color: line });
    const kind = movement.type === 'purchase' ? 'COMPRA / ENCOMENDA' : 'LANÇAMENTO A RECEBER';
    page.drawText(`${ptDate(movement.at)}  ${kind}`, { x: M, y: y - 8, size: 9, font: bold, color: navy });
    rightText(page, money(movement.amount), right, y - 8, 10, bold, navy);
    y -= 22;
    if (movement.type === 'purchase') {
      for (const item of movement.items || []) {
        ensure(16);
        const label = `${item.qty} x ${item.name}  (${money(item.unitPrice)} cada)`;
        page.drawText(trunc(label, 72), { x: M + 12, y, size: 8.5, font, color: navy });
        rightText(page, money(item.total), right, y, 8.5, font, navy);
        y -= 14;
      }
      if (movement.freight > 0) {
        ensure(16);
        page.drawText('Frete', { x: M + 12, y, size: 8.5, font, color: soft });
        rightText(page, money(movement.freight), right, y, 8.5, font, navy);
        y -= 14;
      }
      if (movement.deliveryMethod || movement.notes) {
        ensure(16);
        const detail = [`Entrega: ${movement.deliveryMethod === 'motoboy' ? 'Motoboy' : 'Retirada'}`, movement.notes && `Obs.: ${movement.notes}`].filter(Boolean).join(' - ');
        page.drawText(trunc(detail, 84), { x: M + 12, y, size: 8, font, color: soft });
        y -= 14;
      }
    } else {
      page.drawText(trunc(movement.description || 'Valor a receber', 82), { x: M + 12, y, size: 8.5, font, color: soft });
      y -= 14;
    }
    ensure(17);
    const status = movement.balance > 0.005
      ? `Recebido ${money(movement.paid)}  -  Em aberto ${money(movement.balance)}`
      : `Recebido ${money(movement.paid)}  -  QUITADO`;
    page.drawText(status, { x: M + 12, y, size: 8.5, font: bold, color: movement.balance > 0.005 ? bad : good });
    y -= 19;
  }

  if (!(statement.movements || []).length) page.drawText('Nenhuma compra ou pagamento no período selecionado.', { x: M, y, size: 10, font, color: soft });
  for (let index = 0; index < doc.getPageCount(); index += 1) {
    const current = doc.getPage(index);
    current.drawText(`Página ${index + 1} de ${doc.getPageCount()}`, { x: right - 72, y: 20, size: 7.5, font, color: soft });
  }
  return doc.save();
}

/** A4 managerial income statement (DRE) by competence, including automatic diagnoses. */
export async function generateDrePdf(dre) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.23, 0.32, 0.44); const teal = rgb(0.08, 0.45, 0.51);
  const soft = rgb(0.37, 0.39, 0.39); const line = rgb(0.85, 0.82, 0.78);
  const good = rgb(0.18, 0.45, 0.20); const bad = rgb(0.70, 0.15, 0.12);
  const right = A4[0] - M; let page; let y;
  const ptDate = (value) => { const [yy, mm, dd] = String(value || '').slice(0, 10).split('-'); return yy && mm && dd ? `${dd}/${mm}/${yy}` : ''; };
  const width = (text, size, face = font) => face.widthOfTextAtSize(text, size);
  const rightText = (text, valueY, size = 9, face = font, color = navy) => page.drawText(text, { x: right - width(text, size, face), y: valueY, size, font: face, color });
  const newPage = () => {
    page = doc.addPage(A4); y = A4[1] - M;
    page.drawText('Quitutes do Paiol', { x: M, y: y - 12, size: 15, font: bold, color: navy });
    rightText('DRE GERENCIAL', y - 11, 11, bold, teal); y -= 29;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 2, color: teal }); y -= 18;
    page.drawText(`Período de competência: ${ptDate(dre.start)} até ${ptDate(dre.end)}`, { x: M, y, size: 9, font, color: soft }); y -= 13;
    page.drawText('Valores pagos e pendentes entram integralmente; caixa e lucro são análises diferentes.', { x: M, y, size: 8, font, color: soft }); y -= 22;
  };
  const ensure = (height) => { if (!page || y - height < M + 22) newPage(); };
  const row = (label, amount, options = {}) => {
    ensure(18); const face = options.bold ? bold : font; const color = options.bad ? bad : options.good ? good : navy;
    if (options.rule) { page.drawLine({ start: { x: M, y: y + 5 }, end: { x: right, y: y + 5 }, thickness: options.bold ? 1 : 0.5, color: line }); }
    page.drawText(trunc(label, options.indent ? 68 : 72), { x: M + (options.indent ? 14 : 0), y: y - 7, size: options.bold ? 10 : 8.7, font: face, color });
    rightText(money(amount), y - 7, options.bold ? 10 : 8.7, face, color); y -= options.bold ? 21 : 17;
  };
  newPage();
  page.drawText('DEMONSTRAÇÃO DO RESULTADO', { x: M, y, size: 9, font: bold, color: navy }); y -= 13;
  row('Receita de vendas', dre.salesRevenue);
  row('Outras receitas operacionais', dre.otherRevenue);
  row('RECEITA OPERACIONAL', dre.grossRevenue, { bold: true, rule: true });
  for (const detail of dre.costRows || []) row(`(-) ${detail.name}`, -detail.amount, { indent: true });
  row('(-) CUSTOS DIRETOS', -dre.directCosts, { bold: true, rule: true });
  row('LUCRO BRUTO', dre.grossProfit, { bold: true, rule: true, bad: dre.grossProfit < 0, good: dre.grossProfit >= 0 });
  for (const detail of dre.expenseRows || []) row(`(-) ${detail.name}`, -detail.amount, { indent: true });
  row('(-) DESPESAS OPERACIONAIS', -dre.operatingExpenses, { bold: true, rule: true });
  row('RESULTADO DO PERÍODO', dre.netResult, { bold: true, rule: true, bad: dre.netResult < 0, good: dre.netResult >= 0 });
  ensure(48);
  page.drawText(`Margem bruta: ${dre.grossMarginPct == null ? 'sem receita' : `${Math.round(dre.grossMarginPct * 100)}%`}`, { x: M, y: y - 3, size: 9, font: bold, color: navy });
  page.drawText(`Margem líquida: ${dre.netMarginPct == null ? 'sem receita' : `${Math.round(dre.netMarginPct * 100)}%`}`, { x: M + 190, y: y - 3, size: 9, font: bold, color: dre.netResult < 0 ? bad : good }); y -= 24;
  page.drawText('DIAGNÓSTICO', { x: M, y, size: 9, font: bold, color: navy }); y -= 15;
  for (const diagnosis of dre.diagnostics || []) {
    ensure(35); const color = diagnosis.tone === 'bad' ? bad : diagnosis.tone === 'ok' ? good : navy;
    page.drawText(trunc(`- ${diagnosis.title}`, 78), { x: M, y, size: 9, font: bold, color }); y -= 12;
    page.drawText(trunc(diagnosis.text, 92), { x: M + 10, y, size: 8, font, color: soft }); y -= 19;
  }
  for (let index = 0; index < doc.getPageCount(); index += 1) doc.getPage(index).drawText(`Página ${index + 1} de ${doc.getPageCount()}`, { x: right - 72, y: 20, size: 7.5, font, color: soft });
  return doc.save();
}

/** Save/share a generated PDF: native share on iOS where available, else a download. */
export async function savePdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch { /* share cancelled/unsupported → fall through to download */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
