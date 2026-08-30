/* ============ TELA DE CARREGAMENTO PARA CONEXÃO LENTA ============ */
(function(){
  "use strict";

  var ATRASO_MS = 3000;

  var LIMITE_MS = 30000;

  var ROTAS_DE_FUNDO = [
    /\/api\/orders\/[^/]+\/status$/,
    /\/api\/auth\/me$/,
  ];
  function ehDeFundo(url){
    return ROTAS_DE_FUNDO.some(function(re){ return re.test(String(url)); });
  }

  var overlay = null;
  var emVoo = 0;
  var timerMostrar = null;
  var timerLimite = null;

  function criarOverlay(){
    if(overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "app-loading";

    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML =
      '<div class="app-loading-card">' +
        '<div class="app-loading-bow" aria-hidden="true"></div>' +
        '<p class="app-loading-text">Carregando...</p>' +
        '<p class="app-loading-hint">Sua conexão está um pouco lenta.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function mostrar(){
    if(!document.body) return;
    criarOverlay().classList.add("is-visible");
    document.documentElement.setAttribute("aria-busy", "true");

    document.body.classList.add("app-loading-lock");
  }

  function esconder(){
    if(overlay) overlay.classList.remove("is-visible");
    document.documentElement.removeAttribute("aria-busy");
    if(document.body) document.body.classList.remove("app-loading-lock");
  }

  function agendar(){
    if(timerMostrar) return;
    timerMostrar = setTimeout(mostrar, ATRASO_MS);
    timerLimite = setTimeout(function(){ emVoo = 0; cancelar(); }, LIMITE_MS);
  }

  function cancelar(){
    clearTimeout(timerMostrar); clearTimeout(timerLimite);
    timerMostrar = null; timerLimite = null;
    esconder();
  }

  function comecou(){ emVoo++; agendar(); }
  function terminou(){
    emVoo = Math.max(0, emVoo - 1);

    if(emVoo === 0) cancelar();
  }

  var fetchOriginal = window.fetch;
  window.fetch = function(entrada, opcoes){
    var url = (entrada && entrada.url) || entrada || "";
    if(ehDeFundo(url)) return fetchOriginal.apply(this, arguments);
    comecou();

    return fetchOriginal.apply(this, arguments).finally(terminou);
  };

  window.addEventListener("pageshow", cancelar);
  window.addEventListener("pagehide", cancelar);
})();
