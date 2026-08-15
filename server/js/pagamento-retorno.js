(function(){
  "use strict";

  /* Usado pelas 3 páginas de retorno do Mercado Pago (pagamento-sucesso,
     pagamento-erro, pagamento-pendente). O Mercado Pago volta pra cá com
     external_reference (nosso próprio identificador do pedido, ver
     server/server.js) na query string — só usamos isso pra mostrar o
     número do pedido, nunca pra decidir o status exibido na página (esse
     já vem fixo por qual arquivo o Mercado Pago escolheu redirecionar).
     O status "de verdade" do pedido é sempre o do webhook, refletido em
     "Meus pedidos". */
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("external_reference");
  const lineEl = document.getElementById("orderRefLine");
  if(ref && lineEl){
    const short = ref.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8);
    if(short) lineEl.textContent = `Pedido #${short} — ${lineEl.textContent}`;
  }

  /* Esvazia o carrinho quando a compra deu certo — mesma chave usada em
     js/main.js (CART_KEY). Sem isso, o cliente voltava do Mercado Pago com
     os itens que acabou de pagar ainda no carrinho: além do "não comprei?"
     na hora, era um convite direto a pagar o mesmo pedido duas vezes.
     Só nesta página: em "erro"/"pendente" o pagamento ainda pode ser
     retomado, e aí apagar o carrinho é que seria perder a venda.
     A confirmação real continua sendo o webhook (server/server.js) — isto
     é só a limpeza da tela do cliente. */
  if(document.body.dataset.paymentResult === "sucesso"){
    try{
      localStorage.removeItem("plc_cart_v1");
    }catch(err){
      console.warn("Não foi possível limpar o carrinho salvo:", err);
    }
  }
})();
