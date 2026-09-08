/**
 * =============================================================================
 *  LOGO DO E-MAIL — versão com fundo próprio
 * =============================================================================
 *  A logo do site é um PNG transparente cuja marca-palavra é marrom escuro
 *  (#7c3c19). Dentro do e-mail isso é um problema real: quando o aplicativo do
 *  celular está no tema escuro e pinta o fundo de preto por conta própria, a
 *  tinta marrom sobre preto dá 2,28:1 de contraste — praticamente invisível,
 *  que foi exatamente a queixa depois da primeira compra de teste.
 *
 *  Media query não resolve: o aplicativo do Gmail, que é onde a maioria das
 *  clientes lê, ignora `prefers-color-scheme`. O que nenhum cliente de e-mail
 *  mexe são os PIXELS de uma imagem — ele inverte cor declarada em CSS, nunca
 *  o conteúdo de um PNG. Então a logo do e-mail carrega o próprio fundo rosa
 *  achatado dentro da imagem, com cantos arredondados para virar um "selo"
 *  proposital quando o fundo em volta escurece.
 *
 *  ⚠️ Gera um arquivo NOVO. A logo original (img/logo-adriana-melo-*.png)
 *  continua intocada — ela também é o `logo` do JSON-LD em server.js, e
 *  achatar um fundo nela quebraria o resultado no Google.
 *
 *  Rode com: node scripts/logo-email.js
 * =============================================================================
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ORIGEM = path.join(__dirname, "..", "img", "logo-adriana-melo-6e53bc.png");
const DESTINO = path.join(__dirname, "..", "img", "logo-adriana-melo-email.png");

// Mesmo rosa da faixa do cabeçalho do e-mail (--blush-150 no site).
const FUNDO = "#FBDCE8";
const RESPIRO = 24;
const RAIO = 18;

async function gerar() {
  const logo = sharp(ORIGEM);
  const { width, height } = await logo.metadata();

  const larguraTotal = width + RESPIRO * 2;
  const alturaTotal = height + RESPIRO * 2;

  const fundo = Buffer.from(
    `<svg width="${larguraTotal}" height="${alturaTotal}">` +
      `<rect width="${larguraTotal}" height="${alturaTotal}" rx="${RAIO}" ry="${RAIO}" fill="${FUNDO}"/>` +
      `</svg>`
  );

  await sharp(fundo)
    .composite([{ input: await logo.png().toBuffer(), top: RESPIRO, left: RESPIRO }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(DESTINO);

  const { size } = fs.statSync(DESTINO);
  console.log(`${path.basename(DESTINO)} — ${larguraTotal}x${alturaTotal}, ${(size / 1024).toFixed(1)} KB`);
}

if (require.main === module) {
  gerar().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { DESTINO, FUNDO, gerar };
