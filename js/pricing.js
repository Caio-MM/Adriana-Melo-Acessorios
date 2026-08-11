/**
 * =============================================================================
 *  REGRAS DE PREÇO — parcelamento no cartão e desconto do Pix
 * =============================================================================
 *  FONTE ÚNICA das regras de pagamento. Este mesmo arquivo é usado em três
 *  lugares que precisam concordar entre si até o centavo:
 *    1) a vitrine/quick view (js/main.js) — o que o cliente LÊ;
 *    2) o carrinho (js/main.js) — o total que o cliente CONFERE;
 *    3) o checkout (server/server.js, via `require("../js/pricing.js")`) — o
 *       valor que é de fato COBRADO e enviado ao Mercado Pago.
 *
 *  Por que um arquivo só, e não uma cópia em cada lado: um desconto anunciado
 *  na tela do produto que não aparece na cobrança é propaganda enganosa, e é
 *  exatamente o tipo de coisa que se quebra sozinha quando a regra mora em
 *  dois arquivos e alguém edita um deles. Aqui, mudar `PAYMENT_RULES` muda a
 *  vitrine, o carrinho e a cobrança na mesma hora.
 *
 *  O formato UMD abaixo existe só por isso: o mesmo arquivo precisa carregar
 *  como <script> no navegador (expondo `window.PLCPricing`) e como módulo
 *  CommonJS no Node (`module.exports`). Não há segredo nenhum aqui — são
 *  regras públicas, que o cliente vê na tela de qualquer jeito.
 * =============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PLCPricing = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* =========================================================================
     ⚙️ REGRA DO NEGÓCIO — é aqui que se muda o parcelamento e o desconto.
     -------------------------------------------------------------------------
     `maxInstallments` está em 3 porque é o que a loja já anuncia no rodapé do
     site ("Até 3x sem juros"). Para passar a oferecer 10x ou 12x, mude os
     números abaixo — a vitrine, o carrinho, o rodapé e o limite de parcelas
     enviado ao Mercado Pago acompanham sozinhos.

     Se `maxInstallments` > `interestFreeInstallments`, as parcelas acima do
     limite sem juros são calculadas pela Tabela Price usando
     `monthlyInterestRate` (juros ao mês, em decimal: 0.0199 = 1,99% a.m.).
     ⚠️ Nesse caso, configure a MESMA taxa no painel do Mercado Pago
     (Seu negócio > Custos de parcelamento) — quem define o juro efetivamente
     cobrado no cartão é o Mercado Pago, e o valor mostrado aqui só bate com o
     da fatura se as duas configurações forem iguais.
  ========================================================================= */
  const PAYMENT_RULES = {
    pixDiscountPercent: 5,       // desconto à vista no Pix (%)
    maxInstallments: 3,          // máximo de parcelas no cartão de crédito
    interestFreeInstallments: 3, // até quantas parcelas ficam sem juros
    monthlyInterestRate: 0,      // juros ao mês acima do limite sem juros (0 = nunca cobra juros)
    minInstallmentValue: 5,      // valor mínimo de cada parcela (R$)
  };

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // Espaço não separável entre "R$" e o valor: em telas bem estreitas, o
  // preço quebra linha (por causa de outros textos ao lado, como "no Pix"),
  // e um espaço comum deixava o "R$" sozinho numa linha e o valor na
  // seguinte — com   os dois sempre quebram juntos, como uma unidade.
  function formatMoney(n) {
    return "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",");
  }

  /* ------------------------------- PIX ------------------------------- */
  function pixDiscountFor(amount) {
    return round2((Number(amount) || 0) * PAYMENT_RULES.pixDiscountPercent / 100);
  }
  function pixPriceFor(amount) {
    return round2((Number(amount) || 0) - pixDiscountFor(amount));
  }

  /* --------------------------- PARCELAMENTO --------------------------- */
  /* Arredonda a parcela para CIMA (e não para o mais próximo): 49,90/3 dá
     16,6333… — anunciar "16,63" e cobrar 16,64 na primeira parcela seria
     anunciar menos do que se cobra. Com 16,64 o anúncio é sempre ≥ a
     cobrança, e a diferença de centavos fica na última parcela (é assim que
     o Mercado Pago faz a divisão também). */
  function installmentValueFor(amount, count) {
    const total = Number(amount) || 0;
    const rate = PAYMENT_RULES.monthlyInterestRate;
    const raw = (count <= PAYMENT_RULES.interestFreeInstallments || rate <= 0)
      ? total / count
      : total * (rate / (1 - Math.pow(1 + rate, -count))); // Tabela Price
    return Math.ceil(raw * 100) / 100;
  }

  /* Maior número de parcelas permitido para este valor: começa no máximo da
     regra e desce até a parcela alcançar `minInstallmentValue` — sem isso um
     laço de R$ 29,90 seria oferecido em "3x de R$ 9,97", parcelas pequenas
     demais para valer a tarifa de cada cobrança. */
  function installmentCountFor(amount) {
    const total = Number(amount) || 0;
    if (total <= 0) return 1;
    let count = Math.max(1, PAYMENT_RULES.maxInstallments);
    while (count > 1 && installmentValueFor(total, count) < PAYMENT_RULES.minInstallmentValue) count--;
    return count;
  }

  function installmentPlanFor(amount) {
    const total = Number(amount) || 0;
    const count = installmentCountFor(total);
    const value = installmentValueFor(total, count);
    return {
      count,
      value,
      interestFree: count <= PAYMENT_RULES.interestFreeInstallments || PAYMENT_RULES.monthlyInterestRate <= 0,
      totalWithInterest: round2(count <= PAYMENT_RULES.interestFreeInstallments ? total : value * count),
    };
  }

  /* Texto pronto ("3x de R$ 16,64 sem juros"), usado na vitrine, na quick
     view e no carrinho — para os três dizerem exatamente a mesma coisa. */
  function installmentLabelFor(amount) {
    const plan = installmentPlanFor(amount);
    if (plan.count <= 1) return `${formatMoney(amount)} à vista no cartão`;
    return `${plan.count}x de ${formatMoney(plan.value)} ${plan.interestFree ? "sem juros" : "com juros"}`;
  }

  /* Resumo completo de um valor, do jeito que as telas precisam mostrar. */
  function paymentSummaryFor(amount) {
    const total = round2(amount);
    return {
      price: total,
      pixPrice: pixPriceFor(total),
      pixSavings: pixDiscountFor(total),
      pixDiscountPercent: PAYMENT_RULES.pixDiscountPercent,
      installment: installmentPlanFor(total),
      installmentLabel: installmentLabelFor(total),
    };
  }

  return {
    PAYMENT_RULES,
    round2,
    formatMoney,
    pixDiscountFor,
    pixPriceFor,
    installmentValueFor,
    installmentCountFor,
    installmentPlanFor,
    installmentLabelFor,
    paymentSummaryFor,
  };
});
