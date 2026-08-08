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
      imgEl.closest(".product-thumb, .cart-item-thumb, .gal-item")?.classList.remove("is-loading");
    });
    imgEl.addEventListener("error", () => {
      imgEl.classList.add("is-error");
      imgEl.closest(".product-thumb, .cart-item-thumb, .gal-item")?.classList.remove("is-loading");
    });
  }

  function renderProducts(){
    const list = currentFilter === "todos" ? products : products.filter(p => p.cat === currentFilter);
    grid.innerHTML = list.map(p => `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="product-card">
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
              <span class="product-price">R$ ${p.price.toFixed(2).replace(".", ",")}</span>
              <button class="btn-add" data-id="${p.id}" aria-label="Adicionar ${escapeHTML(p.name)} ao carrinho"><i class="bi bi-plus-lg"></i></button>
            </div>
          </div>
        </div>
      </div>
    `).join("");
    grid.querySelectorAll(".product-thumb img").forEach(wireImage);
  }
  renderProducts();

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
    return products.find(p => p.id === id);
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

  function addToCart(id, qty){
    const existing = cart.find(i => i.id === id);
    if(existing){
      existing.qty = Math.min(10, existing.qty + qty);
    } else {
      cart.push({ id, qty: Math.min(10, Math.max(1, qty)) });
    }
    saveCart();
    updateCartBadges();
    renderCart();
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
    renderCart();
  }

  const cartItemsList = document.getElementById("cartItemsList");
  const cartEmptyState = document.getElementById("cartEmptyState");
  const cartSubtotalEl = document.getElementById("cartSubtotal");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutMsg = document.getElementById("checkoutMsg");

  function renderCart(){
    if(cart.length === 0){
      cartItemsList.innerHTML = "";
      cartEmptyState.classList.remove("d-none");
      checkoutBtn.disabled = true;
    } else {
      cartEmptyState.classList.add("d-none");
      checkoutBtn.disabled = false;
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
              <div class="cart-item-price">R$ ${p.price.toFixed(2).replace(".", ",")} un.</div>
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
    cartSubtotalEl.textContent = "R$ " + cartSubtotal().toFixed(2).replace(".", ",");
    checkoutMsg.classList.remove("show");
    checkoutMsg.innerHTML = "";
  }

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
  renderCart();

  /* =====================================================================
     CHECKOUT — MERCADO PAGO (Checkout Pro)
     -------------------------------------------------------------------
     O front-end NUNCA fala diretamente com a API do Mercado Pago nem
     conhece o Access Token. Ele só chama o SEU back-end
     (POST /api/create-preference), que:
       1) recebe { items: [{id, qty}] }  — repare: SEM preço;
       2) busca o preço de cada id no catálogo do servidor;
       3) cria a "preference" usando o Access Token (guardado em
          server/.env, nunca no navegador);
       4) devolve { init_point }, o link de pagamento do Mercado Pago.
     O navegador só redireciona para esse link. Veja README.md e
     server/server.js para o passo a passo completo de configuração.
  ===================================================================== */
  async function goToCheckout(){
    if(cart.length === 0) return;
    checkoutBtn.disabled = true;
    checkoutMsg.classList.add("show");
    checkoutMsg.innerHTML = `<i class="bi bi-hourglass-split"></i><span>Preparando pagamento...</span>`;
    try{
      const res = await fetch("/api/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart.map(i => ({ id: i.id, qty: i.qty })) })
      });
      if(!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if(!data.init_point) throw new Error("Resposta sem init_point");
      window.location.href = data.init_point;
    } catch(err){
      console.error("Falha ao iniciar checkout:", err);
      checkoutMsg.classList.add("show");
      checkoutMsg.innerHTML = `<i class="bi bi-exclamation-triangle"></i><span>Não conseguimos abrir o pagamento agora (o servidor de pagamentos está fora do ar). Tente novamente em instantes ou <a href="https://wa.me/5561982749808" target="_blank" rel="noopener noreferrer">finalize pelo WhatsApp</a>.</span>`;
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
      addToCart(Number(addBtn.dataset.id), 1);
      return;
    }
    if(qvBtn){
      const p = findProduct(Number(qvBtn.dataset.id));
      if(!p) return;
      qvProductId = p.id; qvQty = 1;
      document.getElementById("qvName").textContent = p.name;
      document.getElementById("qvDesc").textContent = p.desc;
      document.getElementById("qvPrice").textContent = "R$ " + p.price.toFixed(2).replace(".", ",");
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
    if(qvProductId != null) addToCart(qvProductId, qvQty);
    qvModal.hide();
  });

  /* ---------- GALERIA ---------- */
  const galSeeds = ["laco-rosa-1","laco-rosa-2","laco-festa","laco-batizado","laco-presente","laco-tiara","laco-borboleta","laco-duquesa"];
  const gallery = document.getElementById("galleryGrid");
  gallery.innerHTML = galSeeds.map((seed,i) => `
    <div class="col-6 col-md-3">
      <div class="gal-item is-loading">
        <img
          src="https://picsum.photos/seed/${encodeURIComponent(seed)}/500/500"
          alt="Laço artesanal — foto ${i+1} da galeria"
          width="500" height="500" loading="lazy" decoding="async"
          style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0">
        <div class="gal-overlay"><i class="bi bi-heart-fill"></i> ${120 + i*17}</div>
      </div>
    </div>
  `).join("");
  gallery.querySelectorAll(".gal-item img").forEach(wireImage);

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
