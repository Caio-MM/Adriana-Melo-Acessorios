/**
 * =============================================================================
 *  GERADOR DE XLSX — sem dependências externas
 * =============================================================================
 *  Um arquivo .xlsx é só um ZIP contendo alguns XMLs (formato OpenXML/
 *  SpreadsheetML). O Node já traz o `zlib` (deflate) e o `Buffer`, então dá
 *  para montar o ZIP na mão — evitando puxar uma lib de ~90 pacotes só para
 *  um botão de exportação, em linha com a escolha de `node:sqlite` no db.js.
 *
 *  API:
 *    buildXlsx([
 *      { name: "Usuários", columns: [{ header: "ID", key: "id", width: 8 }, ...],
 *        rows: [{ id: 1, ... }, ...] }
 *    ]) -> Buffer  (conteúdo do .xlsx)
 *
 *  Valores numéricos entram como número; qualquer outra coisa vira texto
 *  (inlineStr) — inclusive datas, que a camada de cima já formata como string
 *  legível ("2026-08-21 14:30"), evitando a complexidade de datas seriais.
 * =============================================================================
 */
const zlib = require("zlib");

/* ---------------------------------------------------------------- CRC32 ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------ XML helpers -- */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Remove caracteres de controle inválidos em XML 1.0 (exceto tab/nl/cr).
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

// Converte índice de coluna (0-based) em letra de coluna do Excel (A, B, ... AA).
function colLetter(index) {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(ref, value) {
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}"/>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.columns || [];
  const colsXml = cols.length
    ? `<cols>${cols
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 18}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const headerCells = cols
    .map((c, i) => cellXml(`${colLetter(i)}1`, c.header))
    .join("");
  const headerRow = `<row r="1">${headerCells}</row>`;

  const bodyRows = (sheet.rows || [])
    .map((row, r) => {
      const rowNum = r + 2; // linha 1 é o cabeçalho
      const cells = cols
        .map((c, i) => cellXml(`${colLetter(i)}${rowNum}`, row[c.key]))
        .join("");
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${headerRow}${bodyRows}</sheetData></worksheet>`;
}

/* -------------------------------------------------------------- ZIP store -- */
function zipEntry(name, contentBuf) {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(contentBuf);
  const compressed = zlib.deflateRawSync(contentBuf);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // assinatura do local file header
  local.writeUInt16LE(20, 4);           // versão necessária
  local.writeUInt16LE(0x0800, 6);       // flag: nomes em UTF-8
  local.writeUInt16LE(8, 8);            // método: deflate
  local.writeUInt16LE(0, 10);           // hora (fixa)
  local.writeUInt16LE(0x21, 12);        // data (fixa: 1980-01-01)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(contentBuf.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);           // extra field length

  return {
    name: nameBuf,
    crc,
    compressed,
    uncompressedSize: contentBuf.length,
    localHeader: Buffer.concat([local, nameBuf]),
  };
}

function buildZip(files) {
  const entries = files.map(f => zipEntry(f.name, f.content));
  const chunks = [];
  let offset = 0;
  const central = [];

  for (const e of entries) {
    chunks.push(e.localHeader, e.compressed);
    const localSize = e.localHeader.length + e.compressed.length;

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);    // central directory header
    cd.writeUInt16LE(20, 4);            // versão que criou
    cd.writeUInt16LE(20, 6);            // versão necessária
    cd.writeUInt16LE(0x0800, 8);        // flag UTF-8
    cd.writeUInt16LE(8, 10);            // deflate
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.compressed.length, 20);
    cd.writeUInt32LE(e.uncompressedSize, 24);
    cd.writeUInt16LE(e.name.length, 28);
    cd.writeUInt16LE(0, 30);           // extra
    cd.writeUInt16LE(0, 32);           // comentário
    cd.writeUInt16LE(0, 34);           // disco
    cd.writeUInt16LE(0, 36);           // atributos internos
    cd.writeUInt32LE(0, 38);           // atributos externos
    cd.writeUInt32LE(offset, 42);      // offset do local header
    central.push(Buffer.concat([cd, e.name]));

    offset += localSize;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);   // end of central directory
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);      // offset do início do central directory
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/* ----------------------------------------------------------- workbook XML -- */
function buildXlsx(sheets) {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error("buildXlsx requer ao menos uma planilha.");
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("")}</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${escapeXml(sanitizeSheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("")}</Relationships>`;

  const files = [
    { name: "[Content_Types].xml", content: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", content: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", content: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(workbookRels, "utf8") },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: Buffer.from(sheetXml(s), "utf8"),
    })),
  ];

  return buildZip(files);
}

// O Excel proíbe alguns caracteres e limita o nome da aba a 31 chars.
function sanitizeSheetName(name, index) {
  const cleaned = String(name || `Planilha${index + 1}`).replace(/[\\/?*[\]:]/g, " ").trim();
  return cleaned.slice(0, 31) || `Planilha${index + 1}`;
}

module.exports = { buildXlsx };
