/**
 * Testes unitários de lib/notaFiscal.js — só as partes que não dependem de
 * rede (a API da Focus NFe em si só existe quando a lojista tiver conta lá).
 * Cobre exatamente as duas guardas que travam a emissão antes de qualquer
 * chamada de rede: NCM ausente e configuração incompleta.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const notaFiscal = require("../lib/notaFiscal.js");

const ENDERECO = {
  nome: "Cliente Teste", cpf: "11144477735", telefone: "61982749808",
  rua: "Rua X", numero: "1", bairro: "B", cidade: "Brasília", uf: "DF", cep: "70040020",
};

test("montarPayload recusa item sem NCM, com o nome do produto na mensagem", () => {
  assert.throws(
    () => notaFiscal.montarPayload({
      referencia: "TESTE1",
      items: [{ id: 1, qty: 1, price: 34.9, name: "Laço Bailarina", ncm: null }],
      address: ENDERECO,
      subtotal: 34.9, shippingPrice: 10, discountTotal: 0, total: 44.9,
    }),
    /Laço Bailarina.*NCM/,
  );
});

test("montarPayload monta o payload quando todo item tem NCM", () => {
  const payload = notaFiscal.montarPayload({
    referencia: "TESTE2",
    items: [{ id: 1, qty: 2, price: 34.9, name: "Laço Bailarina", ncm: "58063000" }],
    address: ENDERECO,
    subtotal: 69.8, shippingPrice: 10, discountTotal: 5, total: 74.8,
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].codigo_ncm, "58063000");
  assert.equal(payload.valor_total, "74.8");
  assert.equal(payload.valor_desconto, "5");
  assert.equal(payload.uf_destinatario, "DF");
});

test("cfopPara usa o CFOP de dentro do estado quando destino bate com SELLER_STATE, senão o de fora", () => {
  const original = process.env.SELLER_STATE;
  process.env.SELLER_STATE = "DF";
  try {
    assert.equal(notaFiscal.cfopPara("DF"), "5101");
    assert.equal(notaFiscal.cfopPara("SP"), "6101");
  } finally {
    if (original === undefined) delete process.env.SELLER_STATE;
    else process.env.SELLER_STATE = original;
  }
});

test("configuracaoCompleta é false sem FOCUS_NFE_TOKEN (estado deste ambiente de teste)", () => {
  assert.equal(notaFiscal.configuracaoCompleta(), false);
});
