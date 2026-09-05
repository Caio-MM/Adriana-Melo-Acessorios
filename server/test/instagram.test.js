/**
 * Testes de lib/instagram.js: mapMediaItem (pura, sem rede) e o botão
 * "Reconectar" do painel (server.js: POST /api/admin/instagram/reconnect),
 * num banco ISOLADO em tmp. A parte que bate na Graph API de verdade não
 * tem teste — o projeto não usa mock de fetch em nenhum outro lugar (mesma
 * escolha em lib/whatsapp.js) — ver docs/instagram-setup.md para testar
 * com credenciais reais. Roda com: node --test
 */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const TMP_DB = path.join(os.tmpdir(), `plc-instagram-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
const db = require("../lib/db.js");
const instagram = require("../lib/instagram.js");

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch {}
  }
});

test("mapMediaItem usa media_url para foto/carrossel", () => {
  const mapped = instagram.mapMediaItem({
    id: "1",
    caption: "Laço novo!",
    media_type: "IMAGE",
    media_url: "https://exemplo.com/foto.jpg",
    permalink: "https://www.instagram.com/p/abc/",
  });
  assert.deepEqual(mapped, {
    id: "1",
    permalink: "https://www.instagram.com/p/abc/",
    caption: "Laço novo!",
    displayUrl: "https://exemplo.com/foto.jpg",
  });

  const carrossel = instagram.mapMediaItem({
    id: "2",
    media_type: "CAROUSEL_ALBUM",
    media_url: "https://exemplo.com/capa.jpg",
    permalink: "https://www.instagram.com/p/def/",
  });
  assert.equal(carrossel.displayUrl, "https://exemplo.com/capa.jpg");
});

test("mapMediaItem usa thumbnail_url para vídeo (media_url não serve de capa)", () => {
  const mapped = instagram.mapMediaItem({
    id: "3",
    media_type: "VIDEO",
    media_url: "https://exemplo.com/video.mp4",
    thumbnail_url: "https://exemplo.com/capa-video.jpg",
    permalink: "https://www.instagram.com/reel/ghi/",
  });
  assert.equal(mapped.displayUrl, "https://exemplo.com/capa-video.jpg");
});

test("mapMediaItem lida com legenda ausente", () => {
  const mapped = instagram.mapMediaItem({
    id: "4",
    media_type: "IMAGE",
    media_url: "https://exemplo.com/foto2.jpg",
    permalink: "https://www.instagram.com/p/jkl/",
  });
  assert.equal(mapped.caption, "");
});

test("db.deleteInstagramToken apaga o registro salvo", () => {
  db.saveInstagramToken({ accessToken: "abc123", refreshedAt: Date.now() });
  assert.ok(db.getInstagramToken());
  db.deleteInstagramToken();
  assert.equal(db.getInstagramToken(), null);
});

test("db.deleteInstagramToken não quebra quando não há nada salvo", () => {
  assert.equal(db.getInstagramToken(), null);
  assert.doesNotThrow(() => db.deleteInstagramToken());
});

test("instagram.resetToken() apaga o token salvo no banco", () => {
  db.saveInstagramToken({ accessToken: "token-velho", refreshedAt: Date.now() });
  instagram.resetToken();
  assert.equal(db.getInstagramToken(), null);
});

test("instagram.testConnection() sem token configurado (nem banco, nem .env) devolve ok:false com mensagem clara", async () => {
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
  instagram.resetToken();
  const resultado = await instagram.testConnection();
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /INSTAGRAM_ACCESS_TOKEN não está definido/);
});
