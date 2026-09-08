/**
 * =============================================================================
 *  FORMATAÇÃO COMPARTILHADA DE PEDIDOS
 * =============================================================================
 *  Moeda, data/hora e linha de endereço usados tanto pelo aviso de WhatsApp
 *  (server/whatsapp.js) quanto pelo e-mail (server/email.js) e pelo painel
 *  administrativo (server/server.js) — centralizado aqui para não duplicar
 *  a mesma formatação em três lugares.
 * =============================================================================
 */

function formatCurrency(value) {
  return `R$ ${Number(value ?? 0).toFixed(2).replace(".", ",")}`;
}

function formatOrderDateTime(dateInput) {
  return new Date(dateInput).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

// Linha curta de endereço de entrega ("Rua X, 123 · Bairro — Cidade — UF"),
// usada tanto no aviso de WhatsApp quanto no e-mail para a lojista já
// enxergar para onde despachar sem precisar abrir o painel administrativo.
function deliveryLineFor(address) {
  return [
    [address?.rua, address?.numero].filter(Boolean).join(", "),
    [address?.bairro, address?.cidade, address?.uf].filter(Boolean).join(" — "),
  ].filter(Boolean).join(" · ");
}

module.exports = { formatCurrency, formatOrderDateTime, deliveryLineFor };
