/**
 * A fonte de ícones é um recorte do Bootstrap Icons (scripts/subset-icones.js).
 *
 * ⚠️ Isso quebra em silêncio: uma classe `bi-*` fora do recorte vira retângulo
 * vazio, sem erro e sem 404. Estes testes refazem a varredura do script, então
 * esquecer de rodá-lo vira teste vermelho em vez de ícone sumido.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { iconesUsados, mapaDeCodepoints, CSS_RECORTADO } = require("../scripts/subset-icones.js");

function iconesNoRecorte() {
  const css = fs.readFileSync(CSS_RECORTADO, "utf8");
  return new Set(Array.from(css.matchAll(/\.(bi-[a-z0-9-]+)::before/g), (m) => m[1]));
}

test("todo ícone usado no site existe no recorte da fonte", () => {
  const mapa = mapaDeCodepoints();
  const recorte = iconesNoRecorte();
  // Filtra pelo mapa do Bootstrap Icons: "bi-" também aparece em classes
  // nossas (.bow-icon não, mas o filtro protege de futuras), e só o que o
  // Bootstrap define é que precisa estar na fonte.
  const usados = [...iconesUsados()].filter((nome) => mapa.has(nome));

  const faltando = usados.filter((nome) => !recorte.has(nome)).sort();
  assert.deepEqual(faltando, [],
    "ícone usado no HTML/JS e ausente do recorte — rode: node scripts/subset-icones.js");
});

test("o recorte não carrega ícone que ninguém usa", () => {
  const mapa = mapaDeCodepoints();
  const usados = new Set([...iconesUsados()].filter((nome) => mapa.has(nome)));

  const sobrando = [...iconesNoRecorte()].filter((nome) => !usados.has(nome)).sort();
  assert.deepEqual(sobrando, [],
    "ícone no recorte que saiu do site — rode: node scripts/subset-icones.js");
});

test("nenhuma página ainda aponta para o CSS completo do Bootstrap Icons", () => {
  const paginas = fs.readdirSync(__dirname + "/..").filter((f) => f.endsWith(".html"));
  const erradas = paginas.filter((f) =>
    fs.readFileSync(__dirname + "/../" + f, "utf8").includes("bootstrap-icons.min.css")
  );
  assert.deepEqual(erradas, [],
    "página carregando os 84 KB do CSS completo em vez do recorte de 4 KB");
});

test("a fonte recortada existe e é uma fração da original", () => {
  const recortada = fs.statSync(__dirname + "/../css/vendor/fonts/bootstrap-icons.subset.woff2").size;
  const completa = fs.statSync(__dirname + "/../css/vendor/fonts/bootstrap-icons.woff2").size;
  assert.ok(recortada < completa / 5,
    `recorte com ${recortada} bytes contra ${completa} da fonte cheia — recorte não surtiu efeito`);
});
