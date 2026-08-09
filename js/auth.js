(function(){
  "use strict";

  /* =====================================================================
     SESSÃO — usado em toda página (index.html, conta.html, pedidos.html).
     Consulta GET /api/auth/me (o cookie de sessão httpOnly vai junto
     automaticamente, nunca é lido/guardado aqui em JS) e:
       1) atualiza a área de conta da navbar (Entrar/Cadastrar vs Nome/Sair);
       2) dispara o evento "plc:auth" com o usuário (ou null), para outras
          páginas (conta.html, pedidos.html) reagirem sem precisar consultar
          a sessão de novo.
  ===================================================================== */
  function escapeHTML(str){
    return String(str).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  const navAccount = document.getElementById("navAccount");
  const navAccountMobile = document.getElementById("navAccountMobile");

  function renderLoggedOut(){
    if(navAccount){
      navAccount.innerHTML = `<a href="conta.html" class="plc-nav-link"><i class="bi bi-person me-1"></i>Entrar</a>`;
    }
    if(navAccountMobile){
      navAccountMobile.innerHTML = `<a href="conta.html" class="plc-nav-link" data-bs-dismiss="offcanvas"><i class="bi bi-person me-1"></i>Entrar / Cadastrar</a>`;
    }
  }

  function renderLoggedIn(user){
    const firstName = escapeHTML(String(user.name || "").trim().split(" ")[0] || "cliente");
    if(navAccount){
      navAccount.innerHTML = `
        <a href="pedidos.html" class="plc-nav-link">Olá, ${firstName}</a>
        <button type="button" class="plc-nav-link" id="logoutBtn" style="background:none;border:none;cursor:pointer">Sair</button>
      `;
      document.getElementById("logoutBtn")?.addEventListener("click", logout);
    }
    if(navAccountMobile){
      navAccountMobile.innerHTML = `
        <a href="pedidos.html" class="plc-nav-link" data-bs-dismiss="offcanvas"><i class="bi bi-bag-check me-1"></i>Meus pedidos</a>
        <button type="button" class="plc-nav-link text-start p-0 border-0 bg-transparent" id="logoutBtnMobile">Sair (${firstName})</button>
      `;
      document.getElementById("logoutBtnMobile")?.addEventListener("click", logout);
    }
  }

  async function logout(){
    try{
      await fetch("/api/auth/logout", { method: "POST" });
    }catch(err){
      console.warn("Falha ao encerrar sessão no servidor (limpando mesmo assim):", err);
    }
    window.location.href = "index.html";
  }

  async function checkSession(){
    let user = null;
    try{
      const res = await fetch("/api/auth/me");
      if(res.ok) user = await res.json();
    }catch(err){
      console.warn("Não foi possível verificar a sessão:", err);
    }
    if(user) renderLoggedIn(user); else renderLoggedOut();
    document.dispatchEvent(new CustomEvent("plc:auth", { detail: { user } }));
    return user;
  }

  window.PLCAuth = { checkSession, escapeHTML, logout };
  checkSession();
})();
