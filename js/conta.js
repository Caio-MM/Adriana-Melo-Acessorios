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
