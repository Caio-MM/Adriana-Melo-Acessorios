/**
 * =============================================================================
 *  RECORTA O CSS DO BOOTSTRAP PARA O QUE O SITE REALMENTE USA
 * =============================================================================
 *  Medido: só 11,5% dos seletores de topo de bootstrap.min.css têm alguma
 *  correspondência na home, e ele é render-blocking — 32,4 KB comprimidos
 *  (232 KB brutos) do CSS que trava o primeiro pixel são, na maior parte,
 *  regras de componentes que este site nunca usa (accordion, carousel,
 *  breadcrumb, pagination, tooltip/popover, form floating labels etc.).
 *
 *  Varre TODO .html e .js do site (não só a home) e chama `npx purgecss`
 *  (não vira dependência do package.json — mesmo espírito do pyftsubset via
 *  venv em scripts/subset-icones.js).
 *
 *      cd server && node scripts/purgar-bootstrap.js
 *
 *  ⚠️ O risco do Bootstrap não é a classe estática (essa o extrator acha
 *  sozinho) — é a classe que a PRÓPRIA BIBLIOTECA adiciona em runtime
 *  (.show, .fade, .modal-backdrop, .offcanvas-backdrop, .collapsing), que
 *  nunca aparece como class="..." literal no HTML/JS. Confirmado onde isso
 *  importa: bootstrap.Modal/Offcanvas/Toast são instanciados em admin.js,
 *  cupom-toast.js, main.js e pedidos.js — por isso o safelist abaixo, e não
 *  uma varredura maior de conteúdo, é o que protege esses três componentes.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const RAIZ = path.join(__dirname, "..");
const CSS_ORIGINAL = path.join(RAIZ, "css/vendor/bootstrap.min.css");
const CSS_PURGADO = path.join(RAIZ, "css/vendor/bootstrap.purged.css");

const CONFIG = `
module.exports = {
  content: [${JSON.stringify(path.join(RAIZ, "*.html"))}, ${JSON.stringify(path.join(RAIZ, "js/*.js"))}],
  css: [${JSON.stringify(CSS_ORIGINAL)}],
  safelist: {
    standard: ["show", "fade", "collapsing"],
    deep: [/^modal/, /^offcanvas/, /^toast/, /^backdrop$/],
  },
};
`;

function main() {
  const antes = fs.statSync(CSS_ORIGINAL).size;
  const configPath = path.join(os.tmpdir(), "purgecss-bootstrap." + Date.now() + ".js");
  // Saída num diretório à parte: purgecss escreve <dir>/<nome-do-arquivo-fonte>,
  // e se isso fosse css/vendor/ o output colidiria com o próprio
  // bootstrap.min.css e o sobrescreveria em silêncio antes de eu poder lê-lo.
  const dirSaida = fs.mkdtempSync(path.join(os.tmpdir(), "purgecss-saida-"));
  fs.writeFileSync(configPath, CONFIG);

  try {
    execFileSync("npx", ["--yes", "purgecss", "-c", configPath, "-o", dirSaida], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (err) {
    console.error("purgecss falhou:\n" + String(err.stderr || err.message));
    process.exit(1);
  } finally {
    fs.unlinkSync(configPath);
  }

  fs.renameSync(path.join(dirSaida, path.basename(CSS_ORIGINAL)), CSS_PURGADO);
  fs.rmdirSync(dirSaida);

  const depois = fs.statSync(CSS_PURGADO).size;
  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  console.log(`bootstrap.min.css  ${kb(antes)} -> bootstrap.purged.css ${kb(depois)}`);
}

if (require.main === module) main();
