/* pdf-writer.js — Phase 4.B, step 6: writes a PDF from the page model that goc-core's resultsPdfModel() builds.
   No dependencies and no browser: plain PDF 1.4 with the two standard fonts (Helvetica and Helvetica-Bold), one content
   stream per page, and a real cross-reference table. Text is sent in WinAnsi; anything outside Latin-1 (and the
   0x80-0x9F block) becomes "?". node: const { pdfFromModel } = require('./pdf-writer'); returns a Buffer. */
'use strict';

function esc(text) {
  var s = String(text == null ? '' : text), out = '', i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c < 32 || c === 127 || (c > 126 && c < 160) || c > 255) c = 63;   /* "?" */
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else out += String.fromCharCode(c);
  }
  return out;
}
function num(n) { var v = Number(n); return (isFinite(v) ? Math.round(v * 100) / 100 : 0).toString(); }

function pageStream(model, page) {
  var H = model.page.h, ops = [];
  page.items.forEach(function (it) {
    if (it.kind === 'rect') {
      ops.push('0.94 g ' + num(it.x) + ' ' + num(H - it.y - it.h) + ' ' + num(it.w) + ' ' + num(it.h) + ' re f 0 g');
    } else if (it.kind === 'rule') {
      ops.push('0.5 w 0.4 G ' + num(it.x1) + ' ' + num(H - it.y1) + ' m ' + num(it.x2) + ' ' + num(H - it.y2) + ' l S 0 G');
    } else if (it.kind === 'text') {
      ops.push('BT /' + (it.bold ? 'F2' : 'F1') + ' ' + num(it.size) + ' Tf ' + num(it.x) + ' ' + num(H - it.y) + ' Td (' + esc(it.text) + ') Tj ET');
    }
  });
  return ops.join('\n');
}

function pdfFromModel(model) {
  var pages = (model && model.pages) || [];
  if (!pages.length) throw new Error('A PDF needs at least one page.');
  var W = model.page.w, H = model.page.h;
  var objs = [];                       /* objs[n] = body of object n+1 (a string, latin1) */
  var pageObjNums = pages.map(function (_, i) { return 5 + i * 2; });
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = '<< /Type /Pages /Kids [' + pageObjNums.map(function (n) { return n + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>';
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach(function (pg, i) {
    var stream = pageStream(model, pg);
    objs[4 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(W) + ' ' + num(H) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>';
    objs[5 + i * 2] = '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream';
  });
  var infoNum = objs.length + 1;
  var d = String(model.generatedOn || '').replace(/-/g, '');
  objs.push('<< /Title (' + esc(model.title || 'GOC Academy - Results') + ') /Producer (GOC Academy Hub)' + (/^\d{8}$/.test(d) ? ' /CreationDate (D:' + d + ')' : '') + ' >>');

  var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offsets = [];
  objs.forEach(function (body, i) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  var xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + infoNum + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

module.exports = { pdfFromModel: pdfFromModel };
