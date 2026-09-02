/**
 * =============================================================================
 *  TESTE DOS E-MAILS DA CLIENTE — confirmação de compra e aviso de envio
 * =============================================================================
 *  Uso:
 *      cd server && node scripts/testar-email-cliente.js seu@email.com
 *
 *  Manda para o endereço informado os DOIS e-mails que a cliente recebe:
 *  o recibo do pedido pago e o aviso de postagem com o código de rastreio.
 *  Usa exatamente as mesmas funções de lib/email.js que o site usa em
 *  produção, então o que chegar aqui é o que a cliente vai ver.
 *
 *  Não escreve no banco: monta um pedido de exemplo em memória e envia.
 *  Pode rodar quantas vezes quiser sem sujar nada.
 *
 *  Existe porque scripts/testar-email.js só prova que o SMTP funciona —
 *  ele manda um texto genérico para a lojista, não mostra o que a cliente
 *  recebe. E a home promete "código de rastreio por e-mail": vale poder
 *  conferir esse e-mail sem precisar fazer uma compra de verdade.
 */
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const email = require("../lib/email.js");

const destino = process.argv[2];
if (!destino || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) {
  console.error("Informe o e-mail de destino:\n  node scripts/testar-email-cliente.js seu@email.com");
  process.exit(1);
}

const SITE = process.env.CLIENT_ORIGIN || "https://adrianameloacessorios.com";
const REFERENCIA = "TESTE-" + Date.now().toString(36).toUpperCase();
const RASTREIO = "AA123456789BR";

const pedido = {
  itens: [
    { qty: 1, name: "Laço Duquesa", price: 49.90 },
    { qty: 2, name: "Laço Borboleta", price: 44.90 },
  ],
  endereco: {
    nome: "Cliente de Teste", telefone: "(61) 98274-9808",
    rua: "Quadra 300, Conjunto 15", numero: "12", complemento: "Casa",
    bairro: "Samambaia Sul", cidade: "Brasília", uf: "DF", cep: "72620115",
  },
  subtotal: 139.70, desconto: 13.97, descontoPix: 6.29, frete: 24.50,
};
pedido.total = Number(
  (pedido.subtotal - pedido.desconto - pedido.descontoPix + pedido.frete).toFixed(2)
);

const acompanhar = `${SITE}/acompanhar-pedido.html?pedido=${encodeURIComponent(REFERENCIA)}`;

async function enviar(rotulo, conteudo) {
  process.stdout.write(`  ${rotulo}... `);
  try {
    await email.sendEmail({
      to: destino,
      subject: conteudo.subject,
      text: conteudo.text,
      html: conteudo.html,
    });
    console.log("enviado");
    console.log(`    assunto: "${conteudo.subject}"`);
  } catch (err) {
    console.log("FALHOU");
    console.log(`    ${err.message || err}`);
    return false;
  }
  return true;
}

(async () => {
  console.log(`\nPedido de exemplo ${REFERENCIA} → ${destino}\n`);

  const ok1 = await enviar("1. confirmação de compra", email.formatOrderConfirmationEmail({
    externalReference: REFERENCIA,
    items: pedido.itens,
    subtotal: pedido.subtotal,
    discount: pedido.desconto,
    pixDiscount: pedido.descontoPix,
    shippingPrice: pedido.frete,
    total: pedido.total,
    couponCode: "BEMVINDA10",
    address: pedido.endereco,
    paidAt: Date.now(),
    trackUrl: acompanhar,
  }));

  const ok2 = await enviar("2. aviso de envio", email.formatTrackingEmail({
    externalReference: REFERENCIA,
    trackingCode: RASTREIO,
    address: pedido.endereco,
    trackUrl: acompanhar,
  }));

  if (ok1 && ok2) {
    console.log("\nOs dois chegaram. Confira também a caixa de spam na primeira vez.");
  } else {
    console.log("\nAlgum envio falhou. Confira as variáveis SMTP_* no .env —");
    console.log("scripts/testar-email.js isola se o problema é o SMTP em si.");
    process.exitCode = 1;
  }
})().catch(err => { console.error("Erro:", err); process.exit(1); });
