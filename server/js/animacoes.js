/* ============ ANIMAÇÕES (GSAP) ============
   O site é inteiramente legível sem este arquivo: cada trecho aqui só melhora
   algo que já aparece sozinho, por CSS. Se o GSAP não carregar, nada some.

   Tudo mora dentro de um matchMedia de prefers-reduced-motion porque o bloco
   global do CSS (*{animation:none}) NÃO alcança o GSAP, que escreve estilo
   inline. Sem esta guarda, quem pediu menos movimento receberia tudo. */
(function () {
  "use strict";
  if (!window.gsap || !window.ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);
  const mm = gsap.matchMedia();

  /* SplitText mede as linhas do título: se rodar antes da fonte chegar, ele
     quebra no lugar errado. O timeout é só para nunca ficar preso. */
  function fontesProntas() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 600)),
    ]);
  }

  /* ---- HERO ---- */
  function entradaDoHero() {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    const titulo = hero.querySelector(".hero-title");
    const arte = hero.querySelector(".hero-art");
    const lacos = Array.from(hero.querySelectorAll(".hero-art .floaty"));
    const texto = [
      hero.querySelector(".hero-lead"),
      ...hero.querySelectorAll(".hero .d-flex.flex-wrap > *"),
      ...hero.querySelectorAll(".hero-stats > div"),
    ].filter(Boolean);

    if (titulo) gsap.set(titulo, { opacity: 0 });
    if (texto.length) gsap.set(texto, { opacity: 0, y: 18 });
    /* .hero-art não tem transform próprio, então dá para animar em bloco. Os
       laços dentro dele têm (o keyframe floaty), mas transform de pai e de
       filho se compõem sem brigar — o que não pode é dois donos no MESMO
       elemento, por isso aqui os laços recebem só opacity. */
    if (arte) gsap.set(arte, { opacity: 0, scale: 0.96 });
    if (lacos.length) gsap.set(lacos, { opacity: 0 });

    fontesProntas().then(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      let split = null;
      if (window.SplitText && titulo) {
        gsap.registerPlugin(SplitText);
        try {
          /* SEM mask: a máscara recorta exatamente a caixa da linha, e o
             line-height do título é 1.08 — a descida do ç, do q e do p pinta
             fora dela. O resultado era a letra emergindo por último e parecendo
             cortada, como se estivesse demorando a carregar. Sem máscara não
             existe recorte nenhum: a linha simplesmente sobe e aparece. */
          split = new SplitText(titulo, { type: "lines" });
        } catch (e) {
          split = null;
        }
      }

      if (split && split.lines.length) {
        gsap.set(titulo, { opacity: 1 });
        tl.from(split.lines, { y: 26, opacity: 0, duration: 0.7, stagger: 0.09 });
        // Reverter para não deixar o título picado em <div>s no DOM, que um
        // leitor de tela anunciaria linha a linha.
        tl.add(() => split.revert());
      } else if (titulo) {
        tl.to(titulo, { opacity: 1, duration: 0.8 });
      }

      if (arte) tl.to(arte, { opacity: 1, scale: 1, duration: 1.1 }, 0.15);
      if (texto.length) {
        tl.to(texto, { opacity: 1, y: 0, duration: 0.7, stagger: 0.07 }, 0.35);
      }
      if (lacos.length) {
        tl.to(lacos, { opacity: 1, duration: 0.6, stagger: 0.06 }, 0.5);
      }
    });
  }

  /* ---- RODAPÉ ----
     ⚠️ fromTo, NUNCA from. Um from() guarda o valor ATUAL como destino, e o
     ScrollTrigger.refresh() lá embaixo o recalcula DEPOIS de o próprio from já
     ter zerado o elemento — o destino vira 0 e o tween anima de zero para zero.
     Foi exatamente isso que fez os selos de pagamento sumirem do rodapé,
     deixando a coluna inteira vazia. Com fromTo o destino é escrito à mão e
     nenhum refresh o reescreve. */
  function entradaDoRodape() {
    const rodape = document.querySelector(".plc-footer");
    if (!rodape) return;

    const colunas = gsap.utils.toArray(
      ".plc-footer-marca, .plc-footer-col, .plc-footer-pagamento"
    );
    if (colunas.length) {
      gsap.fromTo(colunas,
        { opacity: 0, y: 22 },
        {
          opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ease: "power2.out",
          onComplete() { gsap.set(this.targets(), { clearProps: "opacity,transform" }); },
          scrollTrigger: { trigger: rodape, start: "top 88%" },
        }
      );
    }

    // As bandeiras entram depois das colunas, uma a uma — é o detalhe que faz
    // o rodapé parecer montado e não apenas revelado em bloco.
    const selos = gsap.utils.toArray(".pay-logo-badge");
    if (selos.length) {
      gsap.fromTo(selos,
        { opacity: 0, y: 10, scale: 0.94 },
        {
          opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.045,
          ease: "back.out(1.6)", delay: 0.15,
          // Devolve o controle ao CSS: o :hover dos selos mexe em opacity e
          // transform, e o estilo inline do GSAP ganharia dele para sempre.
          onComplete() { gsap.set(this.targets(), { clearProps: "opacity,transform" }); },
          scrollTrigger: { trigger: ".plc-footer-pagamento", start: "top 92%" },
        }
      );
    }
  }

  /* ---- VITRINE ----
     A grade é reconstruída a cada filtro, busca e "Ver mais" (renderProducts
     em js/main.js dispara vitrine:render). Os gatilhos antigos precisam morrer
     junto, senão vazam um por tecla digitada na busca. */
  let gatilhosDaVitrine = [];

  const DOBRA = 0.88;

  function entrarEmCascata(lote) {
    return gsap.to(lote, {
      opacity: 1,
      y: 0,
      duration: 0.65,
      stagger: 0.08,
      ease: "power2.out",
      overwrite: true,
      // Estilo inline ganha do CSS: sem limpar, o :hover translateY do card
      // pararia de funcionar depois da entrada.
      onComplete() {
        gsap.set(this.targets(), { clearProps: "opacity,transform" });
      },
    });
  }

  function animarVitrine() {
    gatilhosDaVitrine.forEach((st) => st.kill());
    gatilhosDaVitrine = [];

    const grid = document.getElementById("productsGrid");
    if (!grid) return;
    const cards = gsap.utils.toArray(grid.querySelectorAll(".reveal:not(.is-visible)"));
    if (!cards.length) return;

    /* Tirar .reveal desliga a transição do CSS. Sem isto os DOIS sistemas
       animam o mesmo card e o transition-delay do .reveal-delay-* briga com o
       stagger daqui. A classe só sai quando o GSAP assume de fato — quem cai
       no observador do main.js (sem GSAP, ou com movimento reduzido) continua
       com o .reveal intacto. */
    cards.forEach((el) =>
      el.classList.remove("reveal", "reveal-delay-1", "reveal-delay-2", "reveal-delay-3")
    );
    gsap.set(cards, { opacity: 0, y: 28 });

    /* Quem já está na tela (ou passou dela) entra na hora. Só o que está
       abaixo da dobra espera a rolagem: buscar com a página já rolada refaz a
       grade inteira, e um card que nasce ACIMA da dobra nunca dispararia o
       onEnter — ficaria invisível para sempre. */
    const limite = window.innerHeight * DOBRA;
    const agora = [];
    const depois = [];
    cards.forEach((el) => {
      (el.getBoundingClientRect().top < limite ? agora : depois).push(el);
    });

    if (agora.length) entrarEmCascata(agora);
    if (depois.length) {
      gatilhosDaVitrine = ScrollTrigger.batch(depois, {
        start: "top " + Math.round(DOBRA * 100) + "%",
        refreshPriority: -3,
        onEnter: entrarEmCascata,
      });
    }
  }

  mm.add("(prefers-reduced-motion: no-preference)", () => {
    entradaDoHero();
    entradaDoRodape();
    animarVitrine();
    document.addEventListener("vitrine:render", animarVitrine);
    return () => document.removeEventListener("vitrine:render", animarVitrine);
  });

  // Fonte e imagem que chegam depois mudam a altura da página e desalinham os
  // gatilhos calculados na carga.
  window.addEventListener("load", () => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
})();
