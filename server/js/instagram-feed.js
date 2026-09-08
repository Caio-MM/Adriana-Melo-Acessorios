(() => {
  "use strict";

  const PERFIL_INSTAGRAM = "https://www.instagram.com/adriana_melo_acessorios/";

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
      a.href = /^https?:\/\//i.test(String(post.permalink || ""))
        ? post.permalink
        : PERFIL_INSTAGRAM;
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
