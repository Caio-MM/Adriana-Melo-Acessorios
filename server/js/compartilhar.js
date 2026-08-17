(function(){
  "use strict";

  /* =====================================================================
     COMPARTILHAR — botões de WhatsApp / Facebook / Pinterest / copiar link
     -------------------------------------------------------------------
     Um módulo só, dirigido por atributos no HTML, para o mesmo bloco poder
     aparecer na página de obrigado (pagamento-sucesso.html) e na tela do
     Pix confirmado (pagamento-pix.html) sem duplicar código.

     Cada rede recebe um endereço com ?utm_source próprio. É isso que
     permite a lojista descobrir, no Google Analytics/Search Console, de
     qual rede vieram as visitas — sem isso todo mundo chega como
     "tráfego direto" e não dá para saber o que valeu a pena.

     Instagram não entra: a rede não tem endereço de compartilhamento pela
     web (só pelo app, para conteúdo já publicado). Para ela o caminho é o
     "copiar link", que serve para qualquer lugar.
  ===================================================================== */

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
      // wa.me sem número = abre a lista de contatos para escolher com quem
      // compartilhar, em vez de mandar para a loja.
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

    /* Botão nativo: no celular abre a folha de compartilhamento do próprio
       sistema (Instagram, Telegram, e-mail, o que a pessoa tiver instalado)
       — bem mais completo que qualquer lista fixa. Fica escondido por
       padrão e só aparece onde a API existe, para não virar um botão que
       não faz nada no computador. */
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
          // Cancelar o compartilhamento cai aqui e não é erro nenhum.
          if(err.name !== "AbortError") console.warn("Falha ao compartilhar:", err);
        }
      });
    }

    /* Cópia pelo caminho antigo: um campo temporário + execCommand("copy").
       É o que ainda funciona nos navegadores embutidos do Instagram e do
       Facebook — exatamente de onde vem quem clica em "compartilhar" — em
       que navigator.clipboard costuma ser bloqueado. Devolve true/false e
       nunca lança. */
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
          // Nada aqui pode escapar como erro: window.prompt(), que seria a
          // saída óbvia, é BLOQUEADO (lança) em navegador embutido de rede
          // social, e uma promessa rejeitada acionaria o error-boundary e
          // cobriria a tela com "algo deu errado" — no meio de uma tela de
          // compra confirmada.
          console.warn("Área de transferência indisponível, tentando o modo antigo:", err);
          copiou = copiarPeloCampo(endereco);
        }
        const original = copiar.innerHTML;
        const estado = copiou
          ? { classe: "is-copied", icone: "bi-check2" }
          // Sem cópia possível: o botão avisa em vez de fingir que deu
          // certo. Os outros botões de compartilhar continuam servindo.
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
