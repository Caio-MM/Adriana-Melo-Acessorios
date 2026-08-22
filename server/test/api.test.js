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

let child;

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
function cookieFrom(res) {
  const raw = res.headers.get("set-cookie");
  return raw ? raw.split(";")[0] : null;
}

// Testes ----------------------------------------------------------------
test("cadastro define sessão e /api/auth/me responde ao dono", async () => {
  const res = await post("/api/auth/register", { name: "Cliente A", email: "a@test.com", password: "SenhaA12345!", cep: "70040020" });
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
  const rc = await post("/api/auth/register", { name: "Comum", email: "comum@test.com", password: "SenhaC12345!", cep: "70040020" });
  const comumCookie = cookieFrom(rc);
  const asComum = await fetch(ORIGIN + "/api/admin/orders", { headers: { Cookie: comumCookie } });
  assert.equal(asComum.status, 403, "cliente comum -> 403");

  // Admin (e-mail com hash em ADMIN_EMAIL_HASHES; 2FA desligado no teste)
  const ra = await post("/api/auth/register", { name: "Admin", email: ADMIN_EMAIL, password: "SenhaADM12345!", cep: "70040020" });
  const adminCookie = cookieFrom(ra);
  assert.equal((await ra.json()).isAdmin, true);
  const asAdmin = await fetch(ORIGIN + "/api/admin/orders", { headers: { Cookie: adminCookie } });
  assert.equal(asAdmin.status, 200, "admin -> 200");
});

test("exclusão de conta: senha errada barra; senha certa apaga e invalida login", async () => {
  const reg = await post("/api/auth/register", { name: "Del", email: "del@test.com", password: "SenhaDEL12345!", cep: "70040020" });
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
