
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PLCColors = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ PALETA DE CORES DE LAÇO — fonte única de verdade ============
     Mesmos 6 hex que já eram usados espalhados em js/main.js (tinta
     decorativa por produto e CUSTOM_PRODUCT_PALETTE) e em
     lib/orderFormatting.js (rótulos fixos por id) — consolidados aqui
     para virar uma escolha real da cliente. Não mude os valores de hex
     sem migrar pedidos antigos que os referenciam (orders.items_json). */
  const RIBBON_COLORS = [
    { hex: "#F4B4CC", label: "Rosa bebê" },
    { hex: "#DD6E9B", label: "Rosa pink" },
    { hex: "#FBEAF0", label: "Rosa clarinho" },
    { hex: "#F8ECF1", label: "Branco perolado" },
    { hex: "#EA8FB4", label: "Rosa chiclete" },
    { hex: "#C05480", label: "Rosa profundo" },
  ];

  const ALL_COLOR_HEXES = RIBBON_COLORS.map(c => c.hex);
  const VALID_HEXES = new Set(ALL_COLOR_HEXES);

  function isValidColor(hex) {
    return typeof hex === "string" && VALID_HEXES.has(hex);
  }

  function labelForColor(hex) {
    const match = RIBBON_COLORS.find(c => c.hex === hex);
    return match ? match.label : "cor padrão do catálogo";
  }

  return { RIBBON_COLORS, ALL_COLOR_HEXES, isValidColor, labelForColor };
});
