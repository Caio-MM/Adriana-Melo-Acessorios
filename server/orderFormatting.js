/**
 * =============================================================================
 *  FORMATAÇÃO COMPARTILHADA DE PEDIDOS
 * =============================================================================
 *  Nome da cor, moeda e data/hora usados tanto pelo aviso de WhatsApp
 *  (server/whatsapp.js) quanto pelo e-mail (server/email.js) e pelo painel
 *  administrativo (server/server.js) — centralizado aqui para não duplicar
 *  a mesma lista/formatação em três lugares.
 * =============================================================================
 */

// Nome amigável para a cor "de catálogo" de cada laço (mesmas cores usadas
// como swatch em js/main.js). Ajuste os textos aqui se os nomes não
// baterem com os nomes reais das cores da loja.
const PRODUCT_COLOR_LABELS = {
  1: "Rosa bebê",
  2: "Rosa pink",
  3: "Rosa clarinho",
  4: "Rosa perolado",
  5: "Rosa chiclete",
  6: "Mix de rosas",
  7: "Rosa bebê",
  8: "Rosa pink",
};

function colorLabelFor(productId) {
  return PRODUCT_COLOR_LABELS[productId] || "cor padrão do catálogo";
}

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

module.exports = { PRODUCT_COLOR_LABELS, colorLabelFor, formatCurrency, formatOrderDateTime };
