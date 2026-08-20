/* =============================================================================
   TELA DE CARREGAMENTO PARA CONEXÃO LENTA
   =============================================================================
   Aparece só quando a espera passa de 3 segundos. Esse atraso é o ponto todo
   do arquivo: numa conexão boa a resposta chega em milissegundos, e mostrar
   um overlay que pisca por 200ms deixa a página MAIS instável de usar, não
   menos — o usuário vê um flash e não entende o que aconteceu. Abaixo de ~1s
   ninguém sente falta de aviso nenhum; acima de 3s a tela parada sem
   explicação é o que faz a pessoa clicar de novo ou desistir.

   Carregado em toda página logo depois do error-boundary.js: ele embrulha o
   fetch global, então precisa estar no ar antes de qualquer script que faça
   chamadas — mas depois do error-boundary, que tem que ser o primeiro de
   todos para capturar erros dos demais.
============================================================================= */
(function(){
  "use strict";

  var ATRASO_MS = 3000;
  // Rede de segurança: se uma resposta nunca chegar (servidor mudo, túnel de
  // rede que engoliu a requisição), o overlay bloquearia a página para
  // sempre. Depois deste prazo ele sai sozinho e devolve o controle.
  var LIMITE_MS = 30000;

  /* Chamadas que a página faz sozinha, sem ninguém ter pedido, ficam de fora:
     mostrar "Carregando..." por cima da tela por causa de uma verificação de
     fundo assusta sem motivo. A consulta de status do Pix é o caso concreto —
     ela roda de 4 em 4 segundos por até 20 minutos (js/pagamento-pix.js)
     enquanto a cliente olha o QR code parada. */
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
    // role=status + aria-live: o leitor de tela anuncia "Carregando" sozinho.
    // aria-busy no <html> avisa que a página inteira está ocupada.
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
    // Trava o scroll junto: sem isso a página continua rolando atrás do
    // overlay, o que passa a impressão de que dá para interagir.
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
    // Só some quando NADA mais está pendente: com duas chamadas em paralelo
    // (o painel faz cinco), esconder na primeira que voltasse deixaria o
    // overlay piscando no meio do carregamento.
    if(emVoo === 0) cancelar();
  }

  /* ---------------- Chamadas de API (fetch) ---------------- */
  var fetchOriginal = window.fetch;
  window.fetch = function(entrada, opcoes){
    var url = (entrada && entrada.url) || entrada || "";
    if(ehDeFundo(url)) return fetchOriginal.apply(this, arguments);
    comecou();
    // finally em vez de then/catch separados: o contador precisa baixar
    // mesmo quando a chamada falha, senão um erro de rede deixaria o
    // overlay preso na tela.
    return fetchOriginal.apply(this, arguments).finally(terminou);
  };

  /* ---------------- Navegação entre páginas ---------------- */
  // Um clique em link só mostra o overlay se a página seguinte demorar —
  // mesmo critério dos 3 segundos, agendado aqui e cancelado pelo
  // pageshow/pagehide se a troca for rápida.
  document.addEventListener("click", function(e){
    var link = e.target.closest && e.target.closest("a[href]");
    if(!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || link.target === "_blank") return;
    var href = link.getAttribute("href");
    // Âncora na mesma página, download e protocolos que abrem outro app
    // (tel:, mailto:, whatsapp) não carregam página nenhuma.
    if(!href || href.charAt(0) === "#" || link.hasAttribute("download") || /^[a-z]+:/i.test(href) && !/^https?:/i.test(href)) return;
    if(link.origin && link.origin !== location.origin) return;
    agendar();
  }, true);

  document.addEventListener("submit", function(e){
    // Formulário que envia por fetch (a maioria aqui) já é coberto pelo
    // wrapper acima; este ramo é só para o envio nativo, que navega.
    if(e.target && !e.defaultPrevented) agendar();
  }, true);

  // Voltar pelo histórico traz a página do cache sem recarregar nada — o
  // overlay tem que sumir, senão a pessoa volta e encontra a tela travada.
  window.addEventListener("pageshow", cancelar);
  window.addEventListener("pagehide", cancelar);
})();
