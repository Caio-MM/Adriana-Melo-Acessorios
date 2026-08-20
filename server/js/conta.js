(function(){
  "use strict";

  function setLoading(btn, loading, loadingLabel){
    if(!btn) return;
    if(loading){
      btn.dataset.originalLabel = btn.dataset.originalLabel || btn.innerHTML;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${loadingLabel}`;
    } else if(btn.dataset.originalLabel){
      btn.innerHTML = btn.dataset.originalLabel;
    }
    btn.disabled = loading;
  }

  function showMessage(el, text, type){
    if(!el) return;
    el.textContent = text || "";
    el.classList.toggle("text-danger", type === "error");
    el.classList.toggle("text-success", type === "success");
  }

  async function postJSON(url, body){
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      throw new Error(data.error || "Algo deu errado. Tente novamente em instantes.");
    }
    return data;
  }

  /* Para onde ir depois de entrar/criar conta. `isAdmin` vem calculado pelo
     servidor na própria resposta do login/cadastro (nunca é declarado pelo
     navegador) — o painel em si continua protegido por auth.requireAdmin no
     servidor, isso aqui é só a escolha do destino. */
  function destinationFor(user){
    if(user?.isAdmin) return "admin.html";
    // Quem chegou aqui pelo botão de pagamento do carrinho volta para lá
    // (js/main.js reabre o carrinho com ?carrinho=1) em vez de cair em
    // "Meus pedidos" e ter que refazer o caminho.
    const retorno = new URLSearchParams(location.search).get("retorno");
    return retorno === "carrinho" ? "index.html?carrinho=1" : "pedidos.html";
  }

  /* =====================================================================
     PAINEL DESLIZANTE — alternar entre "Entrar" e "Criar conta".
     Todo o visual (posição do painel do laço, qual formulário aparece,
     aba ativa) sai do atributo data-mode no .auth-shell, via CSS. Aqui só
     trocamos esse valor e cuidamos do que o CSS não faz: aria-selected das
     abas e levar o foco para o primeiro campo do formulário que entrou.
  ===================================================================== */
  const authShell = document.getElementById("authForms");
  const modeButtons = document.querySelectorAll("[data-auth-mode]");

  /* Ordem dos modos na horizontal, para o celular saber de que lado o
     formulário deve entrar (o desktop já mostra isso pelo painel do laço
     deslizando). "forgot" tem o mesmo índice de "login" porque é uma etapa
     dentro de entrar, não um terceiro destino. */
  const MODE_ORDER = { login: 0, forgot: 0, twofactor: 0, register: 1 };

  function setAuthMode(mode, moveFocus){
    if(!authShell || authShell.dataset.mode === mode) return;
    authShell.dataset.dir = MODE_ORDER[mode] >= MODE_ORDER[authShell.dataset.mode] ? "forward" : "back";

    /* Pulso do laço: remover, forçar reflow e recolocar é o que reinicia uma
       animação CSS — só readicionar uma classe que já está lá não dispara
       nada. Sem isso o laço reagiria à primeira troca e ficaria parado nas
       seguintes. */
    authShell.classList.remove("auth-deco-pulse");
    void authShell.offsetWidth;
    authShell.classList.add("auth-deco-pulse");

    authShell.dataset.mode = mode;
    // "forgot" é uma etapa dentro do fluxo de entrar, e não existe aba para
    // ela — a aba "Entrar" continua marcada para o mobile não ficar sem
    // nenhuma aba ativa.
    const tabMode = mode === "forgot" ? "login" : mode;
    modeButtons.forEach((btn) => {
      // Só as abas têm role="tab"; os botões do painel/links não.
      if(btn.getAttribute("role") === "tab"){
        btn.setAttribute("aria-selected", String(btn.dataset.authMode === tabMode));
      }
    });
    if(!moveFocus) return;
    // Sem isso o foco fica no botão que sumiu/trocou de rótulo, e quem usa
    // teclado teria de tabular a tela inteira de novo. O atraso espera a
    // transição do CSS: enquanto o painel está visibility:hidden o campo
    // não é focável.
    const firstFieldId = { login: "loginEmail", register: "registerName", forgot: "forgotEmail", twofactor: "twoFactorCode" }[mode];
    setTimeout(() => document.getElementById(firstFieldId)?.focus(), 650);
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode, true));
  });

  const loginForm = document.getElementById("loginForm");
  const loginMsg = document.getElementById("loginMsg");

  /* Guarda o desafio da 2ª etapa entre os dois envios. Fica só nesta
     variável (nunca em localStorage/sessionStorage): é um token que vale
     acesso, e o objetivo do 2º fator é justamente não deixar nada
     reaproveitável parado no navegador. Some se a página for recarregada,
     e aí o login recomeça — que é o comportamento certo. */
  let pendingChallengeToken = null;

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("loginSubmitBtn");
    showMessage(loginMsg, "", null);
    setLoading(btn, true, "Entrando...");
    try{
      const user = await postJSON("/api/auth/login", {
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value,
      });
      // Senha certa, mas a conta tem verificação em duas etapas: o servidor
      // ainda NÃO criou sessão, só devolveu um desafio curto para trocar
      // pelo código.
      if(user?.twoFactorRequired){
        pendingChallengeToken = user.challengeToken;
        setLoading(btn, false);
        showMessage(twoFactorMsg, "", null);
        document.getElementById("twoFactorCode").value = "";
        setAuthMode("twofactor", true);
        return;
      }
      window.location.href = destinationFor(user);
    }catch(err){
      showMessage(loginMsg, err.message, "error");
      setLoading(btn, false);
    }
  });

  const twoFactorForm = document.getElementById("twoFactorForm");
  const twoFactorMsg = document.getElementById("twoFactorMsg");
  const twoFactorCode = document.getElementById("twoFactorCode");

  /* Deixa passar dígitos (código do app) e também letras/hífen (código de
     recuperação, no formato ABCDE-12345), só padronizando em maiúsculas. O
     maxlength do HTML é 6, então aqui soltamos o limite quando já não parece
     um código de 6 dígitos. */
  twoFactorCode?.addEventListener("input", () => {
    const v = twoFactorCode.value.toUpperCase();
    twoFactorCode.maxLength = /^\d*$/.test(v.replace(/-/g, "")) && !v.includes("-") ? 6 : 11;
    twoFactorCode.value = v;
  });

  twoFactorForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("twoFactorSubmitBtn");
    showMessage(twoFactorMsg, "", null);
    setLoading(btn, true, "Verificando...");
    try{
      const user = await postJSON("/api/auth/login/2fa", {
        challengeToken: pendingChallengeToken,
        code: twoFactorCode.value.trim(),
      });
      window.location.href = destinationFor(user);
    }catch(err){
      setLoading(btn, false);
      // O desafio expirou (5 min) — não adianta pedir o código de novo,
      // tem que refazer o login desde a senha.
      if(/expirada/i.test(err.message)){
        pendingChallengeToken = null;
        setAuthMode("login", true);
        showMessage(loginMsg, err.message, "error");
        return;
      }
      showMessage(twoFactorMsg, err.message, "error");
      twoFactorCode.select();
    }
  });

  const registerForm = document.getElementById("registerForm");
  const registerMsg = document.getElementById("registerMsg");
  const registerCep = document.getElementById("registerCep");

  // Máscara 00000-000, igual à do carrinho (js/main.js) — o servidor
  // recebe só os dígitos de qualquer jeito.
  registerCep?.addEventListener("input", () => {
    let v = registerCep.value.replace(/\D/g, "").slice(0, 8);
    if(v.length > 5) v = v.slice(0, 5) + "-" + v.slice(5);
    registerCep.value = v;
  });
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("registerSubmitBtn");
    showMessage(registerMsg, "", null);

    const password = document.getElementById("registerPassword").value;
    if(password.length < 8){
      showMessage(registerMsg, "A senha precisa ter pelo menos 8 caracteres.", "error");
      return;
    }
    const cep = registerCep.value.replace(/\D/g, "");
    if(cep.length !== 8){
      showMessage(registerMsg, "Informe um CEP válido, com 8 dígitos.", "error");
      return;
    }

    setLoading(btn, true, "Criando conta...");
    try{
      const user = await postJSON("/api/auth/register", {
        name: document.getElementById("registerName").value.trim(),
        email: document.getElementById("registerEmail").value.trim(),
        cep,
        password,
      });
      window.location.href = destinationFor(user);
    }catch(err){
      showMessage(registerMsg, err.message, "error");
      setLoading(btn, false);
    }
  });

  /* "Esqueci a senha": o servidor responde a mesma coisa exista ou não uma
     conta com aquele e-mail (evita virar um verificador de quem é cliente
     da loja), então a mensagem aqui é sempre a de sucesso — inclusive
     quando o e-mail não está cadastrado. */
  const forgotForm = document.getElementById("forgotForm");
  const forgotMsg = document.getElementById("forgotMsg");
  forgotForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("forgotSubmitBtn");
    showMessage(forgotMsg, "", null);

    const emailValue = document.getElementById("forgotEmail").value.trim();
    if(!emailValue){
      showMessage(forgotMsg, "Informe o e-mail da sua conta.", "error");
      return;
    }

    setLoading(btn, true, "Enviando...");
    try{
      const data = await postJSON("/api/auth/forgot-password", { email: emailValue });
      showMessage(forgotMsg, data.message || "Se existir uma conta com esse e-mail, enviamos o link de redefinição.", "success");
      forgotForm.reset();
    }catch(err){
      showMessage(forgotMsg, err.message, "error");
    }finally{
      setLoading(btn, false);
    }
  });

  // Mostrar/ocultar senha — um listener delegado só, então funciona para
  // qualquer campo marcado com .password-toggle-btn + data-target (o id do
  // input ao lado), sem precisar registrar cada campo aqui um por um.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".password-toggle-btn");
    if(!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if(!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.setAttribute("aria-pressed", String(!showing));
    btn.setAttribute("aria-label", showing ? "Mostrar senha" : "Ocultar senha");
    btn.querySelector("i").className = showing ? "bi bi-eye" : "bi bi-eye-slash";
  });

  // Se a sessão já existir (checada por js/auth.js), mostra um aviso em vez
  // dos formulários — evita a confusão de "por que estou vendo login de novo".
  document.addEventListener("plc:auth", (e) => {
    const user = e.detail.user;
    const authForms = document.getElementById("authForms");
    const alreadyBox = document.getElementById("alreadyLoggedIn");
    if(user && authForms && alreadyBox){
      authForms.classList.add("d-none");
      alreadyBox.classList.remove("d-none");
      document.getElementById("alreadyName").textContent = user.name;
      const primaryLink = document.getElementById("alreadyPrimaryLink");
      if(primaryLink && user.isAdmin){
        primaryLink.href = "admin.html";
        primaryLink.textContent = "Ir para o painel administrativo";
      }
    }
  });
})();
