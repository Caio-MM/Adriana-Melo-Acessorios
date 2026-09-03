/**
 * bootstrap.purged.css é um recorte de bootstrap.min.css (scripts/purgar-bootstrap.js)
 * — 227 KB brutos viraram 54 KB. Modal, Offcanvas e Toast (os únicos
 * componentes JS do Bootstrap em uso, confirmado por grep em admin.js,
 * cupom-toast.js, main.js e pedidos.js) sobrevivem por um safelist, não por
 * aparecerem como class="..." literal — o extrator não os acharia sozinho
 * porque essas classes são adicionadas pela própria biblioteca em runtime.
 *
 * ⚠️ Isso quebra em silêncio: um Modal/Offcanvas/Toast sem CSS ainda funciona
 * em JS (a classe é adicionada do mesmo jeito), só que invisível — parece bug
 * de estado, não de estilo. Este teste garante que a família de classes de
 * cada componente sobrevive no arquivo recortado.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const CSS_PURGADO = fs.readFileSync(path.join(RAIZ, "css/vendor/bootstrap.purged.css"), "utf8");

test("Modal, Offcanvas e Toast sobrevivem ao recorte do Bootstrap", () => {
  const familias = [
    ".modal", ".modal-backdrop", ".modal-dialog", ".modal-content",
    ".offcanvas", ".offcanvas-backdrop",
    ".toast", ".toast-header", ".toast-body",
    ".btn-close", ".fade", ".show",
  ];
  const faltando = familias.filter((classe) => {
    const re = new RegExp("\\" + classe + "(?![a-zA-Z0-9_-])");
    return !re.test(CSS_PURGADO);
  });
  assert.deepEqual(faltando, [],
    "classe de Modal/Offcanvas/Toast ausente do recorte — rode: node scripts/purgar-bootstrap.js");
});

test("nenhuma página ainda aponta para o bootstrap.min.css completo", () => {
  const paginas = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html"));
  const erradas = paginas.filter((f) =>
    fs.readFileSync(path.join(RAIZ, f), "utf8").includes("bootstrap.min.css")
  );
  assert.deepEqual(erradas, [],
    "página carregando os 227 KB do Bootstrap completo em vez do recorte de 54 KB");
});

test("o recorte é uma fração real do arquivo original", () => {
  const original = fs.statSync(path.join(RAIZ, "css/vendor/bootstrap.min.css")).size;
  const purgado = fs.statSync(path.join(RAIZ, "css/vendor/bootstrap.purged.css")).size;
  assert.ok(purgado < original / 2,
    `recorte com ${purgado} bytes contra ${original} do original — recorte não surtiu efeito`);
});
