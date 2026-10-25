import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateClientStatementPdf, generateReciboPdf, generateCommercialDocumentPdf } from '../src/pdf.js';

test('client PDFs accept invisible direction marks and unsupported copied characters', async () => {
  const source = await readFile(new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url), 'utf8');
  const pdfLib = {};
  Function('exports', 'module', source)(pdfLib, { exports: pdfLib });
  globalThis.PDFLib = pdfLib;
  const name = '\u202aNatália 🧁';
  const item = { name: '\u202aBolo de chocolate 🧁', qty: 1, unitPrice: 100, total: 100 };
  const statement = {
    client: { name }, start: '2026-10-01', end: '2026-10-31',
    periodPurchases: 100, periodPayments: 90, currentBalance: 0, creditBalance: 0,
    movements: [{ type: 'purchase', at: '2026-10-25', description: 'Encomenda', amount: 100, paid: 90, discounted: 10, balance: 0, items: [item] }],
  };
  const receipt = { date: '25/10/2026', clientName: name, referente: 'Encomenda', items: [item], total: 100, pago: 90, saldo: 0, forma: 'Pix\u202a 🧁' };
  const commercial = { type: 'recibo', date: '2026-10-25', clientName: name, items: [item], total: 100, paid: 90, balance: 0 };
  for (const bytes of [
    await generateClientStatementPdf(statement),
    await generateReciboPdf(receipt),
    await generateCommercialDocumentPdf(commercial),
  ]) {
    assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
    const document = await pdfLib.PDFDocument.load(bytes);
    assert.ok(document.getPageCount() >= 1);
  }
});
