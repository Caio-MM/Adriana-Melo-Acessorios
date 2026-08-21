(function(){
  "use strict";

  /* ============ CATÁLOGO (somente para EXIBIÇÃO no front-end) ============ */
  const products = [
    { id:1, name:"Laço Bailarina", cat:"dia-a-dia", catLabel:"Dia a dia", price:34.90, color:"#F4B4CC", rating:5, badges:[], desc:"Laço em cetim rosa bebê, leve e confortável para o dia a dia." },
    { id:2, name:"Laço Duquesa", cat:"festa", catLabel:"Festa", price:49.90, color:"#DD6E9B", rating:5, badges:["Mais vendido"], desc:"Cetim duplo com volume extra, perfeito para festas e ensaios." },
    { id:3, name:"Laço Recém-nascida", cat:"maternidade", catLabel:"Maternidade", price:29.90, color:"#FBEAF0", rating:5, badges:[], desc:"Presilha macia em algodão, indicada para os primeiros meses." },
    { id:4, name:"Laço Pérola", cat:"batizado", catLabel:"Batizado", price:59.90, color:"#F8ECF1", rating:5, badges:[], desc:"Detalhes em pérolas para o dia especial do batizado." },
    { id:5, name:"Laço Borboleta", cat:"festa", catLabel:"Festa", price:44.90, color:"#EA8FB4", rating:4, badges:[], desc:"Formato de borboleta com fita de organza, ideal para festas infantis." },
    { id:6, name:"Kit Presente 3 Laços", cat:"presente", catLabel:"Presente", price:89.90, color:"#C05480", rating:5, badges:["Novo"], desc:"Trio de laços em tons de rosa, embalado em caixa para presente." },
    { id:7, name:"Laço Tiara Flor", cat:"dia-a-dia", catLabel:"Dia a dia", price:39.90, color:"#F4B4CC", rating:4, badges:[], desc:"Tiara macia com flor de tecido, confortável para uso prolongado." },
    { id:8, name:"Laço Personalizado", cat:"presente", catLabel:"Presente", price:64.90, color:"#DD6E9B", rating:5, badges:["Novo"], desc:"Bordado com o nome que você escolher, embalagem para presente." },
  ];

  /* ============ SEGURANÇA — SANITIZAÇÃO ============ */
  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  const productsById = new Map(products.map(p => [p.id, p]));

  const CUSTOM_PRODUCT_PALETTE = ["#F4B4CC", "#DD6E9B", "#FBEAF0", "#F8ECF1", "#EA8FB4", "#C05480"];

  const pricing = window.PLCPricing;
  const formatMoney = pricing.formatMoney;

  function imageFor(p){
    return p.image || "";
  }

  let cartCount = 0;
  let currentFilter = "todos";

  const grid = document.getElementById("productsGrid");
  const cartCountEl = document.getElementById("cartCount");
  const cartCountMobileEl = document.getElementById("cartCountMobile");
  const cartToast = new bootstrap.Toast(document.getElementById("cartToast"));
  const checkoutHintToastEl = document.getElementById("checkoutHintToast");
  const checkoutHintToastBody = document.getElementById("checkoutHintToastBody");
  const checkoutHintToast = new bootstrap.Toast(checkoutHintToastEl, { delay: 4000 });
  function showCheckoutHintToast(text){
    checkoutHintToastBody.textContent = text;
    checkoutHintToast.show();
  }
  const cartPillEl = document.querySelector(".cart-pill");

  /* ============ REVEAL ON SCROLL — fade/slide-up sutil para seções e cards conforme ============ */
  const revealObserver = ("IntersectionObserver" in window)
    ? new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if(entry.isIntersecting){
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -10% 0px" })
    : null;

  function observeReveal(root){
    (root || document).querySelectorAll(".reveal:not(.is-visible)").forEach(el => {
      if(revealObserver) revealObserver.observe(el);
      else el.classList.add("is-visible"); 
    });
  }
  observeReveal(); 

  /* ============ ANIMAÇÃO "ADICIONAR AO CARRINHO" — três efeitos combinados, disparados ============ */
  function bumpCartIcon(){
    if(!cartPillEl) return;
    cartPillEl.classList.remove("is-bumped");
    void cartPillEl.offsetWidth; 
    cartPillEl.classList.add("is-bumped");
    cartPillEl.addEventListener("animationend", () => cartPillEl.classList.remove("is-bumped"), { once: true });
  }

  function flyToCart(originEl, color){
    if(!cartPillEl || !originEl) return;
    const start = originEl.getBoundingClientRect();
    const end = cartPillEl.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.className = "fly-dot";
    dot.style.background = color || "var(--blush-600)";
    dot.style.transform = `translate(${start.left + start.width / 2 - 7}px, ${start.top + start.height / 2 - 7}px)`;
    document.body.appendChild(dot);

    requestAnimationFrame(() => {
      const x = end.left + end.width / 2 - 7;
      const y = end.top + end.height / 2 - 7;
      dot.style.transform = `translate(${x}px, ${y}px) scale(.3)`;
      dot.style.opacity = "0";
    });

    const cleanup = () => dot.remove();
    dot.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 900); 
  }

  function pulseAddButton(btn){
    const icon = btn?.querySelector("i");
    if(!icon) return;

    if(btn.classList.contains("is-added")) return;
    const original = icon.className;
    btn.classList.add("is-added");
    icon.className = "bi bi-check-lg";
    setTimeout(() => {
      btn.classList.remove("is-added");
      icon.className = original;
    }, 900);
  }

  function celebrateAddToCart(originEl, color){
    flyToCart(originEl, color);
    bumpCartIcon();
  }

  function stars(n){
    let s = "";
    for(let i=1;i<=5;i++){ s += `<i class="bi ${i<=n ? 'bi-star-fill':'bi-star'}"></i>`; }
    return s;
  }

  function wireImage(imgEl){
    imgEl.addEventListener("load", () => {
      imgEl.classList.add("is-loaded");
      imgEl.closest(".product-thumb, .cart-item-thumb, .qv-thumb")?.classList.remove("is-loading");
    });
    imgEl.addEventListener("error", () => {
      imgEl.classList.add("is-error");
      imgEl.closest(".product-thumb, .cart-item-thumb, .qv-thumb")?.classList.remove("is-loading");
    });
  }

  function renderProducts(){
    const list = currentFilter === "todos" ? products : products.filter(p => p.cat === currentFilter);
    grid.innerHTML = list.map((p, i) => {
      const pay = pricing.paymentSummaryFor(p.price);
      const photo = imageFor(p);
      return `
      <div class="col-6 col-md-4 col-lg-3 reveal reveal-delay-${i % 4}">
        <div class="product-card${p.badges?.length ? " is-featured" : ""}" data-id="${p.id}">
          <div class="product-thumb${photo ? " is-loading" : ""}" style="background:${p.color}22">
            ${p.badges?.length ? `<div class="product-badges">${p.badges.map(b => `<span class="product-badge">${escapeHTML(b)}</span>`).join("")}</div>` : ""}
            <button type="button" class="product-quickview" aria-label="Ver detalhes de ${escapeHTML(p.name)}"><i class="bi bi-eye"></i></button>
            ${photo ? `<img
              src="${escapeHTML(photo)}"
              alt="${escapeHTML(p.name)} — ${escapeHTML(p.catLabel)}"
              width="600" height="600"
              loading="lazy" decoding="async">` : ""}
            <svg class="bow-icon" style="color:${p.color}; position:absolute"><use href="#bow-shape"/></svg>
          </div>
          <div class="product-body">
            <div class="product-cat">${escapeHTML(p.catLabel)}</div>
            <div class="product-name">${escapeHTML(p.name)}</div>
            <div class="product-stars mb-2">${stars(p.rating)}</div>
            <div class="d-flex align-items-end justify-content-between gap-2">
              <div class="product-pricing">
                <span class="product-price">${formatMoney(p.price)}</span>
                <span class="product-pix">${formatMoney(pay.pixPrice)} <small>no Pix</small></span>
                <span class="product-installment">ou ${escapeHTML(pay.installmentLabel)}</span>
              </div>
              <button class="btn-add flex-shrink-0" data-id="${p.id}" aria-label="Adicionar ${escapeHTML(p.name)} ao carrinho"><i class="bi bi-plus-lg"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;
    }).join("");
    grid.querySelectorAll(".product-thumb img").forEach(wireImage);
    observeReveal(grid);
  }
  renderProducts();



  function categoryLabelFor(catSlug){
    const chip = document.querySelector(`#filterGroup .chip[data-cat="${CSS.escape(catSlug)}"]`);
    return chip ? chip.textContent.trim() : catSlug;
  }
  function sameBadges(a, b){
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function ensureCategoryChips(categories){
    const group = document.getElementById("filterGroup");
    (Array.isArray(categories) ? categories : []).forEach(c => {
      if(!c?.slug || group.querySelector(`.chip[data-cat="${CSS.escape(c.slug)}"]`)) return;
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.dataset.cat = c.slug;
      chip.textContent = c.label || c.slug;
      group.appendChild(chip);
    });
  }

  async function loadProductOverrides(){
    try{
      const res = await fetch("/api/products");
      if(!res.ok) return;
      const data = await res.json();
      ensureCategoryChips(data.categories);
      let changed = false;
      (Array.isArray(data.products) ? data.products : []).forEach(o => {
        const p = productsById.get(o.id);
        if(!p){
          if(!o.name || o.price == null) return;
          const fresh = {
            id: o.id, name: o.name, price: o.price,
            cat: o.category || "", catLabel: o.category ? categoryLabelFor(o.category) : "",
            color: CUSTOM_PRODUCT_PALETTE[o.id % CUSTOM_PRODUCT_PALETTE.length],
            rating: 5, badges: Array.isArray(o.badges) ? o.badges : [],
            desc: "Peça exclusiva, feita à mão pela Adriana Melo Acessórios.",
            image: o.photoUrl || null,
          };
          products.push(fresh);
          productsById.set(o.id, fresh);
          changed = true;
          return;
        }
        if(o.name && o.name !== p.name){ p.name = o.name; changed = true; }
        if(o.price != null && o.price !== p.price){ p.price = o.price; changed = true; }
        if(o.photoUrl && o.photoUrl !== p.image){ p.image = o.photoUrl; changed = true; }
        if(o.category && o.category !== p.cat){
          p.cat = o.category;
          p.catLabel = categoryLabelFor(o.category);
          changed = true;
        }
        if(Array.isArray(o.badges) && !sameBadges(o.badges, p.badges || [])){
          p.badges = o.badges;
          changed = true;
        }
      });
      if(changed){ renderProducts(); renderCart(); }
      verifyPaymentRules(data.paymentRules);
    }catch(err){
      console.warn("Não foi possível verificar atualizações do catálogo:", err);
    }
  }

  const PRICING_RELOAD_KEY = "plc_pricing_reloaded";
  function verifyPaymentRules(serverRules){
    if(!serverRules) return;
    const same = Object.keys(pricing.PAYMENT_RULES)
      .every(k => serverRules[k] === pricing.PAYMENT_RULES[k]);
    if(same){ sessionStorage.removeItem(PRICING_RELOAD_KEY); return; }
    if(sessionStorage.getItem(PRICING_RELOAD_KEY)){
      console.error("Regras de pagamento do servidor continuam diferentes das do navegador após recarregar.", serverRules);
      return;
    }
    sessionStorage.setItem(PRICING_RELOAD_KEY, "1");
    window.location.reload();
  }

  loadProductOverrides();

  document.getElementById("filterGroup").addEventListener("click", function(e){
    const btn = e.target.closest(".chip");
    if(!btn) return;
    document.querySelectorAll("#filterGroup .chip").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.cat;
    renderProducts();
  });

  /* ============ CARRINHO ============ */
  const CART_KEY = "plc_cart_v1";

  function loadCart(){
    try{
      const raw = localStorage.getItem(CART_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(parsed)) return [];
      return parsed
        .filter(i => i && Number.isInteger(i.id) && Number.isInteger(i.qty))
        .map(i => ({ id:i.id, qty: Math.min(10, Math.max(1, i.qty)) }));
    }catch(err){
      console.warn("Carrinho salvo estava corrompido, começando vazio.", err);
      return [];
    }
  }

  function saveCart(){
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  let cart = loadCart();

  function findProduct(id){
    return productsById.get(id);
  }

  function cartTotalQty(){
    return cart.reduce((sum, i) => sum + i.qty, 0);
  }

  function cartSubtotal(){
    return cart.reduce((sum, i) => {
      const p = findProduct(i.id);
      return p ? sum + p.price * i.qty : sum;
    }, 0);
  }

  function updateCartBadges(){
    const n = cartTotalQty();
    cartCountEl.textContent = n;
    if(cartCountMobileEl) cartCountMobileEl.textContent = n;
  }

  function patchCartItemQty(id, qty){
    const row = cartItemsList.querySelector(`.cart-item[data-id="${id}"]`);
    if(!row) return false;
    const qtyEl = row.querySelector(".cart-qty span");
    if(qtyEl) qtyEl.textContent = qty;
    return true;
  }

  const PENDING_ITEM_KEY = "plc_item_pendente";

  function addToCart(id, qty){


    if(!currentUser){
      try{
        sessionStorage.setItem(PENDING_ITEM_KEY, JSON.stringify({ id, qty }));
      }catch(err){
        console.warn("Não foi possível guardar o item pendente:", err);
      }



      if(!sessionChecked){
        redirectAoSaberDaSessao = true;
        return;
      }
      window.location.href = "conta.html?retorno=carrinho";
      return;
    }

    const existing = cart.find(i => i.id === id);
    if(existing){
      existing.qty = Math.min(10, existing.qty + qty);
      saveCart();
      updateCartBadges();
      if(patchCartItemQty(id, existing.qty)){
        resetShipping();
        updateTotals();
      } else {
        renderCart();
      }
    } else {
      cart.push({ id, qty: Math.min(10, Math.max(1, qty)) });
      saveCart();
      updateCartBadges();
      renderCart(); 
    }
    cartToast.show();
  }

  function removeFromCart(id){
    cart = cart.filter(i => i.id !== id);
    saveCart();
    updateCartBadges();
    renderCart(); 
  }

  function setQty(id, qty){
    const item = cart.find(i => i.id === id);
    if(!item) return;
    item.qty = Math.min(10, Math.max(1, qty));
    saveCart();
    updateCartBadges();
    patchCartItemQty(id, item.qty);
    resetShipping();
    updateTotals();
  }

  const cartItemsList = document.getElementById("cartItemsList");
  const cartEmptyState = document.getElementById("cartEmptyState");
  const cartRecommendationsEl = document.getElementById("cartRecommendations");
  const cartRecsListEl = document.getElementById("cartRecsList");
  const cartSubtotalEl = document.getElementById("cartSubtotal");
  const cartDiscountRow = document.getElementById("cartDiscountRow");
  const cartCouponCodeEl = document.getElementById("cartCouponCode");
  const cartDiscountEl = document.getElementById("cartDiscount");
  const cartPixRow = document.getElementById("cartPixRow");
  const cartPixPercentEl = document.getElementById("cartPixPercent");
  const cartPixDiscountEl = document.getElementById("cartPixDiscount");
  const cartShippingPriceEl = document.getElementById("cartShippingPrice");
  const cartTotalEl = document.getElementById("cartTotal");
  const cartInstallmentNoteEl = document.getElementById("cartInstallmentNote");
  const payMethodGroupEl = document.getElementById("payMethodGroup");
  const pmPixPriceEl = document.getElementById("pmPixPrice");
  const pmPixNoteEl = document.getElementById("pmPixNote");
  const pmCardPriceEl = document.getElementById("pmCardPrice");
  const pmCardNoteEl = document.getElementById("pmCardNote");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");
  const cartLoginNotice = document.getElementById("cartLoginNotice");
  const couponInput = document.getElementById("couponInput");
  const couponApplyBtn = document.getElementById("couponApplyBtn");
  const couponMsgEl = document.getElementById("couponMsg");

  let shipping = null; 

  let currentUser = null;

  let sessionChecked = false;
  let redirectAoSaberDaSessao = false;

  let coupon = null; 

  function currentDiscount(subtotal){
    return coupon ? Math.round(subtotal * coupon.percentOff / 100 * 100) / 100 : 0;
  }

  let paymentMethod = "pix";

  function updateTotals(){
    const subtotal = cartSubtotal();
    const discount = currentDiscount(subtotal);
    cartSubtotalEl.textContent = formatMoney(subtotal);

    if(discount > 0){
      cartDiscountRow.classList.remove("d-none");
      cartCouponCodeEl.textContent = `(${coupon.code})`;
      cartDiscountEl.textContent = "-" + formatMoney(discount);
    } else {
      cartDiscountRow.classList.add("d-none");
    }

    const afterCoupon = pricing.round2(subtotal - discount);
    const pixDiscount = pricing.pixDiscountFor(afterCoupon);
    const shippingPrice = shipping ? shipping.price : 0;



    pmPixPriceEl.textContent = formatMoney(afterCoupon - pixDiscount + shippingPrice);
    pmPixNoteEl.textContent = `${pricing.PAYMENT_RULES.pixDiscountPercent}% de desconto · ${formatMoney(pixDiscount)} a menos`;
    pmCardPriceEl.textContent = formatMoney(afterCoupon + shippingPrice);
    pmCardNoteEl.textContent = pricing.installmentPlanFor(afterCoupon + shippingPrice).count > 1
      ? `em até ${pricing.installmentLabelFor(afterCoupon + shippingPrice)}`
      : "à vista";

    const isPix = paymentMethod === "pix";
    cartPixRow.classList.toggle("d-none", !isPix || pixDiscount <= 0);
    cartPixPercentEl.textContent = `(${pricing.PAYMENT_RULES.pixDiscountPercent}%)`;
    cartPixDiscountEl.textContent = "-" + formatMoney(pixDiscount);

    const total = pricing.round2(afterCoupon - (isPix ? pixDiscount : 0) + shippingPrice);
    cartShippingPriceEl.textContent = shipping ? formatMoney(shipping.price) : "a calcular";
    cartTotalEl.textContent = formatMoney(total);

    const plan = pricing.installmentPlanFor(total);
    cartInstallmentNoteEl.textContent = (!isPix && plan.count > 1)
      ? `ou ${pricing.installmentLabelFor(total)} no cartão`
      : "";



    const pendente = checkoutBlockInfo();
    checkoutBtn.disabled = cart.length === 0;
    checkoutBtn.classList.toggle("is-pending", !!pendente);

    renderCheckoutHint(pendente);
  }

  function checkoutBlockInfo(){
    if(!currentUser || cart.length === 0) return null;
    if(!shipping){
      return { icon: "bi-truck", text: "Informe seu CEP e calcule o frete para liberar o pagamento." };
    }
    const faltando = missingAddressFields();
    if(faltando.length > 0){
      return { icon: "bi-geo-alt", text: `Falta preencher ${faltando.join(", ")} para liberar o pagamento.` };
    }
    return null;
  }

  function renderCheckoutHint(pendente){
    checkoutMsg.innerHTML = pendente ? `<i class="bi ${pendente.icon}"></i> ${pendente.text}` : "";
  }

  function renderAuthGate(){
    const loggedOut = !currentUser;
    cartLoginNotice?.classList.toggle("d-none", !loggedOut);
    checkoutBtn.innerHTML = loggedOut
      ? `<i class="bi bi-box-arrow-in-right"></i> Entrar para finalizar`
      : `<i class="bi bi-lock-fill"></i> Ir para pagamento`;
  }
  document.addEventListener("plc:auth", (e) => {
    currentUser = e.detail.user;
    sessionChecked = true;
    renderAuthGate();

    prefillFromAccount();

    if(!currentUser && redirectAoSaberDaSessao){
      window.location.href = "conta.html?retorno=carrinho";
      return;
    }
    resgatarItemPendente();
    updateTotals();
  });

  function resgatarItemPendente(){
    if(!currentUser) return;
    let pendente = null;
    try{
      pendente = JSON.parse(sessionStorage.getItem(PENDING_ITEM_KEY) || "null");
    }catch(err){
      console.warn("Item pendente ilegível:", err);
    }

    sessionStorage.removeItem(PENDING_ITEM_KEY);
    if(pendente?.id) addToCart(Number(pendente.id), Number(pendente.qty) || 1);
  }
  renderAuthGate();

  const gatewayTextEl = document.getElementById("cartGatewayText");

  function syncPayMethodSelection(){
    payMethodGroupEl.querySelectorAll(".pay-method").forEach(label => {
      label.classList.toggle("selected", label.querySelector("input").checked);
    });

    if(gatewayTextEl){
      gatewayTextEl.innerHTML = paymentMethod === "pix"
        ? `Você paga com o QR code aqui mesmo, <strong>sem sair do site</strong>.`
        : `Você conclui a compra no <strong>Mercado Pago</strong>, com segurança.`;
    }
  }
  payMethodGroupEl.addEventListener("change", (e) => {
    const input = e.target.closest("input[name='payMethod']");
    if(!input) return;
    paymentMethod = input.value === "pix" ? "pix" : "card";
    syncPayMethodSelection();
    updateTotals();
  });
  syncPayMethodSelection();

  function resetShipping(){
    shipping = null;
    document.getElementById("shippingOptions").innerHTML = "";
    document.getElementById("addressFields").classList.add("d-none");
    document.getElementById("shippingMsg").textContent = cart.length
      ? "Informe seu CEP para ver as opções de entrega."
      : "";
  }

  function resetCoupon(){
    coupon = null;
    if(couponInput) couponInput.value = "";
    if(couponMsgEl) couponMsgEl.textContent = "";
  }

  function renderCart(){

    const checkoutPanel = document.getElementById("cartCheckoutPanel");
    checkoutPanel?.classList.toggle("d-none", cart.length === 0);

    if(cart.length === 0){
      cartItemsList.innerHTML = "";
      cartEmptyState.classList.remove("d-none");
      resetCoupon();
    } else {
      cartEmptyState.classList.add("d-none");
      cartItemsList.innerHTML = cart.map(item => {
        const p = findProduct(item.id);
        if(!p) return "";
        const photo = imageFor(p);
        return `
          <div class="cart-item" data-id="${p.id}">
            <div class="cart-item-thumb${photo ? " is-loading" : ""}" style="background:${p.color}22">
              ${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(p.name)}" width="64" height="64" loading="lazy" decoding="async">` : ""}
              <svg class="bow-icon" style="color:${p.color}"><use href="#bow-shape"/></svg>
            </div>
            <div class="cart-item-body">
              <div class="cart-item-head">
                <span class="cart-item-name">${escapeHTML(p.name)}</span>
                <span class="cart-item-price">${formatMoney(p.price)}<small>un.</small></span>
              </div>
              <div class="cart-item-controls">
                <div class="cart-qty">
                  <button type="button" class="cart-qty-minus" aria-label="Diminuir quantidade">−</button>
                  <span>${item.qty}</span>
                  <button type="button" class="cart-qty-plus" aria-label="Aumentar quantidade">+</button>
                </div>
                <button type="button" class="cart-item-remove" aria-label="Remover ${escapeHTML(p.name)}"><i class="bi bi-trash3"></i></button>
              </div>
            </div>
          </div>
        `;
      }).join("");
      cartItemsList.querySelectorAll(".cart-item-thumb img").forEach(wireImage);
    }
    renderCartRecommendations();
    resetShipping();

    checkoutMsg.classList.remove("show");
    checkoutMsg.innerHTML = "";
    updateTotals();
  }

  /* ============ CROSS-SELL NO CARRINHO ("Complete seu pedido") ============ */
  function pickCartRecommendations(){
    const inCartIds = new Set(cart.map(i => i.id));
    const inCartCats = new Set(cart.map(i => findProduct(i.id)?.cat).filter(Boolean));
    const candidates = products.filter(p => !inCartIds.has(p.id));
    const byBadgeFirst = (a, b) => (b.badges?.length ? 1 : 0) - (a.badges?.length ? 1 : 0);

    const otherCategories = candidates.filter(p => !inCartCats.has(p.cat)).sort(byBadgeFirst);
    const sameCategory = candidates.filter(p => inCartCats.has(p.cat)).sort(byBadgeFirst);
    return [...otherCategories, ...sameCategory].slice(0, 2);
  }

  function renderCartRecommendations(){
    const recs = cart.length ? pickCartRecommendations() : [];
    if(!recs.length){
      cartRecommendationsEl.classList.add("d-none");
      return;
    }
    cartRecommendationsEl.classList.remove("d-none");
    cartRecsListEl.innerHTML = recs.map(p => {
      const photo = imageFor(p);
      return `
      <div class="cart-rec-item" data-id="${p.id}">
        <div class="cart-rec-thumb" style="background:${p.color}22">
          ${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(p.name)}" width="44" height="44" loading="lazy" decoding="async">` : ""}
          <svg class="bow-icon" style="color:${p.color}"><use href="#bow-shape"/></svg>
        </div>
        <div class="flex-grow-1">
          <div class="cart-rec-name">${escapeHTML(p.name)}</div>
          <div class="cart-rec-price">${formatMoney(p.price)}</div>
        </div>
        <button type="button" class="cart-rec-add" data-id="${p.id}" aria-label="Adicionar ${escapeHTML(p.name)} ao carrinho"><i class="bi bi-plus-lg"></i></button>
      </div>
    `;
    }).join("");
    cartRecsListEl.querySelectorAll(".cart-rec-thumb img").forEach(wireImage);
  }

  cartRecsListEl.addEventListener("click", function(e){
    const btn = e.target.closest(".cart-rec-add");
    if(!btn) return;
    addToCart(Number(btn.dataset.id), 1);
    bumpCartIcon(); 
  });

  cartItemsList.addEventListener("click", function(e){
    const row = e.target.closest(".cart-item");
    if(!row) return;
    const id = Number(row.dataset.id);

    const item = cart.find(i => i.id === id);
    if(e.target.closest(".cart-qty-plus")){
      if(item) setQty(id, item.qty + 1);
    } else if(e.target.closest(".cart-qty-minus")){
      if(!item || item.qty <= 1){ removeFromCart(id); } else { setQty(id, item.qty - 1); }
    } else if(e.target.closest(".cart-item-remove")){
      removeFromCart(id);
    }
  });

  updateCartBadges();

  /* ============ FRETE — MELHOR ENVIO ============ */
  const cepInput = document.getElementById("cepInput");
  const calcShippingBtn = document.getElementById("calcShippingBtn");
  const shippingMsgEl = document.getElementById("shippingMsg");
  const shippingOptionsEl = document.getElementById("shippingOptions");
  const addressFieldsEl = document.getElementById("addressFields");
  const addrInputs = {
    nome: document.getElementById("addrNome"),
    telefone: document.getElementById("addrTelefone"),
    rua: document.getElementById("addrRua"),
    numero: document.getElementById("addrNumero"),
    complemento: document.getElementById("addrComplemento"),
    bairro: document.getElementById("addrBairro"),
    cidade: document.getElementById("addrCidade"),
    uf: document.getElementById("addrUf"),
  };

  function getAddress(){
    return {
      nome: addrInputs.nome.value.trim(),
      telefone: addrInputs.telefone.value.trim(),
      rua: addrInputs.rua.value.trim(),
      numero: addrInputs.numero.value.trim(),
      complemento: addrInputs.complemento.value.trim(),
      bairro: addrInputs.bairro.value.trim(),
      cidade: addrInputs.cidade.value.trim(),
      uf: addrInputs.uf.value.trim(),
    };
  }

  const ADDRESS_FIELD_LABELS = {
    nome: "Nome",
    telefone: "Telefone",
    rua: "Rua",
    numero: "Número",
    bairro: "Bairro",
    cidade: "Cidade",
    uf: "UF",
  };

  function missingAddressFields(){
    const a = getAddress();
    return Object.keys(ADDRESS_FIELD_LABELS).filter(key => !a[key]).map(key => ADDRESS_FIELD_LABELS[key]);
  }

  function isAddressComplete(){
    return missingAddressFields().length === 0;
  }

  let addressValidationAttempted = false;

  function markInvalidAddressFields(){
    if(!addressValidationAttempted) return;
    const a = getAddress();
    Object.keys(ADDRESS_FIELD_LABELS).forEach(key => {
      addrInputs[key].classList.toggle("is-invalid", !a[key]);
    });
  }

  function prefillFromAccount(){
    if(!currentUser) return;
    if(currentUser.name && !addrInputs.nome.value.trim()){
      addrInputs.nome.value = currentUser.name;
    }
    if(currentUser.cep && !cepInput.value.trim()){
      const d = String(currentUser.cep).replace(/\D/g, "").slice(0, 8);
      cepInput.value = d.length > 5 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
    }
  }

  async function autofillAddress(cep){
    try{
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if(data.erro) return;
      if(!addrInputs.rua.value) addrInputs.rua.value = data.logradouro || "";
      if(!addrInputs.bairro.value) addrInputs.bairro.value = data.bairro || "";
      if(!addrInputs.cidade.value) addrInputs.cidade.value = data.localidade || "";
      if(!addrInputs.uf.value) addrInputs.uf.value = data.uf || "";
    }catch(err){
      console.warn("Não foi possível autopreencher o endereço:", err);
    }
  }

  Object.values(addrInputs).forEach(el => el.addEventListener("input", () => {
    updateTotals();
    markInvalidAddressFields();
  }));

  cepInput.addEventListener("input", () => {

    let v = cepInput.value.replace(/\D/g, "").slice(0, 8);
    if(v.length > 5) v = v.slice(0,5) + "-" + v.slice(5);
    cepInput.value = v;
  });

  function isValidCep(v){
    return /^\d{5}-?\d{3}$/.test(v);
  }

  async function calcShipping(){
    const cep = cepInput.value.trim();
    if(!isValidCep(cep)){
      shippingMsgEl.textContent = "Digite um CEP válido (8 dígitos).";
      return;
    }
    if(cart.length === 0) return;

    calcShippingBtn.disabled = true;
    shippingOptionsEl.innerHTML = "";
    addressFieldsEl.classList.add("d-none");
    shippingMsgEl.textContent = "Calculando opções de entrega...";
    shipping = null;
    updateTotals();

    try{
      const res = await fetchWithTimeout("/api/calculate-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cep: cep.replace("-", ""),
          items: cart.map(i => ({ id: i.id, qty: i.qty }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || `Erro inesperado (HTTP ${res.status}).`);
      if(!Array.isArray(data.options) || data.options.length === 0){
        shippingMsgEl.textContent = "Nenhuma opção de entrega encontrada para esse CEP.";
        return;
      }
      shippingMsgEl.textContent = "Escolha uma opção de entrega:";
      shippingOptionsEl.innerHTML = data.options.map((opt, i) => `
        <label class="shipping-option" data-index="${i}">
          <input type="radio" name="shippingOption" value="${i}">
          <span>
            <span class="so-name d-block">${escapeHTML(opt.name)}</span>
            <span class="so-days">${escapeHTML(opt.delivery_time)}</span>
          </span>
          <span class="so-price">${formatMoney(opt.price)}</span>
        </label>
      `).join("");

      shippingOptionsEl.querySelectorAll(".shipping-option").forEach(label => {
        label.addEventListener("click", () => {
          const idx = Number(label.dataset.index);
          const opt = data.options[idx];
          shipping = opt;
          shippingOptionsEl.querySelectorAll(".shipping-option").forEach(l => l.classList.remove("selected"));
          label.classList.add("selected");
          label.querySelector("input").checked = true;
          addressFieldsEl.classList.remove("d-none");
          updateTotals();
        });
      });

      autofillAddress(cep.replace("-", ""));
    } catch(err){
      console.error("Falha ao calcular frete:", err);
      shippingMsgEl.textContent = err.name === "AbortError"
        ? "A busca por opções de frete demorou demais. Tente novamente."
        : (err.message || "Não foi possível calcular o frete agora. Tente novamente em instantes.");
    } finally {
      calcShippingBtn.disabled = false;
    }
  }
  calcShippingBtn.addEventListener("click", calcShipping);
  cepInput.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); calcShipping(); } });

  /* ============ CUPOM DE DESCONTO ============ */
  async function applyCoupon(){
    const code = couponInput.value.trim();
    if(!code){
      if(coupon){ resetCoupon(); updateTotals(); }
      return;
    }
    if(cart.length === 0) return;

    couponApplyBtn.disabled = true;
    couponMsgEl.style.color = "var(--ink-soft)";
    couponMsgEl.textContent = "Verificando cupom...";
    try{
      const res = await fetch("/api/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, items: cart.map(i => ({ id: i.id, qty: i.qty })) })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Cupom inválido.");
      coupon = { code: data.code, percentOff: data.percentOff };
      couponMsgEl.style.color = "var(--blush-700)";
      couponMsgEl.textContent = `Cupom ${data.code} aplicado: ${data.percentOff}% de desconto.`;
      updateTotals();
    }catch(err){
      coupon = null;
      couponMsgEl.style.color = "#B3261E";
      couponMsgEl.textContent = err.message;
      updateTotals();
    }finally{
      couponApplyBtn.disabled = false;
    }
  }
  couponApplyBtn.addEventListener("click", applyCoupon);
  couponInput.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); applyCoupon(); } });

  renderCart(); 

  /* ============ CHECKOUT — MERCADO PAGO (Checkout Pro) ============ */
  async function goToCheckout(){

    if(!currentUser){
      window.location.href = "conta.html?retorno=carrinho";
      return;
    }
    if(cart.length === 0) return;
    const pendente = checkoutBlockInfo();
    if(pendente){
      if(shipping){
        addressValidationAttempted = true;
        markInvalidAddressFields();
      }
      showCheckoutHintToast(pendente.text);
      return;
    }
    checkoutBtn.disabled = true;
    checkoutMsg.classList.add("show");
    checkoutMsg.innerHTML = `<i class="bi bi-hourglass-split"></i><span>Preparando pagamento...</span>`;

    const rota = paymentMethod === "pix" ? "/api/create-pix-payment" : "/api/create-preference";

    let res;
    try{
      res = await fetchWithTimeout(rota, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(i => ({ id: i.id, qty: i.qty })),
          cep: cepInput.value.replace("-", ""),
          shipping_service_id: shipping.service_id,
          address: getAddress(),
          coupon: coupon ? coupon.code : undefined,
          paymentMethod,
        })
      });
    } catch(networkErr){
      console.error("Falha de rede ao iniciar checkout:", networkErr);
      checkoutMsg.innerHTML = `<i class="bi bi-exclamation-triangle"></i><span>Não conseguimos abrir o pagamento agora (sem conexão com o servidor). Tente novamente em instantes ou <a href="https://wa.me/5561982749808" target="_blank" rel="noopener noreferrer">finalize pelo WhatsApp</a>.</span>`;
      checkoutBtn.disabled = false;
      return;
    }

    try{
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || `Erro inesperado (HTTP ${res.status}).`);

      if(paymentMethod === "pix"){
        if(!data.qrCode) throw new Error("O servidor não devolveu o código Pix. Tente novamente.");

        sessionStorage.setItem("plc_pix_pendente", JSON.stringify(data));

        window.location.href = "pagamento-pix.html";
        return;
      }

      if(!data.init_point) throw new Error("O servidor não devolveu o link de pagamento. Tente novamente.");
      window.location.href = data.init_point;
    } catch(err){
      console.error("Falha ao iniciar checkout:", err);
      checkoutMsg.innerHTML = `<i class="bi bi-exclamation-triangle"></i><span>${escapeHTML(err.message)}</span>`;
      checkoutBtn.disabled = false;
    }
  }
  checkoutBtn.addEventListener("click", goToCheckout);

  if(new URLSearchParams(location.search).get("carrinho") === "1"){
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById("cartOffcanvas")).show();
    history.replaceState(null, "", location.pathname);
  }

  /* ============ QUICK VIEW — tela de detalhes do produto ============ */
  let qvProductId = null, qvQty = 1;
  const qvModalEl = document.getElementById("quickViewModal");
  const qvModal = new bootstrap.Modal(qvModalEl);
  const qvQtyEl = document.getElementById("qvQty");
  const qvPriceEl = document.getElementById("qvPrice");
  const qvPixPriceEl = document.getElementById("qvPixPrice");
  const qvPixNoteEl = document.getElementById("qvPixNote");
  const qvInstallmentEl = document.getElementById("qvInstallment");

  function renderQuickViewPayment(){
    const p = findProduct(qvProductId);
    if(!p) return;
    const total = pricing.round2(p.price * qvQty);
    const pay = pricing.paymentSummaryFor(total);

    qvQtyEl.textContent = qvQty;
    qvPriceEl.textContent = formatMoney(total);
    qvPixPriceEl.textContent = formatMoney(pay.pixPrice);
    qvPixNoteEl.textContent =
      `Economize ${formatMoney(pay.pixSavings)} (${pay.pixDiscountPercent}% de desconto à vista)`;

    qvInstallmentEl.textContent = pay.installment.count > 1
      ? `ou ${pay.installmentLabel}`
      : "à vista ou boleto";
  }

  function openQuickView(id){
    const p = findProduct(id);
    if(!p) return;
    qvProductId = p.id; qvQty = 1;
    document.getElementById("qvName").textContent = p.name;
    document.getElementById("qvDesc").textContent = p.desc;

    const thumb = document.getElementById("qvThumb");
    const img = document.getElementById("qvImage");
    thumb.style.background = p.color + "22";
    thumb.querySelector(".bow-icon").style.color = p.color;

    img.classList.remove("is-loaded", "is-error");
    img.alt = p.name;

    thumb.style.removeProperty("--qv-ratio");
    thumb.style.removeProperty("--qv-ar");
    const photo = imageFor(p);
    if(photo){
      thumb.classList.add("is-loading");
      img.src = photo;
    } else {
      thumb.classList.remove("is-loading");
      img.removeAttribute("src");
    }

    renderQuickViewPayment();
    qvModal.show();
  }
  wireImage(document.getElementById("qvImage"));

  document.getElementById("qvImage").addEventListener("load", (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.target;
    if(!w || !h) return;
    const thumb = document.getElementById("qvThumb");
    thumb.style.setProperty("--qv-ratio", `${w}/${h}`);

    thumb.style.setProperty("--qv-ar", String(w / h));
  });

  grid.addEventListener("click", function(e){
    const addBtn = e.target.closest(".btn-add");
    if(addBtn){
      const id = Number(addBtn.dataset.id);
      const p = findProduct(id);
      addToCart(id, 1);
      celebrateAddToCart(addBtn, p?.color);
      pulseAddButton(addBtn);
      return;
    }

    const card = e.target.closest(".product-card");
    if(card) openQuickView(Number(card.dataset.id));
  });

  document.getElementById("qvMinus").addEventListener("click", () => {
    qvQty = Math.max(1, qvQty - 1);
    renderQuickViewPayment();
  });
  document.getElementById("qvPlus").addEventListener("click", () => {
    qvQty = Math.min(10, qvQty + 1);
    renderQuickViewPayment();
  });
  document.getElementById("qvAddBtn").addEventListener("click", () => {
    if(qvProductId != null){
      const p = findProduct(qvProductId);
      addToCart(qvProductId, qvQty);
      celebrateAddToCart(document.getElementById("qvAddBtn"), p?.color);
    }
    qvModal.hide();
  });

  const navOffcanvasEl = document.getElementById("navOffcanvas");
  navOffcanvasEl?.addEventListener("click", (e) => {
    if(e.target.closest("a, button")){
      bootstrap.Offcanvas.getInstance(navOffcanvasEl)?.hide();
    }
  });

  document.getElementById("cartContinueLink")?.addEventListener("click", () => {
    bootstrap.Offcanvas.getInstance(document.getElementById("cartOffcanvas"))?.hide();
  });

  const nav = document.getElementById("mainNav");
  const btnTop = document.getElementById("btnTop");

  const navLinks = [...document.querySelectorAll("#mainNav .plc-nav-link, #mainNav .nav-cta")]
    .filter(a => a.getAttribute("href")?.startsWith("#"));
  const navTargets = navLinks
    .map(a => ({ link:a, section: document.getElementById(a.getAttribute("href").slice(1)) }))
    .filter(t => t.section);
  let activeLink = null;

  function updateActiveSection(){
    if(!navTargets.length) return;
    const line = nav.offsetHeight + 24;
    let current = null;
    for(const t of navTargets){
      if(t.section.getBoundingClientRect().top <= line) current = t.link;
    }

    if(window.innerHeight + window.scrollY >= document.body.scrollHeight - 2){
      current = navTargets[navTargets.length - 1].link;
    }
    if(current === activeLink) return;
    activeLink?.classList.remove("is-active");
    activeLink?.removeAttribute("aria-current");
    activeLink = current;
    if(activeLink){
      activeLink.classList.add("is-active");
      activeLink.setAttribute("aria-current", "true");
    }
  }

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if(scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      nav.classList.toggle("is-scrolled", window.scrollY > 40);
      btnTop.classList.toggle("show", window.scrollY > 500);
      updateActiveSection();
      scrollTicking = false;
    });
  }, { passive:true });
  updateActiveSection();

  btnTop.addEventListener("click", () => {
    window.scrollTo({ top:0, behavior:"smooth" });
  });

  /* ============ FORMULÁRIOS ============ */
  function isValidEmail(v){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  async function postForm(url, body){
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || "Não foi possível enviar agora. Tente novamente em instantes.");
    return data;
  }

  const newsletterForm = document.getElementById("newsletterForm");
  newsletterForm.addEventListener("submit", async function(e){
    e.preventDefault();
    const input = this.querySelector("input[type=email]");
    const btn = this.querySelector("button[type=submit]");
    const msg = document.getElementById("newsletterMsg");
    const email = input.value.trim();
    if(!isValidEmail(email)){
      msg.textContent = "Digite um e-mail válido.";
      return;
    }
    btn.disabled = true;
    msg.textContent = "Enviando...";
    try{
      const data = await postForm("/api/newsletter", { email });

      if(data.coupon){
        const emailLine = data.emailed
          ? "Também enviamos no seu e-mail."
          : "Anote o código — use no carrinho antes de finalizar.";
        msg.innerHTML = `Pronto! Seu cupom de ${escapeHTML(String(data.percentOff))}% é `
          + `<strong class="newsletter-coupon">${escapeHTML(data.coupon)}</strong> 🎀<br>${emailLine}`;
      } else {
        msg.textContent = "Pronto! Você está na nossa lista de novidades. 🎀";
      }
      input.value = "";
    }catch(err){
      console.error("Falha ao inscrever na newsletter:", err);
      msg.textContent = err.name === "AbortError"
        ? "O envio demorou demais. Tente novamente."
        : err.message;
    }finally{
      btn.disabled = false;
    }
  });

  const contactForm = document.getElementById("contactForm");
  contactForm.addEventListener("submit", async function(e){
    e.preventDefault();
    e.stopPropagation();
    if(!this.checkValidity()){
      this.classList.add("was-validated");
      return;
    }
    const msgEl = document.getElementById("contactMsg");
    const btn = this.querySelector("button[type=submit]");
    btn.disabled = true;
    msgEl.textContent = "Enviando...";
    try{
      await postForm("/api/contact", {
        nome: document.getElementById("contactNome").value.trim(),
        telefone: document.getElementById("contactTelefone").value.trim(),
        ocasiao: document.getElementById("contactOcasiao").value,
        mensagem: document.getElementById("contactMensagem").value.trim(),
      });
      msgEl.textContent = "Mensagem enviada! Responderemos em breve. 🎀";
      this.reset();
      this.classList.remove("was-validated");
    }catch(err){
      console.error("Falha ao enviar contato:", err);
      msgEl.textContent = err.name === "AbortError"
        ? "O envio demorou demais. Tente novamente."
        : err.message;
    }finally{
      btn.disabled = false;
    }
  });

  /* ============ RODAPÉ — selos de forma de pagamento ============ */
  const payBadgePixEl = document.getElementById("payBadgePix");
  const payBadgeInstallmentsEl = document.getElementById("payBadgeInstallments");
  if(payBadgePixEl){
    payBadgePixEl.textContent = `Pix com ${pricing.PAYMENT_RULES.pixDiscountPercent}% de desconto`;
  }
  if(payBadgeInstallmentsEl){
    const { maxInstallments, interestFreeInstallments, monthlyInterestRate } = pricing.PAYMENT_RULES;
    const semJuros = Math.min(maxInstallments, interestFreeInstallments);
    payBadgeInstallmentsEl.textContent = (monthlyInterestRate > 0 && maxInstallments > semJuros)
      ? `Até ${maxInstallments}x (${semJuros}x sem juros)`
      : `Até ${semJuros}x sem juros`;
  }

})();