/**
 * Testes do gerador de .xlsx sem dependências (lib/xlsx.js): estrutura ZIP
 * válida e neutralização de injeção de fórmula (CWE-1236). Roda com: node --test
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildXlsx, neutralizeFormula } = require("../lib/xlsx.js");

test("buildXlsx gera um ZIP válido (assinaturas PK)", () => {
  const buf = buildXlsx([
    { name: "Teste", columns: [{ header: "A", key: "a" }, { header: "N", key: "n" }], rows: [{ a: "oi", n: 42 }] },
  ]);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 4).toString("hex"), "504b0304", "local file header PK\\x03\\x04");
  // End Of Central Directory (PK\x05\x06) presente ao final.
  assert.ok(buf.includes(Buffer.from("504b0506", "hex")), "EOCD presente");
  assert.ok(buf.length > 200);
});

test("buildXlsx exige ao menos uma planilha", () => {
  assert.throws(() => buildXlsx([]), /ao menos uma planilha/);
});

test("neutralizeFormula prefixa apóstrofo em fórmulas perigosas", () => {
  assert.equal(neutralizeFormula("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(neutralizeFormula("+55"), "'+55");
  assert.equal(neutralizeFormula("-2+3"), "'-2+3");
  assert.equal(neutralizeFormula("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(neutralizeFormula("\tTAB"), "'\tTAB");
});

test("neutralizeFormula deixa dados legítimos intactos", () => {
  assert.equal(neutralizeFormula("(61) 99999-8888"), "(61) 99999-8888");
  assert.equal(neutralizeFormula("Laço Duquesa"), "Laço Duquesa");
  assert.equal(neutralizeFormula("ana@example.com"), "ana@example.com");
});
