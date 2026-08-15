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
    return user?.isAdmin ? "admin.html" : "pedidos.html";
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
  const MODE_ORDER = { login: 0, forgot: 0, register: 1 };

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
    const firstFieldId = { login: "loginEmail", register: "registerName", forgot: "forgotEmail" }[mode];
    setTimeout(() => document.getElementById(firstFieldId)?.focus(), 650);
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode, true));
  });

  const loginForm = document.getElementById("loginForm");
  const loginMsg = document.getElementById("loginMsg");
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
      window.location.href = destinationFor(user);
    }catch(err){
      showMessage(loginMsg, err.message, "error");
      setLoading(btn, false);
    }
  });

  const registerForm = document.getElementById("registerForm");
  const registerMsg = document.getElementById("registerMsg");
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("registerSubmitBtn");
    showMessage(registerMsg, "", null);

    const password = document.getElementById("registerPassword").value;
    if(password.length < 8){
      showMessage(registerMsg, "A senha precisa ter pelo menos 8 caracteres.", "error");
      return;
    }

    setLoading(btn, true, "Criando conta...");
    try{
      const user = await postJSON("/api/auth/register", {
        name: document.getElementById("registerName").value.trim(),
        email: document.getElementById("registerEmail").value.trim(),
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
