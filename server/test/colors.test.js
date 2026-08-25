/**
 * Testes da paleta de cores de laço (js/colors.js) — fonte única de
 * verdade usada tanto no checkout quanto na vitrine/Quick View/admin.
 * Roda com: node --test
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const colors = require("../js/colors.js");

test("RIBBON_COLORS tem 6 hex únicos, os mesmos já usados no catálogo", () => {
  assert.equal(colors.RIBBON_COLORS.length, 6);
  const hexes = colors.RIBBON_COLORS.map(c => c.hex);
  assert.equal(new Set(hexes).size, 6, "sem hex repetido");
  assert.deepEqual(hexes, ["#F4B4CC", "#DD6E9B", "#FBEAF0", "#F8ECF1", "#EA8FB4", "#C05480"]);
  assert.deepEqual(colors.ALL_COLOR_HEXES, hexes);
});

test("isValidColor aceita só as 6 cores da paleta", () => {
  for (const hex of colors.ALL_COLOR_HEXES) {
    assert.equal(colors.isValidColor(hex), true, hex);
  }
  assert.equal(colors.isValidColor("#FFFFFF"), false, "hex válido mas fora da paleta");
  assert.equal(colors.isValidColor("red"), false);
  assert.equal(colors.isValidColor(""), false);
  assert.equal(colors.isValidColor(null), false);
  assert.equal(colors.isValidColor(undefined), false);
});

test("labelForColor devolve o rótulo certo e cai num texto genérico pra hex desconhecido", () => {
  assert.equal(colors.labelForColor("#F4B4CC"), "Rosa bebê");
  assert.equal(colors.labelForColor("#C05480"), "Rosa profundo");
  assert.equal(colors.labelForColor("#000000"), "cor padrão do catálogo");
  assert.equal(colors.labelForColor(null), "cor padrão do catálogo");
});
