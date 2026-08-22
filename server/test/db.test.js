/**
 * Testes da camada de dados (lib/db.js) num banco ISOLADO em tmp — nunca toca
 * o data.db real. Cobre contas, cupom (incl. o TOCTOU dos pendentes) e a
 * exclusão de conta com anonimização (LGPD). Roda com: node --test
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const bcrypt = require("bcryptjs");

// Precisa vir ANTES de require("../lib/db.js"): o db.js lê DB_PATH no load.
const TMP_DB = path.join(os.tmpdir(), `plc-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
const db = require("../lib/db.js");

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch {}
  }
});

test("createUser / getUserByEmail", () => {
  const u = db.createUser({ name: "Ana", email: "ana@example.com", passwordHash: "x", cep: "70040020" });
  assert.ok(u.id > 0);
  assert.equal(db.getUserByEmail("ana@example.com").id, u.id);
  assert.equal(db.getUserByEmail("naoexiste@example.com"), null);
});

test("hasUsedCoupon — pago bloqueia; cupom diferente não", () => {
  const u = db.createUser({ name: "B", email: "b@example.com", passwordHash: "x", cep: "70040020" });
  const base = {
    userId: u.id, items: [{ id: 1, qty: 1, price: 34.9 }],
    address: { nome: "B", telefone: "(61) 90000-0000", rua: "R", numero: "1", bairro: "B", cidade: "Bsb", uf: "DF", cep: "70040020" },
    shipping: { name: "X", price: 10 }, subtotal: 34.9, shippingPrice: 10, total: 44.9, customerPhone: "61900000000",
  };
  assert.equal(db.hasUsedCoupon({ code: "BEMVINDA10", userId: u.id }), false);
  db.createOrder({ ...base, externalReference: "PAGO1", status: "pago", couponCode: "BEMVINDA10" });
  assert.equal(db.hasUsedCoupon({ code: "BEMVINDA10", userId: u.id }), true);
  assert.equal(db.hasUsedCoupon({ code: "OUTRO", userId: u.id }), false);
});

test("hasUsedCoupon — pedido PENDENTE recente bloqueia (fecha o TOCTOU)", () => {
  const u = db.createUser({ name: "C", email: "c@example.com", passwordHash: "x", cep: "70040020" });
  db.createOrder({
    externalReference: "PEND1", userId: u.id, status: "pendente", couponCode: "BEMVINDA10",
    items: [{ id: 1, qty: 1, price: 34.9 }],
    address: { nome: "C", telefone: "x", rua: "R", numero: "1", bairro: "B", cidade: "Bsb", uf: "DF", cep: "70040020" },
    shipping: { name: "X", price: 10 }, subtotal: 34.9, shippingPrice: 10, total: 44.9, customerPhone: "61911112222",
  });
  assert.equal(db.hasUsedCoupon({ code: "BEMVINDA10", userId: u.id }), true, "por userId");
  assert.equal(db.hasUsedCoupon({ code: "BEMVINDA10", phone: "61911112222" }), true, "por telefone");
});

test("deleteUserAccount — apaga o titular e anonimiza os pedidos (LGPD)", () => {
  const u = db.createUser({ name: "Del", email: "del@example.com", passwordHash: bcrypt.hashSync("x", 4), cep: "70040020" });
  db.addNewsletterSubscriber("del@example.com");
  db.createOrder({
    externalReference: "DEL1", userId: u.id, status: "pago",
    items: [{ id: 1, qty: 1, price: 34.9 }],
    address: { nome: "Del Fulano", telefone: "(61) 91111-2222", rua: "Rua X", numero: "9", bairro: "B", cidade: "Bsb", uf: "DF", cep: "70040020" },
    shipping: { name: "S", price: 10 }, subtotal: 34.9, shippingPrice: 10, total: 44.9, customerPhone: "61911112222",
  });

  assert.equal(db.deleteUserAccount(u.id), true);

  // Usuário e newsletter apagados.
  assert.equal(db.getUserById(u.id), null);
  assert.equal(db.listNewsletterSubscribers().some(s => s.email === "del@example.com"), false);

  // Pedido RETIDO, mas anonimizado; financeiro preservado.
  const order = db.getOrderByExternalReference("DEL1");
  assert.ok(order, "pedido deve continuar existindo (retenção fiscal)");
  assert.equal(order.customer_phone, null);
  assert.equal(order.user_id, null);
  assert.match(order.address_json, /anonimizado/);
  assert.equal(order.total, 44.9, "valor preservado");
  assert.ok(order.created_at, "data preservada");

  // Excluir de novo (usuário já não existe) retorna false, sem quebrar.
  assert.equal(db.deleteUserAccount(u.id), false);
});
