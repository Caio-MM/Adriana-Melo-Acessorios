/**
 * Testes de integração HTTP: sobe o server.js num processo à parte, com porta
 * e banco ISOLADOS (nunca o data.db/porta reais), e exercita os fluxos
 * críticos — cadastro, login, controle de acesso (auth + admin), CSRF e
 * exclusão de conta. Roda com: node --test
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const PORT = 39557;
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "admin@test.com";
const ADMIN_HASH = crypto.createHash("sha256").update(ADMIN_EMAIL).digest("hex");
const TMP_DB = path.join(os.tmpdir(), `plc-api-test-${process.pid}-${Date.now()}.db`);

// Aponta pro MESMO arquivo (WAL) que o processo filho do server.js abaixo —
// usado só para inserir pedidos "pago"/"pendente" diretamente (sem depender
// de credencial real do Mercado Pago/Melhor Envio) nos testes de
// "continuar pagamento". Precisa vir ANTES do require, igual db.test.js.
process.env.DB_PATH = TMP_DB;
const db = require("../lib/db.js");

let child;
// Cookie de admin reaproveitado entre testes (setado no primeiro login bem-
// sucedido, abaixo). authLimiter (server.js) capa em 10 requisições por IP
// a cada 15min nas rotas de auth — os testes já rodam bem perto desse teto
// só com os registros/logins que precisam de contas DIFERENTES; um login
// extra por teste que só precisa "ser admin" estoura o limite à toa.
let sharedAdminCookie = null;
// Mesma ideia de sharedAdminCookie: reaproveitado no lugar de registrar/
// logar uma conta de cliente nova a cada teste que só precisa "ser uma
// cliente logada" (setado no teste de estoque por cor, abaixo).
let sharedClienteCookie = null;

function cleanupDb() {
  for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + s); } catch {} }
}

before(async () => {
  child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      DB_PATH: TMP_DB, PORT: String(PORT), CLIENT_ORIGIN: ORIGIN,
      ADMIN_2FA_REQUIRED: "false", ADMIN_EMAIL_HASHES: ADMIN_HASH,
      MP_ACCESS_TOKEN: "TEST-fake", NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  // Espera o servidor responder (até ~10s).
  const deadline = Date.now() + 10000;
  for (;;) {
    try { if ((await fetch(ORIGIN + "/")).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error("servidor de teste não subiu");
    await new Promise(r => setTimeout(r, 200));
  }
});

after(() => {
  if (child) child.kill();
  cleanupDb();
});

// Helpers ---------------------------------------------------------------
function post(url, body, cookie) {
  return fetch(ORIGIN + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function put(url, body, cookie) {
  return fetch(ORIGIN + url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function patch(url, body, cookie) {
  return fetch(ORIGIN + url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function cookieFrom(res) {
  const raw = res.headers.get("set-cookie");
  return raw ? raw.split(";")[0] : null;
}

// Testes ----------------------------------------------------------------
test("cadastro define sessão e /api/auth/me responde ao dono", async () => {
  const res = await post("/api/auth/register", { name: "Cliente A", email: "a@test.com", password: "SenhaA12345!", cpf: "11144477735" });
  assert.equal(res.status, 201);
  const cookie = cookieFrom(res);
  assert.ok(cookie, "deve vir cookie de sessão");
  const me = await fetch(ORIGIN + "/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).email, "a@test.com");
});

test("login com senha errada é rejeitado", async () => {
  const res = await post("/api/auth/login", { email: "a@test.com", password: "errada" });
  assert.equal(res.status, 401);
});

test("rotas protegidas exigem sessão (401 sem cookie)", async () => {
  assert.equal((await fetch(ORIGIN + "/api/orders")).status, 401);
  assert.equal((await fetch(ORIGIN + "/api/admin/orders")).status, 401);
});

test("CSRF: POST sem Origin correto é bloqueado", async () => {
  const res = await fetch(ORIGIN + "/api/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://site-malicioso.com" },
    body: JSON.stringify({ email: "x@test.com" }),
  });
  assert.equal(res.status, 403);
});

test("controle de acesso admin: cliente comum não entra, admin entra", async () => {
  // Cliente comum
  const rc = await post("/api/auth/register", { name: "Comum", email: "comum@test.com", password: "SenhaC12345!", cpf: "11144477735" });
  const comumCookie = cookieFrom(rc);
  const asComum = await fetch(ORIGIN + "/api/admin/orders", { headers: { Cookie: comumCookie } });
  assert.equal(asComum.status, 403, "cliente comum -> 403");

  // Admin (e-mail com hash em ADMIN_EMAIL_HASHES; 2FA desligado no teste)
  const ra = await post("/api/auth/register", { name: "Admin", email: ADMIN_EMAIL, password: "SenhaADM12345!", cpf: "11144477735" });
  const adminCookie = cookieFrom(ra);
  assert.equal((await ra.json()).isAdmin, true);
  const asAdmin = await fetch(ORIGIN + "/api/admin/orders", { headers: { Cookie: adminCookie } });
  assert.equal(asAdmin.status, 200, "admin -> 200");
});

test("exclusão de conta: senha errada barra; senha certa apaga e invalida login", async () => {
  const reg = await post("/api/auth/register", { name: "Del", email: "del@test.com", password: "SenhaDEL12345!", cpf: "11144477735" });
  const cookie = cookieFrom(reg);

  // Senha errada -> 401, conta permanece.
  const bad = await fetch(ORIGIN + "/api/auth/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ password: "errada" }),
  });
  assert.equal(bad.status, 401);

  // Senha certa -> 200.
  const ok = await fetch(ORIGIN + "/api/auth/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ password: "SenhaDEL12345!" }),
  });
  assert.equal(ok.status, 200);

  // Conta some: login falha.
  assert.equal((await post("/api/auth/login", { email: "del@test.com", password: "SenhaDEL12345!" })).status, 401);
});

test("GET/PUT /api/auth/address — sem sessão, endereço em branco, salva/atualiza, isolado entre clientes", async () => {
  assert.equal((await fetch(ORIGIN + "/api/auth/address")).status, 401);

  const regA = await post("/api/auth/register", { name: "End A", email: "enda@test.com", password: "SenhaA12345!", cpf: "11144477735" });
  const cookieA = cookieFrom(regA);

  // Primeira compra: nada salvo ainda.
  const initial = await fetch(ORIGIN + "/api/auth/address", { headers: { Cookie: cookieA } });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).address, null);

  const endereco = { nome: "End A", telefone: "(61) 91111-2222", rua: "Rua das Flores", numero: "10", bairro: "Centro", cidade: "Brasília", uf: "DF", cep: "70040-020" };

  // Endereço incompleto -> 400, nada é salvo.
  const incompleto = await put("/api/auth/address", { address: { ...endereco, numero: "" } }, cookieA);
  assert.equal(incompleto.status, 400);

  // Endereço completo -> 200, e volta pré-preenchido igual ao que foi salvo.
  const saved = await put("/api/auth/address", { address: endereco }, cookieA);
  assert.equal(saved.status, 200);
  const fetched = await (await fetch(ORIGIN + "/api/auth/address", { headers: { Cookie: cookieA } })).json();
  assert.equal(fetched.address.rua, "Rua das Flores");
  assert.equal(fetched.address.cep, "70040020", "cep salvo só com dígitos");

  // Segunda compra, endereço mudou -> PUT sobrescreve o anterior.
  const atualizado = await put("/api/auth/address", { address: { ...endereco, rua: "Rua Nova", numero: "20" } }, cookieA);
  assert.equal(atualizado.status, 200);
  const refetched = await (await fetch(ORIGIN + "/api/auth/address", { headers: { Cookie: cookieA } })).json();
  assert.equal(refetched.address.rua, "Rua Nova");

  // Endereço de A nunca aparece para B, mesmo autenticado.
  const regB = await post("/api/auth/register", { name: "End B", email: "endb@test.com", password: "SenhaB12345!", cpf: "11144477735" });
  const cookieB = cookieFrom(regB);
  const asB = await (await fetch(ORIGIN + "/api/auth/address", { headers: { Cookie: cookieB } })).json();
  assert.equal(asB.address, null, "endereço de outra conta não vaza");
});

test("estoque por cor: PATCH admin reflete no catálogo e é aplicado no checkout (incl. a corrida)", async () => {
  const endereco = {
    nome: "Cliente Cor", telefone: "61982749808", rua: "Rua das Flores",
    numero: "100", bairro: "Centro", cidade: "Brasília", uf: "DF",
  };
  const checkoutBody = (color) => ({
    items: [{ id: 1, qty: 1, color }],
    cep: "70040020",
    shipping_service_id: "1",
    address: endereco,
    paymentMethod: "card",
  });

  // Reaproveita a conta admin já criada no teste de controle de acesso
  // (mesmo ADMIN_EMAIL/senha; registrar de novo daria 409, sem cookie).
  const ra = await post("/api/auth/login", { email: ADMIN_EMAIL, password: "SenhaADM12345!" });
  const adminCookie = cookieFrom(ra);
  assert.ok(adminCookie, "login admin precisa devolver cookie de sessão");
  sharedAdminCookie = adminCookie;
  const patched = await patch("/api/admin/products/1", { availableColors: ["#F4B4CC"] }, adminCookie);
  assert.equal(patched.status, 200);
  assert.deepEqual((await patched.json()).availableColors, ["#F4B4CC"]);

  // O catálogo público e o do admin refletem a restrição.
  const pub = await (await fetch(ORIGIN + "/api/products")).json();
  assert.deepEqual(pub.products.find(p => p.id === 1).availableColors, ["#F4B4CC"]);
  const adminList = await (await fetch(ORIGIN + "/api/admin/products", { headers: { Cookie: adminCookie } })).json();
  assert.deepEqual(adminList.products.find(p => p.id === 1).availableColors, ["#F4B4CC"]);

  // Cliente comum faz login para testar o checkout.
  const rc = await post("/api/auth/register", { name: "Cliente Cor", email: "clientecor@test.com", password: "SenhaC12345!", cpf: "11144477735" });
  const clienteCookie = cookieFrom(rc);
  sharedClienteCookie = clienteCookie;

  // Cor fora da paleta inteira -> 400.
  const forsDaPaleta = await post("/api/create-preference", checkoutBody("#000000"), clienteCookie);
  assert.equal(forsDaPaleta.status, 400);

  // Cor válida da paleta, mas fora do estoque ATUAL do produto -> 409,
  // nomeando produto e cor (não é um 400 genérico).
  const foraDeEstoque = await post("/api/create-preference", checkoutBody("#DD6E9B"), clienteCookie);
  assert.equal(foraDeEstoque.status, 409);
  const foraDeEstoqueMsg = (await foraDeEstoque.json()).error;
  assert.match(foraDeEstoqueMsg, /Rosa pink/);
  assert.match(foraDeEstoqueMsg, /Bailarina/);

  // Cor que AINDA está em estoque passa da validação de cor (não é 400/409
  // — o que sobrar de erro daqui pra frente é só a cotação de frete, que
  // este ambiente de teste não tem credencial real pra completar).
  const emEstoque = await post("/api/create-preference", checkoutBody("#F4B4CC"), clienteCookie);
  assert.notEqual(emEstoque.status, 400);
  assert.notEqual(emEstoque.status, 409);

  // A CONDIÇÃO DE CORRIDA: a lojista tira a última cor do estoque DEPOIS
  // que a cliente já tinha escolhido — o checkout, ao revalidar contra o
  // estoque atual, tem que rejeitar com 409 em vez de aceitar a cor velha.
  const removeu = await patch("/api/admin/products/1", { availableColors: [] }, adminCookie);
  assert.equal(removeu.status, 200);
  const corrida = await post("/api/create-preference", checkoutBody("#F4B4CC"), clienteCookie);
  assert.equal(corrida.status, 409, "cor que ficou esgotada entre a escolha e o checkout é rejeitada");
});

test("galeria de fotos: PATCH admin reflete no catálogo (a 1ª é a capa) e valida limites", async () => {
  // Reaproveita o cookie de admin do teste de estoque por cor, acima — ver
  // comentário em sharedAdminCookie sobre o teto do authLimiter.
  const adminCookie = sharedAdminCookie;
  assert.ok(adminCookie, "precisa de um cookie de admin já autenticado");

  const fotoA = "https://exemplo.test/foto-a.jpg";
  const fotoB = "https://exemplo.test/foto-b.jpg";

  const salvo = await patch("/api/admin/products/2", { photos: [fotoA, fotoB] }, adminCookie);
  assert.equal(salvo.status, 200);
  const salvoBody = await salvo.json();
  assert.deepEqual(salvoBody.photos, [fotoA, fotoB]);
  assert.equal(salvoBody.photoUrl, fotoA, "a 1ª foto da lista é a capa (photoUrl derivado)");

  // Catálogo público e do admin refletem a galeria e a capa.
  const pub = await (await fetch(ORIGIN + "/api/products")).json();
  const p2 = pub.products.find(p => p.id === 2);
  assert.deepEqual(p2.photos, [fotoA, fotoB]);
  assert.equal(p2.photoUrl, fotoA);

  // Só reordenar (sem adicionar/remover nada) já muda a capa.
  const reordenado = await patch("/api/admin/products/2", { photos: [fotoB, fotoA] }, adminCookie);
  assert.equal(reordenado.status, 200);
  assert.equal((await reordenado.json()).photoUrl, fotoB);

  // Mais de 8 fotos, URL duplicada e URL inválida são todas rejeitadas.
  const demais = await patch(
    "/api/admin/products/2",
    { photos: Array.from({ length: 9 }, (_, i) => `https://exemplo.test/foto-${i}.jpg`) },
    adminCookie
  );
  assert.equal(demais.status, 400);
  const duplicada = await patch("/api/admin/products/2", { photos: [fotoA, fotoA] }, adminCookie);
  assert.equal(duplicada.status, 400);
  const invalida = await patch("/api/admin/products/2", { photos: ["nao-e-uma-url"] }, adminCookie);
  assert.equal(invalida.status, 400);

  // Removeu todas as fotos: [] explícito é um estado real (produto sem
  // foto), não um erro — o servidor aceita e devolve photos: [].
  const semFotos = await patch("/api/admin/products/2", { photos: [] }, adminCookie);
  assert.equal(semFotos.status, 200);
  assert.deepEqual((await semFotos.json()).photos, []);
});

test("galeria de fotos: upload real grava em img/products/ e remover a foto do PATCH apaga o arquivo", async () => {
  const adminCookie = sharedAdminCookie;
  assert.ok(adminCookie, "precisa de um cookie de admin já autenticado");

  const form = new FormData();
  form.append("photo", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xdb])], { type: "image/jpeg" }), "foto.jpg");
  const up = await fetch(`${ORIGIN}/api/admin/products/3/photo`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: adminCookie },
    body: form,
  });
  assert.equal(up.status, 201);
  const { photoUrl } = await up.json();
  assert.match(photoUrl, /^\/img\/products\/produto-3-\d+\.jpe?g$/);
  const filePath = path.join(__dirname, "..", photoUrl);

  // try/finally garante a limpeza do arquivo em disco mesmo se alguma
  // asserção falhar no meio — este upload grava na MESMA pasta usada pelo
  // servidor de verdade (server/img/products/), não numa pasta isolada de
  // teste, então não pode deixar sobra.
  try {
    assert.ok(fs.existsSync(filePath), "arquivo devia existir em disco logo após o upload");

    const salvo = await patch("/api/admin/products/3", { photos: [photoUrl] }, adminCookie);
    assert.equal(salvo.status, 200);
    assert.ok(fs.existsSync(filePath), "arquivo continua existindo enquanto está na lista");

    // Remover a foto da lista (photos: []) apaga o arquivo do disco,
    // melhor-esforço (mesmo racional de deleteOldLocalPhoto ao trocar a
    // foto única antiga) — fs.unlink é assíncrono, por isso o poll curto.
    const removido = await patch("/api/admin/products/3", { photos: [] }, adminCookie);
    assert.equal(removido.status, 200);
    for (let i = 0; i < 10 && fs.existsSync(filePath); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(!fs.existsSync(filePath), "arquivo devia ter sido apagado do disco ao sair da lista");
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
  }
});

test("cor personalizada: POST /api/admin/colors cria, aparece em /api/products, e rejeita duplicata/hex inválido", async () => {
  const adminCookie = sharedAdminCookie;
  assert.ok(adminCookie, "precisa de um cookie de admin já autenticado");

  const created = await post("/api/admin/colors", { hex: "#7a2e4f", label: "Vinho" }, adminCookie);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.hex, "#7A2E4F", "hex normalizado para maiúsculo");
  assert.equal(createdBody.label, "Vinho");

  const pub = await (await fetch(ORIGIN + "/api/products")).json();
  assert.ok(pub.colors.some(c => c.hex === "#7A2E4F" && c.label === "Vinho"), "cor nova aparece na paleta pública");

  const duplicada = await post("/api/admin/colors", { hex: "#7A2E4F", label: "Outro nome" }, adminCookie);
  assert.equal(duplicada.status, 409);

  const invalida = await post("/api/admin/colors", { hex: "vermelho", label: "X" }, adminCookie);
  assert.equal(invalida.status, 400);

  const semNome = await post("/api/admin/colors", { hex: "#112233", label: "a" }, adminCookie);
  assert.equal(semNome.status, 400);
});

test("cor personalizada: DELETE /api/admin/colors/:hex apaga cor criada, mas nunca uma fixa", async () => {
  const adminCookie = sharedAdminCookie;
  assert.ok(adminCookie);

  const created = await post("/api/admin/colors", { hex: "#334455", label: "Cinza Teste" }, adminCookie);
  assert.equal(created.status, 201);

  const del = (hex) => fetch(`${ORIGIN}/api/admin/colors/${encodeURIComponent(hex)}`, {
    method: "DELETE",
    headers: { Origin: ORIGIN, Cookie: adminCookie },
  });

  // Cor fixa (da paleta original) nunca pode ser apagada.
  const fixaNegada = await del("#F4B4CC");
  assert.equal(fixaNegada.status, 400);

  // Hex que não existe -> 404.
  const inexistente = await del("#999999");
  assert.equal(inexistente.status, 404);

  // Cor criada pelo painel é apagada de verdade.
  const apagada = await del("#334455");
  assert.equal(apagada.status, 200);
  const pub = await (await fetch(ORIGIN + "/api/products")).json();
  assert.ok(!pub.colors.some(c => c.hex === "#334455"), "cor apagada não aparece mais na paleta");
});

test("2ª cor opcional (produtos vendidos em conjunto): exige allowsSecondColor, valida cada cor separadamente (incl. a corrida)", async () => {
  const adminCookie = sharedAdminCookie;
  const clienteCookie = sharedClienteCookie;
  assert.ok(adminCookie && clienteCookie, "precisa de admin e cliente já autenticados");

  // Produto 6 ("Kit Presente 3 Laços") — id de kit de verdade no catálogo,
  // ainda não tocado pelos testes anteriores.
  const endereco = {
    nome: "Cliente Kit", telefone: "61982749809", rua: "Rua das Flores",
    numero: "200", bairro: "Centro", cidade: "Brasília", uf: "DF",
  };
  const checkoutBody = (color, secondColor) => ({
    items: [{ id: 6, qty: 1, color, secondColor }],
    cep: "70040020",
    shipping_service_id: "1",
    address: endereco,
    paymentMethod: "card",
  });

  // Produto ainda não permite 2ª cor -> secondColor truthy é rejeitado (400),
  // mesmo sendo uma cor válida e em estoque.
  const semPermissao = await post("/api/create-preference", checkoutBody("#F4B4CC", "#DD6E9B"), clienteCookie);
  assert.equal(semPermissao.status, 400);

  const ligou = await patch("/api/admin/products/6", { allowSecondColor: true }, adminCookie);
  assert.equal(ligou.status, 200);
  assert.equal((await ligou.json()).allowsSecondColor, true);

  // Com permissão, mas a 2ª cor está fora do estoque atual -> 409 nomeando ELA.
  await patch("/api/admin/products/6", { availableColors: ["#F4B4CC"] }, adminCookie);
  const foraDeEstoque = await post("/api/create-preference", checkoutBody("#F4B4CC", "#DD6E9B"), clienteCookie);
  assert.equal(foraDeEstoque.status, 409);
  assert.match((await foraDeEstoque.json()).error, /Rosa pink/);

  // As duas cores em estoque -> passam da validação de cor.
  await patch("/api/admin/products/6", { availableColors: ["#F4B4CC", "#DD6E9B"] }, adminCookie);
  const comAsDuas = await post("/api/create-preference", checkoutBody("#F4B4CC", "#DD6E9B"), clienteCookie);
  assert.notEqual(comAsDuas.status, 400);
  assert.notEqual(comAsDuas.status, 409);

  // A 2ª cor é OPCIONAL mesmo num produto elegível — só a principal continua válido.
  const soPrincipal = await post("/api/create-preference", checkoutBody("#F4B4CC", undefined), clienteCookie);
  assert.notEqual(soPrincipal.status, 400);
  assert.notEqual(soPrincipal.status, 409);

  // A CORRIDA: a 2ª cor escolhida fica esgotada DEPOIS da escolha da
  // cliente — o checkout, revalidando contra o estoque atual, rejeita com
  // 409 em vez de aceitar a cor velha (mesma lógica já provada pra cor única).
  await patch("/api/admin/products/6", { availableColors: ["#F4B4CC"] }, adminCookie);
  const corrida = await post("/api/create-preference", checkoutBody("#F4B4CC", "#DD6E9B"), clienteCookie);
  assert.equal(corrida.status, 409, "2ª cor que ficou esgotada entre a escolha e o checkout é rejeitada");
});

test("descrição do produto: PATCH edita, GET /api/products reflete, POST /api/admin/products aceita na criação", async () => {
  const adminCookie = sharedAdminCookie;
  assert.ok(adminCookie);

  // Produto 4 (Laço Pérola) — ainda não tocado pelos testes anteriores.
  const patched = await patch("/api/admin/products/4", { description: "Descrição escrita pela lojista." }, adminCookie);
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).description, "Descrição escrita pela lojista.");

  const pub = await (await fetch(ORIGIN + "/api/products")).json();
  assert.equal(pub.products.find(p => p.id === 4).description, "Descrição escrita pela lojista.");

  // Descrição muito longa é rejeitada.
  const longaDemais = await patch("/api/admin/products/4", { description: "x".repeat(501) }, adminCookie);
  assert.equal(longaDemais.status, 400);

  // String vazia limpa de volta pro padrão (null) — não é erro.
  const limpa = await patch("/api/admin/products/4", { description: "" }, adminCookie);
  assert.equal(limpa.status, 200);
  assert.equal((await limpa.json()).description, null);

  // Criar produto novo já com descrição.
  const created = await post("/api/admin/products", {
    name: "Produto Teste Descrição", description: "Feito sob encomenda.",
    price: 39.9, weight: 0.05, width: 16, height: 3, length: 11, badges: [],
  }, adminCookie);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).description, "Feito sob encomenda.");
});

test("continuar pagamento: 404 se não existe/não é da cliente, 409 se já não está pendente", async () => {
  // Duas clientes novas, cada uma dona de um pedido — tudo inserido direto
  // no banco (db.createUser/createSession/createOrder), sem passar por
  // /api/auth/register nem /api/auth/login: essas rotas dividem o mesmo
  // authLimiter (10 req/15min por IP) com todos os testes deste arquivo, e
  // esta suíte já está perto do teto só com os cadastros que os testes
  // anteriores precisaram fazer. Sessão criada assim é idêntica, para fins
  // de auth.requireAuth, a uma sessão de login de verdade — só pula o
  // hash de senha e o rate limit, que não são o que este teste verifica.
  // Pedidos "pago"/"pendente" também são inseridos direto (db.createOrder):
  // este ambiente de teste não tem credencial real de Mercado Pago/Melhor
  // Envio para levar um pedido de verdade até existir (mesma limitação já
  // documentada nos testes de estoque por cor acima). Isso ainda cobre a
  // parte que É nossa (as travas de dono/status), sem depender de rede.
  function sessionCookieFor(userId){
    const token = crypto.randomBytes(32).toString("hex");
    db.createSession({
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      userId,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    return `plc_session=${token}`;
  }

  const dona = db.createUser({ name: "Dona Pedido", email: "donapedido@test.com", passwordHash: "x", cpf: "11144477735" });
  const donaCookie = sessionCookieFor(dona.id);
  const donaId = dona.id;

  const outra = db.createUser({ name: "Outra Cliente", email: "outracliente@test.com", passwordHash: "x", cpf: "11144477735" });
  const outraCookie = sessionCookieFor(outra.id);

  const pedidoBase = {
    items: [{ id: 1, qty: 1, price: 34.9, color: "#F4B4CC" }],
    address: { nome: "Dona Pedido", telefone: "61982749808", rua: "Rua X", numero: "1", bairro: "B", cidade: "Brasília", uf: "DF", cep: "70040020" },
    shipping: { service_id: "1", name: "PAC", price: 10 },
    subtotal: 34.9, shippingPrice: 10, total: 44.9, customerPhone: "61982749808",
  };

  const pago = db.createOrder({ ...pedidoBase, externalReference: "TEST-PAGO-1", userId: donaId, status: "pago" });
  const pendenteDaDona = db.createOrder({ ...pedidoBase, externalReference: "TEST-PENDENTE-1", userId: donaId, status: "pendente" });

  // Referência que não existe -> 404.
  const inexistente = await post("/api/orders/nao-existe-esta-referencia/resume-payment", {}, donaCookie);
  assert.equal(inexistente.status, 404);

  // Pedido é de outra cliente -> 404 (nunca revela que o pedido existe).
  const deOutra = await post(`/api/orders/${pendenteDaDona.external_reference}/resume-payment`, {}, outraCookie);
  assert.equal(deOutra.status, 404);

  // Pedido já pago -> 409, sem tentar gerar um pagamento novo.
  const jaPago = await post(`/api/orders/${pago.external_reference}/resume-payment`, {}, donaCookie);
  assert.equal(jaPago.status, 409);
});

test("ordem dos produtos: PUT reordena a vitrine, e rejeita lista incompleta/repetida", async () => {
  const adminCookie = sharedAdminCookie;
  assert.ok(adminCookie);

  const idsOriginais = (await (await fetch(ORIGIN + "/api/products")).json()).products.map(p => p.id);
  assert.ok(idsOriginais.length >= 3, "precisa de pelo menos 3 produtos pra testar a troca");

  // Inverter a lista inteira é o caso mais simples de conferir: se a ordem
  // valeu, o primeiro vira o último.
  const invertida = [...idsOriginais].reverse();
  const ok = await put("/api/admin/products/order", { ids: invertida }, adminCookie);
  assert.equal(ok.status, 200);

  const depois = (await (await fetch(ORIGIN + "/api/products")).json()).products.map(p => p.id);
  assert.deepEqual(depois, invertida, "a vitrine passa a seguir a ordem salva");

  // O painel enxerga a mesma ordem que a cliente — se divergirem, a lojista
  // arrasta um produto olhando para uma lista que não é a da loja.
  const noPainel = (await (await fetch(ORIGIN + "/api/admin/products", { headers: { Cookie: adminCookie } })).json()).products.map(p => p.id);
  assert.deepEqual(noPainel, invertida, "painel e vitrine na mesma ordem");

  // Lista sem todos os produtos -> 409 (a tela está velha; gravar deixaria
  // produto sem posição).
  const incompleta = await put("/api/admin/products/order", { ids: invertida.slice(1) }, adminCookie);
  assert.equal(incompleta.status, 409);

  // Id repetido -> 400, antes mesmo de comparar com o catálogo.
  const repetida = await put("/api/admin/products/order", { ids: [invertida[0], ...invertida] }, adminCookie);
  assert.equal(repetida.status, 400);

  // Lista vazia -> 400.
  assert.equal((await put("/api/admin/products/order", { ids: [] }, adminCookie)).status, 400);

  // Cliente comum não reordena a vitrine da loja.
  const comoCliente = await put("/api/admin/products/order", { ids: idsOriginais }, sharedClienteCookie);
  assert.equal(comoCliente.status, 403);

  // Devolve a ordem original pra não interferir em outros testes.
  await put("/api/admin/products/order", { ids: idsOriginais }, adminCookie);
});
