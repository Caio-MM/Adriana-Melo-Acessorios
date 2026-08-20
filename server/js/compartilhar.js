(function(){
  "use strict";

  /* ============ COMPARTILHAR — botões de WhatsApp / Facebook / Pinterest / copiar link ============ */

  const MENSAGEM = "Achei esse ateliê de laços feitos à mão e amei 🎀";

  function comUtm(url, origem){
    const u = new URL(url);
    u.searchParams.set("utm_source", origem);
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", "compartilhar");
    return u.toString();
  }

  function montarLinks(base){
    return {

      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${MENSAGEM} ${comUtm(base, "whatsapp")}`)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(comUtm(base, "facebook"))}`,
      pinterest: `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(comUtm(base, "pinterest"))}&description=${encodeURIComponent(MENSAGEM)}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(comUtm(base, "telegram"))}&text=${encodeURIComponent(MENSAGEM)}`,
    };
  }

  document.querySelectorAll(".share-block").forEach((bloco) => {
    const base = bloco.dataset.shareUrl || window.location.origin + "/";
    const links = montarLinks(base);

    bloco.querySelectorAll("[data-share]").forEach((el) => {
      const destino = links[el.dataset.share];
      if(destino) el.href = destino;
    });

    const nativo = bloco.querySelector(".share-btn-native");
    if(nativo && navigator.share){
      nativo.hidden = false;
      nativo.addEventListener("click", async () => {
        try{
          await navigator.share({
            title: "Adriana Melo Acessórios",
            text: MENSAGEM,
            url: comUtm(base, "nativo"),
          });
        }catch(err){

          if(err.name !== "AbortError") console.warn("Falha ao compartilhar:", err);
        }
      });
    }

    function copiarPeloCampo(texto){
      const campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.cssText = "position:fixed; top:0; left:-9999px; opacity:0";
      document.body.appendChild(campo);
      try{
        campo.select();
        return document.execCommand("copy");
      }catch{
        return false;
      }finally{
        campo.remove();
      }
    }

    const copiar = bloco.querySelector(".share-btn-copy");
    if(copiar){
      copiar.addEventListener("click", async () => {
        const endereco = comUtm(base, "link");
        let copiou = false;
        try{
          await navigator.clipboard.writeText(endereco);
          copiou = true;
        }catch(err){

          console.warn("Área de transferência indisponível, tentando o modo antigo:", err);
          copiou = copiarPeloCampo(endereco);
        }
        const original = copiar.innerHTML;
        const estado = copiou
          ? { classe: "is-copied", icone: "bi-check2" }

          : { classe: "is-failed", icone: "bi-exclamation-triangle" };
        copiar.innerHTML = `<i class="bi ${estado.icone}"></i>`;
        copiar.classList.add(estado.classe);
        setTimeout(() => {
          copiar.innerHTML = original;
          copiar.classList.remove(estado.classe);
        }, 2000);
      });
    }
  });
})();
