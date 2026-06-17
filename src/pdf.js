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
