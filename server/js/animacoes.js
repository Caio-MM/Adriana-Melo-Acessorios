(function () {
  "use strict";
  if (!window.gsap) return;

  const mm = gsap.matchMedia();

  function carregarScrollTrigger() {
    return new Promise((resolve) => {
      if (window.ScrollTrigger) return resolve(true);
      const asset = document.getElementById("assetScrollTrigger");
      const script = document.createElement("script");
      script.src = asset ? asset.href : "js/vendor/ScrollTrigger.min.js";
      script.onload = () => resolve(!!window.ScrollTrigger);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  function quandoDerFolga(acao) {
    let feito = false;
    function uma() {
      if (feito) return;
      feito = true;
      window.removeEventListener("scroll", uma);
      window.removeEventListener("pointerdown", uma);
      acao();
    }
    window.addEventListener("scroll", uma, { once: true, passive: true });
    window.addEventListener("pointerdown", uma, { once: true, passive: true });
    if ("requestIdleCallback" in window) requestIdleCallback(uma, { timeout: 2500 });
    else setTimeout(uma, 1200);
  }

  function fontesProntas() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 600)),
    ]);
  }

  function criarBlocoDeDigitacao(titulo) {
    const bloco = document.createElement("span");
    bloco.className = "hero-bloco";
    bloco.setAttribute("aria-hidden", "true");
    titulo.insertBefore(bloco, titulo.firstChild);
    return bloco;
  }

  function digitacaoDoTitulo(titulo, split) {
    const letras = split.chars;
    const bloco = criarBlocoDeDigitacao(titulo);
    const destaque = titulo.querySelector("em");
    const inicioDoDestaque = letras.findIndex((letra) => letra.closest("em"));
    const linha = gsap.timeline();

    titulo.classList.add("esta-digitando");
    gsap.set(titulo, { opacity: 1 });
    gsap.set(letras, { opacity: 0 });
    gsap.set(bloco, { opacity: 0 });

    const CORPO = parseFloat(getComputedStyle(titulo).fontSize) || 16;
    const FOLGA_X = 0.09 * CORPO;
    const RECUO_TOPO = 0.2 * CORPO;
    const SOBRA_BASE = 0.04 * CORPO;
    let corAtual = null;

    function caixaRelativa(alvo) {
      const a = alvo.getBoundingClientRect();
      const t = titulo.getBoundingClientRect();
      return {
        left: a.left - t.left - FOLGA_X,
        top: a.top - t.top + RECUO_TOPO,
        width: a.width + FOLGA_X * 2,
        height: a.height - RECUO_TOPO + SOBRA_BASE,
      };
    }

    function levarBlocoPara(letra, cor) {
      gsap.set(bloco, { ...caixaRelativa(letra), opacity: 1 });
      if (cor !== corAtual) {
        corAtual = cor;
        gsap.to(bloco, { backgroundColor: cor, duration: 0.25, overwrite: "auto" });
      }
    }

    const corComum = "var(--blush-500)";
    const corDestaque = "var(--blush-150)";

    let quando = 0;
    letras.forEach((letra, i) => {
      const noDestaque = inicioDoDestaque >= 0 && i >= inicioDoDestaque;
      if (i === inicioDoDestaque) quando += 0.2;
      quando += noDestaque ? 0.036 : 0.018;
      linha.call(() => {
        gsap.set(letra, { opacity: 1 });
        levarBlocoPara(letra, noDestaque ? corDestaque : corComum);
      }, null, quando);
    });

    const podeMarcarTexto = destaque && destaque.getClientRects().length === 1;
    if (podeMarcarTexto) {
      linha.call(() => {
        gsap.to(bloco, { ...caixaRelativa(destaque), duration: 0.34, ease: "power2.inOut", overwrite: true });
      }, null, quando + 0.16);
    } else {
      linha.to(bloco, { opacity: 0, duration: 0.3 }, quando + 0.2);
    }

    linha.call(() => {
      split.revert();
      titulo.classList.remove("esta-digitando");
      bloco.remove();
    }, null, quando + (podeMarcarTexto ? 0.95 : 1.35));

    return linha;
  }

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
    if (arte) gsap.set(arte, { opacity: 0, scale: 0.96 });
    if (lacos.length) gsap.set(lacos, { opacity: 0 });

    fontesProntas().then(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      let split = null;
      if (window.SplitText && titulo) {
        gsap.registerPlugin(SplitText);
        try {
          split = new SplitText(titulo, { type: "words,chars" });
        } catch (e) {
          split = null;
        }
      }

      if (split && split.chars.length) {
        tl.add(digitacaoDoTitulo(titulo, split), 0);
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

  /* ⚠️ fromTo, NUNCA from. Com ScrollTrigger, o from() guarda o valor atual
     como destino e o refresh o relê depois de já ter zerado o elemento — o
     tween passa a animar de zero para zero. */
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

    const selos = gsap.utils.toArray(".pay-logo-badge");
    if (selos.length) {
      gsap.fromTo(selos,
        { opacity: 0, y: 10, scale: 0.94 },
        {
          opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.045,
          ease: "back.out(1.6)", delay: 0.15,
          onComplete() { gsap.set(this.targets(), { clearProps: "opacity,transform" }); },
          scrollTrigger: { trigger: ".plc-footer-pagamento", start: "top 92%" },
        }
      );
    }
  }

  const TITULOS = "#colecoes h2, #historia h2, #sobre h2, #depoimentos h2, .plc-cta h2, #contato h2";

  function entradaDosTitulos() {
    const titulos = gsap.utils.toArray(TITULOS);
    if (!titulos.length) return;
    if (window.SplitText) gsap.registerPlugin(SplitText);

    titulos.forEach((titulo) => {
      let split = null;
      if (window.SplitText) {
        try {
          split = new SplitText(titulo, { type: "words" });
        } catch (e) {
          split = null;
        }
      }
      const alvos = split && split.words.length ? split.words : [titulo];

      gsap.fromTo(alvos,
        { opacity: 0, y: 20 },
        {
          opacity: 1, y: 0, duration: 0.6, stagger: 0.045, ease: "power3.out",
          onComplete() {
            if (split) split.revert();
            else gsap.set(this.targets(), { clearProps: "opacity,transform" });
          },
          scrollTrigger: { trigger: titulo, start: "top 88%" },
        }
      );
    });
  }

  /* ⚠️ Cada alvo aqui foi escolhido por NÃO ter transform próprio no CSS —
     dois donos do mesmo transform se cancelam. Não use .hero-photo-wrap: ela
     tem translate(-50%,-50%) fixo. */
  function camadasComParallax() {
    const camadas = [
      [".hero-flutuantes", 90],
      ["#historia .instagram-feed-card", -46],
      [".plc-cta .bow-icon", 70],
    ];

    camadas.forEach(([seletor, distancia]) => {
      const alvos = gsap.utils.toArray(seletor);
      if (!alvos.length) return;
      gsap.fromTo(alvos,
        { y: -distancia / 2 },
        {
          y: distancia / 2,
          ease: "none",
          scrollTrigger: {
            trigger: alvos[0].closest("section, header") || alvos[0],
            start: "top bottom",
            end: "bottom top",
            scrub: true,
            invalidateOnRefresh: true,
          },
        }
      );
    });

    const lacosCta = gsap.utils.toArray(".plc-cta .bow-icon");
    if (lacosCta.length) {
      gsap.fromTo(lacosCta,
        { rotation: -8 },
        {
          rotation: 8, ease: "none",
          scrollTrigger: {
            trigger: ".plc-cta", start: "top bottom", end: "bottom top",
            scrub: true, invalidateOnRefresh: true,
          },
        }
      );
    }
  }

  function fitaGuia() {
    const fita = document.querySelector(".fita-guia");
    if (!fita) return;

    const fio = fita.querySelector(".fita-guia-fio");
    const laco = fita.querySelector(".fita-guia-laco");
    const AMOSTRAS = 240;
    let comprimento = 0, comprimentoNaTela = 0, tabelaDeTela = null;

    /* ⚠️ O tracejado é medido em px de TELA (efeito do
       vector-effect:non-scaling-stroke), e getTotalLength devolve unidades do
       viewBox — 1008 contra ~880px reais. Sem esta tabela o rosa terminava
       aos 87% e o laço seguia sozinho. */
    function medir() {
      if (!fio || !fio.getTotalLength) return;
      comprimento = fio.getTotalLength();
      const ctm = fio.getScreenCTM();
      tabelaDeTela = new Float64Array(AMOSTRAS + 1);
      let acumulado = 0, anterior = null;
      for (let i = 0; i <= AMOSTRAS; i++) {
        const ponto = fio.getPointAtLength((comprimento * i) / AMOSTRAS);
        const naTela = ctm ? ponto.matrixTransform(ctm) : ponto;
        if (anterior) acumulado += Math.hypot(naTela.x - anterior.x, naTela.y - anterior.y);
        tabelaDeTela[i] = acumulado;
        anterior = naTela;
      }
      comprimentoNaTela = acumulado || comprimento;
      gsap.set(fio, { strokeDasharray: comprimentoNaTela, strokeDashoffset: comprimentoNaTela });
    }

    function telaAte(pr) {
      if (!tabelaDeTela) return comprimentoNaTela * pr;
      const pos = Math.min(Math.max(pr, 0), 1) * AMOSTRAS;
      const i = Math.floor(pos);
      if (i >= AMOSTRAS) return tabelaDeTela[AMOSTRAS];
      return tabelaDeTela[i] + (tabelaDeTela[i + 1] - tabelaDeTela[i]) * (pos - i);
    }
    medir();

    return ScrollTrigger.create({
      start: 0,
      end: () => ScrollTrigger.maxScroll(window),
      scrub: true,
      invalidateOnRefresh: true,
      onRefresh: medir,
      onUpdate(self) {
        const p = self.progress;
        fita.style.setProperty("--progresso", p.toFixed(4));
        if (fio && comprimentoNaTela) {
          fio.style.strokeDashoffset = String(comprimentoNaTela - telaAte(p));
          if (laco && fio.getPointAtLength) {
            const ponto = fio.getPointAtLength(comprimento * p);
            laco.style.top = (ponto.y / 1000) * 100 + "%";
            /* ⚠️ Na faixa estreita do celular o laço não cavalga a onda: seguir
               o x jogaria a ponta dele sobre a primeira letra da página. */
            if (fita.clientWidth > 20) {
              laco.style.left = (ponto.x / 60) * 100 + "%";
            } else if (laco.style.left) {
              laco.style.left = "";
            }
          }
        }
      },
    });
  }

  function entregaGuiada({ comPin }) {
    const wrap = document.querySelector(".process-wrap");
    const passos = gsap.utils.toArray("#sobre .process-step");
    if (!wrap || passos.length < 3) return;

    const van = document.querySelector(".process-truck");
    const pacote = document.getElementById("processPackage");
    const visivel = (el) => el && getComputedStyle(el).display !== "none";
    const movel = visivel(van) ? van : pacote;
    if (!visivel(movel)) return;

    const ehVan = movel === van;
    movel.classList.add("is-guiada");

    /* ⚠️ offsetLeft/offsetTop, não getBoundingClientRect: o rect devolve a
       posição ANIMADA e estes ícones nunca param de flutuar — dava alvo errado
       por 25-30px. Somar a cadeia de offsetParent porque .process-wrap é um
       .row do Bootstrap, com margem negativa. */
    function centroDoPasso(passo) {
      const icone = passo.querySelector(".process-icon-wrap") || passo;
      const pai = movel.offsetParent;
      let x = 0, y = 0, n = icone;
      while (n && n !== pai) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { x: x + icone.offsetWidth / 2, y: y + icone.offsetHeight / 2 };
    }
    const partida = () => wrap.getBoundingClientRect().width * 0.14;

    let parada;

    /* ⚠️ Precisa ser passado na CRIAÇÃO do gatilho: o ScrollTrigger guarda a
       referência agora, e atribuir vars.onUpdate depois não faz nada — em
       silêncio. */
    function aCadaQuadro(self) {
      movel.classList.add("is-andando");
      clearTimeout(parada);
      parada = setTimeout(() => movel.classList.remove("is-andando"), 120);

      const naVez = Math.min(
        Math.floor(self.progress * passos.length),
        passos.length - 1
      );
      passos.forEach((passo, i) => passo.classList.toggle("is-na-vez", i === naVez));
    }

    const gatilho = {
      trigger: "#sobre",
      scrub: 0.6,
      invalidateOnRefresh: true,
      refreshPriority: 1,
      onUpdate: aCadaQuadro,
    };

    if (comPin) {
      gatilho.start = "center center";
      gatilho.end = "+=100%";
      gatilho.pin = true;
      gatilho.anticipatePin = 1;
    } else {
      gatilho.start = "top 80%";
      gatilho.end = "bottom 55%";
    }

    const tl = gsap.timeline({ scrollTrigger: gatilho });

    if (ehVan) {
      tl.fromTo(movel,
        { x: () => centroDoPasso(passos[0]).x - partida() },
        { x: () => centroDoPasso(passos[2]).x - partida(), ease: "none", duration: 1 }
      );
    } else {
      /* ⚠️ 68px à DIREITA do ícone, nunca no centro dele. Na altura de um
         ícone essa faixa está vazia; na linha do meio ficam todos os títulos,
         e o pacote parava em cima da palavra "Personalize". */
      const DESVIO_X = 68;
      const emX = (i) => centroDoPasso(passos[i]).x + DESVIO_X + "px";
      const emY = (i) => centroDoPasso(passos[i]).y + "px";
      tl.fromTo(movel,
        { left: () => emX(0), top: () => emY(0) },
        { left: () => emX(1), top: () => emY(1), ease: "none", duration: 1 }
      ).to(movel,
        { left: () => emX(2), top: () => emY(2), ease: "none", duration: 1 }
      );

      /* ⚠️ Só aparece PARADO. Entre um ícone e outro ele cruza o título e o
         parágrafo do passo, então some no caminho e volta na chegada — era o
         que o @keyframes antigo fazia com opacity:0, e que se perdeu quando o
         GSAP virou dono da posição. */
      tl.fromTo(movel,
        { opacity: 1 },
        { opacity: 0, duration: 0.3, ease: "none" }, 0
      ).to(movel, { opacity: 1, duration: 0.3, ease: "none" }, 0.7)
        .to(movel, { opacity: 0, duration: 0.3, ease: "none" }, 1)
        .to(movel, { opacity: 1, duration: 0.3, ease: "none" }, 1.7);
    }

    return tl;
  }

  /* ⚠️ Inclina os GRUPOS de dentro, não a faixa nem o track: o track já é dono
     do transform pelo keyframe scrollx, e inclinar o fundo abre um vão
     triangular nos cantos. */
  function marqueeReativo() {
    const grupos = gsap.utils.toArray(".plc-marquee-group");
    if (!grupos.length) return;

    const inclinar = gsap.quickTo(grupos, "skewY", { duration: 0.5, ease: "power3" });
    let parada;

    return ScrollTrigger.create({
      onUpdate(self) {
        inclinar(gsap.utils.clamp(-2.5, 2.5, self.getVelocity() / 900));
        clearTimeout(parada);
        parada = setTimeout(() => inclinar(0), 140);
      },
    });
  }

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
      onComplete() {
        gsap.set(this.targets(), { clearProps: "opacity,transform" });
      },
    });
  }

  /* ⚠️ A grade de produtos chega depois, por fetch, e tem ~1800px. Os
     refresh() do fim do arquivo rodam no load e no fonts.ready, que podem
     acontecer antes dela existir — e aí todo gatilho abaixo fica medido numa
     página sem produtos. O setTimeout evita refresh reentrante e agrupa as
     chamadas (vitrine:render dispara a cada tecla da busca). */
  let remedidaPendente;
  function remedirGatilhos() {
    clearTimeout(remedidaPendente);
    remedidaPendente = setTimeout(() => ScrollTrigger.refresh(), 200);
  }

  function animarVitrine() {
    gatilhosDaVitrine = gatilhosDaVitrine.filter((st) => {
      if (st.trigger && st.trigger.isConnected) return true;
      st.kill();
      return false;
    });

    const grid = document.getElementById("productsGrid");
    if (!grid) return;
    const cards = gsap.utils.toArray(grid.querySelectorAll(".reveal:not(.is-visible)"));
    if (!cards.length) { remedirGatilhos(); return; }

    cards.forEach((el) =>
      el.classList.remove("reveal", "reveal-delay-1", "reveal-delay-2", "reveal-delay-3")
    );
    gsap.set(cards, { opacity: 0, y: 28 });

    const limite = window.innerHeight * DOBRA;
    const agora = [];
    const depois = [];
    cards.forEach((el) => {
      (el.getBoundingClientRect().top < limite ? agora : depois).push(el);
    });

    remedirGatilhos();

    if (agora.length) entrarEmCascata(agora);
    if (depois.length) {
      gatilhosDaVitrine = gatilhosDaVitrine.concat(
        ScrollTrigger.batch(depois, {
          start: "top " + Math.round(DOBRA * 100) + "%",
          refreshPriority: -3,
          onEnter: entrarEmCascata,
        })
      );
    }
  }

  mm.add("(prefers-reduced-motion: no-preference)", () => {
    entradaDoHero();
  });

  function animacoesDeRolagem() {
    gsap.registerPlugin(ScrollTrigger);

    mm.add("(min-width: 992px) and (prefers-reduced-motion: no-preference)", () => {
      const tl = entregaGuiada({ comPin: true });
      return () => { if (tl && tl.scrollTrigger) tl.scrollTrigger.kill(); };
    });

    mm.add("(max-width: 991.98px) and (prefers-reduced-motion: no-preference)", () => {
      const tl = entregaGuiada({ comPin: false });
      return () => { if (tl && tl.scrollTrigger) tl.scrollTrigger.kill(); };
    });

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      entradaDoRodape();
      entradaDosTitulos();
      camadasComParallax();
      const gatilhoDaFaixa = marqueeReativo();
      const gatilhoDaFita = fitaGuia();
      animarVitrine();
      document.addEventListener("vitrine:render", animarVitrine);
      return () => {
        document.removeEventListener("vitrine:render", animarVitrine);
        if (gatilhoDaFaixa) gatilhoDaFaixa.kill();
        if (gatilhoDaFita) gatilhoDaFita.kill();
      };
    });

    ScrollTrigger.refresh();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => ScrollTrigger.refresh());
    }
  }

  if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    quandoDerFolga(() => {
      carregarScrollTrigger().then((ok) => {
        if (ok) animacoesDeRolagem();
      });
    });
  }
})();
