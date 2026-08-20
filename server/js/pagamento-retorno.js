(function(){
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const ref = params.get("external_reference");
  const lineEl = document.getElementById("orderRefLine");
  if(ref && lineEl){
    const short = ref.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8);

    if(short) lineEl.innerHTML = `Pedido <strong class="order-ref">#${short}</strong> — ${lineEl.textContent}`;
  }

  if(document.body.dataset.paymentResult === "sucesso"){
    try{
      localStorage.removeItem("plc_cart_v1");
    }catch(err){
      console.warn("Não foi possível limpar o carrinho salvo:", err);
    }
  }
})();
