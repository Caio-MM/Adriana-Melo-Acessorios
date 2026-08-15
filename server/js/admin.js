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
  // Mesma fonte única que a vitrine e o carrinho usam (js/pricing.js) —
  // antes o painel tinha sua própria cópia, sem o espaço não separável
  // entre "R$" e o valor nem a proteção contra NaN que a versão central
  // já tinha (ver formatMoney em js/pricing.js).
  const formatMoney = window.PLCPricing.formatMoney;
  function formatDate(ts){
    return new Date(ts).toLocaleString("pt-BR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  }
  // Mesma regra da vitrine (js/main.js:imageFor): sem foto cadastrada não
  // existe imagem nenhuma — quem chama mostra o laço em SVG no lugar, para
  // o painel refletir exatamente o que o cliente vê na loja.
  function imageFor(product){
    return product.photoUrl || "";
  }
  const BOW_PLACEHOLDER = `<span class="admin-thumb-placeholder" aria-hidden="true"><svg class="bow-icon"><use href="#bow-shape"/></svg></span>`;

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

  /* ================================ ABAS ================================
     Troca de aba é só CSS (mostra/esconde .admin-tab-panel) — os dados de
     todas as abas já foram carregados juntos em loadDashboard(), então
     nenhuma spinner/requisição nova acontece ao navegar entre elas. */
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
    // Ticket médio é derivado dos dois números que o servidor já manda
    // (revenue/count) — não precisa de outra chamada nem de o servidor
    // calcular isso separado, é aritmética determinística em cima de
    // valor já confiável.
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

  /* ======================== GRÁFICO DE VENDAS POR MÊS ========================
     Calculado inteiramente no navegador a partir dos pedidos que o painel
     já buscou pra listagem de "Vendas e pedidos" (mesma resposta de
     /api/admin/orders) — não existe uma segunda chamada nem endpoint novo
     só pra alimentar o gráfico. */
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
      // Barra sempre visível (altura mínima) mesmo em R$0 — um mês sem
      // venda nenhuma continua ocupando o lugar dele na linha do tempo,
      // em vez de sumir e confundir a leitura das barras vizinhas.
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

  /* ==================== VISÕES DO DASHBOARD ====================
     Tudo aqui é calculado no navegador a partir dos pedidos e produtos que
     loadDashboard() já buscou — nenhuma chamada extra à API.

     ⚠️ "Valor" nestas visões é o preço de catálogo dos itens
     (unitPrice × qty), NÃO o total do pedido: o total inclui frete e
     desconta cupom/Pix, que não pertencem a nenhuma categoria ou produto
     específico. Por isso a soma daqui não bate com "Vendas totais" — os
     subtítulos no HTML dizem "sem frete" para deixar isso explícito. */

  /* Uma lista de barras horizontais serve as quatro visões. Cada item é
     { label, value, display, meta } e a barra é proporcional ao maior. */
  function renderBarList(el, items, emptyMessage){
    if(!el) return;
    if(!items.length){
      el.innerHTML = `<p class="section-sub mb-0" style="font-size:.85rem">${escapeHTML(emptyMessage)}</p>`;
      return;
    }
    const max = Math.max(...items.map(i => i.value), 0);
    el.innerHTML = items.map(item => {
      // Mínimo de 2% para um item com valor baixo ainda desenhar uma barra
      // visível, em vez de virar uma linha invisível ao lado do maior.
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

  /* Percorre os itens dos pedidos pagos somando unidades e valor por chave
     (categoria ou produto), devolvendo já ordenado do maior para o menor. */
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
    // Ordena por unidades (e não por valor): "mais vendido" no dia a dia da
    // loja é o que sai mais, não o que fatura mais.
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

  /* ======================== CARRINHOS PENDENTES ========================
     Recuperação de carrinho abandonado: pedidos "pendente" (checkout
     iniciado no Mercado Pago, pagamento nunca confirmado) entre 1h e 14
     dias atrás — cedo demais (< 1h) o cliente pode só estar terminando de
     pagar; tarde demais (> 14 dias) o contato deixa de fazer sentido. */
  const PENDING_CART_MIN_AGE_MS = 60 * 60 * 1000;
  const PENDING_CART_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  // O telefone é digitado pela cliente no checkout como DDD + número (ex.:
  // "(11) 99999-8888"), sem o código do país — um link wa.me com só esses
  // 10-11 dígitos não abre a conversa certa.
  //
  // Não dá para decidir pelo comprimento sozinho: "011 99999-8888" (hábito
  // antigo de pôr o 0 da operadora antes do DDD) também dá 12 dígitos e
  // NÃO tem DDI. Por isso o 0 da frente sai primeiro, e só é considerado
  // "já tem DDI" o número que começa com 55 E tem 12-13 dígitos. Um número
  // do DDD 55 (Rio Grande do Sul) sem DDI tem no máximo 11 dígitos, então
  // não cai nesse caso por engano.
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

  // Mensagem padrão de suporte pós-venda (contato geral sobre um pedido já
  // feito) — diferente da mensagem de recuperação de carrinho acima, que é
  // sobre uma compra ainda não finalizada.
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
        <td>${imageFor(p)
          ? `<img class="admin-product-thumb" src="${escapeHTML(imageFor(p))}" alt="${escapeHTML(p.name)}" width="44" height="44" loading="lazy">`
          : BOW_PLACEHOLDER}</td>
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

  /* Único lugar que mexe na pré-visualização do modal. Sem foto, esconde a
     <img> e mostra o laço — em vez de deixar `src=""`, que o navegador
     resolve como a própria URL da página e transforma numa requisição
     inútil (e num ícone de imagem quebrada). */
  function setPreviewPhoto(url){
    const hasPhoto = Boolean(url);
    if(hasPhoto) epPreview.src = url;
    else epPreview.removeAttribute("src");
    epPreview.classList.toggle("d-none", !hasPhoto);
    epPreviewPlaceholder.classList.toggle("d-none", hasPhoto);
    // Só dá para reenquadrar o que já existe.
    epRecropBtn.classList.toggle("d-none", !hasPhoto);
  }

  /* Nome e preço do mini card acompanham o que está sendo digitado — a
     pré-visualização é "como fica na loja", então tem que refletir a edição
     em andamento, não o valor salvo. */
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
    epCategory.value = product.category || "";
    epBadgeBestseller.checked = (product.badges || []).includes("Mais vendido");
    epBadgeNew.checked = (product.badges || []).includes("Novo");
    setPreviewPhoto(imageFor(product));
    syncPreviewText();
    // Reabrir o modal noutro produto não pode herdar um recorte aberto do
    // anterior.
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

  /* =====================================================================
     FOTO DO PRODUTO — recorte no navegador e depois upload
     ---------------------------------------------------------------------
     A vitrine mostra a foto num quadrado 1:1 com object-fit:cover
     (.product-thumb), ou seja: SEMPRE recorta. Antes esse recorte era
     decidido pelo navegador (centro da imagem) e a lojista só descobria o
     resultado depois de salvar. Agora ela escolhe o enquadramento aqui.

     1) Ao escolher um arquivo, ele NÃO é enviado ainda: abre o recorte com
        a imagem lida localmente (object URL). Nada sai do navegador.
     2) Em "Usar esta foto", o trecho escolhido é desenhado num <canvas> e
        exportado como JPEG — o arquivo que sobe já é o quadrado final, do
        tamanho que a loja precisa. Isso resolve duas coisas de uma vez: o
        recorte fica gravado (não depende do CSS do dia) e uma foto de
        celular de 4000px vira ~800px, deixando a vitrine bem mais leve.
     3) O upload continua igual: multipart para
        POST /api/admin/products/:id/photo, que grava em disco e devolve um
        caminho curto guardado em `pendingPhotoUrl` até "Salvar alterações".

     Por que multipart e não base64 num JSON: base64 incha o arquivo ~33% e
     impede o servidor de validar tipo/tamanho antes de ler o corpo inteiro.
  ===================================================================== */

  // 800px = 2× os ~400px que o card ocupa na vitrine, para não borrar em
  // tela retina. Acima disso só peso: o card nunca exibe maior que isso.
  const CROP_OUTPUT_SIZE = 800;
  const CROP_JPEG_QUALITY = 0.9;

  /* Estado do recorte. `zoom` 1 = imagem no menor tamanho que ainda cobre o
     quadrado inteiro; offsets são o canto superior-esquerdo da imagem
     dentro do palco, em px de tela. */
  const crop = { natW: 0, natH: 0, baseScale: 1, zoom: 1, x: 0, y: 0, objectUrl: null, stage: 0 };

  function cropClampAndRender(){
    const dispW = crop.natW * crop.baseScale * crop.zoom;
    const dispH = crop.natH * crop.baseScale * crop.zoom;
    // A imagem nunca pode descolar da borda: sem isso sobraria fundo vazio
    // dentro do quadrado, que na loja viraria uma faixa cinza.
    crop.x = Math.min(0, Math.max(crop.stage - dispW, crop.x));
    crop.y = Math.min(0, Math.max(crop.stage - dispH, crop.y));
    epCropImg.style.width = `${dispW}px`;
    epCropImg.style.height = `${dispH}px`;
    epCropImg.style.transform = `translate(${crop.x}px, ${crop.y}px)`;
  }

  /* Aproxima/afasta mantendo fixo o ponto sob o cursor (ou o centro, quando
     vem do slider) — sem isso o zoom "foge" do que a lojista está mirando. */
  function cropSetZoom(nextZoom, anchorX, anchorY){
    const clamped = Math.min(Number(epCropZoom.max), Math.max(Number(epCropZoom.min), nextZoom));
    const ax = anchorX ?? crop.stage / 2;
    const ay = anchorY ?? crop.stage / 2;
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
      crop.stage = epCropStage.clientWidth;
      // "cover": a menor escala em que a imagem ainda tapa o quadrado todo.
      crop.baseScale = Math.max(crop.stage / crop.natW, crop.stage / crop.natH);
      crop.zoom = 1;
      epCropZoom.value = "1";
      // Começa centralizado — o mesmo enquadramento que o navegador faria
      // sozinho, então quem não quer mexer em nada é só confirmar.
      crop.x = (crop.stage - crop.natW * crop.baseScale) / 2;
      crop.y = (crop.stage - crop.natH * crop.baseScale) / 2;
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
      // Object URL segura o arquivo inteiro na memória até ser revogado.
      URL.revokeObjectURL(crop.objectUrl);
      crop.objectUrl = null;
    }
  }

  // ---- Arrastar (mouse e toque, via Pointer Events) ----
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

  // ---- Zoom pela roda do mouse, ancorado no cursor ----
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

  // ---- Teclado: setas movem, +/- aproximam (o arraste sozinho deixaria
  //      quem não usa mouse sem nenhuma forma de enquadrar) ----
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

  /* Desenha só o pedaço visível do palco, em CROP_OUTPUT_SIZE. O fundo
     branco vai antes porque PNG/GIF com transparência viraria preto no
     JPEG — branco combina com o card da vitrine. */
  function exportCroppedBlob(){
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = CROP_OUTPUT_SIZE;
      canvas.height = CROP_OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
      // Do palco (px de tela) de volta para pixels reais da imagem.
      const scale = crop.baseScale * crop.zoom;
      const srcSize = crop.stage / scale;
      ctx.drawImage(epCropImg, -crop.x / scale, -crop.y / scale, srcSize, srcSize,
                    0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
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
        // Volta a pré-visualização para o que já estava salvo — deixar o
        // recorte na tela sugeriria que ele "pegou".
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

  // Reenquadrar a foto que já está publicada, sem precisar reenviar o
  // arquivo. Mesma origem, então o canvas não fica "sujo" (tainted) e a
  // exportação funciona igual.
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
      // Mostra o recorte final no mini card antes mesmo do upload terminar.
      setPreviewPhoto(URL.createObjectURL(blob));
      closeCropper();
      await uploadPhotoBlob(blob);
    }catch(err){
      epPhotoStatus.textContent = err.message || "Não foi possível recortar a imagem.";
      epPhotoStatus.className = "small mt-1 is-error";
    }
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
    // Só em pedido pago: a mensagem é de suporte pós-venda ("recebemos o seu
    // pedido"), que seria falsa num carrinho abandonado ou num pagamento
    // recusado/cancelado. Carrinho pendente já tem o botão de recuperação,
    // com a mensagem certa, na seção "Carrinhos pendentes".
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
    // O card do pedido mora na aba "Vendas e pedidos" — desde que o painel
    // virou abas, ela pode estar escondida (d-none) quando o link do
    // e-mail de pedido pago abre a página. Sem trocar de aba primeiro, o
    // scrollIntoView abaixo não faz nada visível (elemento existe no DOM,
    // mas dentro de um painel oculto).
    switchTab("pedidos");
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
    orders.forEach(order => {
      if(order.status === "pago" && order.trackingCode) renderBarcode(order.reference, order.trackingCode);
    });
    highlightFromQuery();
  }

  // Desenha o código de rastreio como código de barras (Code128) — a
  // lojista já sai com algo pronto pra colar/mostrar na embalagem, sem
  // precisar copiar o texto pra outra ferramenta só pra gerar a barra.
  // JsBarcode (cdnjs, mesma origem já liberada na CSP pro Bootstrap) só
  // desenha dentro do próprio <svg>, sem nenhuma chamada de rede — código
  // sensível (rastreio de pedido) nunca sai do navegador da lojista.
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
      // Só pode acontecer com um código de rastreio digitado à mão fora do
      // padrão dos Correios (ex.: caractere que o Code128 não representa)
      // — nunca trava o resto do painel por causa disso.
      console.error("Não foi possível desenhar o código de barras:", err);
      svg.innerHTML = "";
      svg.classList.remove("is-visible");
      downloadBtn?.classList.add("d-none");
    }
  }

  // Baixa o código de barras como PNG. Desenha de novo num <canvas> só
  // pra isso (fora da tela, nunca inserido no DOM) em vez de converter o
  // <svg> já visível — bem mais simples e sem as pegadinhas de
  // serializar SVG pra imagem entre navegadores, e o JsBarcode já sabe
  // desenhar em canvas do mesmo jeito que em SVG. Tudo local: nenhum
  // arquivo passa pelo servidor pra virar essa imagem.
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

    /* Desenha o que está digitado no campo, sem passar pelo servidor: o
       JsBarcode roda inteiro no navegador. Não exige "Salvar" antes de
       propósito — a lojista pode conferir a barra antes de gravar. */
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
  /* ==================== CLIENTES E CONTATOS ====================
     Dados que só o admin vê (telefone, e-mail, histórico). O servidor já
     barra por auth.requireAdmin — o que é feito aqui é só a exibição. */
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
    const list = document.getElementById("messagesList");
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

  /* CSV para abrir no Excel/Planilhas. O BOM (﻿) no início é o que faz
     o Excel reconhecer UTF-8 — sem ele, "Ação" vira "AÃ§Ã£o". */
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
  /* Os botões de exportar são religados a cada carga do painel porque os
     dados vêm por closure. `onclick` (e não addEventListener) de propósito:
     substitui o handler anterior em vez de empilhar um novo a cada
     recarregamento, que baixaria o mesmo CSV várias vezes. */
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
      if(responses.some(r => r.status === 403)){ showOnly(stateForbidden); return; }
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
