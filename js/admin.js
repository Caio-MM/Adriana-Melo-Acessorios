(function(){
  "use strict";

  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }
  // Mesmo racional do fetchWithTimeout em js/auth.js: sem limite de tempo,
  // um fetch travado deixaria o painel preso em "Carregando painel..."
  // pra sempre, sem cair no estado de erro (que tem botão de "Tentar de novo").
  function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }
  function formatMoney(n){
    return "R$ " + Number(n).toFixed(2).replace(".", ",");
  }
  function formatDate(ts){
    return new Date(ts).toLocaleString("pt-BR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  }
  function slugify(str){
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  }
  // Mesma regra de fallback de imagem usada na vitrine (js/main.js:imageFor)
  // — sem foto customizada, mostra a mesma foto "de placeholder" que o
  // cliente já vê hoje, em vez de um ícone genérico/quebrado no painel.
  function imageFor(product){
    return product.photoUrl || `https://picsum.photos/seed/${encodeURIComponent(slugify(product.name))}/200/200`;
  }

  // Espelha PAYMENT_METHODS em server/server.js.
  const PAYMENT_METHOD_LABELS = { pix: "Pix", card: "Cartão ou boleto" };

  // Espelha PRODUCT_CATEGORIES em server/server.js e os chips de filtro em
  // index.html (data-cat) — mesmos slugs em todo o site.
  const CATEGORY_LABELS = {
    "maternidade": "Maternidade",
    "festa": "Festa",
    "batizado": "Batizado",
    "dia-a-dia": "Dia a dia",
    "presente": "Presente",
  };

  const STATUS_LABELS = {
    "pendente":    { label:"Pagamento pendente", cls:"order-status-pending" },
    "em análise":  { label:"Pagamento em análise", cls:"order-status-pending" },
    "pago":        { label:"Pago", cls:"order-status-paid" },
    "recusado":    { label:"Pagamento recusado", cls:"order-status-failed" },
    "cancelado":   { label:"Cancelado", cls:"order-status-failed" },
    "reembolsado": { label:"Reembolsado", cls:"order-status-failed" },
    "estornado":   { label:"Estornado", cls:"order-status-failed" },
  };

  const stateLoading = document.getElementById("adminLoading");
  const stateLoggedOut = document.getElementById("adminLoggedOut");
  const stateForbidden = document.getElementById("adminForbidden");
  const stateError = document.getElementById("adminError");
  const contentEl = document.getElementById("adminContent");
  const retryBtn = document.getElementById("adminRetryBtn");

  const statsRowEl = document.getElementById("statsRow");
  const productsTableBodyEl = document.getElementById("productsTableBody");
  const stateEmpty = document.getElementById("adminEmpty");
  const listEl = document.getElementById("adminList");
  const pendingCartsSectionEl = document.getElementById("pendingCartsSection");
  const pendingCartsListEl = document.getElementById("pendingCartsList");
  const couponsTableBodyEl = document.getElementById("couponsTableBody");
  const newCouponFormEl = document.getElementById("newCouponForm");
  const couponFormMsgEl = document.getElementById("couponFormMsg");
  const couponSaveBtnEl = document.getElementById("couponSaveBtn");

  function showOnly(target){
    [stateLoading, stateLoggedOut, stateForbidden, stateError, contentEl].forEach(node => {
      if(node) node.classList.toggle("d-none", node !== target);
    });
  }

  /* ============================= VISÃO GERAL ============================= */
  function renderStats(stats){
    statsRowEl.innerHTML = `
      <div class="stat-tile">
        <span class="stat-value">${formatMoney(stats.totalRevenue)}</span>
        <span class="stat-label">Vendas totais (pedidos pagos)</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${stats.totalOrders}</span>
        <span class="stat-label">Total de pedidos pagos</span>
      </div>
    `;
  }

  /* ======================== CARRINHOS PENDENTES ========================
     Recuperação de carrinho abandonado: pedidos "pendente" (checkout
     iniciado no Mercado Pago, pagamento nunca confirmado) entre 1h e 14
     dias atrás — cedo demais (< 1h) o cliente pode só estar terminando de
     pagar; tarde demais (> 14 dias) o contato deixa de fazer sentido. */
  const PENDING_CART_MIN_AGE_MS = 60 * 60 * 1000;
  const PENDING_CART_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function whatsappRecoveryUrl(order){
    const phoneDigits = String(order.customer?.telefone || "").replace(/\D/g, "");
    const firstName = String(order.customer?.nome || "").trim().split(" ")[0] || "";
    const itemNames = order.items.map(i => i.name).join(", ");
    const msg = `Olá${firstName ? " " + firstName : ""}! Vi que você começou uma compra (${itemNames}) aqui na Adriana Melo Acessórios e queria saber se posso ajudar a finalizar 💗`;
    return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
  }

  function renderPendingCarts(orders){
    const now = Date.now();
    const pending = orders.filter(o => {
      if(o.status !== "pendente") return false;
      const age = now - o.createdAt;
      return age >= PENDING_CART_MIN_AGE_MS && age <= PENDING_CART_MAX_AGE_MS;
    });

    if(!pending.length){
      pendingCartsSectionEl.classList.add("d-none");
      return;
    }
    pendingCartsSectionEl.classList.remove("d-none");
    pendingCartsListEl.innerHTML = pending.map(order => `
      <div class="order-card">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
          <div>
            <div class="fw-semibold">${escapeHTML(order.customer?.nome || "Cliente")}</div>
            <div class="small" style="color:var(--ink-soft)">Iniciado em ${formatDate(order.createdAt)}</div>
          </div>
          <span class="order-status order-status-pending">${escapeHTML(order.items.length)} ${order.items.length === 1 ? "item" : "itens"} — ${formatMoney(order.total)}</span>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <a href="${whatsappRecoveryUrl(order)}" target="_blank" rel="noopener noreferrer" class="btn-outline-blush">
            <i class="bi bi-whatsapp me-1"></i>Chamar no WhatsApp
          </a>
          <button type="button" class="btn-outline-blush delete-order-btn" data-ref="${escapeHTML(order.reference)}"><i class="bi bi-trash3 me-1"></i>Apagar carrinho</button>
        </div>
      </div>
    `).join("");
  }

  /* Apaga um pedido (usado tanto pelos cards de "Carrinhos pendentes"
     quanto pela lista geral de "Pedidos", abaixo). O servidor já barra a
     exclusão de pedidos "pago" (histórico financeiro) — o confirm() aqui
     é só pra evitar apagar um carrinho por engano num clique errado. */
  async function deleteOrderWithConfirm(reference, onSuccess){
    if(!confirm("Apagar este pedido? Essa ação não pode ser desfeita.")) return;
    try{
      const res = await fetchWithTimeout(`/api/admin/orders/${encodeURIComponent(reference)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível apagar o pedido.");
      onSuccess?.();
    }catch(err){
      alert(err.message || "Não foi possível apagar o pedido agora.");
    }
  }

  pendingCartsListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-order-btn");
    if(!btn) return;
    deleteOrderWithConfirm(btn.dataset.ref, () => loadDashboard());
  });

  /* ============================== PRODUTOS ============================== */
  let productsCache = [];

  function renderProductsTable(products){
    productsCache = products;
    productsTableBodyEl.innerHTML = products.map(p => `
      <tr data-product-id="${p.id}">
        <td><img class="admin-product-thumb" src="${imageFor(p)}" alt="${escapeHTML(p.name)}" width="44" height="44" loading="lazy"></td>
        <td>${escapeHTML(p.name)}</td>
        <td>${formatMoney(p.price)}</td>
        <td class="small" style="color:var(--ink-soft)">${escapeHTML(CATEGORY_LABELS[p.category] || p.category || "—")}</td>
        <td>${(p.badges && p.badges.length) ? p.badges.map(b => `<span class="admin-badge-pill">${escapeHTML(b)}</span>`).join("") : "—"}</td>
        <td class="text-end">
          <button type="button" class="btn-outline-blush edit-product-btn" data-id="${p.id}">Editar</button>
        </td>
      </tr>
    `).join("");
  }

  const editModalEl = document.getElementById("editProductModal");
  const editModal = new bootstrap.Modal(editModalEl);
  const editForm = document.getElementById("editProductForm");
  const epId = document.getElementById("epId");
  const epName = document.getElementById("epName");
  const epPrice = document.getElementById("epPrice");
  const epPhotoFile = document.getElementById("epPhotoFile");
  const epPhotoStatus = document.getElementById("epPhotoStatus");
  const epCategory = document.getElementById("epCategory");
  const epBadgeBestseller = document.getElementById("epBadgeBestseller");
  const epBadgeNew = document.getElementById("epBadgeNew");
  const epPreview = document.getElementById("epPreview");
  const epMsg = document.getElementById("epMsg");
  const epSaveBtn = document.getElementById("epSaveBtn");

  // Valores do produto no instante em que o modal foi aberto — comparados
  // no submit para montar um PATCH só com o que realmente mudou (ver
  // comentário no handler de submit, abaixo).
  let editOriginal = null;
  // `photoUrl` que vai entrar no PATCH se a lojista salvar: começa igual
  // ao valor atual do produto e só muda depois de um upload TERMINAR com
  // sucesso (nunca aponta para um arquivo ainda enviando ou que falhou).
  let pendingPhotoUrl = "";
  let photoUploadInFlight = false;

  function selectedBadges(){
    return [epBadgeBestseller, epBadgeNew].filter(cb => cb.checked).map(cb => cb.value);
  }

  function openEditModal(productId){
    const product = productsCache.find(p => p.id === productId);
    if(!product) return;
    epId.value = product.id;
    epName.value = product.name;
    epPrice.value = product.price;
    epPhotoFile.value = "";
    epCategory.value = product.category || "";
    epBadgeBestseller.checked = (product.badges || []).includes("Mais vendido");
    epBadgeNew.checked = (product.badges || []).includes("Novo");
    epPreview.src = imageFor(product);
    epMsg.textContent = "";
    epMsg.className = "small account-msg";
    epPhotoStatus.textContent = "";
    epPhotoStatus.className = "small mt-1";
    pendingPhotoUrl = product.photoUrl || "";
    photoUploadInFlight = false;
    editOriginal = {
      name: product.name,
      price: product.price,
      photoUrl: product.photoUrl || "",
      category: product.category || "",
      badges: [...(product.badges || [])].sort(),
    };
    editModal.show();
  }

  /* =====================================================================
     UPLOAD DE FOTO — como funciona
     ---------------------------------------------------------------------
     1) Ao escolher um arquivo, a FileReader API lê os bytes localmente e
        gera uma data URL (base64) só para a pré-visualização instantânea
        (`epPreview.src`) — nunca sai do navegador, é só pra lojista ver o
        que escolheu na hora, sem esperar rede nenhuma.
     2) Em paralelo, o arquivo original (não o base64) é enviado via
        `FormData`/multipart para POST /api/admin/products/:id/photo, que
        grava em disco no servidor e devolve um caminho curto
        (ex.: "/img/products/produto-2-1699999999999.jpg").
     3) Esse caminho fica guardado em `pendingPhotoUrl` até a lojista
        clicar em "Salvar alterações" — só então ele entra no PATCH normal
        do produto (mesmo payload compacto dos outros campos), junto com
        nome/preço/categoria/selos que também tenham mudado.
     Por que não mandar o base64 direto pro servidor: um arquivo de imagem
     em base64 fica ~33% maior que o arquivo original, e viajaria dentro
     de um JSON comum — o multipart/FormData manda os bytes originais,
     sem esse inchaço, e permite ao servidor limitar/validar o upload
     (tamanho, tipo) antes mesmo de tentar interpretar o corpo como JSON.
  ===================================================================== */
  epPhotoFile.addEventListener("change", () => {
    const file = epPhotoFile.files[0];
    if(!file) return;

    epMsg.textContent = "";
    epMsg.className = "small account-msg";

    const reader = new FileReader();
    reader.onload = () => { epPreview.src = reader.result; };
    reader.readAsDataURL(file);

    const id = Number(epId.value);
    const formData = new FormData();
    formData.append("photo", file);

    photoUploadInFlight = true;
    epSaveBtn.disabled = true;
    epPhotoStatus.textContent = "Enviando imagem...";
    epPhotoStatus.className = "small mt-1";

    fetchWithTimeout(`/api/admin/products/${id}/photo`, { method: "POST", body: formData }, 20000)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.error || "Não foi possível enviar a imagem.");
        pendingPhotoUrl = data.photoUrl;
        epPhotoStatus.textContent = "Imagem enviada.";
        epPhotoStatus.classList.add("is-success");
      })
      .catch((err) => {
        epPhotoStatus.textContent = err.message || "Erro ao enviar a imagem.";
        epPhotoStatus.classList.add("is-error");
        // Upload falhou: volta a pré-visualização pro que já estava salvo,
        // e desfaz a seleção do arquivo pra não sugerir que ele "pegou".
        const product = productsCache.find(p => p.id === id);
        epPreview.src = product ? imageFor(product) : "";
        epPhotoFile.value = "";
      })
      .finally(() => {
        photoUploadInFlight = false;
        epSaveBtn.disabled = false;
      });
  });

  productsTableBodyEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".edit-product-btn");
    if(!btn) return;
    openEditModal(Number(btn.dataset.id));
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if(photoUploadInFlight) return; // botão já fica desabilitado, isto é só uma segunda trava
    const id = Number(epId.value);
    const name = epName.value.trim();
    const price = Number(epPrice.value);
    const category = epCategory.value;
    const badges = selectedBadges();

    // Payload compacto: manda só os campos que mudaram desde que o modal
    // abriu, em vez do produto inteiro a cada "Salvar" — ver PATCH
    // /api/admin/products/:id em server.js, que trata ausência de uma
    // chave como "não mexeu nisso" (preserva o valor já salvo).
    const patch = {};
    if(name !== editOriginal.name) patch.name = name;
    if(price !== editOriginal.price) patch.price = price;
    if(pendingPhotoUrl !== editOriginal.photoUrl) patch.photoUrl = pendingPhotoUrl;
    if(category !== editOriginal.category) patch.category = category;
    const sortedBadges = [...badges].sort();
    if(JSON.stringify(sortedBadges) !== JSON.stringify(editOriginal.badges)) patch.badges = badges;

    if(Object.keys(patch).length === 0){
      editModal.hide();
      return;
    }

    epMsg.textContent = "";
    epMsg.className = "small account-msg";
    epSaveBtn.disabled = true;
    epSaveBtn.textContent = "Salvando...";

    try{
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível salvar o produto.");

      const idx = productsCache.findIndex(p => p.id === id);
      if(idx !== -1) productsCache[idx] = data;
      renderProductsTable(productsCache);

      editModal.hide();
    }catch(err){
      epMsg.textContent = err.message || "Erro ao salvar.";
      epMsg.classList.add("text-danger");
    }finally{
      epSaveBtn.disabled = false;
      epSaveBtn.textContent = "Salvar alterações";
    }
  });

  /* ================================ PEDIDOS ================================ */
  function addressLine(address){
    const street = [address?.rua, address?.numero].filter(Boolean).join(", ");
    const rest = [address?.bairro, address?.cidade, address?.uf].filter(Boolean).join(" — ");
    const cep = address?.cep ? `CEP ${address.cep}` : "";
    return [street, rest, cep].filter(Boolean).join(" · ") || "—";
  }

  function orderCardHTML(order){
    const status = STATUS_LABELS[order.status] || { label: escapeHTML(order.status), cls:"order-status-pending" };
    const ref = order.reference;
    const isPaid = order.status === "pago";

    const itemsHtml = order.items.map(item => `
      <li class="d-flex justify-content-between gap-3">
        <span>${item.qty}x ${escapeHTML(item.name)} — cor: ${escapeHTML(item.color)}</span>
        <span>${item.unitPrice != null ? formatMoney(item.unitPrice * item.qty) : "—"}</span>
      </li>
    `).join("");

    return `
      <div class="order-card" id="pedido-${escapeHTML(ref)}" data-ref="${escapeHTML(ref)}">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
          <div>
            <div class="fw-semibold">Pedido #${escapeHTML(ref.slice(0, 8))}</div>
            <div class="small" style="color:var(--ink-soft)">${formatDate(order.createdAt)}</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="order-status ${status.cls}">${status.label}</span>
            ${!isPaid ? `<button type="button" class="delete-order-icon-btn delete-order-btn" data-ref="${escapeHTML(ref)}" aria-label="Apagar pedido" title="Apagar pedido"><i class="bi bi-trash3"></i></button>` : ""}
          </div>
        </div>

        <div class="small mb-3" style="color:var(--ink-soft)">
          <div><strong style="color:var(--ink)">Cliente:</strong> ${escapeHTML(order.customer?.nome || "—")}</div>
          <div><strong style="color:var(--ink)">Telefone:</strong> ${escapeHTML(order.customer?.telefone || "—")}</div>
          ${order.customer?.email ? `<div><strong style="color:var(--ink)">E-mail da conta:</strong> ${escapeHTML(order.customer.email)}</div>` : ""}
          <div><strong style="color:var(--ink)">Entrega:</strong> ${escapeHTML(addressLine(order.address))}${order.shipping?.name ? ` — ${escapeHTML(order.shipping.name)}` : ""}</div>
        </div>

        <ul class="list-unstyled small mb-2">${itemsHtml}</ul>

        ${order.discount > 0 ? `
        <div class="d-flex justify-content-between small" style="color:var(--blush-700)">
          <span>Desconto${order.couponCode ? " (" + escapeHTML(order.couponCode) + ")" : ""}</span>
          <span>-${formatMoney(order.discount)}</span>
        </div>` : ""}
        ${order.pixDiscount > 0 ? `
        <div class="d-flex justify-content-between small" style="color:var(--blush-700)">
          <span>Desconto Pix</span><span>-${formatMoney(order.pixDiscount)}</span>
        </div>` : ""}

        <div class="d-flex justify-content-between fw-semibold pt-2 mt-1 border-top" style="border-color:var(--blush-100)!important">
          <span>Total <span class="fw-normal small" style="color:var(--ink-soft)">· ${escapeHTML(PAYMENT_METHOD_LABELS[order.paymentMethod] || "Cartão ou boleto")}</span></span>
          <span style="color:var(--blush-700)">${formatMoney(order.total)}</span>
        </div>

        ${isPaid ? `
        <div class="tracking-row mt-3 pt-3 border-top d-flex flex-wrap align-items-center gap-2" style="border-color:var(--blush-100)!important">
          <label class="small fw-semibold mb-0" for="tracking-${escapeHTML(ref)}">Código de rastreio (Correios)</label>
          <div class="d-flex gap-2 flex-grow-1 flex-wrap" style="min-width:220px">
            <input type="text" class="form-control form-control-sm tracking-input" id="tracking-${escapeHTML(ref)}"
                   value="${escapeHTML(order.trackingCode || "")}" placeholder="Ex.: BR123456789BR" maxlength="60">
            <button type="button" class="btn-outline-blush save-tracking-btn" data-ref="${escapeHTML(ref)}">Salvar</button>
            <button type="button" class="btn-outline-blush generate-label-btn" data-ref="${escapeHTML(ref)}" title="Compra a etiqueta no Melhor Envio e preenche o código automaticamente"><i class="bi bi-stars me-1"></i>Gerar código</button>
          </div>
          <span class="small tracking-feedback" data-ref-feedback="${escapeHTML(ref)}"></span>
        </div>
        ` : ""}
      </div>
    `;
  }

  function highlightFromQuery(){
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("pedido");
    if(!ref) return;
    // getElementById recebe o id LITERAL, não um seletor CSS — passar por
    // CSS.escape aqui quebrava justamente os casos reais: a referência é um
    // UUID, e quando ele começa com dígito o escape vira "\38 f2a…", que
    // nunca casa com o id no DOM. Resultado: o link "ver no painel" do
    // e-mail de pedido pago abria a página e não destacava nada.
    const card = document.getElementById(`pedido-${ref}`);
    if(!card) return;
    card.scrollIntoView({ behavior:"smooth", block:"center" });
    card.classList.add("is-highlighted");
    setTimeout(() => card.classList.remove("is-highlighted"), 4000);
  }

  function renderOrders(orders){
    if(!orders.length){
      stateEmpty.classList.remove("d-none");
      listEl.classList.add("d-none");
      return;
    }
    stateEmpty.classList.add("d-none");
    listEl.classList.remove("d-none");
    listEl.innerHTML = orders.map(orderCardHTML).join("");
    highlightFromQuery();
  }

  async function saveTracking(ref, trackingCode, feedbackEl){
    feedbackEl.textContent = "Salvando...";
    feedbackEl.classList.remove("is-success", "is-error");
    try{
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(ref)}/tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingCode }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível salvar.");
      feedbackEl.textContent = "Salvo!";
      feedbackEl.classList.add("is-success");
      setTimeout(() => { feedbackEl.textContent = ""; }, 2500);
    }catch(err){
      feedbackEl.textContent = err.message || "Erro ao salvar.";
      feedbackEl.classList.add("is-error");
    }
  }

  // ⚠️ Compra a etiqueta de verdade no Melhor Envio (gasta saldo real da
  // conta) — por isso confirm() antes, mesmo já sendo um clique
  // deliberado da lojista num botão explicitamente rotulado.
  async function generateLabel(ref, feedbackEl, btn){
    if(!confirm("Gerar a etiqueta de envio agora? Isso compra o frete de verdade no Melhor Envio (gasta saldo da conta).")) return;
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "Gerando...";
    feedbackEl.textContent = "";
    feedbackEl.classList.remove("is-success", "is-error");
    try{
      const res = await fetchWithTimeout(`/api/admin/orders/${encodeURIComponent(ref)}/generate-label`, { method: "POST" }, 20000);
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível gerar a etiqueta.");
      const input = document.getElementById(`tracking-${ref}`);
      if(input && data.trackingCode) input.value = data.trackingCode;
      feedbackEl.textContent = data.trackingCode ? "Código gerado!" : "Etiqueta comprada, mas sem código de rastreio na resposta — confira no painel do Melhor Envio.";
      feedbackEl.classList.add("is-success");
    }catch(err){
      feedbackEl.textContent = err.message || "Erro ao gerar etiqueta.";
      feedbackEl.classList.add("is-error");
    }finally{
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  }

  listEl.addEventListener("click", (e) => {
    const trackBtn = e.target.closest(".save-tracking-btn");
    const labelBtn = e.target.closest(".generate-label-btn");
    const deleteBtn = e.target.closest(".delete-order-btn");

    if(trackBtn){
      const ref = trackBtn.dataset.ref;
      const input = document.getElementById(`tracking-${ref}`);
      const feedbackEl = listEl.querySelector(`[data-ref-feedback="${ref}"]`);
      if(input && feedbackEl) saveTracking(ref, input.value.trim(), feedbackEl);
      return;
    }
    if(labelBtn){
      const ref = labelBtn.dataset.ref;
      const feedbackEl = listEl.querySelector(`[data-ref-feedback="${ref}"]`);
      if(feedbackEl) generateLabel(ref, feedbackEl, labelBtn);
      return;
    }
    if(deleteBtn){
      deleteOrderWithConfirm(deleteBtn.dataset.ref, () => loadDashboard());
    }
  });

  /* ================================ CUPONS ================================ */
  function renderCouponsTable(coupons){
    if(!coupons.length){
      couponsTableBodyEl.innerHTML = `<tr><td colspan="4" class="text-center small py-3" style="color:var(--ink-soft)">Nenhum cupom cadastrado.</td></tr>`;
      return;
    }
    couponsTableBodyEl.innerHTML = coupons.map(c => `
      <tr data-code="${escapeHTML(c.code)}">
        <td class="fw-semibold">${escapeHTML(c.code)}</td>
        <td>${c.percentOff}%</td>
        <td class="small" style="color:var(--ink-soft)">${escapeHTML(c.description || "—")}</td>
        <td class="text-end">
          <button type="button" class="delete-order-icon-btn delete-coupon-btn" data-code="${escapeHTML(c.code)}" aria-label="Apagar cupom" title="Apagar cupom"><i class="bi bi-trash3"></i></button>
        </td>
      </tr>
    `).join("");
  }

  couponsTableBodyEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-coupon-btn");
    if(!btn) return;
    const code = btn.dataset.code;
    if(!confirm(`Apagar o cupom ${code}? Ele deixa de funcionar no checkout imediatamente.`)) return;
    try{
      const res = await fetchWithTimeout(`/api/admin/coupons/${encodeURIComponent(code)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível apagar o cupom.");
      loadDashboard();
    }catch(err){
      alert(err.message || "Não foi possível apagar o cupom agora.");
    }
  });

  newCouponFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("couponCode").value.trim();
    const percentOff = Number(document.getElementById("couponPercent").value);
    const description = document.getElementById("couponDesc").value.trim();

    couponFormMsgEl.textContent = "";
    couponFormMsgEl.className = "small account-msg";
    couponSaveBtnEl.disabled = true;
    try{
      const res = await fetchWithTimeout("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, percentOff, description }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível criar o cupom.");
      newCouponFormEl.reset();
      loadDashboard();
    }catch(err){
      couponFormMsgEl.textContent = err.message || "Erro ao criar cupom.";
      couponFormMsgEl.classList.add("text-danger");
    }finally{
      couponSaveBtnEl.disabled = false;
    }
  });

  /* ============================ CARREGAMENTO ============================ */
  async function loadDashboard(){
    showOnly(stateLoading);
    try{
      const [ordersRes, productsRes, couponsRes] = await Promise.all([
        fetchWithTimeout("/api/admin/orders"),
        fetchWithTimeout("/api/admin/products"),
        fetchWithTimeout("/api/admin/coupons"),
      ]);
      if([ordersRes, productsRes, couponsRes].some(r => r.status === 401)){ showOnly(stateLoggedOut); return; }
      if([ordersRes, productsRes, couponsRes].some(r => r.status === 403)){ showOnly(stateForbidden); return; }
      if(!ordersRes.ok || !productsRes.ok || !couponsRes.ok){
        throw new Error("Falha ao carregar o painel (HTTP " + (ordersRes.status || productsRes.status || couponsRes.status) + ").");
      }
      const ordersData = await ordersRes.json();
      const productsData = await productsRes.json();
      const couponsData = await couponsRes.json();

      const orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];
      showOnly(contentEl);
      renderStats(ordersData.stats || { totalRevenue: 0, totalOrders: 0 });
      renderPendingCarts(orders);
      renderProductsTable(Array.isArray(productsData.products) ? productsData.products : []);
      renderCouponsTable(Array.isArray(couponsData.coupons) ? couponsData.coupons : []);
      renderOrders(orders);
    }catch(err){
      console.error("Erro ao carregar painel administrativo:", err);
      showOnly(stateError);
    }
  }

  retryBtn?.addEventListener("click", loadDashboard);

  // js/auth.js já faz a checagem de sessão ao carregar a página; reagimos
  // ao resultado dela em vez de checar de novo (evita duas chamadas a
  // /api/auth/me). Só tenta carregar o painel se o usuário for admin — do
  // contrário mostra o estado apropriado sem nunca chamar /api/admin/* (a
  // proteção de verdade é sempre no servidor, isso é só para não fazer uma
  // chamada que sabemos que vai voltar 401/403).
  let authEventReceived = false;
  document.addEventListener("plc:auth", (e) => {
    authEventReceived = true;
    const user = e.detail.user;
    if(!user) showOnly(stateLoggedOut);
    else if(!user.isAdmin) showOnly(stateForbidden);
    else loadDashboard();
  });

  // Rede de segurança: se por algum motivo o evento "plc:auth" nunca
  // chegar (ex.: js/auth.js falhou ao carregar), não fica preso em
  // "Carregando painel..." pra sempre — mostra erro com botão de retry.
  setTimeout(() => {
    if(!authEventReceived) showOnly(stateError);
  }, 10000);
})();
