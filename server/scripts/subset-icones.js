/**
 * =============================================================================
 *  RECORTA A FONTE DE ÍCONES PARA O QUE O SITE REALMENTE USA
 * =============================================================================
 *  Bootstrap Icons traz 2.050 ícones (130 KB de fonte + 86 KB de CSS); o site
 *  usa 86. Rode à mão quando um ícone novo entrar, e commite a saída:
 *
 *      cd server && node scripts/subset-icones.js
 *
 *  Precisa do fonttools:
 *      python3 -m venv .venv && .venv/bin/pip install "fonttools[woff]"
 *
 *  ⚠️ Ícone usado e fora do recorte vira quadrado vazio, sem erro no console.
 *  Quem protege disso é test/icones.test.js, que refaz esta varredura.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RAIZ = path.join(__dirname, "..");
const CSS_COMPLETO = path.join(RAIZ, "css/vendor/bootstrap-icons.min.css");
const FONTE_COMPLETA = path.join(RAIZ, "css/vendor/fonts/bootstrap-icons.woff2");
const CSS_RECORTADO = path.join(RAIZ, "css/vendor/bootstrap-icons.subset.css");
const FONTE_RECORTADA = path.join(RAIZ, "css/vendor/fonts/bootstrap-icons.subset.woff2");

// Inclui o JS: metade dos ícones nasce em template string e nunca está no HTML.
const PASTAS = ["", "js"];
const IGNORAR = new Set(["node_modules", "vendor", "fonts", "test", "scripts"]);

function arquivosParaVarrer() {
  const achados = [];
  for (const pasta of PASTAS) {
    const dir = path.join(RAIZ, pasta);
    for (const nome of fs.readdirSync(dir)) {
      if (IGNORAR.has(nome)) continue;
      const cheio = path.join(dir, nome);
      if (!fs.statSync(cheio).isFile()) continue;
      if (/\.(html|js)$/.test(nome)) achados.push(cheio);
    }
  }
  return achados;
}

/** Nomes de ícone (`bi-truck`) citados no HTML/JS do site. */
function iconesUsados() {
  const usados = new Set();
  for (const arquivo of arquivosParaVarrer()) {
    const texto = fs.readFileSync(arquivo, "utf8");
    // ⚠️ Só pega nome literal. Não existe "bi-" + variavel no projeto hoje; se
    // passar a existir, o ícone some e nem o teste percebe.
    for (const m of texto.matchAll(/\bbi-([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) {
      usados.add("bi-" + m[1]);
    }
  }
  return usados;
}

/** Mapa `bi-truck` -> "f4df", lido do próprio CSS do Bootstrap Icons. */
function mapaDeCodepoints() {
  const css = fs.readFileSync(CSS_COMPLETO, "utf8");
  const mapa = new Map();
  for (const m of css.matchAll(/\.(bi-[a-z0-9-]+)::before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g)) {
    mapa.set(m[1], m[2].toLowerCase());
  }
  return mapa;
}

function main() {
  const mapa = mapaDeCodepoints();
  // Só o que o CSS do Bootstrap Icons conhece: "bi-" também aparece em nomes
  // de classe nossos (.bi-icon, por exemplo), e isso não é um ícone.
  const usados = [...iconesUsados()].filter((nome) => mapa.has(nome)).sort();

  if (!usados.length) {
    console.error("Nenhum ícone encontrado — algo está errado na varredura.");
    process.exit(1);
  }

  const unicodes = usados.map((nome) => "U+" + mapa.get(nome)).join(",");

  try {
    execFileSync("pyftsubset", [
      FONTE_COMPLETA,
      `--unicodes=${unicodes}`,
      "--flavor=woff2",
      `--output-file=${FONTE_RECORTADA}`,
      // Sem layout-features: ícone não tem ligadura, kerning nem contexto.
      "--layout-features=",
      "--no-hinting",
      "--desubroutinize",
      // Sem os nomes internos a fonte encolhe mais e nada depende deles: o
      // @font-face abaixo nomeia a família por conta própria.
      "--name-IDs=",
      "--drop-tables+=DSIG",
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const faltando = err.code === "ENOENT";
    console.error(faltando
      ? "pyftsubset não encontrado. Instale com:\n" +
        '  python3 -m venv .venv && .venv/bin/pip install "fonttools[woff]"\n' +
        "e rode com o venv ativo (ou PATH apontando para ele)."
      : "pyftsubset falhou:\n" + String(err.stderr || err.message));
    process.exit(1);
  }

  /* O CSS recortado é escrito à mão (e não filtrado do original) porque são
     três regras fixas mais uma linha por ícone — gerar é mais previsível do
     que tentar recortar um arquivo minificado com regex. */
  const regras = usados.map((nome) => `.${nome}::before{content:"\\${mapa.get(nome)}"}`).join("\n");
  const css = `/* GERADO por scripts/subset-icones.js — não editar à mão.
   ${usados.length} de ${mapa.size} ícones do Bootstrap Icons v1.11.3 (MIT).
   Para adicionar um ícone: use a classe no HTML/JS e rode o script de novo. */
@font-face{font-display:block;font-family:bootstrap-icons;src:url("fonts/${path.basename(FONTE_RECORTADA)}") format("woff2")}
.bi::before,[class*=" bi-"]::before,[class^=bi-]::before{display:inline-block;font-family:bootstrap-icons!important;font-style:normal;font-weight:400!important;font-variant:normal;text-transform:none;line-height:1;vertical-align:-.125em;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
${regras}
`;
  fs.writeFileSync(CSS_RECORTADO, css);

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + " KB";
  console.log(`${usados.length} ícones de ${mapa.size}`);
  console.log(`fonte  ${kb(FONTE_COMPLETA)} -> ${kb(FONTE_RECORTADA)}`);
  console.log(`css    ${kb(CSS_COMPLETO)} -> ${kb(CSS_RECORTADO)}`);
}

module.exports = { iconesUsados, mapaDeCodepoints, CSS_RECORTADO, FONTE_RECORTADA };

if (require.main === module) main();
