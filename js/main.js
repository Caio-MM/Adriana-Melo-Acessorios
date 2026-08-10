(function(){
  "use strict";

  /* =====================================================================
     CATÁLOGO (somente para EXIBIÇÃO no front-end)
     -------------------------------------------------------------------
     ⚠️ SEGURANÇA: o preço aqui é só para a vitrine. Na hora de pagar, o
     back-end (server/server.js) busca o preço de novo na SUA própria
     lista de produtos, ignorando qualquer preço vindo do navegador. Isso
     impede que alguém edite o localStorage no DevTools e pague menos do
     que deveria (manipulação de preço). Mantenha os IDs sincronizados
     com PRODUCTS em server/server.js.
  ===================================================================== */
  const products = [
    { id:1, name:"Laço Bailarina", cat:"dia-a-dia", catLabel:"Dia a dia", price:34.90, color:"#F4B4CC", rating:5, desc:"Laço em cetim rosa bebê, leve e confortável para o dia a dia." },
    { id:2, name:"Laço Duquesa", cat:"festa", catLabel:"Festa", price:49.90, color:"#DD6E9B", rating:5, badge:"Mais vendido", desc:"Cetim duplo com volume extra, perfeito para festas e ensaios." },
    { id:3, name:"Laço Recém-nascida", cat:"maternidade", catLabel:"Maternidade", price:29.90, color:"#FBEAF0", rating:5, desc:"Presilha macia em algodão, indicada para os primeiros meses." },
    { id:4, name:"Laço Pérola", cat:"batizado", catLabel:"Batizado", price:59.90, color:"#F8ECF1", rating:5, desc:"Detalhes em pérolas para o dia especial do batizado." },
    { id:5, name:"Laço Borboleta", cat:"festa", catLabel:"Festa", price:44.90, color:"#EA8FB4", rating:4, desc:"Formato de borboleta com fita de organza, ideal para festas infantis." },
    { id:6, name:"Kit Presente 3 Laços", cat:"presente", catLabel:"Presente", price:89.90, color:"#C05480", rating:5, badge:"Novo", desc:"Trio de laços em tons de rosa, embalado em caixa para presente." },
    { id:7, name:"Laço Tiara Flor", cat:"dia-a-dia", catLabel:"Dia a dia", price:39.90, color:"#F4B4CC", rating:4, desc:"Tiara macia com flor de tecido, confortável para uso prolongado." },
    { id:8, name:"Laço Personalizado", cat:"presente", catLabel:"Presente", price:64.90, color:"#DD6E9B", rating:5, badge:"Novo", desc:"Bordado com o nome que você escolher, embalagem para presente." },
  ];

  /* =====================================================================
     SEGURANÇA — SANITIZAÇÃO
     Toda vez que texto é inserido via innerHTML, ele passa por aqui.
     Hoje os dados vêm de um array fixo (baixo risco), mas se um dia o
     catálogo vier de uma API/CMS, essa função evita XSS (ex.: um nome
     de produto contendo "<img src=x onerror=alert(1)>").
  ===================================================================== */
  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  /* fetch pode travar (nunca resolver nem rejeitar) em vez de falhar
     rápido — sem um limite de tempo, calcular frete ou ir pro pagamento
     ficariam presos no botão desabilitado/"Calculando..." pra sempre, sem
     nenhum jeito de tentar de novo. Mesmo racional do fetchWithTimeout em
     js/auth.js e js/admin.js. */
  function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  /* Lookup de produto por id em O(1) em vez de Array.find (O(n)) a cada
     cálculo de subtotal/render — o catálogo é pequeno hoje, mas é a forma
     correta de fazer e não tem custo nenhum a mais para escrever assim. */
  const productsById = new Map(products.map(p => [p.id, p]));

  function formatMoney(n){
    return "R$ " + Number(n).toFixed(2).replace(".", ",");
  }

  function slugify(str){
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  }

  /* Imagem "placeholder real" (foto de verdade, não SVG) via Picsum —
     serviço público, sem chave de API. O "seed" fixa sempre a mesma foto
     para o mesmo produto. Troque pela foto real do produto quando tiver:
     basta apontar `image` para o arquivo (ex.: "img/produtos/laco-1.jpg"). */
  function imageFor(p){
    return p.image || `https://picsum.photos/seed/${encodeURIComponent(slugify(p.name))}/600/600`;
  }

  let cartCount = 0;
  let currentFilter = "todos";

  const grid = document.getElementById("productsGrid");
  const cartCountEl = document.getElementById("cartCount");
  const cartCountMobileEl = document.getElementById("cartCountMobile");
  const cartToast = new bootstrap.Toast(document.getElementById("cartToast"));
  const cartPillEl = document.querySelector(".cart-pill");

  /* =====================================================================
     REVEAL ON SCROLL — fade/slide-up sutil para seções e cards conforme
     entram na tela. Só usa opacity/transform (a animação de verdade é
     CSS, em .reveal/.is-visible no style.css) — aqui só alterna a classe,
     sem tocar em layout, então é barato mesmo rolando rápido no celular.
     unobserve() depois de revelar: o elemento já apareceu, não precisa
     mais gastar ciclos observando ele. */
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
      else el.classList.add("is-visible"); // sem suporte a IntersectionObserver: mostra direto
    });
  }
  observeReveal(); // seções estáticas já presentes no HTML

  /* =====================================================================
     ANIMAÇÃO "ADICIONAR AO CARRINHO" — três efeitos combinados, disparados
     junto com addToCart() nos cliques de "+"/"Adicionar": (1) uma bolinha
     "voa" do botão até o ícone do carrinho, (2) o ícone do carrinho dá um
     pulso, (3) o próprio botão vira um check por um instante. Tudo com
     transform/opacity (sem animar width/height/top/left, que forçam
     reflow) para não travar em aparelhos mais fracos.
  ===================================================================== */
  function bumpCartIcon(){
    if(!cartPillEl) return;
    cartPillEl.classList.remove("is-bumped");
    void cartPillEl.offsetWidth; // reinicia a keyframe mesmo em cliques em sequência
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
    setTimeout(cleanup, 900); // rede de segurança (ex.: prefers-reduced-motion desliga a transição)
  }

  function pulseAddButton(btn){
    const icon = btn?.querySelector("i");
    if(!icon) return;
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

  /* Troca o skeleton de carregamento pela imagem real, ou esconde a
     imagem quebrada (mantendo o ícone de laço em SVG por baixo) caso
     falhe — nunca deixa um "ícone quebrado" feio na tela. */
  function wireImage(imgEl){
    imgEl.addEventListener("load", () => {
      imgEl.classList.add("is-loaded");
      imgEl.closest(".product-thumb, .cart-item-thumb")?.classList.remove("is-loading");
    });
    imgEl.addEventListener("error", () => {
      imgEl.classList.add("is-error");
      imgEl.closest(".product-thumb, .cart-item-thumb")?.classList.remove("is-loading");
    });
  }

  function renderProducts(){
    const list = currentFilter === "todos" ? products : products.filter(p => p.cat === currentFilter);
    grid.innerHTML = list.map((p, i) => `
      <div class="col-6 col-md-4 col-lg-3 reveal reveal-delay-${i % 4}">
        <div class="product-card${p.badge ? " is-featured" : ""}">
          <div class="product-thumb is-loading" style="background:${p.color}22">
            ${p.badge ? `<span class="product-badge">${escapeHTML(p.badge)}</span>` : ""}
            <button class="product-quickview" data-id="${p.id}" aria-label="Ver detalhes"><i class="bi bi-eye"></i></button>
            <img
              src="${imageFor(p)}"
              alt="${escapeHTML(p.name)} — ${escapeHTML(p.catLabel)}"
              width="600" height="600"
              loading="lazy" decoding="async">
            <svg class="bow-icon" style="color:${p.color}; position:absolute"><use href="#bow-shape"/></svg>
          </div>
          <div class="product-body">
            <div class="product-cat">${escapeHTML(p.catLabel)}</div>
            <div class="product-name">${escapeHTML(p.name)}</div>
            <div class="product-stars mb-2">${stars(p.rating)}</div>
            <div class="d-flex align-items-center justify-content-between">
              <span class="product-price">${formatMoney(p.price)}</span>
              <button class="btn-add" data-id="${p.id}" aria-label="Adicionar ${escapeHTML(p.name)} ao carrinho"><i class="bi bi-plus-lg"></i></button>
            </div>
          </div>
        </div>
      </div>
    `).join("");
    grid.querySelectorAll(".product-thumb img").forEach(wireImage);
    observeReveal(grid);
  }
  renderProducts();

  /* Busca eventuais edições de nome/preço/foto feitas no painel
     administrativo (server/server.js > /api/products) e aplica por cima
     do catálogo estático acima, sem bloquear a primeira renderização (que
     já aconteceu, com os dados estáticos, na linha de cima) — se a busca
     falhar ou demorar, a vitrine continua funcionando normalmente com o
     catálogo padrão. Como `products`/`productsById` guardam referências
     mutáveis, atualizar `p.name`/`p.price`/`p.image` aqui já é suficiente
     para o carrinho e a quick view (que sempre leem do mesmo objeto)
     mostrarem o valor novo, sem precisar duplicar essa lógica em cada um. */
  async function loadProductOverrides(){
    try{
      const res = await fetch("/api/products");
      if(!res.ok) return;
      const data = await res.json();
      let changed = false;
      (Array.isArray(data.products) ? data.products : []).forEach(o => {
        const p = productsById.get(o.id);
        if(!p) return;
        if(o.name && o.name !== p.name){ p.name = o.name; changed = true; }
        if(o.price != null && o.price !== p.price){ p.price = o.price; changed = true; }
        if(o.photoUrl && o.photoUrl !== p.image){ p.image = o.photoUrl; changed = true; }
      });
      if(changed){ renderProducts(); renderCart(); }
    }catch(err){
      console.warn("Não foi possível verificar atualizações do catálogo:", err);
    }
  }
  loadProductOverrides();

  /* ---------- FILTROS ---------- */
  document.getElementById("filterGroup").addEventListener("click", function(e){
    const btn = e.target.closest(".chip");
    if(!btn) return;
    document.querySelectorAll("#filterGroup .chip").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.cat;
    renderProducts();
  });

  /* =====================================================================
     CARRINHO
     Guardamos só { id, qty } no localStorage — nunca o preço. O preço
     exibido é sempre recalculado a partir do catálogo local (e, na hora
     de pagar, a partir do catálogo do servidor). Isso é o que impede
     alguém de editar `localStorage` no DevTools para pagar menos.
  ===================================================================== */
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

  /* Atualiza só o número da quantidade de um item já renderizado no
     carrinho, em vez de reconstruir o HTML inteiro (renderCart()). Evita
     recriar a <img> do item a cada clique em +/− — o que forçava um
     "flash" de skeleton/opacidade toda vez, mesmo a imagem já estando em
     cache. Retorna false se o item ainda não está no DOM (carrinho vazio
     antes, ou item novo), sinalizando que um renderCart() completo é
     necessário dessa vez. */
  function patchCartItemQty(id, qty){
    const row = cartItemsList.querySelector(`.cart-item[data-id="${id}"]`);
    if(!row) return false;
    const qtyEl = row.querySelector(".cart-qty span");
    if(qtyEl) qtyEl.textContent = qty;
    return true;
  }

  function addToCart(id, qty){
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
      renderCart(); // item novo: precisa criar a linha no DOM
    }
    cartToast.show();
  }

  function removeFromCart(id){
    cart = cart.filter(i => i.id !== id);
    saveCart();
    updateCartBadges();
    renderCart(); // a lista perdeu uma linha: precisa reconstruir a estrutura
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
  const cartShippingPriceEl = document.getElementById("cartShippingPrice");
  const cartTotalEl = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");
  const couponInput = document.getElementById("couponInput");
  const couponApplyBtn = document.getElementById("couponApplyBtn");
  const couponMsgEl = document.getElementById("couponMsg");

  /* Estado do frete escolhido. Fica em memória (não em localStorage):
     se o carrinho mudar de conteúdo, o peso/preço do frete pode mudar,
     então é mais seguro pedir para recalcular do que arriscar mostrar
     um valor de frete desatualizado. */
  let shipping = null; // { service_id, name, price, delivery_time }

  /* Estado do cupom aplicado. Guardamos só o percentual (não o valor de
     desconto em R$) — assim o desconto mostrado acompanha automaticamente
     qualquer mudança de quantidade no carrinho, sem precisar chamar a API
     de novo a cada +/-. O servidor sempre revalida o cupom e recalcula o
     desconto de novo no checkout (nunca confia neste cálculo do navegador). */
  let coupon = null; // { code, percentOff }

  function currentDiscount(subtotal){
    return coupon ? Math.round(subtotal * coupon.percentOff / 100 * 100) / 100 : 0;
  }

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

    const afterDiscount = subtotal - discount;
    if(shipping){
      cartShippingPriceEl.textContent = formatMoney(shipping.price);
      cartTotalEl.textContent = formatMoney(afterDiscount + shipping.price);
    } else {
      cartShippingPriceEl.textContent = "a calcular";
      cartTotalEl.textContent = formatMoney(afterDiscount);
    }
    checkoutBtn.disabled = cart.length === 0 || !shipping || !isAddressComplete();
  }

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
    if(cart.length === 0){
      cartItemsList.innerHTML = "";
      cartEmptyState.classList.remove("d-none");
      resetCoupon();
    } else {
      cartEmptyState.classList.add("d-none");
      cartItemsList.innerHTML = cart.map(item => {
        const p = findProduct(item.id);
        if(!p) return "";
        return `
          <div class="cart-item" data-id="${p.id}">
            <div class="cart-item-thumb is-loading" style="background:${p.color}22">
              <img src="${imageFor(p)}" alt="${escapeHTML(p.name)}" width="64" height="64" loading="lazy" decoding="async">
            </div>
            <div class="flex-grow-1">
              <div class="cart-item-name">${escapeHTML(p.name)}</div>
              <div class="cart-item-price">${formatMoney(p.price)} un.</div>
              <div class="cart-qty mt-1">
                <button type="button" class="cart-qty-minus" aria-label="Diminuir quantidade">−</button>
                <span>${item.qty}</span>
                <button type="button" class="cart-qty-plus" aria-label="Aumentar quantidade">+</button>
                <button type="button" class="cart-item-remove ms-2" aria-label="Remover ${escapeHTML(p.name)}"><i class="bi bi-trash3"></i></button>
              </div>
            </div>
          </div>
        `;
      }).join("");
      cartItemsList.querySelectorAll(".cart-item-thumb img").forEach(wireImage);
    }
    renderCartRecommendations();
    resetShipping();
    updateTotals();
    checkoutMsg.classList.remove("show");
    checkoutMsg.innerHTML = "";
  }

  /* =====================================================================
     CROSS-SELL NO CARRINHO ("Complete seu pedido")
     -------------------------------------------------------------------
     Sugere produtos que ainda não estão no carrinho, priorizando
     categorias diferentes das já escolhidas (ex.: cliente levou um laço
     de "festa" → sugere "presente"/"dia a dia" antes de outro de festa),
     e dentro de cada grupo prioriza os que já têm selo (mais vendido/
     novo) — são os que a própria loja já sabe que convertem bem. Mostrado
     no momento de maior intenção de compra (carrinho aberto), que é onde
     esse tipo de sugestão mais aumenta o ticket médio.
  ===================================================================== */
  function pickCartRecommendations(){
    const inCartIds = new Set(cart.map(i => i.id));
    const inCartCats = new Set(cart.map(i => findProduct(i.id)?.cat).filter(Boolean));
    const candidates = products.filter(p => !inCartIds.has(p.id));
    const byBadgeFirst = (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0);

    const otherCategories = candidates.filter(p => !inCartCats.has(p.cat)).sort(byBadgeFirst);
    const sameCategory = candidates.filter(p => inCartCats.has(p.cat)).sort(byBadgeFirst);
    return [...otherCategories, ...sameCategory].slice(0, 3);
  }

  function renderCartRecommendations(){
    const recs = cart.length ? pickCartRecommendations() : [];
    if(!recs.length){
      cartRecommendationsEl.classList.add("d-none");
      return;
    }
    cartRecommendationsEl.classList.remove("d-none");
    cartRecsListEl.innerHTML = recs.map(p => `
      <div class="cart-rec-item" data-id="${p.id}">
        <div class="cart-rec-thumb">
          <img src="${imageFor(p)}" alt="${escapeHTML(p.name)}" width="44" height="44" loading="lazy" decoding="async">
        </div>
        <div class="flex-grow-1">
          <div class="cart-rec-name">${escapeHTML(p.name)}</div>
          <div class="cart-rec-price">${formatMoney(p.price)}</div>
        </div>
        <button type="button" class="cart-rec-add" data-id="${p.id}" aria-label="Adicionar ${escapeHTML(p.name)} ao carrinho"><i class="bi bi-plus-lg"></i></button>
      </div>
    `).join("");
    cartRecsListEl.querySelectorAll(".cart-rec-thumb img").forEach(wireImage);
  }

  cartRecsListEl.addEventListener("click", function(e){
    const btn = e.target.closest(".cart-rec-add");
    if(!btn) return;
    addToCart(Number(btn.dataset.id), 1);
    bumpCartIcon(); // carrinho já está aberto aqui — sem o "voo" até o ícone, que ficaria escondido atrás do próprio painel
  });

  cartItemsList.addEventListener("click", function(e){
    const row = e.target.closest(".cart-item");
    if(!row) return;
    const id = Number(row.dataset.id);
    if(e.target.closest(".cart-qty-plus")){
      const item = cart.find(i => i.id === id);
      setQty(id, item.qty + 1);
    } else if(e.target.closest(".cart-qty-minus")){
      const item = cart.find(i => i.id === id);
      if(item.qty <= 1){ removeFromCart(id); } else { setQty(id, item.qty - 1); }
    } else if(e.target.closest(".cart-item-remove")){
      removeFromCart(id);
    }
  });

  updateCartBadges();

  /* =====================================================================
     FRETE — MELHOR ENVIO
     -------------------------------------------------------------------
     O front-end manda o CEP + os itens para o SEU back-end
     (POST /api/calculate-shipping). O back-end é quem fala com a API do
     Melhor Envio (com o token dele, guardado em server/.env) e devolve
     só a lista de opções (transportadora, prazo, preço). O front nunca
     vê o token do Melhor Envio, do mesmo jeito que nunca vê o do
     Mercado Pago.
  ===================================================================== */
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

  function isAddressComplete(){
    const a = getAddress();
    return a.nome && a.telefone && a.rua && a.numero && a.bairro && a.cidade && a.uf;
  }

  /* Autopreenche rua/bairro/cidade/UF a partir do CEP usando o ViaCEP —
     API pública e gratuita (sem chave), só para poupar digitação. Se
     falhar, o cliente preenche manualmente sem problema. */
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

  Object.values(addrInputs).forEach(el => el.addEventListener("input", updateTotals));

  cepInput.addEventListener("input", () => {
    // máscara simples 00000-000
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

  /* =====================================================================
     CUPOM DE DESCONTO
     -------------------------------------------------------------------
     O front-end só mostra o desconto — quem valida o código e calcula o
     valor de verdade é sempre o back-end (POST /api/validate-coupon),
     igual ao frete. Guardamos aqui só { code, percentOff } para o desconto
     acompanhar mudanças de quantidade sem precisar chamar a API de novo
     (ver updateTotals/currentDiscount).
  ===================================================================== */
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

  renderCart(); // agora que addrInputs/isAddressComplete já existem

  /* =====================================================================
     CHECKOUT — MERCADO PAGO (Checkout Pro)
     -------------------------------------------------------------------
     O front-end NUNCA fala diretamente com a API do Mercado Pago nem
     conhece o Access Token. Ele só chama o SEU back-end
     (POST /api/create-preference), que:
       1) recebe { items: [{id, qty}], cep, shipping_service_id } —
          repare: SEM preço de produto e SEM preço de frete;
       2) busca o preço de cada item no catálogo do servidor;
       3) recalcula o frete de novo junto ao Melhor Envio (nunca confia
          no valor que o navegador mostrou), usando o `shipping_service_id`
          só para saber QUAL opção foi escolhida;
       4) cria a "preference" no Mercado Pago (Access Token só no
          servidor, em server/.env);
       5) devolve { init_point }, o link de pagamento.
     O navegador só redireciona para esse link. Veja README.md e
     server/server.js para o passo a passo completo de configuração.
  ===================================================================== */
  async function goToCheckout(){
    if(cart.length === 0 || !shipping || !isAddressComplete()) return;
    checkoutBtn.disabled = true;
    checkoutMsg.classList.add("show");
    checkoutMsg.innerHTML = `<i class="bi bi-hourglass-split"></i><span>Preparando pagamento...</span>`;

    let res;
    try{
      res = await fetchWithTimeout("/api/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(i => ({ id: i.id, qty: i.qty })),
          cep: cepInput.value.replace("-", ""),
          shipping_service_id: shipping.service_id,
          address: getAddress(),
          coupon: coupon ? coupon.code : undefined,
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
      if(!data.init_point) throw new Error("O servidor não devolveu o link de pagamento. Tente novamente.");
      window.location.href = data.init_point;
    } catch(err){
      console.error("Falha ao iniciar checkout:", err);
      checkoutMsg.innerHTML = `<i class="bi bi-exclamation-triangle"></i><span>${escapeHTML(err.message)}</span>`;
      checkoutBtn.disabled = false;
    }
  }
  checkoutBtn.addEventListener("click", goToCheckout);

  /* ---------- ADICIONAR AO CARRINHO / QUICK VIEW ---------- */
  let qvProductId = null, qvQty = 1;
  const qvModalEl = document.getElementById("quickViewModal");
  const qvModal = new bootstrap.Modal(qvModalEl);

  grid.addEventListener("click", function(e){
    const addBtn = e.target.closest(".btn-add");
    const qvBtn = e.target.closest(".product-quickview");
    if(addBtn){
      const id = Number(addBtn.dataset.id);
      const p = findProduct(id);
      addToCart(id, 1);
      celebrateAddToCart(addBtn, p?.color);
      pulseAddButton(addBtn);
      return;
    }
    if(qvBtn){
      const p = findProduct(Number(qvBtn.dataset.id));
      if(!p) return;
      qvProductId = p.id; qvQty = 1;
      document.getElementById("qvName").textContent = p.name;
      document.getElementById("qvDesc").textContent = p.desc;
      document.getElementById("qvPrice").textContent = formatMoney(p.price);
      document.getElementById("qvQty").textContent = qvQty;
      const thumb = document.getElementById("qvThumb");
      thumb.style.background = p.color + "22";
      thumb.querySelector(".bow-icon").style.color = p.color;
      qvModal.show();
    }
  });

  document.getElementById("qvMinus").addEventListener("click", () => {
    qvQty = Math.max(1, qvQty - 1);
    document.getElementById("qvQty").textContent = qvQty;
  });
  document.getElementById("qvPlus").addEventListener("click", () => {
    qvQty = Math.min(10, qvQty + 1);
    document.getElementById("qvQty").textContent = qvQty;
  });
  document.getElementById("qvAddBtn").addEventListener("click", () => {
    if(qvProductId != null){
      const p = findProduct(qvProductId);
      addToCart(qvProductId, qvQty);
      celebrateAddToCart(document.getElementById("qvAddBtn"), p?.color);
    }
    qvModal.hide();
  });

  /* ---------- NAVBAR SCROLL ---------- */
  const nav = document.getElementById("mainNav");
  const btnTop = document.getElementById("btnTop");
  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if(scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      nav.classList.toggle("is-scrolled", window.scrollY > 40);
      btnTop.classList.toggle("show", window.scrollY > 500);
      scrollTicking = false;
    });
  }, { passive:true });

  /* ---------- BACK TO TOP ---------- */
  btnTop.addEventListener("click", () => {
    window.scrollTo({ top:0, behavior:"smooth" });
  });

  /* =====================================================================
     FORMULÁRIOS
     -------------------------------------------------------------------
     Validação no navegador é só conveniência para o usuário — NUNCA é
     proteção de verdade, porque qualquer pessoa pode desativar o
     JavaScript ou chamar a API direto. Por isso o server.js de exemplo
     também valida tudo de novo do lado do servidor antes de aceitar.
  ===================================================================== */
  function isValidEmail(v){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  document.getElementById("newsletterForm").addEventListener("submit", function(e){
    e.preventDefault();
    const input = this.querySelector("input[type=email]");
    const msg = document.getElementById("newsletterMsg");
    const email = input.value.trim();
    if(!isValidEmail(email)){
      msg.textContent = "Digite um e-mail válido.";
      return;
    }
    // Endpoint sugerido: POST /api/newsletter { email } — implemente no
    // seu back-end com limite de tentativas (rate limit) para evitar spam.
    msg.textContent = "Cupom enviado! Confira seu e-mail. 🎀";
    input.value = "";
  });

  const contactForm = document.getElementById("contactForm");
  contactForm.addEventListener("submit", function(e){
    e.preventDefault();
    e.stopPropagation();
    if(!this.checkValidity()){
      this.classList.add("was-validated");
      return;
    }
    const msgEl = document.getElementById("contactMsg");
    msgEl.textContent = "Mensagem enviada! Responderemos em breve. 🎀";
    // Endpoint sugerido: POST /api/contact { nome, telefone, ocasiao, mensagem }
    // Sempre sanitize/valide esses campos de novo no servidor antes de
    // salvar ou encaminhar (nunca confie só na validação do navegador).
    this.reset();
    this.classList.remove("was-validated");
  });

})();