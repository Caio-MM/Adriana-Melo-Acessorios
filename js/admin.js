(function(){
  "use strict";

  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
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

  /* ============================== PRODUTOS ============================== */
  let productsCache = [];

  function renderProductsTable(products){
    productsCache = products;
    productsTableBodyEl.innerHTML = products.map(p => `
      <tr data-product-id="${p.id}">
        <td><img class="admin-product-thumb" src="${imageFor(p)}" alt="${escapeHTML(p.name)}" width="44" height="44" loading="lazy"></td>
        <td>${escapeHTML(p.name)}</td>
        <td>${formatMoney(p.price)}</td>
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
  const epPhoto = document.getElementById("epPhoto");
  const epPreview = document.getElementById("epPreview");
  const epMsg = document.getElementById("epMsg");
  const epSaveBtn = document.getElementById("epSaveBtn");

  function openEditModal(productId){
    const product = productsCache.find(p => p.id === productId);
    if(!product) return;
    epId.value = product.id;
    epName.value = product.name;
    epPrice.value = product.price;
    epPhoto.value = product.photoUrl || "";
    epPreview.src = imageFor(product);
    epMsg.textContent = "";
    epMsg.className = "small account-msg";
    editModal.show();
  }

  // Pré-visualização ao vivo enquanto a lojista cola/edita a URL da foto.
  epPhoto.addEventListener("input", () => {
    const product = productsCache.find(p => p.id === Number(epId.value));
    epPreview.src = epPhoto.value.trim() || (product ? imageFor(product) : "");
  });

  productsTableBodyEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".edit-product-btn");
    if(!btn) return;
    openEditModal(Number(btn.dataset.id));
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = Number(epId.value);
    const name = epName.value.trim();
    const price = Number(epPrice.value);
    const photoUrl = epPhoto.value.trim();

    epMsg.textContent = "";
    epMsg.className = "small account-msg";
    epSaveBtn.disabled = true;
    epSaveBtn.textContent = "Salvando...";

    try{
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, photoUrl }),
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
          <span class="order-status ${status.cls}">${status.label}</span>
        </div>

        <div class="small mb-3" style="color:var(--ink-soft)">
          <div><strong style="color:var(--ink)">Cliente:</strong> ${escapeHTML(order.customer?.nome || "—")}</div>
          <div><strong style="color:var(--ink)">Telefone:</strong> ${escapeHTML(order.customer?.telefone || "—")}</div>
          ${order.customer?.email ? `<div><strong style="color:var(--ink)">E-mail da conta:</strong> ${escapeHTML(order.customer.email)}</div>` : ""}
          <div><strong style="color:var(--ink)">Entrega:</strong> ${escapeHTML(addressLine(order.address))}${order.shipping?.name ? ` — ${escapeHTML(order.shipping.name)}` : ""}</div>
        </div>

        <ul class="list-unstyled small mb-2">${itemsHtml}</ul>

        <div class="d-flex justify-content-between fw-semibold pt-2 mt-1 border-top" style="border-color:var(--blush-100)!important">
          <span>Total</span><span style="color:var(--blush-700)">${formatMoney(order.total)}</span>
        </div>

        <div class="tracking-row mt-3 pt-3 border-top d-flex flex-wrap align-items-center gap-2" style="border-color:var(--blush-100)!important">
          <label class="small fw-semibold mb-0" for="tracking-${escapeHTML(ref)}">Código de rastreio (Correios)</label>
          <div class="d-flex gap-2 flex-grow-1" style="min-width:220px">
            <input type="text" class="form-control form-control-sm tracking-input" id="tracking-${escapeHTML(ref)}"
                   value="${escapeHTML(order.trackingCode || "")}" placeholder="Ex.: BR123456789BR" maxlength="60">
            <button type="button" class="btn-outline-blush save-tracking-btn" data-ref="${escapeHTML(ref)}">Salvar</button>
          </div>
          <span class="small tracking-feedback" data-ref-feedback="${escapeHTML(ref)}"></span>
        </div>
      </div>
    `;
  }

  function highlightFromQuery(){
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("pedido");
    if(!ref) return;
    const card = document.getElementById(`pedido-${CSS.escape(ref)}`);
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

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".save-tracking-btn");
    if(!btn) return;
    const ref = btn.dataset.ref;
    const input = document.getElementById(`tracking-${ref}`);
    const feedbackEl = listEl.querySelector(`[data-ref-feedback="${ref}"]`);
    if(input && feedbackEl) saveTracking(ref, input.value.trim(), feedbackEl);
  });

  /* ============================ CARREGAMENTO ============================ */
  async function loadDashboard(){
    showOnly(stateLoading);
    try{
      const [ordersRes, productsRes] = await Promise.all([
        fetch("/api/admin/orders"),
        fetch("/api/admin/products"),
      ]);
      if(ordersRes.status === 401 || productsRes.status === 401){ showOnly(stateLoggedOut); return; }
      if(ordersRes.status === 403 || productsRes.status === 403){ showOnly(stateForbidden); return; }
      if(!ordersRes.ok || !productsRes.ok){
        throw new Error("Falha ao carregar o painel (HTTP " + (ordersRes.status || productsRes.status) + ").");
      }
      const ordersData = await ordersRes.json();
      const productsData = await productsRes.json();

      showOnly(contentEl);
      renderStats(ordersData.stats || { totalRevenue: 0, totalOrders: 0 });
      renderProductsTable(Array.isArray(productsData.products) ? productsData.products : []);
      renderOrders(Array.isArray(ordersData.orders) ? ordersData.orders : []);
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
  document.addEventListener("plc:auth", (e) => {
    const user = e.detail.user;
    if(!user) showOnly(stateLoggedOut);
    else if(!user.isAdmin) showOnly(stateForbidden);
    else loadDashboard();
  });
})();
