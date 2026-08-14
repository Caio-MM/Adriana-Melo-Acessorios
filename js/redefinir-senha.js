(function(){
  "use strict";

  /* =====================================================================
     REDEFINIR SENHA — página aberta pelo link enviado no e-mail
     (redefinir-senha.html?token=...).

     O token nunca é guardado em localStorage/sessionStorage nem exibido na
     tela: sai da URL, vive numa variável e é usado uma vez só. Quem valida
     de fato é o servidor (POST /api/auth/reset-password) — aqui só existe
     a checagem de "veio algum token?" para não mostrar um formulário que
     não teria como funcionar.
  ===================================================================== */
  const token = new URLSearchParams(window.location.search).get("token");

  const form = document.getElementById("resetForm");
  const invalidBox = document.getElementById("resetInvalid");
  const doneBox = document.getElementById("resetDone");
  const msg = document.getElementById("resetMsg");

  if(!token){
    invalidBox.classList.remove("d-none");
    return;
  }
  form.classList.remove("d-none");

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

  function showMessage(text, type){
    msg.textContent = text || "";
    msg.classList.toggle("text-danger", type === "error");
    msg.classList.toggle("text-success", type === "success");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("resetSubmitBtn");
    const password = document.getElementById("resetPassword").value;
    const confirmation = document.getElementById("resetPasswordConfirm").value;
    showMessage("", null);

    if(password.length < 8){
      showMessage("A senha precisa ter pelo menos 8 caracteres.", "error");
      return;
    }
    if(password !== confirmation){
      showMessage("As duas senhas não são iguais.", "error");
      return;
    }

    setLoading(btn, true, "Salvando...");
    try{
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        throw new Error(data.error || "Não foi possível redefinir a senha. Tente novamente.");
      }
      // Trocar a senha derruba toda sessão antiga (inclusive esta), então o
      // caminho daqui é sempre entrar de novo com a senha nova.
      form.classList.add("d-none");
      doneBox.classList.remove("d-none");
    }catch(err){
      showMessage(err.message, "error");
      setLoading(btn, false);
    }
  });
})();
