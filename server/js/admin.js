(function(){
  "use strict";

  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  const formatMoney = window.PLCPricing.formatMoney;
  function formatDate(ts){
    return new Date(ts).toLocaleString("pt-BR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  }

  function imageFor(product){
    return product.photoUrl || "";
  }
  const BOW_PLACEHOLDER = `<span class="admin-thumb-placeholder" aria-hidden="true"><svg class="bow-icon"><use href="#bow-shape"/></svg></span>`;

  const PAYMENT_METHOD_LABELS = { pix: "Pix", card: "Cartão ou boleto" };

  let CATEGORY_LABELS = {
    "maternidade": "Maternidade",
    "festa": "Festa",
    "batizado": "Batizado",
    "dia-a-dia": "Dia a dia",
    "presente": "Presente",
  };
  let currentCategories = Object.entries(CATEGORY_LABELS).map(([slug, label]) => ({ slug, label }));
  function applyCategories(categories){
    if(!Array.isArray(categories) || categories.length === 0) return;
    currentCategories = categories;
    CATEGORY_LABELS = Object.fromEntries(categories.map(c => [c.slug, c.label]));
  }

  function renderCategoryOptions(selectEl, selectedSlug){
    selectEl.innerHTML = currentCategories
      .map(c => `<option value="${escapeHTML(c.slug)}">${escapeHTML(c.label)}</option>`).join("");
    if(selectedSlug) selectEl.value = selectedSlug;
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
  const stateTwoFactor = document.getElementById("adminTwoFactorSetup");
  const stateRecovery = document.getElementById("adminRecoveryCodes");
  const contentEl = document.getElementById("adminContent");
  const retryBtn = document.getElementById("adminRetryBtn");

  const statsRowEl = document.getElementById("statsRow");
  const productsTableBodyEl = document.getElementById("productsTableBody");
  const stateEmpty = document.getElementById("adminEmpty");
  const listEl = document.getElementById("adminList");
  const pendingCartsSectionEl = document.getElementById("pendingCartsSection");
  const pendingCartsListEl = document.getElementById("pendingCartsList");
  const messagesListEl = document.getElementById("messagesList");
  const couponsTableBodyEl = document.getElementById("couponsTableBody");
  const newCouponFormEl = document.getElementById("newCouponForm");
  const couponFormMsgEl = document.getElementById("couponFormMsg");
  const couponSaveBtnEl = document.getElementById("couponSaveBtn");

  function showOnly(target){
    [stateLoading, stateLoggedOut, stateForbidden, stateError,
     stateTwoFactor, stateRecovery, contentEl].forEach(node => {
      if(node) node.classList.toggle("d-none", node !== target);
    });

    document.body.classList.toggle(
      "admin-gate-active", target === stateTwoFactor || target === stateRecovery
    );
  }

  /* ==================== VERIFICAÇÃO EM DUAS ETAPAS ==================== */
  let tfaSecret = null;

  async function startTwoFactorSetup(){
    showOnly(stateTwoFactor);
    try{
      const res = await fetch("/api/admin/2fa/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      if(!res.ok) throw new Error("falha ao preparar");
      const data = await res.json();
      tfaSecret = data.secret;
      document.getElementById("tfaQr").src = data.qrDataUri;

      document.getElementById("tfaSecret").textContent = data.secret.replace(/(.{4})/g, "$1 ").trim();
    }catch{
      showOnly(stateError);
    }
  }

  document.getElementById("tfaActivateForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("tfaActivateBtn");
    const msg = document.getElementById("tfaMsg");
    const codeEl = document.getElementById("tfaCode");
    msg.textContent = "";
    msg.classList.remove("text-danger");
    btn.disabled = true;
    try{
      const res = await fetch("/api/admin/2fa/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: tfaSecret, code: codeEl.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível ativar agora.");
      renderRecoveryCodes(data.recoveryCodes);
    }catch(err){
      msg.textContent = err.message;
      msg.classList.add("text-danger");
      codeEl.select();

      codeEl.classList.remove("tfa-shake");
      void codeEl.offsetWidth;
      codeEl.classList.add("tfa-shake");
    }finally{
      btn.disabled = false;
    }
  });

  function renderRecoveryCodes(codes){
    const list = document.getElementById("tfaRecoveryList");
    list.innerHTML = "";
    codes.forEach(code => {
      const li = document.createElement("li");

      li.textContent = code;
      list.appendChild(li);
    });
    document.getElementById("tfaCopyCodesBtn").onclick = async () => {
      await navigator.clipboard.writeText(codes.join("\n"));
      const btn = document.getElementById("tfaCopyCodesBtn");
      btn.innerHTML = '<i class="bi bi-check2"></i> Copiado!';
      setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard"></i> Copiar códigos'; }, 2000);
    };
    showOnly(stateRecovery);
  }

  document.getElementById("tfaSavedCheck")?.addEventListener("change", (e) => {
    document.getElementById("tfaDoneBtn").disabled = !e.target.checked;
  });
  document.getElementById("tfaDoneBtn")?.addEventListener("click", () => loadDashboard());

  /* ================================ ABAS ================================ */
  const adminTabsEl = document.getElementById("adminTabs");
  const tabButtons = [...document.querySelectorAll(".admin-tab-btn")];
  const tabPanels = [...document.querySelectorAll(".admin-tab-panel")];

  function switchTab(tabName){
    const target = tabPanels.find(p => p.dataset.tabPanel === tabName);
    if(!target) return;
    tabButtons.forEach(btn => btn.classList.toggle("is-active", btn.dataset.tab === tabName));
    tabPanels.forEach(panel => panel.classList.toggle("d-none", panel !== target));
  }

  adminTabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab-btn");
    if(btn) switchTab(btn.dataset.tab);
  });

  /* ============================= VISÃO GERAL ============================= */
  function renderStats(stats){

    const avgTicket = stats.totalOrders ? stats.totalRevenue / stats.totalOrders : 0;
    statsRowEl.innerHTML = `
      <div class="stat-tile stat-tile--revenue">
        <div class="stat-tile-icon"><i class="bi bi-wallet2"></i></div>
        <div>
          <span class="stat-value">${formatMoney(stats.totalRevenue)}</span>
          <span class="stat-label">Vendas totais</span>
        </div>
      </div>
      <div class="stat-tile stat-tile--orders">
        <div class="stat-tile-icon"><i class="bi bi-bag-check"></i></div>
        <div>
          <span class="stat-value">${stats.totalOrders}</span>
          <span class="stat-label">Total de pedidos</span>
        </div>
      </div>
      <div class="stat-tile stat-tile--avg">
        <div class="stat-tile-icon"><i class="bi bi-graph-up-arrow"></i></div>
        <div>
          <span class="stat-value">${formatMoney(avgTicket)}</span>
          <span class="stat-label">Ticket médio</span>
        </div>
      </div>
    `;
  }

  /* ======================== GRÁFICO DE VENDAS POR MÊS ======================== */
  const MONTH_LABELS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const salesChartEl = document.getElementById("salesChart");

  function computeMonthlySales(orders, monthsWindow){
    const now = new Date();
    const buckets = [];
    for(let i = monthsWindow - 1; i >= 0; i--){
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ year: d.getFullYear(), month: d.getMonth(), revenue: 0, count: 0 });
    }
    orders
      .filter(o => o.status === "pago")
      .forEach(o => {
        const d = new Date(o.createdAt);
        const bucket = buckets.find(b => b.year === d.getFullYear() && b.month === d.getMonth());
        if(bucket){ bucket.revenue += o.total; bucket.count += 1; }
      });
    return buckets;
  }

  function renderSalesChart(orders){
    const buckets = computeMonthlySales(orders, 6);
    const maxRevenue = Math.max(...buckets.map(b => b.revenue), 0);
    const now = new Date();

    salesChartEl.innerHTML = buckets.map(b => {
      const isCurrent = b.year === now.getFullYear() && b.month === now.getMonth();

      const pct = maxRevenue > 0 ? Math.max((b.revenue / maxRevenue) * 100, 3) : 3;
      const orderWord = b.count === 1 ? "pedido" : "pedidos";
      return `
        <div class="sales-chart-bar-wrap${isCurrent ? " is-current" : ""}">
          <div class="sales-chart-tooltip">${formatMoney(b.revenue)}<small>${b.count} ${orderWord}</small></div>
          <div class="sales-chart-bar" style="--bar-pct:${pct}%"></div>
          <span class="sales-chart-month">${MONTH_LABELS[b.month]}${isCurrent ? "<small>atual</small>" : ""}</span>
        </div>
      `;
    }).join("");
  }

  /* ==================== VISÕES DO DASHBOARD ==================== */

  function renderBarList(el, items, emptyMessage){
    if(!el) return;
    if(!items.length){
      el.innerHTML = `<p class="section-sub mb-0" style="font-size:.85rem">${escapeHTML(emptyMessage)}</p>`;
      return;
    }
    const max = Math.max(...items.map(i => i.value), 0);
    el.innerHTML = items.map(item => {

      const pct = max > 0 ? Math.max((item.value / max) * 100, 2) : 2;
      return `
        <div class="bar-row">
          <div class="bar-row-head">
            <span class="bar-row-label">${escapeHTML(item.label)}</span>
            <span class="bar-row-value">${escapeHTML(item.display)}</span>
          </div>
          <div class="bar-row-track"><div class="bar-row-fill" style="width:${pct}%"></div></div>
          ${item.meta ? `<span class="bar-row-meta">${escapeHTML(item.meta)}</span>` : ""}
        </div>`;
    }).join("");
  }

  const paidOrdersOf = (orders) => orders.filter(o => o.status === "pago");

  function tallyItems(orders, keyOf){
    const totals = new Map();
    for(const order of paidOrdersOf(orders)){
      for(const item of order.items || []){
        const key = keyOf(item);
        if(key == null) continue;
        const acc = totals.get(key) || { units: 0, revenue: 0 };
        acc.units += item.qty;
        acc.revenue += (item.unitPrice || 0) * item.qty;
        totals.set(key, acc);
      }
    }
    return [...totals.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  function renderCategoryChart(orders, products){
    const categoryOf = new Map(products.map(p => [p.id, p.category]));
    const rows = tallyItems(orders, item => categoryOf.get(item.id) || "sem-categoria");
    renderBarList(
      document.getElementById("categoryChart"),
      rows.map(r => ({
        label: CATEGORY_LABELS[r.key] || "Sem categoria",
        value: r.revenue,
        display: formatMoney(r.revenue),
        meta: `${r.units} ${r.units === 1 ? "unidade" : "unidades"}`,
      })),
      "Nenhuma venda paga ainda."
    );
  }

  function renderTopProductsChart(orders){

    const rows = tallyItems(orders, item => item.name || `Produto #${item.id}`)
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);
    renderBarList(
      document.getElementById("topProductsChart"),
      rows.map(r => ({
        label: r.key,
        value: r.units,
        display: `${r.units} un.`,
        meta: formatMoney(r.revenue),
      })),
      "Nenhuma venda paga ainda."
    );
  }

  function renderStatusChart(orders){
    const counts = new Map();
    for(const order of orders){
      counts.set(order.status, (counts.get(order.status) || 0) + 1);
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = orders.length;
    renderBarList(
      document.getElementById("statusChart"),
      rows.map(([status, count]) => ({
        label: STATUS_LABELS[status]?.label || status,
        value: count,
        display: String(count),
        meta: total > 0 ? `${Math.round((count / total) * 100)}% dos pedidos` : "",
      })),
      "Nenhum pedido registrado ainda."
    );
  }

  function renderPaymentChart(orders){
    const totals = new Map();
    for(const order of paidOrdersOf(orders)){
      const method = order.paymentMethod || "card";
      const acc = totals.get(method) || { count: 0, revenue: 0 };
      acc.count += 1;
      acc.revenue += order.total;
      totals.set(method, acc);
    }
    const rows = [...totals.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    renderBarList(
      document.getElementById("paymentChart"),
      rows.map(([method, v]) => ({
        label: PAYMENT_METHOD_LABELS[method] || method,
        value: v.revenue,
        display: formatMoney(v.revenue),
        meta: `${v.count} ${v.count === 1 ? "pedido" : "pedidos"}`,
      })),
      "Nenhuma venda paga ainda."
    );
  }

  /* ======================== CARRINHOS PENDENTES ======================== */
  const PENDING_CART_MIN_AGE_MS = 60 * 60 * 1000;
  const PENDING_CART_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function whatsappDigitsWithCountryCode(phone){
    let digits = String(phone || "").replace(/\D/g, "");
    if(!digits) return "";
    if(digits.length > 11) digits = digits.replace(/^0+/, "");
    if(digits.length >= 12 && digits.startsWith("55")) return digits;
    return `55${digits}`;
  }
  function whatsappUrl(phone, message){
    const phoneDigits = whatsappDigitsWithCountryCode(phone);
    if(!phoneDigits) return null;
    return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
  }

  function whatsappRecoveryUrl(order){
    const firstName = String(order.customer?.nome || "").trim().split(" ")[0] || "";
    const itemNames = order.items.map(i => i.name).join(", ");
    const msg = `Olá${firstName ? " " + firstName : ""}! Vi que você começou uma compra (${itemNames}) aqui na Adriana Melo Acessórios e queria saber se posso ajudar a finalizar 💗`;
    return whatsappUrl(order.customer?.telefone, msg);
  }

  const WHATSAPP_POST_SALE_MESSAGE = "Olá, recebemos o seu pedido na Adriana Melo Acessórios e estamos à disposição para qualquer dúvida.";
  function whatsappContactUrl(order){
    return whatsappUrl(order.customer?.telefone, WHATSAPP_POST_SALE_MESSAGE);
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
    pendingCartsListEl.innerHTML = pending.map(order => {
      const recoveryUrl = whatsappRecoveryUrl(order);
      return `
      <div class="order-card">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
          <div>
            <div class="fw-semibold">${escapeHTML(order.customer?.nome || "Cliente")}</div>
            <div class="small" style="color:var(--ink-soft)">Iniciado em ${formatDate(order.createdAt)}</div>
          </div>
          <span class="order-status order-status-pending">${escapeHTML(order.items.length)} ${order.items.length === 1 ? "item" : "itens"} — ${formatMoney(order.total)}</span>
        </div>
        <div class="d-flex flex-wrap gap-2">
          ${recoveryUrl ? `
          <a href="${recoveryUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline-blush">
            <i class="bi bi-whatsapp me-1"></i>Chamar no WhatsApp
          </a>` : ""}
          <button type="button" class="btn-outline-blush delete-order-btn" data-ref="${escapeHTML(order.reference)}"><i class="bi bi-trash3 me-1"></i>Apagar carrinho</button>
        </div>
      </div>
    `;
    }).join("");
  }

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

  async function deleteContactMessageWithConfirm(id, onSuccess){
    if(!confirm("Apagar esta mensagem? Essa ação não pode ser desfeita.")) return;
    try{
      const res = await fetchWithTimeout(`/api/admin/contact-messages/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível apagar a mensagem.");
      onSuccess?.();
    }catch(err){
      alert(err.message || "Não foi possível apagar a mensagem agora.");
    }
  }
  messagesListEl?.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-message-btn");
    if(!btn) return;
    deleteContactMessageWithConfirm(Number(btn.dataset.id), () => loadDashboard());
  });

  /* ============================== PRODUTOS ============================== */
  let productsCache = [];

  const CUSTOM_PRODUCT_ID_START = 1000;

  function renderProductsTable(products){
    productsCache = products;
    productsTableBodyEl.innerHTML = products.map(p => {
      const isCustom = p.id >= CUSTOM_PRODUCT_ID_START;
      return `
      <tr data-product-id="${p.id}">
        <td>${imageFor(p)
          ? `<img class="admin-product-thumb" src="${escapeHTML(imageFor(p))}" alt="${escapeHTML(p.name)}" width="44" height="44" loading="lazy">`
          : BOW_PLACEHOLDER}</td>
        <td>${escapeHTML(p.name)}</td>
        <td>${formatMoney(p.price)}</td>
        <td class="small" style="color:var(--ink-soft)">${escapeHTML(CATEGORY_LABELS[p.category] || p.category || "—")}</td>
        <td>${(p.badges && p.badges.length) ? p.badges.map(b => `<span class="admin-badge-pill">${escapeHTML(b)}</span>`).join("") : "—"}</td>
        <td class="text-end">
          <button type="button" class="btn-outline-blush edit-product-btn" data-id="${p.id}">Editar</button>
          ${isCustom
            ? `<button type="button" class="delete-product-btn ms-2" data-id="${p.id}" aria-label="Excluir produto" style="border:none;background:none;color:var(--ink-soft);padding:.3rem"><i class="bi bi-trash3"></i></button>`
            : `<button type="button" class="ms-2" disabled title="Produto do catálogo original — não pode ser excluído, só editado" style="border:none;background:none;color:var(--blush-100);padding:.3rem;cursor:not-allowed"><i class="bi bi-trash3"></i></button>`}
        </td>
      </tr>
    `;
    }).join("");
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
  const epPreviewPlaceholder = document.getElementById("epPreviewPlaceholder");
  const epPreviewName = document.getElementById("epPreviewName");
  const epPreviewPrice = document.getElementById("epPreviewPrice");
  const epRecropBtn = document.getElementById("epRecropBtn");
  const epCropper = document.getElementById("epCropper");
  const epCropStage = document.getElementById("epCropStage");
  const epCropImg = document.getElementById("epCropImg");
  const epCropZoom = document.getElementById("epCropZoom");
  const epCropCancel = document.getElementById("epCropCancel");
  const epCropConfirm = document.getElementById("epCropConfirm");
  const epMsg = document.getElementById("epMsg");
  const epSaveBtn = document.getElementById("epSaveBtn");

  let editOriginal = null;

  let pendingPhotoUrl = "";
  let photoUploadInFlight = false;

  function selectedBadges(){
    return [epBadgeBestseller, epBadgeNew].filter(cb => cb.checked).map(cb => cb.value);
  }

  function setPreviewPhoto(url){
    const hasPhoto = Boolean(url);
    if(hasPhoto) epPreview.src = url;
    else epPreview.removeAttribute("src");
    epPreview.classList.toggle("d-none", !hasPhoto);
    epPreviewPlaceholder.classList.toggle("d-none", hasPhoto);

    epRecropBtn.classList.toggle("d-none", !hasPhoto);
  }

  function syncPreviewText(){
    epPreviewName.textContent = epName.value.trim() || "Nome do produto";
    const price = Number(epPrice.value);
    epPreviewPrice.textContent = Number.isFinite(price) && price > 0 ? formatMoney(price) : "—";
  }
  epName.addEventListener("input", syncPreviewText);
  epPrice.addEventListener("input", syncPreviewText);

  function openEditModal(productId){
    const product = productsCache.find(p => p.id === productId);
    if(!product) return;
    epId.value = product.id;
    epName.value = product.name;
    epPrice.value = product.price;
    epPhotoFile.value = "";
    renderCategoryOptions(epCategory, product.category || "");
    epBadgeBestseller.checked = (product.badges || []).includes("Mais vendido");
    epBadgeNew.checked = (product.badges || []).includes("Novo");
    setPreviewPhoto(imageFor(product));
    syncPreviewText();

    closeCropper();
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

  /* ============ FOTO DO PRODUTO — recorte no navegador e depois upload ============ */

  const CROP_OUTPUT_W = 800;
  const CROP_OUTPUT_H = 1000;
  const CROP_JPEG_QUALITY = 0.9;

  const crop = { natW: 0, natH: 0, baseScale: 1, zoom: 1, x: 0, y: 0, objectUrl: null, stageW: 0, stageH: 0 };

  function cropClampAndRender(){
    const dispW = crop.natW * crop.baseScale * crop.zoom;
    const dispH = crop.natH * crop.baseScale * crop.zoom;

    crop.x = Math.min(0, Math.max(crop.stageW - dispW, crop.x));
    crop.y = Math.min(0, Math.max(crop.stageH - dispH, crop.y));
    epCropImg.style.width = `${dispW}px`;
    epCropImg.style.height = `${dispH}px`;
    epCropImg.style.transform = `translate(${crop.x}px, ${crop.y}px)`;
  }

  function cropSetZoom(nextZoom, anchorX, anchorY){
    const clamped = Math.min(Number(epCropZoom.max), Math.max(Number(epCropZoom.min), nextZoom));
    const ax = anchorX ?? crop.stageW / 2;
    const ay = anchorY ?? crop.stageH / 2;
    const ratio = clamped / crop.zoom;
    crop.x = ax - (ax - crop.x) * ratio;
    crop.y = ay - (ay - crop.y) * ratio;
    crop.zoom = clamped;
    epCropZoom.value = String(clamped);
    cropClampAndRender();
  }

  function openCropper(src){
    epCropper.classList.remove("d-none");
    epCropImg.onload = () => {
      crop.natW = epCropImg.naturalWidth;
      crop.natH = epCropImg.naturalHeight;
      crop.stageW = epCropStage.clientWidth;
      crop.stageH = epCropStage.clientHeight;

      crop.baseScale = Math.max(crop.stageW / crop.natW, crop.stageH / crop.natH);
      crop.zoom = 1;
      epCropZoom.value = "1";

      crop.x = (crop.stageW - crop.natW * crop.baseScale) / 2;
      crop.y = (crop.stageH - crop.natH * crop.baseScale) / 2;
      cropClampAndRender();
      epCropStage.focus();
    };
    epCropImg.src = src;
  }

  function closeCropper(){
    epCropper.classList.remove("is-zooming");
    epCropper.classList.add("d-none");
    epCropStage.classList.remove("is-dragging");
    if(crop.objectUrl){

      URL.revokeObjectURL(crop.objectUrl);
      crop.objectUrl = null;
    }
  }

  let dragging = false, dragStartX = 0, dragStartY = 0, dragOriginX = 0, dragOriginY = 0;
  epCropStage.addEventListener("pointerdown", (e) => {
    if(!epCropImg.src) return;
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragOriginX = crop.x; dragOriginY = crop.y;
    epCropStage.classList.add("is-dragging");
    epCropStage.setPointerCapture(e.pointerId);
  });
  epCropStage.addEventListener("pointermove", (e) => {
    if(!dragging) return;
    crop.x = dragOriginX + (e.clientX - dragStartX);
    crop.y = dragOriginY + (e.clientY - dragStartY);
    cropClampAndRender();
  });
  const endDrag = () => { dragging = false; epCropStage.classList.remove("is-dragging"); };
  epCropStage.addEventListener("pointerup", endDrag);
  epCropStage.addEventListener("pointercancel", endDrag);

  epCropStage.addEventListener("wheel", (e) => {
    if(!epCropImg.src) return;
    e.preventDefault();
    const rect = epCropStage.getBoundingClientRect();
    cropSetZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  epCropZoom.addEventListener("input", () => {
    epCropper.classList.add("is-zooming");
    cropSetZoom(Number(epCropZoom.value));
  });
  epCropZoom.addEventListener("change", () => epCropper.classList.remove("is-zooming"));

  epCropStage.addEventListener("keydown", (e) => {
    if(!epCropImg.src) return;
    const step = e.shiftKey ? 20 : 5;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if(moves[e.key]){
      e.preventDefault();
      crop.x += moves[e.key][0];
      crop.y += moves[e.key][1];
      cropClampAndRender();
      return;
    }
    if(e.key === "+" || e.key === "="){ e.preventDefault(); cropSetZoom(crop.zoom * 1.1); }
    if(e.key === "-" || e.key === "_"){ e.preventDefault(); cropSetZoom(crop.zoom / 1.1); }
  });

  function exportCroppedBlob(){
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = CROP_OUTPUT_W;
      canvas.height = CROP_OUTPUT_H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CROP_OUTPUT_W, CROP_OUTPUT_H);

      const scale = crop.baseScale * crop.zoom;
      ctx.drawImage(epCropImg, -crop.x / scale, -crop.y / scale, crop.stageW / scale, crop.stageH / scale,
                    0, 0, CROP_OUTPUT_W, CROP_OUTPUT_H);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a imagem recortada.")),
        "image/jpeg",
        CROP_JPEG_QUALITY
      );
    });
  }

  function uploadPhotoBlob(blob){
    const id = Number(epId.value);
    const formData = new FormData();
    formData.append("photo", new File([blob], `produto-${id}.jpg`, { type: "image/jpeg" }));

    photoUploadInFlight = true;
    epSaveBtn.disabled = true;
    epCropConfirm.disabled = true;
    epPhotoStatus.textContent = "Enviando imagem...";
    epPhotoStatus.className = "small mt-1";

    return fetchWithTimeout(`/api/admin/products/${id}/photo`, { method: "POST", body: formData }, 20000)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.error || "Não foi possível enviar a imagem.");
        pendingPhotoUrl = data.photoUrl;
        epPhotoStatus.textContent = "Imagem enviada. Clique em salvar para publicar.";
        epPhotoStatus.classList.add("is-success");
      })
      .catch((err) => {
        epPhotoStatus.textContent = err.message || "Erro ao enviar a imagem.";
        epPhotoStatus.classList.add("is-error");

        const product = productsCache.find(p => p.id === id);
        setPreviewPhoto(product ? imageFor(product) : "");
        epPhotoFile.value = "";
      })
      .finally(() => {
        photoUploadInFlight = false;
        epSaveBtn.disabled = false;
        epCropConfirm.disabled = false;
      });
  }

  epPhotoFile.addEventListener("change", () => {
    const file = epPhotoFile.files[0];
    if(!file) return;
    epMsg.textContent = "";
    epMsg.className = "small account-msg";
    epPhotoStatus.textContent = "";
    epPhotoStatus.className = "small mt-1";
    if(crop.objectUrl) URL.revokeObjectURL(crop.objectUrl);
    crop.objectUrl = URL.createObjectURL(file);
    openCropper(crop.objectUrl);
  });

  epRecropBtn.addEventListener("click", () => {
    const current = epPreview.getAttribute("src");
    if(!current) return;
    epCropImg.crossOrigin = "anonymous";
    openCropper(current);
  });

  epCropCancel.addEventListener("click", () => {
    closeCropper();
    epPhotoFile.value = "";
    const product = productsCache.find(p => p.id === Number(epId.value));
    setPreviewPhoto(product ? imageFor(product) : "");
  });

  epCropConfirm.addEventListener("click", async () => {
    try{
      const blob = await exportCroppedBlob();

      setPreviewPhoto(URL.createObjectURL(blob));
      closeCropper();
      await uploadPhotoBlob(blob);
    }catch(err){
      epPhotoStatus.textContent = err.message || "Não foi possível recortar a imagem.";
      epPhotoStatus.className = "small mt-1 is-error";
    }
  });

  productsTableBodyEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".edit-product-btn");
    if(editBtn){ openEditModal(Number(editBtn.dataset.id)); return; }
    const deleteBtn = e.target.closest(".delete-product-btn");
    if(deleteBtn) deleteProductWithConfirm(Number(deleteBtn.dataset.id));
  });

  async function deleteProductWithConfirm(id){
    if(!confirm("Excluir este produto? Essa ação não pode ser desfeita.")) return;
    try{
      const res = await fetchWithTimeout(`/api/admin/products/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível excluir o produto.");
      productsCache = productsCache.filter(p => p.id !== id);
      renderProductsTable(productsCache);
    }catch(err){
      alert(err.message || "Não foi possível excluir o produto agora.");
    }
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if(photoUploadInFlight) return; 
    const id = Number(epId.value);
    const name = epName.value.trim();
    const price = Number(epPrice.value);
    const category = epCategory.value;
    const badges = selectedBadges();

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

  /* ============================ NOVA CATEGORIA ============================ */
  async function promptNewCategory(selectToUpdate){
    const label = prompt("Nome da nova categoria (ex.: Aniversário):");
    if(!label || !label.trim()) return;
    try{
      const res = await fetchWithTimeout("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível criar a categoria.");
      currentCategories = [...currentCategories, data];
      renderCategoryOptions(selectToUpdate, data.slug);
    }catch(err){
      alert(err.message || "Não foi possível criar a categoria agora.");
    }
  }
  document.getElementById("epNewCategoryBtn").addEventListener("click", () => promptNewCategory(epCategory));

  /* ============================ ADICIONAR PRODUTO ============================ */
  const addProductModalEl = document.getElementById("addProductModal");
  const addProductModal = new bootstrap.Modal(addProductModalEl);
  const addProductForm = document.getElementById("addProductForm");
  const apName = document.getElementById("apName");
  const apPrice = document.getElementById("apPrice");
  const apWeight = document.getElementById("apWeight");
  const apWidth = document.getElementById("apWidth");
  const apHeight = document.getElementById("apHeight");
  const apLength = document.getElementById("apLength");
  const apCategory = document.getElementById("apCategory");
  const apBadgeBestseller = document.getElementById("apBadgeBestseller");
  const apBadgeNew = document.getElementById("apBadgeNew");
  const apMsg = document.getElementById("apMsg");
  const apSaveBtn = document.getElementById("apSaveBtn");

  document.getElementById("apNewCategoryBtn").addEventListener("click", () => promptNewCategory(apCategory));

  document.getElementById("addProductBtn").addEventListener("click", () => {
    addProductForm.reset();
    renderCategoryOptions(apCategory, "");
    apMsg.textContent = "";
    apMsg.className = "small account-msg";
    addProductModal.show();
  });

  addProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: apName.value.trim(),
      price: Number(apPrice.value),
      weight: Number(apWeight.value),
      width: Number(apWidth.value),
      height: Number(apHeight.value),
      length: Number(apLength.value),
      category: apCategory.value,
      badges: [apBadgeBestseller, apBadgeNew].filter(cb => cb.checked).map(cb => cb.value),
    };

    apMsg.textContent = "";
    apMsg.className = "small account-msg";
    apSaveBtn.disabled = true;
    apSaveBtn.textContent = "Criando...";

    try{
      const res = await fetchWithTimeout("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível criar o produto.");

      addProductModal.hide();

      await loadDashboard();
      openEditModal(data.id);
    }catch(err){
      apMsg.textContent = err.message || "Erro ao criar o produto.";
      apMsg.classList.add("text-danger");
    }finally{
      apSaveBtn.disabled = false;
      apSaveBtn.textContent = "Criar produto";
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

    const contactUrl = isPaid ? whatsappContactUrl(order) : null;

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

        ${contactUrl ? `
        <div class="mb-3">
          <a href="${contactUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline-blush" style="padding:.4rem 1rem;font-size:.82rem" title="Abrir conversa no WhatsApp com o cliente">
            <i class="bi bi-whatsapp me-1"></i>Contatar via WhatsApp
          </a>
        </div>` : ""}

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
            <button type="button" class="btn-outline-blush show-barcode-btn" data-ref="${escapeHTML(ref)}" title="Desenha o código digitado acima como código de barras"><i class="bi bi-upc-scan me-1"></i>Gerar código de barras</button>
            <button type="button" class="btn-outline-blush generate-label-btn" data-ref="${escapeHTML(ref)}" title="Compra a etiqueta no Melhor Envio (gasta saldo real) e preenche o código automaticamente"><i class="bi bi-stars me-1"></i>Comprar etiqueta</button>
          </div>
          <span class="small tracking-feedback" data-ref-feedback="${escapeHTML(ref)}"></span>
          <div class="tracking-barcode-wrap">
            <svg class="tracking-barcode" id="barcode-${escapeHTML(ref)}"></svg>
            <button type="button" class="barcode-download-btn d-none" id="barcode-download-${escapeHTML(ref)}" data-ref="${escapeHTML(ref)}" title="Baixar código de barras (PNG)"><i class="bi bi-download"></i> Baixar código de barras</button>
          </div>
        </div>
        ` : ""}
      </div>
    `;
  }

  function highlightFromQuery(){
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("pedido");
    if(!ref) return;

    switchTab("pedidos");

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
    orders.forEach(order => {
      if(order.status === "pago" && order.trackingCode) renderBarcode(order.reference, order.trackingCode);
    });
    highlightFromQuery();
  }

  function renderBarcode(ref, code){
    const svg = document.getElementById(`barcode-${ref}`);
    const downloadBtn = document.getElementById(`barcode-download-${ref}`);
    if(!svg) return;
    if(!code){
      svg.innerHTML = "";
      svg.classList.remove("is-visible");
      downloadBtn?.classList.add("d-none");
      return;
    }
    try{
      JsBarcode(svg, code, {
        format: "CODE128",
        displayValue: true,
        height: 40,
        width: 1.6,
        fontSize: 12,
        margin: 4,
      });
      svg.classList.add("is-visible");
      downloadBtn?.classList.remove("d-none");
    }catch(err){

      console.error("Não foi possível desenhar o código de barras:", err);
      svg.innerHTML = "";
      svg.classList.remove("is-visible");
      downloadBtn?.classList.add("d-none");
    }
  }

  function downloadBarcode(ref){
    const input = document.getElementById(`tracking-${ref}`);
    const code = input?.value.trim();
    if(!code) return;
    try{
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, code, {
        format: "CODE128",
        displayValue: true,
        height: 80,
        width: 3,
        fontSize: 20,
        margin: 12,
      });
      const link = document.createElement("a");
      link.download = `rastreio-${code}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }catch(err){
      console.error("Não foi possível gerar o download do código de barras:", err);
      alert("Não foi possível gerar o arquivo do código de barras agora.");
    }
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
      renderBarcode(ref, data.trackingCode);
      feedbackEl.textContent = "Salvo!";
      feedbackEl.classList.add("is-success");
      setTimeout(() => { feedbackEl.textContent = ""; }, 2500);
    }catch(err){
      feedbackEl.textContent = err.message || "Erro ao salvar.";
      feedbackEl.classList.add("is-error");
    }
  }

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
      if(data.trackingCode) renderBarcode(ref, data.trackingCode);
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
    const barcodeBtn = e.target.closest(".show-barcode-btn");
    const labelBtn = e.target.closest(".generate-label-btn");
    const deleteBtn = e.target.closest(".delete-order-btn");
    const downloadBtn = e.target.closest(".barcode-download-btn");

    if(barcodeBtn){
      const ref = barcodeBtn.dataset.ref;
      const input = document.getElementById(`tracking-${ref}`);
      const feedbackEl = listEl.querySelector(`[data-ref-feedback="${ref}"]`);
      const code = input ? input.value.trim() : "";
      if(feedbackEl){
        feedbackEl.classList.remove("is-success", "is-error");
        feedbackEl.textContent = code ? "" : "Digite o código de rastreio primeiro.";
        if(!code) feedbackEl.classList.add("is-error");
      }
      if(code) renderBarcode(ref, code);
      return;
    }

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
    if(downloadBtn){
      downloadBarcode(downloadBtn.dataset.ref);
      return;
    }
    if(deleteBtn){
      deleteOrderWithConfirm(deleteBtn.dataset.ref, () => loadDashboard());
    }
  });

  /* ================================ CUPONS ================================ */
  /* ==================== CLIENTES E CONTATOS ==================== */
  function toggleBlock(el, show){
    el?.classList.toggle("d-none", !show);
  }

  function renderCustomers(customers){
    const body = document.getElementById("customersTableBody");
    const wrap = document.getElementById("customersTableWrap");
    const empty = document.getElementById("customersEmpty");
    if(!body) return;

    toggleBlock(wrap, customers.length > 0);
    toggleBlock(empty, customers.length === 0);
    if(!customers.length){ body.innerHTML = ""; return; }

    body.innerHTML = customers.map((c, i) => {
      const contactUrl = whatsappUrl(c.telefone, WHATSAPP_POST_SALE_MESSAGE);
      const historyRows = c.orders.map(o => `
        <div class="d-flex justify-content-between gap-2 py-1" style="font-size:.82rem">
          <span>${formatDate(o.createdAt)}</span>
          <span>${escapeHTML(o.reference)}</span>
          <span>${escapeHTML(STATUS_LABELS[o.status]?.label || o.status)}${o.couponCode ? ` · ${escapeHTML(o.couponCode)}` : ""}</span>
          <strong>${formatMoney(o.total)}</strong>
        </div>`).join("");

      return `
      <tr class="customer-row" data-customer-index="${i}" style="cursor:pointer">
        <td>
          <strong>${escapeHTML(c.nome)}</strong>
          ${c.hasAccount ? '<span class="admin-badge-pill ms-1">tem conta</span>' : ""}
        </td>
        <td style="font-size:.84rem">
          ${c.email ? escapeHTML(c.email) + "<br>" : ""}
          ${c.telefone ? escapeHTML(c.telefone) : "—"}
          ${contactUrl ? ` <a href="${contactUrl}" target="_blank" rel="noopener noreferrer" title="Abrir conversa no WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ""}
        </td>
        <td class="text-center">${c.paidOrders}<span style="color:var(--ink-soft)">/${c.totalOrders}</span></td>
        <td class="text-end"><strong>${formatMoney(c.totalSpent)}</strong></td>
        <td style="font-size:.84rem">${formatDate(c.lastOrderAt)}</td>
      </tr>
      <tr class="customer-history d-none" data-history-for="${i}">
        <td colspan="5" style="background:var(--blush-50)">${historyRows}</td>
      </tr>`;
    }).join("");

    body.querySelectorAll(".customer-row").forEach(row => {
      row.addEventListener("click", () => {
        const target = body.querySelector(`[data-history-for="${row.dataset.customerIndex}"]`);
        target?.classList.toggle("d-none");
      });
    });
  }

  function renderContactMessages(messages){
    const list = messagesListEl;
    const empty = document.getElementById("messagesEmpty");
    if(!list) return;

    toggleBlock(list, messages.length > 0);
    toggleBlock(empty, messages.length === 0);
    list.innerHTML = messages.map(m => {
      const contactUrl = whatsappUrl(m.telefone, "Olá! Recebemos a sua mensagem na Adriana Melo Acessórios.");
      return `
      <div class="order-card">
        <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
          <strong>${escapeHTML(m.nome)}</strong>
          <span class="section-sub" style="font-size:.8rem">${formatDate(m.createdAt)}</span>
        </div>
        <p class="mb-2" style="font-size:.9rem">${escapeHTML(m.mensagem)}</p>
        <div class="d-flex flex-wrap align-items-center gap-2" style="font-size:.84rem">
          <span>${escapeHTML(m.telefone)}</span>
          ${m.ocasiao ? `<span class="admin-badge-pill">${escapeHTML(m.ocasiao)}</span>` : ""}
          ${contactUrl ? `<a href="${contactUrl}" target="_blank" rel="noopener noreferrer" class="btn-outline-blush" style="padding:.3rem .8rem;font-size:.78rem"><i class="bi bi-whatsapp me-1"></i>Responder</a>` : ""}
          <button type="button" class="delete-message-btn ms-auto" data-id="${m.id}" aria-label="Apagar mensagem" style="border:none;background:none;color:var(--ink-soft);padding:.3rem"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`;
    }).join("");
  }

  function renderSubscribers(subscribers){
    const body = document.getElementById("subscribersTableBody");
    const wrap = document.getElementById("subscribersTableWrap");
    const empty = document.getElementById("subscribersEmpty");
    if(!body) return;

    toggleBlock(wrap, subscribers.length > 0);
    toggleBlock(empty, subscribers.length === 0);
    body.innerHTML = subscribers.map(s =>
      `<tr><td>${escapeHTML(s.email)}</td><td style="font-size:.84rem">${formatDate(s.createdAt)}</td></tr>`
    ).join("");
  }

  function downloadCSV(filename, header, rows){
    const escapeCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(escapeCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

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
          <div class="admin-row-actions">
            <button type="button" class="edit-order-icon-btn edit-coupon-btn" data-code="${escapeHTML(c.code)}" data-percent="${c.percentOff}" data-desc="${escapeHTML(c.description || "")}" aria-label="Editar cupom" title="Editar cupom"><i class="bi bi-pencil"></i></button>
            <button type="button" class="delete-order-icon-btn delete-coupon-btn" data-code="${escapeHTML(c.code)}" aria-label="Apagar cupom" title="Apagar cupom"><i class="bi bi-trash3"></i></button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  couponsTableBodyEl.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".delete-coupon-btn");
    if(deleteBtn){
      const code = deleteBtn.dataset.code;
      if(!confirm(`Apagar o cupom ${code}? Ele deixa de funcionar no checkout imediatamente.`)) return;
      try{
        const res = await fetchWithTimeout(`/api/admin/coupons/${encodeURIComponent(code)}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.error || "Não foi possível apagar o cupom.");
        loadDashboard();
      }catch(err){
        alert(err.message || "Não foi possível apagar o cupom agora.");
      }
      return;
    }
    const editBtn = e.target.closest(".edit-coupon-btn");
    if(editBtn){
      document.getElementById("ecCode").textContent = editBtn.dataset.code;
      document.getElementById("ecOriginalCode").value = editBtn.dataset.code;
      document.getElementById("ecPercent").value = editBtn.dataset.percent;
      document.getElementById("ecDesc").value = editBtn.dataset.desc;
      document.getElementById("ecMsg").textContent = "";
      editCouponModal.show();
    }
  });

  const editCouponModalEl = document.getElementById("editCouponModal");
  const editCouponModal = new bootstrap.Modal(editCouponModalEl);
  const editCouponForm = document.getElementById("editCouponForm");
  const ecSaveBtn = document.getElementById("ecSaveBtn");
  editCouponForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("ecOriginalCode").value;
    const percentOff = Number(document.getElementById("ecPercent").value);
    const description = document.getElementById("ecDesc").value.trim();
    const msgEl = document.getElementById("ecMsg");

    msgEl.textContent = "";
    msgEl.className = "small account-msg";
    ecSaveBtn.disabled = true;
    try{
      const res = await fetchWithTimeout(`/api/admin/coupons/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percentOff, description }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível salvar.");
      editCouponModal.hide();
      loadDashboard();
    }catch(err){
      msgEl.textContent = err.message || "Erro ao salvar o cupom.";
      msgEl.classList.add("text-danger");
    }finally{
      ecSaveBtn.disabled = false;
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

  function wireExports(customers, subscribers){
    const customersBtn = document.getElementById("exportCustomersBtn");
    if(customersBtn){
      customersBtn.onclick = () => downloadCSV(
        "clientes.csv",
        ["Nome", "E-mail", "Telefone", "Pedidos pagos", "Pedidos totais", "Total gasto", "Última compra"],
        customers.map(c => [
          c.nome, c.email || "", c.telefone || "",
          c.paidOrders, c.totalOrders,
          c.totalSpent.toFixed(2).replace(".", ","),
          formatDate(c.lastOrderAt),
        ])
      );
    }
    const subsBtn = document.getElementById("exportSubscribersBtn");
    if(subsBtn){
      subsBtn.onclick = () => downloadCSV(
        "lista-de-emails.csv",
        ["E-mail", "Cadastrou em"],
        subscribers.map(s => [s.email, formatDate(s.createdAt)])
      );
    }
  }

  async function loadDashboard(){
    showOnly(stateLoading);
    try{
      const responses = await Promise.all([
        fetchWithTimeout("/api/admin/orders"),
        fetchWithTimeout("/api/admin/products"),
        fetchWithTimeout("/api/admin/coupons"),
        fetchWithTimeout("/api/admin/customers"),
        fetchWithTimeout("/api/admin/leads"),
      ]);
      const [ordersRes, productsRes, couponsRes, customersRes, leadsRes] = responses;
      if(responses.some(r => r.status === 401)){ showOnly(stateLoggedOut); return; }
      if(responses.some(r => r.status === 403)){

        const negado = responses.find(r => r.status === 403);
        const corpo = await negado.clone().json().catch(() => ({}));
        if(corpo.needsTwoFactorSetup) return startTwoFactorSetup();
        showOnly(stateForbidden);
        return;
      }
      const failed = responses.find(r => !r.ok);
      if(failed){
        throw new Error("Falha ao carregar o painel (HTTP " + failed.status + ").");
      }
      const ordersData = await ordersRes.json();
      const productsData = await productsRes.json();
      const couponsData = await couponsRes.json();
      const customersData = await customersRes.json();
      const leadsData = await leadsRes.json();

      const orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];
      showOnly(contentEl);
      const products = Array.isArray(productsData.products) ? productsData.products : [];
      applyCategories(productsData.categories);
      renderStats(ordersData.stats || { totalRevenue: 0, totalOrders: 0 });
      renderSalesChart(orders);
      renderCategoryChart(orders, products);
      renderTopProductsChart(orders);
      renderStatusChart(orders);
      renderPaymentChart(orders);
      renderPendingCarts(orders);
      renderProductsTable(products);
      renderCouponsTable(Array.isArray(couponsData.coupons) ? couponsData.coupons : []);
      renderOrders(orders);

      const customers = Array.isArray(customersData.customers) ? customersData.customers : [];
      const subscribers = Array.isArray(leadsData.subscribers) ? leadsData.subscribers : [];
      renderCustomers(customers);
      renderContactMessages(Array.isArray(leadsData.messages) ? leadsData.messages : []);
      renderSubscribers(subscribers);
      wireExports(customers, subscribers);
    }catch(err){
      console.error("Erro ao carregar painel administrativo:", err);
      showOnly(stateError);
    }
  }

  retryBtn?.addEventListener("click", loadDashboard);

  /* Baixar toda a base numa planilha Excel (.xlsx). O arquivo é gerado no
     servidor (rota /api/admin/export.xlsx, protegida por sessão + 2FA); aqui
     usamos fetch para conseguir tratar erro (sessão expirada, etc.) em vez de
     navegar direto para um JSON de erro. */
  const exportAllBtn = document.getElementById("exportAllBtn");
  exportAllBtn?.addEventListener("click", async () => {
    const original = exportAllBtn.innerHTML;
    exportAllBtn.disabled = true;
    exportAllBtn.innerHTML = `<i class="bi bi-hourglass-split me-1"></i>Gerando...`;
    try{
      const res = await fetchWithTimeout("/api/admin/export.xlsx", {}, 30000);
      if(!res.ok){
        let msg = "Não foi possível gerar a planilha agora.";
        try{ msg = (await res.json()).error || msg; }catch{}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") || "";
      const match = dispo.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : "adriana-melo.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }catch(err){
      console.error("Erro ao baixar planilha:", err);
      alert(err.message || "Não foi possível gerar a planilha agora.");
    }finally{
      exportAllBtn.disabled = false;
      exportAllBtn.innerHTML = original;
    }
  });

  let authEventReceived = false;
  document.addEventListener("plc:auth", (e) => {
    authEventReceived = true;
    const user = e.detail.user;
    if(!user) showOnly(stateLoggedOut);
    else if(!user.isAdmin) showOnly(stateForbidden);
    else loadDashboard();
  });

  setTimeout(() => {
    if(!authEventReceived) showOnly(stateError);
  }, 10000);
})();
