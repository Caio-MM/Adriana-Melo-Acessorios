/**
 * Testes de lib/orderFormatting.js — em especial colorLabelForItem, o ponto
 * único que resolve o rótulo de cor de um item de pedido: cor real
 * escolhida (novo) ou rótulo fixo por produto (pedidos antigos, de antes
 * dessa escolha existir). Roda com: node --test
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { colorLabelForItem } = require("../lib/orderFormatting");

test("colorLabelForItem prefere a cor real do item", () => {
  assert.equal(colorLabelForItem({ id: 1, color: "#DD6E9B" }), "Rosa pink");
  assert.equal(colorLabelForItem({ id: 6, color: "#F4B4CC" }), "Rosa bebê");
});

test("colorLabelForItem cai no rótulo fixo por produto quando não há cor salva (pedido antigo)", () => {
  assert.equal(colorLabelForItem({ id: 1, color: null }), "Rosa bebê");
  assert.equal(colorLabelForItem({ id: 6 }), "Mix de rosas");
});

test("colorLabelForItem não quebra com produto desconhecido ou item ausente", () => {
  assert.equal(colorLabelForItem({ id: 9999 }), "cor padrão do catálogo");
  assert.equal(colorLabelForItem(null), "cor padrão do catálogo");
});

test("colorLabelForItem resolve o rótulo de uma cor criada pelo painel via allColors", () => {
  const allColors = [{ hex: "#DD6E9B", label: "Rosa pink" }, { hex: "#7A2E4F", label: "Vinho" }];
  assert.equal(colorLabelForItem({ id: 1, color: "#7A2E4F" }, allColors), "Vinho");
  // Sem allColors (ou cor que não está mais na paleta), cai no estático de sempre.
  assert.equal(colorLabelForItem({ id: 1, color: "#7A2E4F" }), "cor padrão do catálogo");
});

test("colorLabelForItem combina as 2 cores de um produto vendido em conjunto", () => {
  const allColors = [{ hex: "#F4B4CC", label: "Rosa bebê" }, { hex: "#DD6E9B", label: "Rosa pink" }];
  assert.equal(
    colorLabelForItem({ id: 6, color: "#F4B4CC", secondColor: "#DD6E9B" }, allColors),
    "Rosa bebê + Rosa pink"
  );
  // Sem 2ª cor, continua devolvendo só a principal.
  assert.equal(colorLabelForItem({ id: 6, color: "#F4B4CC" }, allColors), "Rosa bebê");
});
