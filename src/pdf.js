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
