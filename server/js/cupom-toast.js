(function(){
  "use strict";

  /* =====================================================================
     NOTIFICAÇÃO DE CUPOM — e-mail gera o cupom, igual à seção "Ganhe 10%
     na primeira compra" (js/main.js), só que num toast pequeno em vez de
     uma seção da página. Usa a MESMA rota (POST /api/newsletter): não
     existe uma segunda regra de validação de e-mail ou de cupom só para
     este componente — se existisse, as duas poderiam um dia divergir.

     Só aparece para quem parece ser cliente nova: sem sessão ativa
     (checado via o evento "plc:auth" que js/auth.js já dispara em toda
     página — não faz uma segunda chamada a /api/auth/me) e que ainda não
     preencheu o e-mail aqui antes (localStorage, não sessionStorage:
     precisa persistir entre visitas, não só dentro da mesma aba).
  ===================================================================== */

  const STORAGE_KEY = "plc_cupom_toast_email_enviado";
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const toastEl = document.getElementById("couponToast");
  if(!toastEl) return;

  if(localStorage.getItem(STORAGE_KEY)){
    return; // Já deixou o e-mail antes nesta ou noutra visita — nada a oferecer de novo.
  }

  let dadosCupom = null;
  try{
    dadosCupom = JSON.parse(toastEl.dataset.cupom || "null");
  }catch(err){
    console.warn("Dados do cupom de boas-vindas ilegíveis:", err);
  }
  if(!dadosCupom?.code || !dadosCupom?.percentOff){
    return; // Cupom apagado pelo painel, ou dado corrompido — nada para anunciar.
  }
  document.getElementById("couponToastPercent").textContent = `${dadosCupom.percentOff}%`;

  const toast = new bootstrap.Toast(toastEl, { autohide: false });
  const form = document.getElementById("couponToastForm");
  const emailInput = document.getElementById("couponToastEmail");
  const errorEl = document.getElementById("couponToastError");
  const revealEl = document.getElementById("couponToastReveal");
  const codeEl = document.getElementById("couponToastCode");
  const copyBtn = document.getElementById("couponToastCopyBtn");

  function mostrarErro(msg){
    errorEl.textContent = msg;
    errorEl.classList.add("show");
    emailInput.classList.add("is-invalid");
  }
  function limparErro(){
    errorEl.classList.remove("show");
    emailInput.classList.remove("is-invalid");
  }

  let enviando = false;
  async function validarEEnviar(){
    const email = emailInput.value.trim();
    if(!email) return; // Campo vazio: não é erro, é só quem ainda não digitou nada.
    if(!EMAIL_RE.test(email)){
      mostrarErro("E-mail inválido");
      return;
    }
    if(enviando) return;
    limparErro();
    enviando = true;
    form.classList.add("coupon-toast-submitting");
    try{
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "Não foi possível agora.");

      if(data.coupon){
        codeEl.textContent = data.coupon;
      }else{
        // Cupom apagado do painel entre a página carregar e a cliente
        // digitar o e-mail (janela bem pequena, mas existe): melhor
        // reconhecer a inscrição do que mostrar um código vazio.
        revealEl.querySelector(".coupon-toast-success-text").textContent =
          "Inscrição confirmada! Fique de olho no seu e-mail para novidades.";
        revealEl.querySelector(".coupon-toast-code-row").remove();
      }
      form.hidden = true;
      revealEl.classList.add("show");
      emailInput.disabled = true;
    }catch(err){
      console.error("Falha ao inscrever pelo cupom da notificação:", err);
      mostrarErro(err.message || "Não foi possível agora. Tente de novo.");
    }finally{
      enviando = false;
      form.classList.remove("coupon-toast-submitting");
    }
    try{
      localStorage.setItem(STORAGE_KEY, "1");
    }catch(err){
      console.warn("Não foi possível salvar no localStorage:", err);
    }
  }

  emailInput.addEventListener("blur", validarEEnviar);
  form.addEventListener("submit", (e) => { e.preventDefault(); validarEEnviar(); });
  // Digitar de novo depois de um erro tira o aviso na hora, sem esperar
  // sair do campo — senão a mensagem de erro fica na tela mesmo já
  // corrigido, como se nada tivesse mudado.
  emailInput.addEventListener("input", limparErro);

  /* Cópia pelo caminho antigo (campo temporário + execCommand) como
     reforço: é o que ainda funciona em navegador embutido de rede social,
     onde navigator.clipboard costuma ser bloqueado — mesmo padrão de
     js/compartilhar.js. */
  function copiarPeloCampo(texto){
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.setAttribute("readonly", "");
    campo.style.cssText = "position:fixed; top:0; left:-9999px; opacity:0";
    document.body.appendChild(campo);
    try{
      campo.select();
      return document.execCommand("copy");
    }catch{
      return false;
    }finally{
      campo.remove();
    }
  }

  copyBtn.addEventListener("click", async () => {
    const codigo = codeEl.textContent;
    let copiou = false;
    try{
      await navigator.clipboard.writeText(codigo);
      copiou = true;
    }catch(err){
      console.warn("Área de transferência indisponível, tentando o modo antigo:", err);
      copiou = copiarPeloCampo(codigo);
    }
    const original = copyBtn.innerHTML;
    copyBtn.innerHTML = copiou
      ? `<i class="bi bi-check2"></i> Copiado!`
      : `<i class="bi bi-clipboard"></i> Copie manualmente`;
    if(copiou) copyBtn.classList.add("is-copied");
    setTimeout(() => {
      copyBtn.innerHTML = original;
      copyBtn.classList.remove("is-copied");
    }, 2000);
  });

  // Só mostra depois de saber se há sessão ativa — quem já tem conta não
  // precisa do convite de "primeira compra". js/auth.js dispara este
  // evento em toda página; não vale a pena chamar /api/auth/me de novo.
  document.addEventListener("plc:auth", (e) => {
    if(e.detail.user) return; // Cliente já logada — já é conta, o convite não se aplica.
    setTimeout(() => toast.show(), 1200);
  });
})();
