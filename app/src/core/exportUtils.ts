/**
 * Exportacion del arbol visible a JPG, PDF y Word (.docx).
 * No usa librerias externas.
 */

const PAD = 24;
const MAX_SIDE = 16000;
const MAX_AREA = 100_000_000;

export interface TreeImage {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  width: number;
  height: number;
}

function getTreeSvg(): SVGSVGElement {
  const svg = document.querySelector('.tree-visualization svg') as SVGSVGElement | null;
  if (!svg) throw new Error('No se encontro el arbol en pantalla.');
  return svg;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo convertir el arbol a imagen.'));
    img.src = url;
  });
}

export async function captureTreeAsJpeg(): Promise<TreeImage> {
  const svg = getTreeSvg();
  const g = svg.querySelector(':scope > g') as SVGGElement | null;
  if (!g) throw new Error('El arbol esta vacio.');

  const bbox = g.getBBox();
  if (!bbox.width || !bbox.height) throw new Error('El arbol esta vacio.');

  const width = Math.ceil(bbox.width + PAD * 2);
  const height = Math.ceil(bbox.height + PAD * 2);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const cloneG = clone.querySelector(':scope > g') as SVGGElement;
  cloneG.setAttribute('transform', `translate(${PAD - bbox.x},${PAD - bbox.y})`);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.removeAttribute('style');

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const scale = Math.min(2, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_AREA / (width * height)));
    const pixelWidth = Math.max(1, Math.floor(width * scale));
    const pixelHeight = Math.max(1, Math.floor(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite crear la imagen.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('El arbol es demasiado grande para exportarlo.');
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    return { jpeg, pixelWidth, pixelHeight, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportFileName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `arbol-taxonomico-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

export function buildPdf(img: TreeImage): Uint8Array {
  const k = Math.min(1, 14400 / Math.max(img.width, img.height));
  const pageW = +(img.width * k).toFixed(2);
  const pageH = +(img.height * k).toFixed(2);
  const content = enc.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (v: Uint8Array | string) => {
    const bytes = typeof v === 'string' ? enc.encode(v) : v;
    chunks.push(bytes); pos += bytes.length;
  };
  const obj = (n: number, body: Uint8Array | string, tail = '') => {
    offsets[n] = pos; push(`${n} 0 obj\n`); push(body); push(`${tail}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, concat([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${img.pixelWidth} /Height ${img.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`), img.jpeg]), '\nendstream');
  obj(5, concat([enc.encode(`<< /Length ${content.length} >>\nstream\n`), content]), '\nendstream');

  const xrefPos = pos;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return concat(chunks);
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    const local = concat([new Uint8Array(lh.buffer), name, f.data]);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    centrals.push(concat([new Uint8Array(ch.buffer), name]));
    locals.push(local); offset += local.length;
  }
  const cd = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(end.buffer)]);
}

const EMU_PER_PX = 9525;
const TWIPS_PER_PX = 15;

export function buildDocx(img: TreeImage, title = 'Estructura Taxonomica de Activos'): Uint8Array {
  const A4_W = 16838, A4_H = 11906, MARGIN = 720, MAX_PAGE = 31680;
  const wantW = img.width * TWIPS_PER_PX + MARGIN * 2;
  const wantH = img.height * TWIPS_PER_PX + MARGIN * 2 + 900;
  const pageW = Math.min(MAX_PAGE, Math.max(A4_W, wantW));
  const pageH = Math.min(MAX_PAGE, Math.max(A4_H, wantH));
  const usableW = pageW - MARGIN * 2;
  const usableH = pageH - MARGIN * 2 - 900;
  const fit = Math.min(1, usableW / (img.width * TWIPS_PER_PX), usableH / (img.height * TWIPS_PER_PX));
  const cx = Math.round(img.width * EMU_PER_PX * fit);
  const cy = Math.round(img.height * EMU_PER_PX * fit);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${esc(title)}</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Arbol"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="arbol.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}" w:orient="landscape"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/arbol.jpg"/></Relationships>`;
  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'word/document.xml', data: enc.encode(documentXml) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'word/media/arbol.jpg', data: img.jpeg },
  ]);
}

export async function exportTreeAsJpg() {
  const img = await captureTreeAsJpeg();
  downloadBytes(img.jpeg, exportFileName('jpg'), 'image/jpeg');
}
export async function exportTreeAsPdf() {
  const img = await captureTreeAsJpeg();
  downloadBytes(buildPdf(img), exportFileName('pdf'), 'application/pdf');
}
export async function exportTreeAsDocx() {
  const img = await captureTreeAsJpeg();
  downloadBytes(buildDocx(img), exportFileName('docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
