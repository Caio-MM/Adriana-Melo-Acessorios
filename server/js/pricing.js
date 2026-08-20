
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PLCPricing = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ ⚙️ REGRA DO NEGÓCIO — é aqui que se muda o parcelamento e o desconto. ============ */
  const PAYMENT_RULES = {
    pixDiscountPercent: 5,       
    maxInstallments: 3,          
    interestFreeInstallments: 3, 
    monthlyInterestRate: 0,      
    minInstallmentValue: 5,      
  };

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function formatMoney(n) {
    return "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",");
  }

  function pixDiscountFor(amount) {
    return round2((Number(amount) || 0) * PAYMENT_RULES.pixDiscountPercent / 100);
  }
  function pixPriceFor(amount) {
    return round2((Number(amount) || 0) - pixDiscountFor(amount));
  }

  function installmentValueFor(amount, count) {
    const total = Number(amount) || 0;
    const rate = PAYMENT_RULES.monthlyInterestRate;
    const raw = (count <= PAYMENT_RULES.interestFreeInstallments || rate <= 0)
      ? total / count
      : total * (rate / (1 - Math.pow(1 + rate, -count))); 
    return Math.ceil(raw * 100) / 100;
  }

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

  function installmentLabelFor(amount) {
    const plan = installmentPlanFor(amount);
    if (plan.count <= 1) return `${formatMoney(amount)} à vista no cartão`;
    return `${plan.count}x de ${formatMoney(plan.value)} ${plan.interestFree ? "sem juros" : "com juros"}`;
  }

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
