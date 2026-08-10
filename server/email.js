/**
 * =============================================================================
 *  E-MAIL PARA A LOJISTA — Petit Laço / Adriana Melo Acessórios
 * =============================================================================
 *  Envia um e-mail para a lojista sempre que um pagamento é aprovado
 *  (chamado pelo webhook do Mercado Pago em server.js), com o resumo do
 *  pedido e um link direto para o pedido no painel administrativo
 *  (admin.html — ver server/server.js e admin.html/js/admin.js).
 *
 *  Usa Nodemailer com SMTP genérico — funciona com Gmail (o endereço que
 *  recebe o aviso hoje é @gmail.com) ou qualquer outro provedor SMTP
 *  (SendGrid, Mailgun, etc.), sem depender de um serviço específico.
 *
 *  🔑 Credenciais (ver server/.env.example):
 *    SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS — conta
 *    que vai ENVIAR o e-mail. Para usar uma conta Gmail como remetente:
 *    host smtp.gmail.com, porta 587, secure=false, e SMTP_PASS precisa ser
 *    uma "senha de app" (myaccount.google.com/apppasswords — exige
 *    verificação em duas etapas ativada na conta; a senha normal da conta
 *    NÃO funciona aqui).
 *    SMTP_FROM — remetente exibido (opcional; usa SMTP_USER se vazio).
 *    OWNER_EMAIL — endereço que RECEBE o aviso.
 *
 *  Se as credenciais não estiverem configuradas, ou se o envio falhar, isso
 *  NUNCA deve derrubar a confirmação do pedido: quem chama
 *  `notifyOwnerOfPaidOrder` (server.js) sempre envolve a chamada em
 *  try/catch, do mesmo jeito que já é feito para o aviso de WhatsApp e
 *  para a compra automática da etiqueta de envio.
 * =============================================================================
 */
const nodemailer = require("nodemailer");
const { colorLabelFor, formatCurrency, formatOrderDateTime, deliveryLineFor } = require("./orderFormatting");

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

/**
 * Monta assunto/texto/HTML do e-mail a partir de um pedido já resolvido
 * (itens com nome/quantidade, endereço, total, data do pagamento, link do
 * painel administrativo). Função pura — sem chamada de rede — fácil de
 * ajustar/testar isoladamente.
 */
function formatOrderEmail({ externalReference, items, address, total, paidAt, adminUrl }) {
  const itemLinesText = items
    .map(({ id, qty, name }) => `${qty}x ${name} — cor: ${colorLabelFor(id)}`)
    .join("\n");
  const itemLinesHtml = items
    .map(({ id, qty, name }) => `<li>${qty}x ${escapeHTML(name)} — cor: ${escapeHTML(colorLabelFor(id))}</li>`)
    .join("");

  const subject = `🎀 Novo pedido pago — ${externalReference}`;
  const deliveryLine = deliveryLineFor(address);

  const text = [
    "Novo pedido pago!",
    `Pedido: ${externalReference}`,
    `Data/hora: ${formatOrderDateTime(paidAt)}`,
    "",
    "Itens:",
    itemLinesText,
    "",
    `Total: ${formatCurrency(total)}`,
    "",
    `Cliente: ${address?.nome || "-"}`,
    `Telefone: ${address?.telefone || "-"}`,
    `Entrega: ${deliveryLine || "-"}`,
    "",
    `Ver no painel administrativo: ${adminUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#3a2230;max-width:480px;margin:0 auto">
      <h2 style="color:#c05480;margin-bottom:4px">🎀 Novo pedido pago!</h2>
      <p style="margin:0 0 12px">
        <strong>Pedido:</strong> ${escapeHTML(externalReference)}<br>
        <strong>Data/hora:</strong> ${escapeHTML(formatOrderDateTime(paidAt))}
      </p>
      <p style="margin:0 0 4px"><strong>Itens:</strong></p>
      <ul style="margin:0 0 12px">${itemLinesHtml}</ul>
      <p style="margin:0 0 12px"><strong>Total:</strong> ${escapeHTML(formatCurrency(total))}</p>
      <p style="margin:0 0 16px">
        <strong>Cliente:</strong> ${escapeHTML(address?.nome || "-")}<br>
        <strong>Telefone:</strong> ${escapeHTML(address?.telefone || "-")}<br>
        <strong>Entrega:</strong> ${escapeHTML(deliveryLine || "-")}
      </p>
      <p>
        <a href="${escapeHTML(adminUrl)}" style="display:inline-block;padding:10px 20px;background:#c05480;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">
          Ver no painel administrativo
        </a>
      </p>
    </div>
  `;

  return { subject, text, html };
}

/**
 * Envia um e-mail via SMTP (Nodemailer). Lança erro se as credenciais não
 * estiverem configuradas ou se o envio falhar — quem chama decide o que
 * fazer com isso (server.js sempre envolve em try/catch).
 */
async function sendEmail({ to, subject, text, html }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP não configurado (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS ausentes no .env).");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

/**
 * Ponto de entrada chamado pelo webhook quando um pagamento é aprovado:
 * formata o e-mail e envia para o endereço da lojista (OWNER_EMAIL).
 * Propaga erro (não engole) — quem chama decide como logar/isolar a falha,
 * igual ao padrão já usado em whatsapp.js e purchaseShippingLabel.
 */
async function notifyOwnerOfPaidOrder(order) {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error("OWNER_EMAIL não configurado no .env — e-mail não enviado.");
  }
  const { subject, text, html } = formatOrderEmail(order);
  await sendEmail({ to: ownerEmail, subject, text, html });
}

module.exports = { formatOrderEmail, sendEmail, notifyOwnerOfPaidOrder };
