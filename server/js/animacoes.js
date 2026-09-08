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

  /* ---- TÍTULOS DE SEÇÃO ----
     O hero já entra por linhas (SplitText). Aqui o mesmo recurso, que já está
     carregado e era usado num lugar só, monta os títulos das seções palavra a
     palavra conforme cada uma chega.

     Os títulos moram dentro de blocos .reveal, que também animam opacity e
     translateY. Não há conflito: o .reveal é dono do BLOCO e o GSAP das
     PALAVRAS — nós diferentes, transforms que se compõem. O que não pode é
     dois donos no mesmo nó. */
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
          // revert() devolve o título inteiro ao DOM: sem isso ele fica picado
          // em <div>s e o leitor de tela anuncia palavra por palavra.
          onComplete() {
            if (split) split.revert();
            else gsap.set(this.targets(), { clearProps: "opacity,transform" });
          },
          scrollTrigger: { trigger: titulo, start: "top 88%" },
        }
      );
    });
  }

  /* ---- PROFUNDIDADE ----
     É aqui que mora a diferença entre "vivo" e "morto": até agora TODA
     animação do site era um fade que dispara uma vez e acaba. Nada acompanhava
     a rolagem. Estas camadas andam presas ao dedo (scrub), em velocidades
     diferentes, e é isso que dá sensação de profundidade.

     ⚠️ Cada alvo abaixo foi escolhido por NÃO ter transform próprio no CSS:
     - .hero-flutuantes é um contêiner novo; os 8 laços dentro dele é que têm
       o @keyframes floaty, e pai + filho se compõem sem brigar.
     - os 2 laços decorativos do CTA são posicionados por top/right/left, sem
       transform (style.css:1717) — hoje estão completamente parados.
     - .instagram-feed-card idem: o posicionamento dele é de fluxo normal.
     Não use .hero-photo-wrap: ela tem translate(-50%,-50%) fixo no CSS. */
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

    // Os laços do CTA também giram devagar — parados eles pareciam adesivo
    // colado; girando, viram fita.
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

  /* ---- FITA-GUIA ----
     O fio se desenha por stroke-dashoffset preso ao progresso da página, e o
     lacinho anda junto pelo próprio caminho (getPointAtLength), então ele
     segue as curvas em vez de descer reto.

     No celular o SVG é escondido e a fita vira um fio horizontal desenhado por
     ::after com width em porcentagem — por isso o progresso também é publicado
     como a custom property --progresso, que o CSS consome. */
  function fitaGuia() {
    const fita = document.querySelector(".fita-guia");
    if (!fita) return;

    const fio = fita.querySelector(".fita-guia-fio");
    const laco = fita.querySelector(".fita-guia-laco");
    let comprimento = 0;

    function medir() {
      if (!fio || !fio.getTotalLength) return;
      comprimento = fio.getTotalLength();
      gsap.set(fio, { strokeDasharray: comprimento, strokeDashoffset: comprimento });
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
        if (fio && comprimento) {
          fio.style.strokeDashoffset = String(comprimento * (1 - p));
          if (laco && fio.getPointAtLength) {
            const ponto = fio.getPointAtLength(comprimento * p);
            // O viewBox é 60x1000 esticado para a altura da tela; converter a
            // coordenada do caminho para porcentagem deixa o laço colado no
            // fio em qualquer altura de janela, sem recalcular no resize.
            laco.style.top = (ponto.y / 1000) * 100 + "%";
            /* ⚠️ Na faixa estreita do celular o laço NÃO cavalga a onda: ele é
               maior que a faixa, e seguir o x jogaria a ponta dele em cima da
               primeira letra da página. Fica no meio (left:50% do CSS) — daí
               limpar o inline, senão o valor do computador sobreviveria a um
               giro de tela. */
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

  /* ---- A ENTREGA GUIADA PELA ROLAGEM (peça central) ----
     Antes a entrega rodava num loop CSS que ignorava a rolagem. Aqui ela anda
     com o dedo: 0% = passo 1, 100% = passo 3, e o passo em que está acende.
     É a metáfora que o site já tinha desenhada — o trajeto do pedido —
     finalmente ligada ao trajeto de quem está lendo.

     Serve as três faixas de tela, mudando só duas coisas:

       computador (>=992px)  van, seção PRESA na tela
       tablet (768-991px)    van, sem prender
       celular (<768px)      o pacotinho, sem prender

     Prender a tela em aparelho pequeno irrita mais do que encanta; e abaixo de
     768px a van nem existe (display:none no CSS), por isso lá quem viaja é o
     pacote. Sem o pin, o percurso é a passagem da própria seção pela tela. */
  function entregaGuiada({ comPin }) {
    const wrap = document.querySelector(".process-wrap");
    const passos = gsap.utils.toArray("#sobre .process-step");
    if (!wrap || passos.length < 3) return;

    const van = document.querySelector(".process-truck");
    const pacote = document.getElementById("processPackage");
    // Quem está visível nesta largura é quem viaja.
    const visivel = (el) => el && getComputedStyle(el).display !== "none";
    const movel = visivel(van) ? van : pacote;
    if (!visivel(movel)) return;

    const ehVan = movel === van;
    // Avisa o CSS para desligar o keyframe de deslocamento e deixar o GSAP
    // como dono único do movimento.
    movel.classList.add("is-guiada");

    /* Posições medidas do ícone de cada passo, não porcentagens chutadas: é o
       que faz a entrega encostar exatamente em cada parada em qualquer
       largura. Em função (não valor fixo) porque invalidateOnRefresh remede
       tudo a cada ScrollTrigger.refresh(). */
    /* ⚠️ Posição de LAYOUT (offsetLeft/offsetTop), não getBoundingClientRect.
       O rect devolve a posição ANIMADA, e os ícones estão sempre em movimento:
       o passo entra com translateY(28px) do .reveal e depois flutua ±5px pelo
       @keyframes process-icon-float. Medir com rect dava alvo errado por
       25-30px dependendo do instante — é a mesma armadilha que o código do
       pacote antigo já documentava em main.js. offsetLeft/offsetTop ignoram
       transform, então valem em qualquer momento da animação.

       Somar a cadeia de offsetParent até o pai do móvel resolve o resto: `left`
       e `top` contam a partir do bloco que contém o elemento, e o .process-wrap
       é um .row do Bootstrap (margens negativas + padding nas colunas). */
    function centroDoPasso(passo) {
      const icone = passo.querySelector(".process-icon-wrap") || passo;
      const pai = movel.offsetParent;
      let x = 0, y = 0, n = icone;
      while (n && n !== pai) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { x: x + icone.offsetWidth / 2, y: y + icone.offsetHeight / 2 };
    }
    // A van nasce em left:14% com translate(-50%): o x do GSAP é relativo a
    // esse ponto de partida. O pacote é posicionado por left/top absolutos.
    const partida = () => wrap.getBoundingClientRect().width * 0.14;

    let parada;

    /* Roda a cada quadro do scrub: liga as rodas enquanto há movimento e
       acende o passo corrente. Classe, não tween — assim acende E apaga
       sozinho ao rolar de volta, e o estilo continua morando no CSS.
       ⚠️ Precisa ser passado na CRIAÇÃO do gatilho: o ScrollTrigger guarda a
       referência da função nesse momento, então atribuir vars.onUpdate depois
       não tem efeito nenhum (silenciosamente). */
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
      /* Maior que o -3 do batch da vitrine: com pin a altura da página MUDA, e
         os gatilhos dos cards precisam ser medidos depois disso. */
      refreshPriority: 1,
      onUpdate: aCadaQuadro,
    };

    if (comPin) {
      gatilho.start = "center center";
      // Uma tela de rolagem presa. Mais que isso vira armadilha: a seção tem
      // só ~490px de conteúdo e ninguém quer ficar preso relendo três passos.
      gatilho.end = "+=100%";
      gatilho.pin = true;
      gatilho.anticipatePin = 1;
    } else {
      // Sem prender: o percurso é a seção atravessando a tela, de baixo para
      // cima. A entrega completa a viagem quando a seção termina de passar.
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
      /* No celular os passos empilham na vertical, então o pacote desce em vez
         de atravessar — e passa POR CADA parada, não em linha reta do primeiro
         ao último. Daí os dois trechos encadeados. */
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

  /* ---- FAIXA REAGINDO À ROLAGEM ----
     A faixa vinho já corre sozinha (@keyframes scrollx). Inclinar conforme a
     VELOCIDADE da rolagem é o efeito mais barato que existe para a página
     parecer responder ao dedo — e a faixa é literalmente uma fita.

     ⚠️ Nem o .plc-marquee (o fundo), nem o .plc-marquee-track. O track já é
     dono do transform pelo keyframe scrollx, e inclinar o fundo abre um vão
     triangular nos cantos — a 2,5° numa faixa de 1440px as bordas sobem 31px
     e o creme aparece por baixo (conferido na tela). Inclinando os GRUPOS de
     dentro, só o conteúdo balança e a faixa continua firme. */
  function marqueeReativo() {
    const grupos = gsap.utils.toArray(".plc-marquee-group");
    if (!grupos.length) return;

    const inclinar = gsap.quickTo(grupos, "skewY", { duration: 0.5, ease: "power3" });
    let parada;

    return ScrollTrigger.create({
      onUpdate(self) {
        inclinar(gsap.utils.clamp(-2.5, 2.5, self.getVelocity() / 900));
        // Sem isto a faixa fica torta para sempre depois de uma rolagem rápida.
        clearTimeout(parada);
        parada = setTimeout(() => inclinar(0), 140);
      },
    });
  }

  /* ---- VITRINE ----
     Filtro e busca reconstroem a grade inteira; "Ver mais" só acrescenta os
     novos ao final (renderProducts/acrescentarProdutos em js/main.js, os dois
     disparam vitrine:render). Gatilho de card que saiu da página precisa
     morrer, senão vaza um por tecla digitada na busca — mas gatilho de card
     que CONTINUA na página tem que sobreviver: no "Ver mais", um card do lote
     anterior ainda abaixo da dobra segue esperando a rolagem, e ele já perdeu
     o .reveal, então não seria reinscrito e ficaria invisível para sempre. */
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

  /* ⚠️ A grade de produtos é preenchida DEPOIS, por fetch da API — e ela tem
     ~1800px. Os ScrollTrigger.refresh() que existem no fim deste arquivo rodam
     no `load` e no `fonts.ready`, que podem acontecer ANTES de a grade existir:
     aí todo gatilho abaixo dela fica com coordenada de uma página que ainda não
     tinha os produtos.

     Com fades de onEnter isso passava despercebido (o fade disparava um pouco
     antes). Com o PIN da seção "Do pedido até a sua porta" o mesmo erro fazia a
     seção grudar 758px cedo demais e cobrir os produtos e a história — foi o
     bug que apareceu em produção, onde a grade tem 47 produtos.

     setTimeout por dois motivos: não chamar refresh() de dentro do mesmo ciclo
     em que animarVitrine está criando os batches (refresh reentrante mede
     errado), e agrupar as chamadas — vitrine:render dispara a cada tecla na
     busca e a cada "Ver mais". */
  let remedidaPendente;
  function remedirGatilhos() {
    clearTimeout(remedidaPendente);
    remedidaPendente = setTimeout(() => ScrollTrigger.refresh(), 200);
  }

  function animarVitrine() {
    // isConnected separa os dois casos: quem foi descartado numa remontagem
    // morre aqui; quem continua na grade mantém o gatilho que ainda não disparou.
    gatilhosDaVitrine = gatilhosDaVitrine.filter((st) => {
      if (st.trigger && st.trigger.isConnected) return true;
      st.kill();
      return false;
    });

    const grid = document.getElementById("productsGrid");
    if (!grid) return;
    const cards = gsap.utils.toArray(grid.querySelectorAll(".reveal:not(.is-visible)"));
    // Mesmo sem card novo para animar (uma busca que filtrou tudo, por
    // exemplo) a altura da grade mudou — e é a altura que desalinha o pin.
    if (!cards.length) { remedirGatilhos(); return; }

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

    // A grade acabou de mudar de altura: tudo que vem abaixo dela precisa ser
    // remedido, inclusive o pin.
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

  /* A van presa à rolagem é só no computador: abaixo de 992px prender a tela
     atrapalha, e abaixo de 768px a van nem existe (display:none). O celular
     mantém o pacotinho pulando entre paradas, que já funciona bem lá. */
  /* Duas faixas, mesma animação, só muda o prender. O gsap.matchMedia troca
     sozinho quando a largura cruza 992px — inclusive girando o aparelho. */
  mm.add("(min-width: 992px) and (prefers-reduced-motion: no-preference)", () => {
    const tl = entregaGuiada({ comPin: true });
    return () => { if (tl && tl.scrollTrigger) tl.scrollTrigger.kill(); };
  });

  mm.add("(max-width: 991.98px) and (prefers-reduced-motion: no-preference)", () => {
    const tl = entregaGuiada({ comPin: false });
    return () => { if (tl && tl.scrollTrigger) tl.scrollTrigger.kill(); };
  });

  mm.add("(prefers-reduced-motion: no-preference)", () => {
    entradaDoHero();
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

  // Fonte e imagem que chegam depois mudam a altura da página e desalinham os
  // gatilhos calculados na carga.
  window.addEventListener("load", () => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
})();
