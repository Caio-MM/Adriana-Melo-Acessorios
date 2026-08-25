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
  const u = db.createUser({ name: "Ana", email: "ana@example.com", passwordHash: "x", cpf: "11144477735" });
  assert.ok(u.id > 0);
  assert.equal(db.getUserByEmail("ana@example.com").id, u.id);
  assert.equal(db.getUserByEmail("naoexiste@example.com"), null);
});

test("hasUsedCoupon — pago bloqueia; cupom diferente não", () => {
  const u = db.createUser({ name: "B", email: "b@example.com", passwordHash: "x", cpf: "11144477735" });
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
  const u = db.createUser({ name: "C", email: "c@example.com", passwordHash: "x", cpf: "11144477735" });
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
  const u = db.createUser({ name: "Del", email: "del@example.com", passwordHash: bcrypt.hashSync("x", 4), cpf: "11144477735" });
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

test("getSavedAddress / saveAddress — endereço padrão por conta, isolado entre clientes", () => {
  const a = db.createUser({ name: "End A", email: "enda@example.com", passwordHash: "x", cpf: "11144477735" });
  const b = db.createUser({ name: "End B", email: "endb@example.com", passwordHash: "x", cpf: "11144477735" });

  assert.equal(db.getSavedAddress(a.id), null, "sem endereço salvo, começa nulo");

  const endereco = { nome: "End A", telefone: "61911112222", rua: "Rua A", numero: "1", bairro: "B", cidade: "Bsb", uf: "DF", cep: "70040020" };
  db.saveAddress(a.id, endereco);
  assert.deepEqual(db.getSavedAddress(a.id), endereco);

  // Salvar de novo (segunda compra, endereço mudou) sobrescreve o anterior.
  const novoEndereco = { ...endereco, rua: "Rua Nova", numero: "2" };
  db.saveAddress(a.id, novoEndereco);
  assert.deepEqual(db.getSavedAddress(a.id), novoEndereco);

  // Endereço de uma cliente nunca aparece para outra.
  assert.equal(db.getSavedAddress(b.id), null);
});

test("upsertProductOverride — available_colors: [] explícito nunca vira NULL (diferente de badges)", () => {
  // Produto nunca customizado: sem linha em product_overrides.
  // Salvar só o nome não deve mexer em available_colors (chave ausente
  // em fields preserva o que já estava — aqui, nada/NULL).
  const semCor = db.upsertProductOverride(90001, { name: "Produto Teste Cor" });
  assert.equal(semCor.available_colors, null, "chave ausente preserva NULL");

  // Define um subconjunto de cores em estoque.
  const comDuasCores = db.upsertProductOverride(90001, { availableColors: ["#F4B4CC", "#DD6E9B"] });
  assert.deepEqual(JSON.parse(comDuasCores.available_colors), ["#F4B4CC", "#DD6E9B"]);

  // Esgotado em TODAS as cores: array vazio, tem que ser gravado como "[]",
  // nunca colapsado para NULL (NULL significaria "todas as cores", o
  // oposto do que a lojista quis dizer).
  const esgotado = db.upsertProductOverride(90001, { availableColors: [] });
  assert.equal(esgotado.available_colors, "[]", "array vazio grava como [], não NULL");
  assert.deepEqual(JSON.parse(esgotado.available_colors), []);

  // Salvar outro campo (ex.: preço) sem tocar em availableColors preserva
  // o [] esgotado — não pode reverter silenciosamente para "todas as cores".
  const depoisDeOutraEdicao = db.upsertProductOverride(90001, { price: 39.9 });
  assert.equal(depoisDeOutraEdicao.available_colors, "[]", "edição de outro campo preserva o esgotado");
});

test("upsertProductOverride — photos: [] explícito nunca vira NULL, e a ORDEM é preservada (não é um Set)", () => {
  const semFoto = db.upsertProductOverride(90002, { name: "Produto Teste Foto" });
  assert.equal(semFoto.photos, null, "chave ausente preserva NULL — cai para a foto única antiga (photo_url) na leitura");

  // Ordem é o próprio dado: a 1ª da lista é a capa.
  const comFotos = db.upsertProductOverride(90002, { photos: ["/img/products/b.jpg", "/img/products/a.jpg"] });
  assert.deepEqual(JSON.parse(comFotos.photos), ["/img/products/b.jpg", "/img/products/a.jpg"]);

  // Removeu todas as fotos: array vazio grava como "[]", nunca colapsa para
  // NULL (que significaria "nunca editado" -> cairia de volta pra foto
  // única antiga em vez de "sem foto nenhuma").
  const semFotoDeNovo = db.upsertProductOverride(90002, { photos: [] });
  assert.equal(semFotoDeNovo.photos, "[]", "array vazio grava como [], não NULL");

  // Editar outro campo sem tocar em photos preserva a lista salva.
  const depoisDeOutraEdicao = db.upsertProductOverride(90002, { price: 39.9 });
  assert.equal(depoisDeOutraEdicao.photos, "[]", "edição de outro campo preserva o estado sem foto");
});

test("listCustomColors / insertCustomColor — round-trip de uma cor criada pelo painel", () => {
  assert.deepEqual(db.listCustomColors().map(c => c.hex), []);
  const created = db.insertCustomColor({ hex: "#7A2E4F", label: "Vinho" });
  assert.deepEqual(created, { hex: "#7A2E4F", label: "Vinho" });
  const listed = db.listCustomColors();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].hex, "#7A2E4F");
  assert.equal(listed[0].label, "Vinho");

  db.deleteCustomColor("#7A2E4F");
  assert.deepEqual(db.listCustomColors().map(c => c.hex), []);

  // Apagar um hex que não existe não quebra (mesmo racional de deleteCustomProduct).
  db.deleteCustomColor("#000000");
});

