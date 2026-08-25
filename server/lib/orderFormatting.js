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

const { labelForColor } = require("../js/colors.js");

// Rótulo fixo por id de produto — usado só como fallback para pedidos
// gravados ANTES da escolha de cor existir (items_json sem `color`). Todo
// pedido novo carrega a cor real escolhida pela cliente (ver
// colorLabelForItem abaixo); não adicione produto novo aqui.
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

// Ponto único de resolução do rótulo de cor de um item de pedido: prefere
// a cor real escolhida pela cliente (item.color, um hex de js/colors.js
// OU criado pelo painel administrativo); cai para o rótulo fixo por
// produto só em pedidos antigos, de antes desta escolha existir.
//
// `allColors` é a paleta ATUAL no momento da chamada — fixa (js/colors.js)
// + criada pelo painel (custom_colors) —, passada por quem chama
// (getAllColors() em server.js) em vez de este módulo ler o banco
// diretamente: mantém orderFormatting.js sem I/O, só formatação, igual
// já era antes das cores personalizadas existirem. Sem esse parâmetro (ou
// quando o hex não está mais na paleta — cor apagada depois do pedido),
// cai no labelForColor estático de sempre.
//
// Produtos vendidos em conjunto podem ter uma 2ª cor (item.secondColor) —
// nesse caso o rótulo combina as duas ("Rosa bebê + Rosa pink").
function colorLabelForItem(item, allColors) {
  if (!item?.color) return colorLabelFor(item?.id);
  const resolve = (hex) => allColors?.find((c) => c.hex === hex)?.label || labelForColor(hex);
  const primary = resolve(item.color);
  return item.secondColor ? `${primary} + ${resolve(item.secondColor)}` : primary;
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

// Linha curta de endereço de entrega ("Rua X, 123 · Bairro — Cidade — UF"),
// usada tanto no aviso de WhatsApp quanto no e-mail para a lojista já
// enxergar para onde despachar sem precisar abrir o painel administrativo.
function deliveryLineFor(address) {
  return [
    [address?.rua, address?.numero].filter(Boolean).join(", "),
    [address?.bairro, address?.cidade, address?.uf].filter(Boolean).join(" — "),
  ].filter(Boolean).join(" · ");
}

module.exports = { PRODUCT_COLOR_LABELS, colorLabelFor, colorLabelForItem, formatCurrency, formatOrderDateTime, deliveryLineFor };
