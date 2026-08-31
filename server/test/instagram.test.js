/**
 * Testes de lib/instagram.js — só a parte pura (mapMediaItem), sem rede
 * nem credenciais reais (ver docs/instagram-setup.md para isso). Roda
 * com: node --test
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

// Precisa vir ANTES de require("../lib/instagram.js"): esse módulo faz
// require("./db") internamente, e db.js lê DB_PATH no load (mesmo padrão
// de test/db.test.js) — sem isso, o teste abriria o data.db real.
process.env.DB_PATH = path.join(os.tmpdir(), `plc-instagram-test-${process.pid}-${Date.now()}.db`);
const { mapMediaItem } = require("../lib/instagram.js");

test("mapMediaItem usa media_url para foto/carrossel", () => {
  const mapped = mapMediaItem({
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

  const carrossel = mapMediaItem({
    id: "2",
    media_type: "CAROUSEL_ALBUM",
    media_url: "https://exemplo.com/capa.jpg",
    permalink: "https://www.instagram.com/p/def/",
  });
  assert.equal(carrossel.displayUrl, "https://exemplo.com/capa.jpg");
});

test("mapMediaItem usa thumbnail_url para vídeo (media_url não serve de capa)", () => {
  const mapped = mapMediaItem({
    id: "3",
    media_type: "VIDEO",
    media_url: "https://exemplo.com/video.mp4",
    thumbnail_url: "https://exemplo.com/capa-video.jpg",
    permalink: "https://www.instagram.com/reel/ghi/",
  });
  assert.equal(mapped.displayUrl, "https://exemplo.com/capa-video.jpg");
});

test("mapMediaItem lida com legenda ausente", () => {
  const mapped = mapMediaItem({
    id: "4",
    media_type: "IMAGE",
    media_url: "https://exemplo.com/foto2.jpg",
    permalink: "https://www.instagram.com/p/jkl/",
  });
  assert.equal(mapped.caption, "");
});
