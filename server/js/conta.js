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
      const err = new Error(data.error || "Algo deu errado. Tente novamente em instantes.");
      // Cooldown de reenvio (2FA por e-mail) manda quanto falta em ms — sem
      // isso o chamador só teria a mensagem de texto, não o número.
      if(typeof data.retryAfterMs === "number") err.retryAfterMs = data.retryAfterMs;
      throw err;
    }
    return data;
  }

  function destinationFor(user){
    if(user?.isAdmin) return "admin.html";

    const retorno = new URLSearchParams(location.search).get("retorno");
    return retorno === "carrinho" ? "index.html?carrinho=1" : "pedidos.html";
  }

  /* ============ PAINEL DESLIZANTE — alternar entre "Entrar" e "Criar conta". ============ */
  const authShell = document.getElementById("authForms");
  const modeButtons = document.querySelectorAll("[data-auth-mode]");

  const MODE_ORDER = { login: 0, forgot: 0, twofactor: 0, register: 1 };

  function setAuthMode(mode, moveFocus){
    if(!authShell || authShell.dataset.mode === mode) return;
    authShell.dataset.dir = MODE_ORDER[mode] >= MODE_ORDER[authShell.dataset.mode] ? "forward" : "back";

    authShell.classList.remove("auth-deco-pulse");
    void authShell.offsetWidth;
    authShell.classList.add("auth-deco-pulse");

    authShell.dataset.mode = mode;

    const tabMode = mode === "forgot" ? "login" : mode;
    modeButtons.forEach((btn) => {

      if(btn.getAttribute("role") === "tab"){
        btn.setAttribute("aria-selected", String(btn.dataset.authMode === tabMode));
      }
    });
    if(!moveFocus) return;

    const firstFieldId = { login: "loginEmail", register: "registerName", forgot: "forgotEmail", twofactor: "twoFactorCode" }[mode];
    setTimeout(() => document.getElementById(firstFieldId)?.focus(), 650);
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode, true));
  });

  const loginForm = document.getElementById("loginForm");
  const loginMsg = document.getElementById("loginMsg");

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

      if(user?.twoFactorRequired){
        pendingChallengeToken = user.challengeToken;
        setLoading(btn, false);
        resetTwoFactorStepsUI();
        setAuthMode("twofactor", true);
        return;
      }
      window.location.href = destinationFor(user);
    }catch(err){
      showMessage(loginMsg, err.message, "error");
      setLoading(btn, false);
    }
  });

  /* ============ 2FA — escolha do método, depois o código ============
     Passo 1 (twoFactorChoiceStep): "app" ou "e-mail" — clique já é a ação,
     não uma seleção que espera confirmação depois.
     Passo 2 (twoFactorCodeStep): mesmo campo #twoFactorCode/#twoFactorForm
     para os dois métodos — um código emailado entra no mesmo lugar que um
     código do app, o back-end (/api/auth/login/2fa) já tenta os dois. */
  const twoFactorChoiceStep = document.getElementById("twoFactorChoiceStep");
  const twoFactorCodeStep = document.getElementById("twoFactorCodeStep");
  const chooseAppBtn = document.getElementById("chooseAppBtn");
  const chooseEmailBtn = document.getElementById("chooseEmailBtn");
  const twoFactorBackBtn = document.getElementById("twoFactorBackBtn");
  const twoFactorCodeSubtitle = document.getElementById("twoFactorCodeSubtitle");
  const twoFactorHint = document.getElementById("twoFactorHint");
  const twoFactorEmailHint = document.getElementById("twoFactorEmailHint");
  const twoFactorForm = document.getElementById("twoFactorForm");
  const twoFactorMsg = document.getElementById("twoFactorMsg");
  const twoFactorCode = document.getElementById("twoFactorCode");
  const twoFactorEmailBtn = document.getElementById("twoFactorEmailBtn");

  const APP_SUBTITLE = "Abra seu app de autenticação e digite o código de 6 dígitos.";
  const EMAIL_SUBTITLE = "Enviamos um código para o seu e-mail — confira a caixa de entrada e digite abaixo.";

  let emailCooldownTimer = null;

  function resetEmailCooldownUI(){
    clearInterval(emailCooldownTimer);
    emailCooldownTimer = null;
    if(twoFactorEmailBtn){
      twoFactorEmailBtn.disabled = false;
      twoFactorEmailBtn.textContent = "Reenviar código";
    }
  }

  function startEmailCooldown(seconds){
    clearInterval(emailCooldownTimer);
    let remaining = Math.max(1, Math.round(seconds));
    twoFactorEmailBtn.disabled = true;
    twoFactorEmailBtn.textContent = `Reenviar em ${remaining}s`;
    emailCooldownTimer = setInterval(() => {
      remaining -= 1;
      if(remaining <= 0){ resetEmailCooldownUI(); return; }
      twoFactorEmailBtn.textContent = `Reenviar em ${remaining}s`;
    }, 1000);
  }

  // Chamado ao entrar na tela (login com 2FA) e sempre que o desafio
  // caduca no meio do caminho — começa sempre do passo de escolha.
  function resetTwoFactorStepsUI(){
    resetEmailCooldownUI();
    showMessage(twoFactorMsg, "", null);
    twoFactorCode.value = "";
    twoFactorChoiceStep.classList.remove("d-none");
    twoFactorCodeStep.classList.add("d-none");
    chooseAppBtn.disabled = false;
    chooseEmailBtn.disabled = false;
    chooseEmailBtn.classList.remove("is-sending");
  }

  function showCodeStep(method){
    twoFactorChoiceStep.classList.add("d-none");
    twoFactorCodeStep.classList.remove("d-none");
    twoFactorCodeSubtitle.textContent = method === "email" ? EMAIL_SUBTITLE : APP_SUBTITLE;
    twoFactorHint.classList.toggle("d-none", method === "email");
    twoFactorEmailHint.classList.toggle("d-none", method !== "email");
    twoFactorCode.value = "";
    setTimeout(() => twoFactorCode.focus(), 50);
  }

  // Trata o desafio caduco do mesmo jeito nos dois caminhos (código/e-mail):
  // volta pro login E reseta esta tela pro passo de escolha, pra próxima
  // vez começar do zero.
  function handleExpiredChallenge(message){
    pendingChallengeToken = null;
    resetTwoFactorStepsUI();
    setAuthMode("login", true);
    showMessage(loginMsg, message, "error");
  }

  chooseAppBtn?.addEventListener("click", () => showCodeStep("app"));

  chooseEmailBtn?.addEventListener("click", async () => {
    if(!pendingChallengeToken) return;
    showMessage(twoFactorMsg, "", null);
    chooseAppBtn.disabled = true;
    chooseEmailBtn.disabled = true;
    chooseEmailBtn.classList.add("is-sending");
    try{
      await postJSON("/api/auth/login/2fa/email", { challengeToken: pendingChallengeToken });
      chooseEmailBtn.classList.remove("is-sending");
      showCodeStep("email");
      startEmailCooldown(60);
    }catch(err){
      chooseAppBtn.disabled = false;
      chooseEmailBtn.disabled = false;
      chooseEmailBtn.classList.remove("is-sending");
      if(/expirada/i.test(err.message)){
        handleExpiredChallenge(err.message);
        return;
      }
      showMessage(twoFactorMsg, err.message, "error");
    }
  });

  twoFactorBackBtn?.addEventListener("click", () => {
    resetEmailCooldownUI();
    showMessage(twoFactorMsg, "", null);
    twoFactorChoiceStep.classList.remove("d-none");
    twoFactorCodeStep.classList.add("d-none");
    chooseAppBtn.disabled = false;
    chooseEmailBtn.disabled = false;
  });

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

      if(/expirada/i.test(err.message)){
        handleExpiredChallenge(err.message);
        return;
      }
      showMessage(twoFactorMsg, err.message, "error");
      twoFactorCode.select();
    }
  });

  // Reenviar dentro do passo de e-mail: mesma chamada do cartão de escolha,
  // só que agora já estamos no passo 2. Se o servidor disser que ainda tem
  // cooldown ativo (voltou pro passo 1 e escolheu e-mail de novo antes dos
  // 60s), usa o retryAfterMs real em vez de assumir 60s de novo.
  twoFactorEmailBtn?.addEventListener("click", async () => {
    if(!pendingChallengeToken) return;
    showMessage(twoFactorMsg, "", null);
    twoFactorEmailBtn.disabled = true;
    try{
      const data = await postJSON("/api/auth/login/2fa/email", { challengeToken: pendingChallengeToken });
      showMessage(twoFactorMsg, data.message || "Código enviado! Confira seu e-mail.", "success");
      startEmailCooldown(60);
    }catch(err){
      if(/expirada/i.test(err.message)){
        handleExpiredChallenge(err.message);
        return;
      }
      if(typeof err.retryAfterMs === "number" && err.retryAfterMs > 0){
        startEmailCooldown(err.retryAfterMs / 1000);
      }else{
        twoFactorEmailBtn.disabled = false;
      }
      showMessage(twoFactorMsg, err.message, "error");
    }
  });

  const registerForm = document.getElementById("registerForm");
  const registerMsg = document.getElementById("registerMsg");
  const registerCpf = document.getElementById("registerCpf");

  registerCpf?.addEventListener("input", () => {
    let v = registerCpf.value.replace(/\D/g, "").slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    registerCpf.value = v;
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
    const cpf = registerCpf.value.replace(/\D/g, "");
    if(cpf.length !== 11){
      showMessage(registerMsg, "Informe um CPF válido, com 11 dígitos.", "error");
      return;
    }
    const consent = document.getElementById("registerConsent");
    if(consent && !consent.checked){
      showMessage(registerMsg, "Aceite a Política de Privacidade para criar a conta.", "error");
      return;
    }

    setLoading(btn, true, "Criando conta...");
    try{
      const user = await postJSON("/api/auth/register", {
        name: document.getElementById("registerName").value.trim(),
        email: document.getElementById("registerEmail").value.trim(),
        cpf,
        password,
      });
      window.location.href = destinationFor(user);
    }catch(err){
      showMessage(registerMsg, err.message, "error");
      setLoading(btn, false);
    }
  });

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
