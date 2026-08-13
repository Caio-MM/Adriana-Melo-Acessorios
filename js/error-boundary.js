/* =========================================================================
   ERROR BOUNDARY GLOBAL
   -------------------------------------------------------------------------
   Site é HTML/JS puro (sem framework), então não existe um Error Boundary
   de componente — o equivalente aqui é escutar erros que escapam de todo
   try/catch e cobrir a tela com uma mensagem amigável em vez de deixar a
   página quebrada/em branco com um erro só no console.

   Carregado como o PRIMEIRO <script defer> de cada página (antes do
   bootstrap e dos scripts da própria página), para já estar escutando
   antes de qualquer outro script rodar.

   Só reage a erro de script (`error` no window, fase de bubble — não usa
   capture, então erro de carregamento de imagem/CSS/script não aciona isto,
   só exceção de JS mesmo) e a promise rejeitada sem `.catch` — não a erros
   tratados internamente pela própria página.
========================================================================= */
(function(){
  "use strict";

  let shown = false;

  function showFallback(){
    if(shown || !document.body) return;
    shown = true;

    const overlay = document.createElement("div");
    overlay.className = "error-boundary-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-live", "assertive");
    overlay.innerHTML = `
      <div class="error-boundary-card">
        <svg class="bow-icon" style="width:52px;height:38px;color:var(--blush-500)" aria-hidden="true"><use href="#bow-shape"/></svg>
        <h1 class="section-title mt-3 mb-2" style="font-size:1.35rem">Ops, algo não saiu como esperado</h1>
        <p class="section-sub mb-4">Você pode tentar recarregar a página. Se o problema continuar, volte para o início e tente de novo em instantes.</p>
        <div class="d-flex flex-column gap-2">
          <button type="button" class="btn-blush" id="errorBoundaryReload">Recarregar página</button>
          <a href="index.html" class="btn-outline-blush">Voltar ao Início</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("errorBoundaryReload").addEventListener("click", () => window.location.reload());
  }

  window.addEventListener("error", (e) => {
    console.error("Erro não tratado:", e.error || e.message);
    showFallback();
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("Promise rejeitada sem tratamento:", e.reason);
    showFallback();
  });
})();
