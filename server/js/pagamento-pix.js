(function(){
  "use strict";

  /* =====================================================================
     PÁGINA DO PIX — QR na tela e confirmação automática
     -------------------------------------------------------------------
     O carrinho (js/main.js) chama POST /api/create-pix-payment, guarda a
     resposta em sessionStorage e manda a cliente para cá. Esta página só
     exibe o que já foi gerado e fica perguntando ao servidor quando o
     pedido virou "pago".

     Quem confirma o pagamento é o webhook do Mercado Pago
     (/api/webhook) — nunca esta tela. Aqui a gente só CONSULTA o status
     do pedido; nada que o navegador faça consegue marcar algo como pago.
  ===================================================================== */

  const STORAGE_KEY = "plc_pix_pendente";
  const INTERVALO_MS = 4000;      // de quanto em quanto tempo perguntamos
  const LIMITE_MS = 20 * 60 * 1000; // desiste de perguntar depois de 20 min

  const statePagar = document.getElementById("statePagar");
  const statePago = document.getElementById("statePago");
  const stateSemDados = document.getElementById("stateSemDados");

  function showOnly(el){
    [statePagar, statePago, stateSemDados].forEach(s => s.classList.toggle("d-none", s !== el));
  }

  function brl(v){
    return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  let dados = null;
  try{
    dados = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
  }catch(err){
    console.warn("Dados do Pix ilegíveis:", err);
  }

  if(!dados?.reference || !dados?.qrCode){
    showOnly(stateSemDados);
    return;
  }

  /* ---------------------------- a tela ---------------------------- */
  document.getElementById("pixAmount").textContent = brl(dados.total);
  document.getElementById("pixCode").value = dados.qrCode;

  const qrImg = document.getElementById("pixQrImg");
  if(dados.qrCodeBase64){
    qrImg.src = `data:image/png;base64,${dados.qrCodeBase64}`;
  }else{
    // Sem a imagem ainda dá para pagar pelo copia-e-cola — não vale
    // travar a tela por causa dela.
    qrImg.remove();
  }

  if(dados.expiresAt){
    const q = new Date(dados.expiresAt);
    if(!isNaN(q)){
      document.getElementById("pixExpiry").textContent =
        `Este código vale até ${q.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}.`;
    }
  }

  /* --------------------------- copiar ---------------------------- */
  const copyBtn = document.getElementById("pixCopyBtn");
  copyBtn.addEventListener("click", async () => {
    const campo = document.getElementById("pixCode");
    try{
      await navigator.clipboard.writeText(dados.qrCode);
    }catch(err){
      // clipboard falha em contexto não-seguro (http://) e em alguns
      // navegadores antigos: selecionar o texto deixa a cliente copiar
      // com Ctrl+C / o menu do celular.
      console.warn("Área de transferência indisponível, selecionando o texto:", err);
      campo.focus();
      campo.select();
    }
    copyBtn.innerHTML = `<i class="bi bi-check2"></i> Copiado`;
    setTimeout(() => { copyBtn.innerHTML = `<i class="bi bi-clipboard"></i> Copiar`; }, 2000);
  });

  /* ----------------------- confirmação -------------------------- */
  const statusEl = document.getElementById("pixStatus");
  const comecou = Date.now();
  let timer = null;

  function pararDePerguntar(){
    clearInterval(timer);
    timer = null;
  }

  function confirmar(){
    pararDePerguntar();
    sessionStorage.removeItem(STORAGE_KEY);
    /* Só esvazia o carrinho agora que o pagamento existe de verdade —
       mesmo critério de js/pagamento-retorno.js. Esvaziar ao gerar o QR
       deixaria quem desistiu no meio sem os itens de volta. */
    try{
      localStorage.removeItem("plc_cart_v1");
    }catch(err){
      console.warn("Não foi possível limpar o carrinho salvo:", err);
    }
    showOnly(statePago);
  }

  async function checarStatus(){
    if(Date.now() - comecou > LIMITE_MS){
      pararDePerguntar();
      statusEl.innerHTML = `<i class="bi bi-info-circle"></i> Ainda não recebemos a confirmação. Se você já pagou, o pedido aparece em <a href="pedidos.html">Meus pedidos</a> assim que o banco confirmar.`;
      return;
    }
    try{
      const res = await fetch(`/api/orders/${encodeURIComponent(dados.reference)}/status`);
      if(!res.ok) return;               // 401/404: tenta de novo no próximo ciclo
      const { status } = await res.json();
      if(status === "pago") return confirmar();
      if(status === "recusado" || status === "cancelado"){
        pararDePerguntar();
        statusEl.innerHTML = `<i class="bi bi-exclamation-triangle"></i> Este pagamento foi ${status}. <a href="index.html">Voltar à loja</a>.`;
      }
    }catch(err){
      // Rede oscilando não é motivo para parar de perguntar.
      console.warn("Falha ao consultar o status do pedido:", err);
    }
  }

  timer = setInterval(checarStatus, INTERVALO_MS);
  checarStatus();

  // Voltar para a aba costuma significar "acabei de pagar no app do
  // banco": vale perguntar na hora, sem esperar o próximo ciclo.
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && timer) checarStatus();
  });
})();
