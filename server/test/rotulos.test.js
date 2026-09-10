/**
 * ⚠️ Isso quebra em silêncio: .form-check-label é inline-flex (para a área de
 * toque de 44px no celular). Num flex, cada trecho de texto e cada link viram
 * um bloco separado, lado a lado — "Li e concordo com a | Política de
 * Privacidade | e autorizo o uso…" saía em três colunas. Rótulo com link ou
 * negrito dentro precisa de um único <span> em volta de tudo.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");

function arquivos() {
  const html = fs.readdirSync(RAIZ).filter(n => n.endsWith(".html")).map(n => path.join(RAIZ, n));
  const js = fs.readdirSync(path.join(RAIZ, "js")).filter(n => n.endsWith(".js")).map(n => path.join(RAIZ, "js", n));
  return [...html, ...js];
}

test("rótulo de caixinha com link ou negrito dentro vem embrulhado num único <span>", () => {
  const culpados = [];
  const re = /<label[^>]*class="[^"]*form-check-label[^"]*"[^>]*>([\s\S]*?)<\/label>/g;
  for (const arquivo of arquivos()) {
    const texto = fs.readFileSync(arquivo, "utf8");
    for (const m of texto.matchAll(re)) {
      const miolo = m[1].trim();
      if (!/<(a|strong|em|b|i|span)\b/.test(miolo)) continue;
      const embrulhado = /^<span\b[^>]*>[\s\S]*<\/span>$/.test(miolo)
        && miolo.indexOf("</span>") === miolo.lastIndexOf("</span>");
      if (!embrulhado) {
        const linha = texto.slice(0, m.index).split("\n").length;
        culpados.push(`${path.relative(RAIZ, arquivo)}:${linha}`);
      }
    }
  }
  assert.deepEqual(culpados, [], "embrulhe o conteúdo do <label> num único <span> — o inline-flex separa em colunas");
});
