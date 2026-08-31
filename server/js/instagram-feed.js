/**
 * =============================================================================
 *  FEED AUTOMÁTICO DO INSTAGRAM — seção "nossa história" (index.html)
 * =============================================================================
 *  Busca /api/instagram/feed (server/lib/instagram.js) e alterna entre os
 *  3 estados já presentes no HTML (#instagramFeedCard): loading (default,
 *  visível até essa busca terminar), live (grid de posts reais) ou
 *  fallback (API não configurada/indisponível — mostra "Seguir no
 *  Instagram" no lugar). Arquivo próprio, não entra em main.js — só
 *  manipula classes dentro do próprio card, sem interferir no
 *  IntersectionObserver de scroll-reveal que já existe lá.
 * =============================================================================
 */
(() => {
  "use strict";

  const card = document.getElementById("instagramFeedCard");
  if (!card) return;

  const loadingEl = card.querySelector(".instagram-feed-loading");
  const liveEl = card.querySelector(".instagram-feed-live");
  const fallbackEl = card.querySelector(".instagram-feed-fallback");

  function showFallback() {
    loadingEl.classList.add("d-none");
    liveEl.classList.add("d-none");
    fallbackEl.classList.remove("d-none");
    card.dataset.state = "fallback";
  }

  function showLive(feed) {
    liveEl.querySelector(".instagram-feed-avatar").src = feed.profilePictureUrl || "";
    liveEl.querySelector(".instagram-feed-username").textContent = feed.username ? `@${feed.username}` : "@adriana_melo_acessorios";

    const grid = liveEl.querySelector(".instagram-feed-grid");
    grid.innerHTML = "";
    feed.posts.forEach((post) => {
      const a = document.createElement("a");
      a.className = "instagram-feed-thumb";
      a.href = post.permalink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", "Ver publicação no Instagram");

      const img = document.createElement("img");
      img.src = post.displayUrl;
      img.alt = post.caption ? post.caption.slice(0, 120) : "";
      img.loading = "lazy";

      const overlay = document.createElement("span");
      overlay.className = "instagram-feed-thumb-overlay";
      overlay.innerHTML = '<i class="bi bi-box-arrow-up-right"></i>';

      a.append(img, overlay);
      grid.appendChild(a);
    });

    loadingEl.classList.add("d-none");
    fallbackEl.classList.add("d-none");
    liveEl.classList.remove("d-none");
    card.dataset.state = "live";
  }

  fetch("/api/instagram/feed")
    .then((res) => (res.ok ? res.json() : { available: false }))
    .then((feed) => {
      if (feed?.available && Array.isArray(feed.posts) && feed.posts.length) {
        showLive(feed);
      } else {
        showFallback();
      }
    })
    .catch(() => showFallback());
})();
