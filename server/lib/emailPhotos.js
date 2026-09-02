/**
 * =============================================================================
 *  MINIATURAS DE PRODUTO NOS E-MAILS DE PEDIDO
 * =============================================================================
 *  Módulo separado de lib/email.js de propósito: só aqui entram o banco e o
 *  sharp. O email.js é carregado por scripts/testar-email.js, que existe para
 *  provar o SMTP — não faz sentido abrir o banco de dados para isso.
 *
 *  POR QUE ANEXO, E NÃO <img src="https://...">
 *  ---------------------------------------------------------------------------
 *  Outlook para computador e Thunderbird bloqueiam imagem remota por padrão, e
 *  o Gmail descarta data: URI. Uma miniatura apontando para o site sumiria
 *  justamente para parte de quem recebe. Anexo cid: é parte da mensagem e
 *  aparece sem pedir permissão — é o mesmo mecanismo que a logo já usa.
 *
 *  POR QUE OS ANEXOS SÃO DERIVADOS DO HTML
 *  ---------------------------------------------------------------------------
 *  O recibo da cliente passa pela fila (email_outbox), que guarda só assunto,
 *  texto e HTML — não tem coluna de anexo — e o cron de retentativa remonta a
 *  mensagem a partir dessa linha. Derivando do próprio HTML, o anexo sobrevive
 *  a enfileirar → entregar → retentar sem precisar mudar o banco: o HTML já
 *  carrega cid:produto-<uuid>, e esse uuid é a chave em product_photos.
 */
const sharp = require("sharp");

/* 56px de exibição em tela retina. Medido com uma foto real da loja
   (800x1200, 135 KB): sai em 2,5 KB e 17 ms. */
const LADO = 112;

const CID_NO_HTML =
  /cid:produto-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

let blocoLisoCache = null;
async function blocoLiso() {
  if (!blocoLisoCache) {
    blocoLisoCache = await sharp({
      create: { width: LADO, height: LADO, channels: 3, background: "#FBDCE8" },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
  }
  return blocoLisoCache;
}

/**
 * Lê o HTML e devolve um anexo para CADA cid:produto-<uuid> encontrado.
 *
 * ⚠️ A cobertura precisa ser TOTAL. Trocar a foto de um produto no painel
 * apaga o blob antigo (deleteOldLocalPhoto, em server.js), e um e-mail pode
 * ficar na fila até ~9h ao longo das 5 tentativas. Se nesse intervalo a foto
 * sumir e este módulo devolvesse a lista sem ela, o HTML ficaria apontando
 * para um cid sem anexo — que o Outlook desenha como ícone de imagem
 * quebrada, pior do que não ter miniatura nenhuma. Por isso todo cid ganha
 * anexo: sumiu a foto, entra um quadrado rosa liso.
 */
async function anexosDeMiniaturas(html) {
  if (!html) return [];

  // Exigido aqui dentro, e não no topo: assim carregar este módulo não abre
  // conexão com o banco (importa para os testes e para os scripts).
  const db = require("./db.js");

  // Deduplicado: o mesmo produto duas vezes no pedido custa um anexo só.
  const ids = [...new Set(Array.from(String(html).matchAll(CID_NO_HTML), (m) => m[1]))];
  if (!ids.length) return [];

  const comecou = Date.now();
  const anexos = [];

  for (const id of ids) {
    let conteudo;
    try {
      const foto = db.getProductPhoto(id);
      conteudo = foto
        // node:sqlite devolve BLOB como Uint8Array, não Buffer.
        ? await sharp(Buffer.from(foto.data))
            .resize(LADO, LADO, { fit: "cover", position: "centre" })
            .jpeg({ quality: 72, mozjpeg: true })
            .toBuffer()
        : await blocoLiso();
    } catch (err) {
      console.error(`Miniatura ${id} falhou — usando bloco liso:`, err.message || err);
      conteudo = await blocoLiso();
    }
    anexos.push({
      filename: `produto-${id}.jpg`,
      content: conteudo,
      cid: `produto-${id}`,
      contentType: "image/jpeg",
    });
  }

  const levou = Date.now() - comecou;
  if (levou > 1000) {
    console.warn(`Miniaturas demoraram ${levou}ms para ${ids.length} foto(s).`);
  }
  return anexos;
}

/** Mesmo formato de sendEmail, com os anexos derivados do próprio HTML. */
async function enviarComMiniaturas(mensagem) {
  const email = require("./email.js");
  return email.sendEmail({
    ...mensagem,
    attachments: await anexosDeMiniaturas(mensagem.html),
  });
}

module.exports = { anexosDeMiniaturas, enviarComMiniaturas, LADO };
