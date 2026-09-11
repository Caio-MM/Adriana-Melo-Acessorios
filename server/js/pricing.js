
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PLCPricing = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  const PROMO_LEVE4_GRUPO = 4;

  /* ⚠️ Ordena por preço para achar o mais barato de cada grupo de 4 — a
     ordem em que os itens foram adicionados ao carrinho não pode mudar
     quem sai grátis, senão duas clientes com o mesmo carrinho recebem
     descontos diferentes. Devolve também quantas unidades de cada produto
     saem grátis (freeQtyById): o servidor precisa disso para separar, na
     preferência do Mercado Pago, as unidades pagas das grátis do mesmo
     produto — cobrar por `unit_price * quantity` numa linha só não permite
     misturar preço cheio e grátis dentro da mesma linha. */
  function promoLeve4Pague3Breakdown(items) {
    const unidades = [];
    (Array.isArray(items) ? items : []).forEach(item => {
      const qty = Math.max(0, Number(item.qty) || 0);
      const price = Number(item.price) || 0;
      for (let k = 0; k < qty; k++) unidades.push({ id: item.id, price });
    });
    unidades.sort((a, b) => b.price - a.price);
    let discount = 0;
    const freeQtyById = new Map();
    for (let i = PROMO_LEVE4_GRUPO - 1; i < unidades.length; i += PROMO_LEVE4_GRUPO) {
      const unidade = unidades[i];
      discount += unidade.price;
      freeQtyById.set(unidade.id, (freeQtyById.get(unidade.id) || 0) + 1);
    }
    return { discount: round2(discount), freeQtyById };
  }

  function promoLeve4Pague3For(items) {
    return promoLeve4Pague3Breakdown(items).discount;
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
    promoLeve4Pague3Breakdown,
    promoLeve4Pague3For,
    installmentValueFor,
    installmentCountFor,
    installmentPlanFor,
    installmentLabelFor,
    paymentSummaryFor,
  };
});
