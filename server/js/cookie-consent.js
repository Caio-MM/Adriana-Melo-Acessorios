/**
 * =============================================================================
 *  BANNER DE CONSENTIMENTO DE COOKIES (LGPD)
 * =============================================================================
 *  Aparece na primeira visita, injetado em todas as páginas. A decisão fica
 *  salva em localStorage — não reaparece depois de Aceitar/Rejeitar.
 *
 *  Esta loja usa apenas cookies/armazenamento ESSENCIAIS (carrinho no
 *  localStorage e o cookie de sessão do login). Por isso o banner é honesto e
 *  simples: não há rastreamento de terceiros a "gerenciar", então não existe
 *  um painel de configurações granular falso. "Rejeitar" é tão fácil quanto
 *  "Aceitar" (exigência de LGPD/GDPR) e apenas registra a preferência.
 *
 *  Sem dependências: cria o DOM e injeta o CSS (via classes já em style.css).
 * =============================================================================
 */
(function () {
  "use strict";

  var STORAGE_KEY = "plc_cookie_consent";

  // Já decidiu antes? Não mostra de novo.
  var prev = null;
  try { prev = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage bloqueado: mostra mesmo assim */ }
  if (prev === "accepted" || prev === "rejected") return;

  function save(decision) {
    try {
      localStorage.setItem(STORAGE_KEY, decision);
      localStorage.setItem(STORAGE_KEY + "_at", new Date().toISOString());
    } catch (e) { /* sem storage: a decisão vale só nesta sessão */ }
  }

  function build() {
    var banner = document.createElement("div");
    banner.className = "cookie-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Aviso de privacidade e cookies");
    banner.innerHTML =
      '<div class="cookie-consent-head">' +
        '<span class="cookie-consent-icon" aria-hidden="true"><i class="bi bi-cookie"></i></span>' +
        '<h2 class="cookie-consent-title">Sua privacidade importa</h2>' +
      '</div>' +
      '<p class="cookie-consent-text">Usamos apenas cookies essenciais — para o seu carrinho e o seu login funcionarem. ' +
        'Nada de rastreamento de terceiros. Veja mais na nossa ' +
        '<a href="politica.html">Política de Privacidade</a>.</p>' +
      '<div class="cookie-consent-actions">' +
        '<button type="button" class="btn-outline-blush cookie-consent-btn" data-consent="rejected">Rejeitar</button>' +
        '<button type="button" class="btn-blush cookie-consent-btn" data-consent="accepted">Aceitar</button>' +
      '</div>';
    return banner;
  }

  function dismiss(banner, decision) {
    save(decision);
    banner.classList.add("is-leaving");
    var done = function () { banner.remove(); };
    banner.addEventListener("animationend", done, { once: true });
    // Rede de segurança caso a animação não dispare (reduced-motion, etc.).
    setTimeout(done, 400);
  }

  function mount() {
    var banner = build();
    document.body.appendChild(banner);
    banner.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-consent]");
      if (btn) dismiss(banner, btn.getAttribute("data-consent"));
    });
    // Foco no primeiro botão para quem navega por teclado — sem prender o foco
    // (é banner, não modal): Tab continua saindo normalmente para a página.
    requestAnimationFrame(function () {
      banner.classList.add("is-visible");
      var firstBtn = banner.querySelector(".cookie-consent-btn");
      if (firstBtn) firstBtn.focus({ preventScroll: true });
    });
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