test("upsertProductOverride — allow_second_color: NULL e 0 são a mesma coisa (desligado), sem distinção especial", () => {
  const semTocar = db.upsertProductOverride(90003, { name: "Kit Teste" });
  assert.ok(!semTocar.allow_second_color, "chave ausente fica \"desligado\" (NULL ou 0 — os dois são equivalentes aqui)");

  const ligado = db.upsertProductOverride(90003, { allowSecondColor: true });
  assert.equal(ligado.allow_second_color, 1);

  const desligadoDeNovo = db.upsertProductOverride(90003, { allowSecondColor: false });
  assert.equal(desligadoDeNovo.allow_second_color, 0);

  // Editar outro campo sem tocar em allowSecondColor preserva o estado ligado.
  db.upsertProductOverride(90003, { allowSecondColor: true });
  const depoisDeOutraEdicao = db.upsertProductOverride(90003, { price: 55 });
  assert.equal(depoisDeOutraEdicao.allow_second_color, 1, "edição de outro campo preserva o estado ligado");
});

test("upsertProductOverride — description: mesmo padrão de name (ausente preserva, vazio limpa pro padrão)", () => {
  const semTocar = db.upsertProductOverride(90004, { name: "Produto Teste Descrição" });
  assert.equal(semTocar.description, null, "chave ausente preserva NULL — front-end cai pra descrição padrão");

  const comDescricao = db.upsertProductOverride(90004, { description: "Laço todo feito à mão, em cetim importado." });
  assert.equal(comDescricao.description, "Laço todo feito à mão, em cetim importado.");

  // Editar outro campo sem tocar em description preserva a descrição salva.
  const depoisDeOutraEdicao = db.upsertProductOverride(90004, { price: 42 });
  assert.equal(depoisDeOutraEdicao.description, "Laço todo feito à mão, em cetim importado.", "edição de outro campo preserva a descrição");

  // String vazia limpa de volta pro padrão (NULL) — diferente de
  // available_colors/photos, não existe "descrição vazia de propósito".
  const limpa = db.upsertProductOverride(90004, { description: "" });
  assert.equal(limpa.description, null, "descrição vazia volta pro padrão (NULL)");
});
