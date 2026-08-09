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
    return new Date(ts).toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"numeric" });
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

  const stateLoading = document.getElementById("ordersLoading");
  const stateEmpty = document.getElementById("ordersEmpty");
  const stateError = document.getElementById("ordersError");
  const stateLoggedOut = document.getElementById("ordersLoggedOut");
  const listEl = document.getElementById("ordersList");
  const retryBtn = document.getElementById("ordersRetryBtn");

  function showOnly(target){
    [stateLoading, stateEmpty, stateError, stateLoggedOut, listEl].forEach(node => {
      if(node) node.classList.toggle("d-none", node !== target);
    });
  }

  function renderOrders(orders){
    if(!orders.length){ showOnly(stateEmpty); return; }
    listEl.innerHTML = orders.map(order => {
      const status = STATUS_LABELS[order.status] || { label: escapeHTML(order.status), cls:"order-status-pending" };
      const itemsHtml = order.items.map(item => `
        <li class="d-flex justify-content-between gap-3">
          <span>${item.qty}x ${escapeHTML(item.name)}</span>
          <span>${item.unitPrice != null ? formatMoney(item.unitPrice * item.qty) : "—"}</span>
        </li>
      `).join("");
      const shippingLabel = order.shipping?.name ? ` — ${escapeHTML(order.shipping.name)}` : "";
      return `
        <div class="order-card">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
            <div>
              <div class="fw-semibold">Pedido #${escapeHTML(order.reference.slice(0, 8))}</div>
              <div class="small" style="color:var(--ink-soft)">${formatDate(order.createdAt)}</div>
            </div>
            <span class="order-status ${status.cls}">${status.label}</span>
          </div>
          <ul class="list-unstyled small mb-2">${itemsHtml}</ul>
          <div class="d-flex justify-content-between small">
            <span>Subtotal</span><span>${formatMoney(order.subtotal)}</span>
          </div>
          ${order.discount > 0 ? `
          <div class="d-flex justify-content-between small" style="color:var(--blush-700)">
            <span>Desconto${order.couponCode ? " (" + escapeHTML(order.couponCode) + ")" : ""}</span>
            <span>-${formatMoney(order.discount)}</span>
          </div>` : ""}
          <div class="d-flex justify-content-between small">
            <span>Frete${shippingLabel}</span><span>${formatMoney(order.shippingPrice)}</span>
          </div>
          <div class="d-flex justify-content-between fw-semibold pt-2 mt-1 border-top" style="border-color:var(--blush-100)!important">
            <span>Total</span><span style="color:var(--blush-700)">${formatMoney(order.total)}</span>
          </div>
        </div>
      `;
    }).join("");
    showOnly(listEl);
  }

  async function loadOrders(){
    showOnly(stateLoading);
    try{
      const res = await fetch("/api/orders");
      if(res.status === 401){ showOnly(stateLoggedOut); return; }
      if(!res.ok) throw new Error("Falha ao carregar pedidos (HTTP " + res.status + ").");
      const data = await res.json();
      renderOrders(Array.isArray(data.orders) ? data.orders : []);
    }catch(err){
      console.error("Erro ao carregar pedidos:", err);
      showOnly(stateError);
    }
  }

  retryBtn?.addEventListener("click", loadOrders);

  // js/auth.js já faz a checagem de sessão ao carregar a página; reagimos
  // ao resultado dela em vez de checar de novo (evita duas chamadas a
  // /api/auth/me).
  document.addEventListener("plc:auth", (e) => {
    if(e.detail.user) loadOrders(); else showOnly(stateLoggedOut);
  });
})();
