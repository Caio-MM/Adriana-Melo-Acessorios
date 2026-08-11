/**
 * =============================================================================
 *  BACK-END DE EXEMPLO — Petit Laço / Adriana Melo Acessórios
 * =============================================================================
 *  Por que isso precisa existir?
 *  ------------------------------------------------------------------------
 *  O site (index.html/main.js) é 100% estático — HTML, CSS e JS puros, sem
 *  servidor. Mas o Access Token do Mercado Pago E o token do Melhor Envio
 *  são credenciais SECRETAS: se forem colocadas em qualquer arquivo que o
 *  navegador baixa (main.js, index.html, etc.), QUALQUER pessoa pode abrir
 *  o "Ver código-fonte" e roubá-las.
 *
 *  Por isso essas credenciais só podem viver aqui: em um servidor, lidas de
 *  variáveis de ambiente (.env), nunca commitadas no git, nunca enviadas ao
 *  navegador. Rode este arquivo com `npm install && npm start` dentro da
 *  pasta server/ (veja README.md).
 * =============================================================================
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const multer = require("multer");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const db = require("./db");
const auth = require("./auth");
const whatsapp = require("./whatsapp");
const email = require("./email");
const { colorLabelFor } = require("./orderFormatting");
// Mesmo arquivo que a vitrine e o carrinho carregam no navegador (js/pricing.js,
// em formato UMD) — é o que garante que o "5% no Pix" e o "3x sem juros"
// mostrados na tela do produto sejam exatamente os valores cobrados aqui.
const pricing = require("../js/pricing.js");

const app = express();
const PORT = process.env.PORT || 3333;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3333";

/* -----------------------------------------------------------------------
   🔑 ONDE COLOCAR SUAS CREDENCIAIS
   -------------------------------------------------------------------------
   1. Copie server/.env.example para server/.env
   2. Preencha MP_ACCESS_TOKEN (Mercado Pago) e MELHOR_ENVIO_TOKEN (frete),
      além dos dados do remetente (SELLER_*) — NUNCA neste arquivo, NUNCA
      no front-end.
   3. O .env já está no .gitignore: confirme que ele nunca é commitado.
   Mercado Pago: https://www.mercadopago.com.br/developers/panel
   Melhor Envio: https://melhorenvio.com.br/painel/gerenciar/tokens
----------------------------------------------------------------------- */
if(!process.env.MP_ACCESS_TOKEN){
  console.warn("⚠️  MP_ACCESS_TOKEN não definido. Copie server/.env.example para server/.env e preencha antes de aceitar pagamentos reais.");
}
if(!process.env.MELHOR_ENVIO_TOKEN){
  console.warn("⚠️  MELHOR_ENVIO_TOKEN não definido. O cálculo de frete não vai funcionar até preencher o .env.");
}

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || "COLOQUE_SEU_ACCESS_TOKEN_NO_.ENV",
});

/* =========================================================================
   CATÁLOGO — fonte da verdade para PREÇOS *e* para peso/dimensões (usados
   no cálculo de frete). Precisa ficar sincronizado com o array `products`
   de js/main.js (nomes/categorias podem divergir sem problema — o que
   importa é id/preço/peso/dimensões). Em produção, troque isto por uma
   consulta ao seu banco de dados.
   weight em kg. width/height/length em cm (medidas da embalagem individual
   de 1 unidade do produto).
========================================================================= */
const PRODUCTS = {
  1: { name:"Laço Bailarina",        price:34.90, weight:0.05, width:16, height:2, length:11, category:"dia-a-dia",   badges:[] },
  2: { name:"Laço Duquesa",          price:49.90, weight:0.08, width:16, height:3, length:11, category:"festa",       badges:["Mais vendido"] },
  3: { name:"Laço Recém-nascida",    price:29.90, weight:0.04, width:16, height:2, length:11, category:"maternidade", badges:[] },
  4: { name:"Laço Pérola",           price:59.90, weight:0.08, width:16, height:3, length:11, category:"batizado",    badges:[] },
  5: { name:"Laço Borboleta",        price:44.90, weight:0.06, width:16, height:2, length:11, category:"festa",       badges:[] },
  6: { name:"Kit Presente 3 Laços",  price:89.90, weight:0.20, width:20, height:6, length:15, category:"presente",    badges:["Novo"] },
  7: { name:"Laço Tiara Flor",       price:39.90, weight:0.07, width:16, height:3, length:11, category:"dia-a-dia",   badges:[] },
  8: { name:"Laço Personalizado",    price:64.90, weight:0.08, width:16, height:3, length:11, category:"presente",    badges:["Novo"] },
};

/* Categoria/selos aceitos — precisam ficar em sincronia com os chips de
   filtro em index.html (data-cat) e com os checkboxes do modal de edição
   em admin.html. Único lugar validado no servidor (nunca confia em
   categoria/selo vindo do painel sem checar contra esta lista). */
const PRODUCT_CATEGORIES = ["maternidade", "festa", "batizado", "dia-a-dia", "presente"];
const PRODUCT_BADGES = ["Mais vendido", "Novo"];

/* Dimensões mínimas aceitas pelos Correios/transportadoras — nunca cotar
   abaixo disso, mesmo que o produto seja minúsculo. */
const MIN_PACKAGE = { weight:0.1, width:16, height:2, length:11 };

/* =========================================================================
   EDIÇÕES DE PRODUTO (painel administrativo) — nome/preço/foto podem ser
   sobrescritos via /api/admin/products, gravados em product_overrides
   (server/db.js). PRODUCTS acima continua sendo a fonte de peso/dimensões
   (não editável pelo painel); effectiveProduct() é o único lugar que
   decide "qual é o valor de verdade agora" — todo o resto do arquivo
   (checkout, listagem de pedidos, avisos de WhatsApp/e-mail) usa essa
   função em vez de ler PRODUCTS[id] direto, para que uma edição no painel
   passe a valer imediatamente em TUDO, inclusive no preço cobrado.
========================================================================= */
function getProductOverridesMap(){
  const map = new Map();
  for(const row of db.listProductOverrides()) map.set(row.product_id, row);
  return map;
}
function effectiveProduct(id, overridesMap){
  const base = PRODUCTS[id];
  if(!base) return null;
  const override = overridesMap.get(id);
  if(!override) return { ...base, photoUrl: null };
  return {
    ...base,
    name: override.name || base.name,
    price: override.price != null ? override.price : base.price,
    photoUrl: override.photo_url || null,
    category: override.category || base.category,
    badges: override.badges ? JSON.parse(override.badges) : base.badges,
  };
}

/* =========================================================================
   CUPONS — assim como PRODUCTS, é a fonte da verdade no servidor. O
   front-end manda só o código; o desconto real é sempre calculado aqui,
   nunca confiando em um valor de desconto vindo do navegador (mesma lógica
   de "nunca confiar em preço/valor do cliente" usada para o carrinho).
   Cupons ficam em server/db.js (tabela coupons) — criados/apagados pelo
   painel administrativo em /api/admin/coupons, sem precisar editar código.
========================================================================= */
function findCoupon(rawCode){
  const code = String(rawCode || "").trim().toUpperCase();
  if(!code) return null;
  const row = db.getCoupon(code);
  if(!row) return null;
  return { code: row.code, percentOff: row.percent_off, description: row.description };
}

/* =========================================================================
   FORMAS DE PAGAMENTO — Pix (com desconto) x cartão/boleto
   -------------------------------------------------------------------------
   O cliente escolhe no carrinho e o servidor faz DUAS coisas com essa
   escolha, nunca só uma:
     1) aplica (ou não) o desconto do Pix no preço de cada item;
     2) restringe, na própria preferência do Mercado Pago, quais meios de
        pagamento aparecem na tela de checkout.
   O (2) é o que impede as duas fraudes óbvias do (1): escolher "Pix" para
   ganhar os 5% e pagar no cartão na tela seguinte, e o inverso — escolher
   cartão e pagar no Pix sem o desconto que era devido. `account_money`
   (saldo do Mercado Pago) fica junto do Pix por ser igualmente à vista e
   instantâneo; deixá-lo no lado do cartão faria o cliente pagar mais por
   uma forma de pagamento que, para a loja, é idêntica ao Pix.
   IDs conforme a documentação de payment types do Mercado Pago.
========================================================================= */
const PAYMENT_METHODS = {
  pix: {
    label: "Pix",
    excludedPaymentTypes: ["credit_card", "debit_card", "prepaid_card", "ticket", "atm"],
  },
  card: {
    label: "Cartão ou boleto",
    excludedPaymentTypes: ["bank_transfer", "account_money"],
  },
};

/* -------------------------- MIDDLEWARES DE SEGURANÇA -------------------------- */
// CSP explícita (mesmas origens já liberadas na <meta> de index.html — mantenha
// as duas em sincronia). Sem isto, o helmet() aplicaria a CSP padrão dele
// (bem mais restritiva) e bloquearia o Bootstrap/ícones/fontes via CDN e as
// imagens do Picsum agora que este servidor também serve o site (abaixo).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://sdk.mercadopago.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      // `https:` (qualquer origem https) em vez de uma lista fixa: o painel
      // administrativo deixa a lojista colar a URL de uma foto hospedada em
      // qualquer lugar (Google Drive, Imgur, CDN da loja...), e não há como
      // saber esses domínios de antemão — com a lista fixa, toda foto
      // customizada era silenciosamente bloqueada pela CSP e a vitrine ficava
      // sem imagem. Continua barrando http:// e, principalmente, o que a CSP
      // realmente protege aqui (script/style/connect) segue restrito.
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'", "https://api.mercadopago.com", "https://viacep.com.br"],
      frameSrc: ["https://www.mercadopago.com", "https://www.mercadopago.com.br"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
    },
  },
}));
// `credentials: true` é necessário para o cookie de sessão trafegar quando o
// site é aberto de uma origem diferente da API (ex.: durante o desenvolvimento
// com um live-reload em outra porta). Combinado com `origin` fixo (não "*"),
// só o seu próprio site pode enviar/receber esse cookie.
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
// Comprime HTML/CSS/JS/JSON com gzip antes de enviar — sem isso, o
// style.css (~21KB) e o main.js (~37KB) saíam do jeito que estão no disco,
// mesmo o navegador sempre anunciando que aceita gzip. Não comprime
// imagens/binários (já vêm comprimidos, gastar CPU tentando de novo
// não ajuda).
app.use(compression());
app.use(express.json({ limit: "50kb" }));   // corpo pequeno: evita payloads gigantes (DoS simples)
app.use(auth.attachUser);                   // preenche req.user (ou null) a partir do cookie de sessão

/* =========================================================================
   PROTEÇÃO CSRF
   -------------------------------------------------------------------------
   O cookie de sessão já é `SameSite=Lax` (auth.js) — navegadores modernos
   não o enviam em POST/PUT/DELETE disparados por outro site. Esta camada
   é uma segunda barreira explícita, independente do cookie: navegadores
   sempre mandam o header `Origin` em requisições não seguras (POST etc.),
   mesmo same-origin; se ele vier ausente ou de outro domínio, a requisição
   é recusada. Isso bloqueia tanto um <form>/fetch hospedado em outro site
   quanto ferramentas que tentam chamar a API "no escuro" sem passar por
   um navegador apontando para o nosso próprio front-end.
   Exceção: /api/webhook é chamado pelo servidor do Mercado Pago, não por
   um navegador — nunca terá `Origin`, então fica de fora desta checagem
   (a segurança dele vem de outro lugar: sempre confirmar o pagamento
   consultando a API do Mercado Pago pelo ID, nunca só pelo payload recebido).
========================================================================= */
function verifyOrigin(req, res, next){
  if(["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if(req.path === "/webhook") return next();
  const origin = req.headers.origin;
  if(!origin || origin !== CLIENT_ORIGIN){
    return res.status(403).json({ error: "Requisição recusada (origem não confiável)." });
  }
  next();
}
app.use("/api", verifyOrigin);

// Limite geral, só para a API (arquivos estáticos não devem esbarrar nisso):
// 100 requisições / 15 min por IP.
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Limite mais rígido para rotas sensíveis (evita spam/força bruta)
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Limite ainda mais rígido para login/cadastro — dificulta força bruta de
// senha e criação em massa de contas.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

/* =========================================================================
   ARQUIVOS ESTÁTICOS DO SITE
   -------------------------------------------------------------------------
   O servidor agora também serve o site (antes só a API rodava aqui — o
   front-end chamava `/api/...` com caminho relativo, mas era aberto em outra
   origem/porta, então essas chamadas nunca chegavam ao back-end). Servir os
   dois juntos corrige isso e também simplifica o cookie de sessão (mesma
   origem, sem depender de CORS cross-site para cookies).
   A lista abaixo é uma ALLOWLIST (mais seguro que bloquear por exceção):
   só esses arquivos/pastas na raiz do projeto ficam acessíveis por HTTP —
   isso impede que a pasta server/ (código-fonte do back-end) seja servida
   por engano caso alguém peça, por exemplo, /server/server.js.
========================================================================= */
const SITE_ROOT = path.join(__dirname, "..");
const PUBLIC_TOP_LEVEL = new Set([
  "index.html", "conta.html", "pedidos.html", "admin.html",
  "pagamento-sucesso.html", "pagamento-erro.html", "pagamento-pendente.html",
  "css", "js", "img",
]);
app.use((req, res, next) => {
  if (req.path === "/" || req.path.startsWith("/api/")) return next();
  const firstSegment = req.path.split("/").filter(Boolean)[0];
  if (firstSegment && PUBLIC_TOP_LEVEL.has(firstSegment)) return next();
  return res.status(404).send("Não encontrado.");
});
// maxAge de 1h para tudo (css/js/img) — deixa o navegador reaproveitar
// esses arquivos sem baixar de novo ao navegar entre páginas ou voltar ao
// site na mesma hora, sem arriscar ficar preso a uma versão velha por
// muito tempo caso algo seja corrigido/publicado de novo (não há um passo
// de build com nome de arquivo versionado neste projeto). HTML fica de
// fora de propósito (sempre revalidado): são as "portas de entrada" do
// site — nunca queremos alguém preso numa versão antiga do index.html
// depois de um deploy, especialmente das páginas de checkout/admin.
app.use(express.static(SITE_ROOT, {
  extensions: ["html"],
  dotfiles: "ignore",
  maxAge: "1h",
  setHeaders(res, filePath){
    if(filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

/* =========================================================================
   UPLOAD DE FOTO DE PRODUTO (painel administrativo)
   -------------------------------------------------------------------------
   Antes o painel só aceitava colar a URL de uma imagem já hospedada em
   outro lugar. Agora a lojista pode enviar o arquivo direto do computador
   dela — o multer grava em disco (img/products/, dentro da allowlist
   acima, então já é servido estaticamente sem rota nova) e devolve o
   caminho curto (ex.: "/img/products/laco-bailarina-a1b2c3.jpg") para o
   painel salvar como `photoUrl`, exatamente como já fazia com uma URL
   externa — ver POST /api/admin/products/:id/photo, mais abaixo.
   Por que gravar em disco em vez de guardar a imagem em base64 no banco:
   o `photoUrl` de cada produto viaja em TODA resposta de /api/products
   (carregado por qualquer visitante da vitrine); um base64 de algumas
   centenas de KB nesse payload, multiplicado por 8 produtos, pesaria a
   página inicial do site inteiro. Um caminho de poucos bytes mantém o
   payload do catálogo do tamanho de sempre, e a imagem em si é servida
   (e cacheada pelo navegador) do mesmo jeito que qualquer outro arquivo
   estático do site.
========================================================================= */
const PRODUCT_UPLOADS_DIR = path.join(SITE_ROOT, "img", "products");
fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });

const PRODUCT_PHOTO_MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const productPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: PRODUCT_UPLOADS_DIR,
    // Nome gerado pelo servidor, nunca a partir do nome original do
    // arquivo do cliente: evita path traversal (ex.: "../../server/.env")
    // e colisão entre uploads de produtos diferentes.
    filename(req, file, cb){
      const ext = PRODUCT_PHOTO_MIME_EXT[file.mimetype];
      cb(null, `produto-${req.params.id}-${Date.now()}.${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 }, // 4MB — folgado para foto de produto, sem deixar a requisição pesada
  fileFilter(req, file, cb){
    // O `accept="image/*"` no <input type="file"> do admin.html é só uma
    // dica de UI — um cliente HTTP direto (curl/Postman) pode mandar
    // qualquer coisa, então o tipo é revalidado aqui contra uma allowlist
    // fixa antes de qualquer gravação em disco.
    cb(null, Boolean(PRODUCT_PHOTO_MIME_EXT[file.mimetype]));
  },
});

// Se o `photoUrl` sendo substituído aponta para um upload anterior nosso
// (e não uma URL externa colada à mão), apaga o arquivo velho do disco —
// best-effort: nunca deve derrubar a resposta do PATCH por causa disso.
// Só chamado de dentro do PATCH, depois que o novo valor já foi
// confirmado como o que vai ser salvo (nunca apaga um arquivo que ainda
// está em uso, mesmo que a lojista tenha enviado uma foto nova e cancelado
// o modal sem salvar — nesse caso o upload novo é que fica órfão, não o
// antigo, que é sempre o lado mais seguro do erro).
function deleteOldLocalPhoto(oldPhotoUrl){
  if(!oldPhotoUrl || !oldPhotoUrl.startsWith("/img/products/")) return;
  const filePath = path.join(SITE_ROOT, oldPhotoUrl);
  fs.unlink(filePath, (err) => {
    if(err && err.code !== "ENOENT"){
      console.error("Não foi possível apagar a foto antiga do produto:", err);
    }
  });
}

/* =========================================================================
   Validação e montagem de itens a partir do que o CLIENTE enviou.
   Nunca usa preço/peso vindos do navegador — sempre busca no catálogo do
   servidor (effectiveProduct, que já aplica eventual edição do painel).
========================================================================= */
function buildValidatedItems(items){
  if(!Array.isArray(items) || items.length === 0){
    throw { status:400, message:"Carrinho vazio ou inválido." };
  }
  if(items.length > 50){
    throw { status:400, message:"Carrinho excede o limite de itens." };
  }
  const overridesMap = getProductOverridesMap();
  return items.map(raw => {
    const id = Number(raw?.id);
    const qty = Number(raw?.qty);
    const product = Number.isInteger(id) ? effectiveProduct(id, overridesMap) : null;
    if(!product){
      throw { status:400, message:`Produto inválido: ${raw?.id}` };
    }
    if(!Number.isInteger(qty) || qty < 1 || qty > 10){
      throw { status:400, message:`Quantidade inválida para o produto ${id}.` };
    }
    return { id, qty, product };
  });
}

/* Empacotamento simplificado: soma o peso de tudo, e cresce a altura da
   caixa proporcionalmente à quantidade (aproximação de "empilhar" os
   laços), respeitando o mínimo aceito pelas transportadoras. Isso é uma
   simplificação razoável para produtos pequenos e leves como laços — para
   um catálogo com produtos de tamanhos muito diferentes, o ideal é
   integrar com o cálculo "por produtos" do próprio Melhor Envio
   (https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos). */
function buildPackage(validatedItems){
  let weight = 0, width = 0, length = 0, height = 0, insurance = 0;
  for(const { qty, product } of validatedItems){
    weight += product.weight * qty;
    width = Math.max(width, product.width);
    length = Math.max(length, product.length);
    height += product.height * qty;
    insurance += product.price * qty;
  }
  return {
    weight: Math.max(weight, MIN_PACKAGE.weight),
    width: Math.max(width, MIN_PACKAGE.width),
    length: Math.max(length, MIN_PACKAGE.length),
    height: Math.max(height, MIN_PACKAGE.height),
    insurance_value: Math.round(insurance * 100) / 100,
  };
}

/* =========================================================================
   MELHOR ENVIO — cliente HTTP mínimo (sem SDK, só fetch nativo do Node 18+)
   -------------------------------------------------------------------------
   A API exige Bearer token + um header User-Agent identificando sua
   aplicação e um e-mail de contato (exigência deles, não nossa).
   Baseado na documentação pública em docs.melhorenvio.com.br — teste com
   o token de SANDBOX antes de trocar para produção.
========================================================================= */
const MELHOR_ENVIO_BASE_URL = process.env.MELHOR_ENVIO_BASE_URL || "https://sandbox.melhorenvio.com.br";
const MELHOR_ENVIO_USER_AGENT = process.env.MELHOR_ENVIO_USER_AGENT || "PetitLaco (defina MELHOR_ENVIO_USER_AGENT no .env com seu e-mail)";

async function meFetch(path, { method = "GET", body } = {}){
  const res = await fetch(`${MELHOR_ENVIO_BASE_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": MELHOR_ENVIO_USER_AGENT,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if(!res.ok){
    const err = new Error(data?.message || `Melhor Envio respondeu ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* Pede a cotação ao Melhor Envio e devolve só as opções utilizáveis,
   já normalizadas para o formato que o front-end espera. Filtra os
   serviços que vieram com erro (ex.: transportadora indisponível para
   aquela rota) e ordena do mais barato para o mais caro. */
async function quoteShipping(cepDestino, validatedItems){
  const pkg = buildPackage(validatedItems);

  const quotes = await meFetch("/api/v2/me/shipment/calculate", {
    method: "POST",
    body: {
      from: { postal_code: process.env.ORIGIN_CEP },
      to: { postal_code: cepDestino },
      package: {
        weight: pkg.weight,
        width: pkg.width,
        height: pkg.height,
        length: pkg.length,
      },
      options: {
        insurance_value: pkg.insurance_value,
        receipt: false,
        own_hand: false,
        collect: false,
      },
    },
  });

  return quotes
    .filter(q => !q.error && (q.custom_price || q.price))
    .map(q => ({
      service_id: q.id,
      name: `${q.company?.name ? q.company.name + " · " : ""}${q.name}`,
      price: Number(q.custom_price ?? q.price),
      delivery_time: q.custom_delivery_time
        ? `${q.custom_delivery_time} dia(s) útil(eis)`
        : (q.delivery_time ? `${q.delivery_time} dia(s) útil(eis)` : "prazo a confirmar"),
    }))
    .sort((a, b) => a.price - b.price);
}

/* =========================================================================
   POST /api/calculate-shipping
   -------------------------------------------------------------------------
   Recebe { cep, items: [{id, qty}] } e devolve as opções de frete
   calculadas de verdade junto ao Melhor Envio (peso/valor vêm do
   catálogo do servidor, nunca do navegador).
========================================================================= */
app.post("/api/calculate-shipping", strictLimiter, async (req, res) => {
  try {
    const cep = String(req.body?.cep || "").replace(/\D/g, "");
    if(!/^\d{8}$/.test(cep)){
      return res.status(400).json({ error: "CEP inválido." });
    }
    if(!process.env.ORIGIN_CEP){
      return res.status(500).json({ error: "Servidor sem CEP de origem configurado (ORIGIN_CEP no .env)." });
    }

    const validatedItems = buildValidatedItems(req.body?.items);
    const options = await quoteShipping(cep, validatedItems);

    if(options.length === 0){
      return res.status(200).json({ options: [], warning: "Nenhuma transportadora disponível para esse CEP." });
    }
    res.json({ options });
  } catch (err) {
    // Distingue os dois tipos de erro que caem aqui: os que a GENTE lança
    // de propósito (objeto simples, ex.: buildValidatedItems — mensagem já
    // pensada pro cliente ler) dos que vêm de uma falha real de rede/API
    // externa (sempre um Error de verdade — meFetch, na chamada ao Melhor
    // Envio). Mostrar a mensagem crua do segundo tipo pro cliente (ex.:
    // "Unauthenticated." quando o token do Melhor Envio está errado) é
    // confuso e vaza detalhe interno — por isso só o primeiro tipo é
    // devolvido como está; o resto vira uma mensagem genérica, com o erro
    // de verdade só no log do servidor.
    if(!(err instanceof Error) && err.status && err.message){
      console.error("Erro de validação/frete:", err.message);
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Erro ao calcular frete:", err);
    res.status(502).json({ error: "Não foi possível calcular o frete agora. Tente novamente em instantes." });
  }
});

/* =========================================================================
   POST /api/validate-coupon
   -------------------------------------------------------------------------
   Recebe { code, items: [{id, qty}] }. Assim como o frete, o desconto NUNCA
   é confiado vindo do navegador — o servidor valida o código contra COUPONS
   e recalcula o desconto a partir do subtotal real (catálogo do servidor).
========================================================================= */
app.post("/api/validate-coupon", strictLimiter, (req, res) => {
  try {
    const coupon = findCoupon(req.body?.code);
    if(!coupon){
      return res.status(404).json({ error: "Cupom inválido ou expirado." });
    }
    const validatedItems = buildValidatedItems(req.body?.items);
    const subtotal = validatedItems.reduce((sum, { qty, product }) => sum + product.price * qty, 0);
    const discount = Math.round(subtotal * (coupon.percentOff / 100) * 100) / 100;
    res.json({ code: coupon.code, percentOff: coupon.percentOff, discount });
  } catch (err) {
    if(!(err instanceof Error) && err.status && err.message){
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Erro ao validar cupom:", err);
    res.status(500).json({ error: "Não foi possível validar o cupom agora." });
  }
});

/* =========================================================================
   POST /api/create-preference
   -------------------------------------------------------------------------
   Recebe { items: [{id, qty}], cep, shipping_service_id, address, coupon,
   paymentMethod } do front-end — SEM preço de produto, SEM preço de frete,
   SEM valor de desconto. O servidor:
     1) recalcula os itens a partir de PRODUCTS;
     2) recalcula o frete de novo junto ao Melhor Envio e confirma que
        `shipping_service_id` ainda é uma opção válida para esse pedido
        (nunca confia no preço de frete que o navegador mostrou);
     3) revalida o cupom (se houver) contra COUPONS e aplica o desconto
        proporcionalmente ao preço de cada item (nunca confia no desconto
        que o navegador mostrou);
     4) aplica o desconto do Pix (js/pricing.js) quando essa é a forma de
        pagamento escolhida, e restringe a preferência aos meios de
        pagamento correspondentes (ver PAYMENT_METHODS);
     5) grava o pedido no banco (server/db.js), vinculado ao usuário logado
        quando houver sessão (req.user, ver server/auth.js) — é isso que
        permite ao cliente ver o pedido depois em "Meus pedidos";
     6) cria a preferência no Mercado Pago com o frete somado como um
        item da compra.
========================================================================= */
app.post("/api/create-preference", strictLimiter, async (req, res) => {
  try {
    const { cep: rawCep, shipping_service_id, address } = req.body || {};
    const cep = String(rawCep || "").replace(/\D/g, "");
    if(!/^\d{8}$/.test(cep)){
      return res.status(400).json({ error: "CEP inválido." });
    }
    if(!shipping_service_id){
      return res.status(400).json({ error: "Escolha uma opção de frete." });
    }
    const paymentMethod = String(req.body?.paymentMethod || "card").toLowerCase();
    if(!PAYMENT_METHODS[paymentMethod]){
      return res.status(400).json({ error: "Forma de pagamento inválida." });
    }
    const requiredAddress = ["nome","telefone","rua","numero","bairro","cidade","uf"];
    if(!address || requiredAddress.some(f => !String(address[f] || "").trim())){
      return res.status(400).json({ error: "Endereço de entrega incompleto." });
    }

    const validatedItems = buildValidatedItems(req.body?.items);

    // Cupom opcional: revalidado aqui, nunca confiando no desconto do front.
    const coupon = req.body?.coupon ? findCoupon(req.body.coupon) : null;
    if(req.body?.coupon && !coupon){
      return res.status(409).json({ error: "Esse cupom não é mais válido. Remova-o e tente novamente." });
    }
    const couponFactor = coupon ? (1 - coupon.percentOff / 100) : 1;

    /* Descontos aplicados no PREÇO UNITÁRIO e somados item a item (em vez de
       calculados de uma vez sobre o subtotal): o Mercado Pago cobra
       `unit_price * quantity` já arredondado por item, então somar os
       descontos do mesmo jeito é o que faz o "Total" gravado no pedido bater
       exatamente com o valor cobrado — calcular por fora sobre o subtotal
       deixaria uma diferença de centavos entre o recibo e a cobrança. */
    let subtotal = 0, couponDiscount = 0, pixDiscount = 0;
    const preferenceItems = validatedItems.map(({ id, qty, product }) => {
      const afterCoupon = pricing.round2(product.price * couponFactor);
      const unitPrice = paymentMethod === "pix" ? pricing.pixPriceFor(afterCoupon) : afterCoupon;
      subtotal += product.price * qty;
      couponDiscount += (product.price - afterCoupon) * qty;
      pixDiscount += (afterCoupon - unitPrice) * qty;
      return {
        id: String(id),
        title: product.name,
        quantity: qty,
        unit_price: unitPrice,   // <- preço vem do servidor, não do cliente
        currency_id: "BRL",
      };
    });
    subtotal = pricing.round2(subtotal);
    const discount = pricing.round2(couponDiscount);
    pixDiscount = pricing.round2(pixDiscount);

    // Recalcula o frete de novo (nunca confia no preço que o front mostrou)
    const shippingOptions = await quoteShipping(cep, validatedItems);
    const chosenShipping = shippingOptions.find(o => String(o.service_id) === String(shipping_service_id));
    if(!chosenShipping){
      return res.status(409).json({ error: "Essa opção de frete expirou ou não está mais disponível. Recalcule o frete e tente de novo." });
    }
    preferenceItems.push({
      id: "frete",
      title: `Frete — ${chosenShipping.name}`,
      quantity: 1,
      unit_price: chosenShipping.price,
      currency_id: "BRL",
    });

    const orderRef = randomUUID();

    // Só grava o pedido DEPOIS que o Mercado Pago confirmar a preferência —
    // se essa chamada falhar (token inválido, MP fora do ar), não queremos
    // um pedido "pendente" órfão no histórico do cliente que nunca vai virar
    // nada (nenhum link de pagamento chegou a existir para ele).
    // payer é opcional na API do Mercado Pago — mandamos o que já temos
    // (nome do endereço de entrega; e-mail só quando o cliente está
    // logado, já que o checkout de visitante não coleta e-mail) pra
    // pré-preencher a tela de pagamento. Sem telefone aqui de propósito:
    // o Mercado Pago exige um formato específico (DDD + número
    // separados) e um valor mal formatado rejeitaria a preferência
    // inteira — não vale o risco por um campo que já é opcional.
    const payer = {
      name: address.nome,
      ...(req.user?.email ? { email: req.user.email } : {}),
    };

    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: preferenceItems,
        payer,
        // Trava a tela de pagamento na forma que o cliente escolheu (e no
        // limite de parcelas que a vitrine anunciou) — ver PAYMENT_METHODS.
        payment_methods: {
          excluded_payment_types: PAYMENT_METHODS[paymentMethod].excludedPaymentTypes.map(id => ({ id })),
          installments: paymentMethod === "pix" ? 1 : pricing.PAYMENT_RULES.maxInstallments,
        },
        external_reference: orderRef,
        back_urls: {
          success: `${CLIENT_ORIGIN}/pagamento-sucesso.html`,
          failure: `${CLIENT_ORIGIN}/pagamento-erro.html`,
          pending: `${CLIENT_ORIGIN}/pagamento-pendente.html`,
        },
        auto_return: "approved",
        notification_url: `${process.env.SERVER_PUBLIC_URL || "https://SEU-DOMINIO-DO-SERVIDOR.com"}/api/webhook`,
        statement_descriptor: "PETIT LACO",
      },
    });

    db.createOrder({
      externalReference: orderRef,
      userId: req.user ? req.user.id : null,
      status: "pendente",
      // Guarda o preço de CATÁLOGO no momento da compra (não só id/qty) —
      // o histórico de pedidos precisa continuar exibindo o valor correto
      // mesmo se o preço do produto mudar depois. É o preço "de tabela"
      // (sem o desconto do cupom, que já aparece como uma linha separada
      // de "Desconto" no resumo), igual a um item de nota fiscal.
      items: validatedItems.map(({ id, qty, product }) => ({
        id, qty, price: product.price,
      })),
      address: { ...address, cep },
      shipping: chosenShipping,
      couponCode: coupon ? coupon.code : null,
      subtotal,
      discount,
      pixDiscount,
      paymentMethod,
      shippingPrice: chosenShipping.price,
      total: pricing.round2(subtotal - discount - pixDiscount + chosenShipping.price),
    });

    // init_point = link de pagamento (Checkout Pro) para redirecionar o cliente
    res.json({ id: result.id, init_point: result.init_point });
  } catch (err) {
    // Mesmo racional do catch em /api/calculate-shipping: só mostra a
    // mensagem crua pro cliente quando é um erro de validação nosso
    // (objeto simples); qualquer Error de verdade (Melhor Envio, Mercado
    // Pago) vira mensagem genérica aqui, com o detalhe real só no log.
    if(!(err instanceof Error) && err.status && err.message){
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Erro ao criar preferência:", err);
    res.status(500).json({ error: "Não foi possível iniciar o pagamento. Tente novamente em instantes." });
  }
});

/* =========================================================================
   Compra da etiqueta de envio no Melhor Envio (opcional, best-effort)
   -------------------------------------------------------------------------
   ⚠️ Isto gasta saldo de verdade da sua conta Melhor Envio. Por isso vem
   DESLIGADO por padrão (AUTO_PURCHASE_SHIPPING_LABEL=false no .env).
   Fluxo, conforme a documentação pública (docs.melhorenvio.com.br):
     1) POST /me/cart              → adiciona o frete escolhido ao carrinho,
                                      com endereço completo de origem/destino
     2) POST /me/shipment/checkout → paga o(s) frete(s) do carrinho com o
                                      saldo da conta Melhor Envio
     3) POST /me/shipment/generate → gera a etiqueta (retorna o código de
                                      rastreio)
   Isso precisa ter sido testado e validado com uma conta de sandbox antes
   de ligar em produção — não foi possível testar de ponta a ponta neste
   ambiente (sem acesso à internet). Trate como um ponto de partida, não
   como algo pronto para rodar sem revisão.
========================================================================= */
async function purchaseShippingLabel(order){
  const seller = {
    name: process.env.SELLER_NAME,
    phone: process.env.SELLER_PHONE,
    email: process.env.SELLER_EMAIL,
    document: process.env.SELLER_DOCUMENT,
    address: process.env.SELLER_ADDRESS,
    complement: process.env.SELLER_COMPLEMENT || "",
    number: process.env.SELLER_NUMBER,
    district: process.env.SELLER_DISTRICT,
    city: process.env.SELLER_CITY,
    state_abbr: process.env.SELLER_STATE,
    postal_code: process.env.ORIGIN_CEP,
    country_id: "BR",
  };

  /* Usa effectiveProduct (e não PRODUCTS direto) pelo mesmo motivo do resto
     do arquivo: um nome/preço editado no painel precisa valer aqui também,
     senão a declaração de conteúdo e o valor segurado da etiqueta saem com
     o dado antigo. O filter() descarta um id que não exista mais no
     catálogo — sem ele, um produto removido derrubaria a geração da
     etiqueta inteira com um TypeError. */
  const labelOverridesMap = getProductOverridesMap();
  const labelItems = order.items
    .map(({ id, qty }) => ({ qty, product: effectiveProduct(id, labelOverridesMap) }))
    .filter(({ product }) => product);
  if(labelItems.length === 0){
    throw new Error("Nenhum item válido no pedido para gerar a etiqueta.");
  }
  const items = labelItems.map(({ qty, product }) => ({
    name: product.name, quantity: qty, unitary_value: product.price,
  }));
  const pkg = buildPackage(labelItems);

  const cartItem = await meFetch("/api/v2/me/cart", {
    method: "POST",
    body: {
      service: order.shipping.service_id,
      from: seller,
      to: {
        name: order.address.nome,
        phone: order.address.telefone,
        address: order.address.rua,
        complement: order.address.complemento || "",
        number: order.address.numero,
  district: order.address.bairro,
        city: order.address.cidade,
        state_abbr: order.address.uf,
        postal_code: order.address.cep,
        country_id: "BR",
      },
      products: items,
      volumes: [{ height: pkg.height, width: pkg.width, length: pkg.length, weight: pkg.weight }],
      options: {
        insurance_value: pkg.insurance_value,
        receipt: false,
        own_hand: false,
        non_commercial: false,
      },
    },
  });

  await meFetch("/api/v2/me/shipment/checkout", {
    method: "POST",
    body: { orders: [cartItem.id] },
  });

  const generated = await meFetch("/api/v2/me/shipment/generate", {
    method: "POST",
    body: { orders: [cartItem.id] },
  });

  return generated;
}

/* =========================================================================
   POST /api/webhook  (configurar essa URL pública no painel do Mercado Pago)
   -------------------------------------------------------------------------
   O Mercado Pago chama esta rota quando o status de um pagamento muda.
   NUNCA confie apenas no redirecionamento do navegador (back_urls) para
   liberar/despachar o pedido — a confirmação de verdade é sempre esta
   notificação, validada consultando a API do Mercado Pago pelo ID
   recebido.
========================================================================= */
// Mapeia os status do Mercado Pago para o rótulo salvo no pedido (o que o
// cliente vê em "Meus pedidos").
const PAYMENT_STATUS_MAP = {
  approved: "pago",
  pending: "pendente",
  in_process: "em análise",
  rejected: "recusado",
  cancelled: "cancelado",
  refunded: "reembolsado",
  charged_back: "estornado",
};

/* Tudo que só deve acontecer UMA VEZ, na primeira vez que um pedido vira
   "pago" (comprar etiqueta, avisar a lojista por WhatsApp/e-mail) — ver
   guarda de idempotência (wasAlreadyApproved) no handler do webhook,
   abaixo, que é quem decide SE isso é chamado. Roda depois da resposta
   200 já ter sido enviada ao Mercado Pago (fire-and-forget, com seu
   próprio catch) — chamadas de rede a terceiros (WhatsApp/SMTP) podem
   demorar alguns segundos, e nunca podem atrasar/arriscar o timeout da
   confirmação do webhook. */
async function runApprovedOrderSideEffects(orderRow, info){
  const order = {
    items: JSON.parse(orderRow.items_json),
    address: JSON.parse(orderRow.address_json),
    shipping: JSON.parse(orderRow.shipping_json),
  };

  if(process.env.AUTO_PURCHASE_SHIPPING_LABEL === "true"){
    try{
      const label = await purchaseShippingLabel(order);
      console.log("Etiqueta de envio comprada:", label);
      // TODO: salvar o código de rastreio automaticamente (hoje a
      // lojista preenche à mão no painel /admin.html).
    }catch(labelErr){
      console.error("Falha ao comprar etiqueta automaticamente (pedido ficou pago, mas sem etiqueta — gere manualmente no painel do Melhor Envio):", labelErr);
    }
  } else {
    console.log("Pagamento aprovado. Gere a etiqueta manualmente no painel do Melhor Envio para o pedido:", info.external_reference);
  }

  // Dados comuns aos dois avisos abaixo (WhatsApp e e-mail), montados uma
  // única vez.
  const notifyOverridesMap = getProductOverridesMap();
  const notificationOrder = {
    externalReference: info.external_reference,
    items: order.items.map(({ id, qty }) => ({
      id, qty, name: effectiveProduct(id, notifyOverridesMap)?.name || `Produto #${id}`,
    })),
    address: order.address,
    total: orderRow.total,
    paidAt: info.date_approved || info.date_created || Date.now(),
  };

  // Os dois avisos abaixo são best-effort e independentes um do outro:
  // uma falha em qualquer um deles (credenciais ausentes, provedor fora
  // do ar, etc.) nunca pode reverter a confirmação do pedido, que já foi
  // gravada antes de chegar aqui.
  try{
    await whatsapp.notifyOwnerOfPaidOrder(notificationOrder);
    console.log(`Aviso de WhatsApp enviado à lojista para o pedido ${info.external_reference}.`);
  }catch(waErr){
    console.error(`Falha ao enviar aviso de WhatsApp (pedido ${info.external_reference} segue pago normalmente):`, waErr.message || waErr);
  }

  try{
    await email.notifyOwnerOfPaidOrder({
      ...notificationOrder,
      adminUrl: `${CLIENT_ORIGIN}/admin.html?pedido=${encodeURIComponent(info.external_reference)}`,
    });
    console.log(`E-mail de aviso enviado à lojista para o pedido ${info.external_reference}.`);
  }catch(mailErr){
    console.error(`Falha ao enviar e-mail de aviso (pedido ${info.external_reference} segue pago normalmente):`, mailErr.message || mailErr);
  }
}

app.post("/api/webhook", async (req, res) => {
  try {
    const paymentId = req.query?.["data.id"] || req.body?.data?.id;
    const topic = req.query?.type || req.body?.type;

    if (topic === "payment" && paymentId) {
      const payment = new Payment(mpClient);
      const info = await payment.get({ id: paymentId });
      console.log(`Webhook recebido — pagamento ${paymentId}: ${info.status}`);

      const orderRow = info.external_reference
        ? db.getOrderByExternalReference(info.external_reference)
        : null;

      if(!orderRow){
        console.warn(`Webhook: pagamento ${paymentId} não corresponde a nenhum pedido conhecido (external_reference=${info.external_reference || "ausente"}).`);
        return res.sendStatus(200);
      }

      // Guarda de idempotência: o Mercado Pago pode reenviar a mesma
      // notificação (rede instável, ou nosso servidor demorou a
      // responder da vez anterior). Se esse pedido JÁ estava "pago"
      // antes desta chamada, é um reenvio — sem esta checagem, cada
      // reenvio mandaria WhatsApp/e-mail de novo pra lojista e, com
      // AUTO_PURCHASE_SHIPPING_LABEL ligado, compraria a etiqueta de novo
      // (gastando saldo real duplicado).
      const wasAlreadyApproved = orderRow.status === "pago";
      const status = PAYMENT_STATUS_MAP[info.status] || info.status;
      db.updateOrderStatus(info.external_reference, status, String(paymentId));

      // Responde ao Mercado Pago AGORA. O que falta (etiqueta, avisos)
      // são chamadas de rede a terceiros que podem demorar — rodam depois,
      // sem bloquear esta resposta nem arriscar um timeout que faria o
      // Mercado Pago reenviar este mesmo webhook.
      res.sendStatus(200);

      if(info.status === "approved" && !wasAlreadyApproved){
        runApprovedOrderSideEffects(orderRow, info).catch(err => {
          console.error(`Falha inesperada processando efeitos do pedido ${info.external_reference}:`, err);
        });
      }
      return;
    }

    // Notificação de um tipo que não nos interessa (ex.: merchant_order) —
    // confirma recebimento mesmo assim, pra o Mercado Pago não ficar
    // reenviando algo que nunca vamos processar.
    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    if(!res.headersSent) res.sendStatus(500);
  }
});

/* =========================================================================
   POST /api/contact e /api/newsletter — exemplos de validação server-side.
   O front-end já valida (main.js), mas isso NUNCA é suficiente sozinho:
   qualquer pessoa pode chamar a API diretamente (curl/Postman) pulando o
   HTML. Por isso validamos e limitamos tudo de novo aqui.
========================================================================= */
app.post("/api/newsletter", strictLimiter, (req, res) => {
  const email = (req.body?.email || "").trim();
  if(!auth.isValidEmail(email)){
    return res.status(400).json({ error: "E-mail inválido." });
  }
  // TODO: salvar em uma lista (ex.: tabela `newsletter_subscribers`) e/ou
  // integrar com um provedor de e-mail marketing.
  console.log("Nova inscrição na newsletter:", email);
  res.json({ ok: true });
});

app.post("/api/contact", strictLimiter, (req, res) => {
  const nome = (req.body?.nome || "").trim().slice(0, 120);
  const telefone = (req.body?.telefone || "").trim().slice(0, 30);
  const ocasiao = (req.body?.ocasiao || "").trim().slice(0, 40);
  const mensagem = (req.body?.mensagem || "").trim().slice(0, 2000);

  if(!nome || !telefone || !mensagem){
    return res.status(400).json({ error: "Preencha nome, telefone e mensagem." });
  }
  // TODO: encaminhar por e-mail (ex.: com Nodemailer) ou salvar em um CRM.
  // Sempre trate nome/mensagem como texto puro (nunca insira em HTML sem
  // escapar, e nunca use em comandos de sistema/SQL sem parametrização).
  console.log("Novo contato:", { nome, telefone, ocasiao });
  res.json({ ok: true });
});

/* =========================================================================
   AUTENTICAÇÃO — /api/auth/*
   -------------------------------------------------------------------------
   Sessão por cookie httpOnly (ver server/auth.js para o porquê). O
   front-end nunca vê nem guarda uma senha ou token de sessão em
   localStorage/sessionStorage — só o cookie, que o navegador envia sozinho.
========================================================================= */
app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = auth.normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if(!auth.isValidName(name)){
      return res.status(400).json({ error: "Informe seu nome completo." });
    }
    if(!auth.isValidEmail(email)){
      return res.status(400).json({ error: "E-mail inválido." });
    }
    if(!auth.isValidPassword(password)){
      return res.status(400).json({ error: "A senha precisa ter entre 8 e 72 caracteres." });
    }
    if(db.getUserByEmail(email)){
      return res.status(409).json({ error: "Já existe uma conta com este e-mail." });
    }

    const passwordHash = await auth.hashPassword(password);
    const user = db.createUser({ name, email, passwordHash });
    auth.issueSession(res, user.id);
    res.status(201).json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Erro ao criar conta:", err);
    res.status(500).json({ error: "Não foi possível criar a conta agora. Tente novamente em instantes." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const genericError = () => res.status(401).json({ error: "E-mail ou senha inválidos." });

    if(!auth.isValidEmail(email) || !password){
      return genericError();
    }

    const user = db.getUserByEmail(email);
    // Sempre chama verifyPassword, mesmo sem usuário (compara contra um hash
    // de referência) — evita que o tempo de resposta revele se o e-mail existe.
    const ok = await auth.verifyPassword(password, user?.password_hash);
    if(!user || !ok){
      return genericError();
    }

    auth.issueSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Erro ao fazer login:", err);
    res.status(500).json({ error: "Não foi possível entrar agora. Tente novamente em instantes." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  auth.clearSession(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if(!req.user) return res.status(401).json({ error: "Não autenticado." });
  res.json(req.user);
});

/* =========================================================================
   GET /api/orders — histórico de pedidos do usuário logado
   -------------------------------------------------------------------------
   Exige sessão (auth.requireAuth). Cada pedido é devolvido já com os nomes
   dos produtos resolvidos a partir de PRODUCTS (o banco só guarda id/qty),
   para o front-end não precisar reimplementar o catálogo.
========================================================================= */
app.get("/api/orders", auth.requireAuth, (req, res) => {
  try {
    const rows = db.listOrdersByUser(req.user.id);
    const overridesMap = getProductOverridesMap();
    const orders = rows.map(row => {
      const items = JSON.parse(row.items_json).map(({ id, qty, price }) => ({
        id, qty,
        name: effectiveProduct(id, overridesMap)?.name || `Produto #${id}`,
        // Preço gravado no momento da compra (fallback ao catálogo atual só
        // para pedidos antigos, de antes dessa informação ser salva).
        unitPrice: price ?? effectiveProduct(id, overridesMap)?.price ?? null,
      }));
      const shipping = JSON.parse(row.shipping_json);
      return {
        reference: row.external_reference,
        status: row.status,
        items,
        shipping: { name: shipping.name, deliveryTime: shipping.delivery_time },
        couponCode: row.coupon_code,
        subtotal: row.subtotal,
        discount: row.discount,
        pixDiscount: row.pix_discount || 0,
        paymentMethod: row.payment_method || "card",
        shippingPrice: row.shipping_price,
        total: row.total,
        createdAt: row.created_at,
      };
    });
    res.json({ orders });
  } catch (err) {
    console.error("Erro ao listar pedidos:", err);
    res.status(500).json({ error: "Não foi possível carregar seus pedidos agora." });
  }
});

/* =========================================================================
   PAINEL ADMINISTRATIVO — /api/admin/*  (ver admin.html / js/admin.js)
   -------------------------------------------------------------------------
   Exige sessão + e-mail com hash cadastrado em ADMIN_EMAIL_HASHES
   (auth.requireAdmin, ver server/auth.js). Diferente de /api/orders
   (cliente só vê os próprios pedidos), aqui devolve TODOS os pedidos com
   dados do cliente (nome, telefone, endereço de entrega) — por isso o
   controle de acesso é crítico: nunca relaxar para auth.requireAuth aqui.

   `noStore` abaixo evita que essas respostas (dados de cliente, preços)
   fiquem guardadas no cache do navegador/proxy — relevante em computador
   compartilhado, onde outra pessoa poderia usar "voltar" no histórico e
   ver a última resposta cacheada mesmo depois do logout.
========================================================================= */
function noStore(req, res, next){
  res.set("Cache-Control", "no-store, private");
  next();
}
app.use("/api/admin", noStore);

app.get("/api/admin/orders", auth.requireAdmin, (req, res) => {
  try {
    const rows = db.listAllOrders();
    const overridesMap = getProductOverridesMap();
    const orders = rows.map(row => {
      const items = JSON.parse(row.items_json).map(({ id, qty, price }) => ({
        id, qty,
        name: effectiveProduct(id, overridesMap)?.name || `Produto #${id}`,
        color: colorLabelFor(id),
        unitPrice: price ?? effectiveProduct(id, overridesMap)?.price ?? null,
      }));
      const address = JSON.parse(row.address_json);
      const shipping = JSON.parse(row.shipping_json);
      const account = row.user_id ? db.getUserById(row.user_id) : null;
      return {
        reference: row.external_reference,
        status: row.status,
        items,
        customer: {
          nome: address?.nome || null,
          telefone: address?.telefone || null,
          email: account?.email || null,
        },
        address,
        shipping: { name: shipping.name, deliveryTime: shipping.delivery_time },
        trackingCode: row.tracking_code || "",
        subtotal: row.subtotal,
        discount: row.discount,
        pixDiscount: row.pix_discount || 0,
        paymentMethod: row.payment_method || "card",
        shippingPrice: row.shipping_price,
        total: row.total,
        createdAt: row.created_at,
      };
    });
    const stats = db.getOrderStats();
    res.json({ orders, stats: { totalRevenue: stats.revenue, totalOrders: stats.count } });
  } catch (err) {
    console.error("Erro ao listar pedidos (admin):", err);
    res.status(500).json({ error: "Não foi possível carregar os pedidos agora." });
  }
});

/* PATCH /api/admin/orders/:reference/tracking — salva o código de postagem/
   rastreio dos Correios para um pedido (preenchido à mão pela lojista). */
app.patch("/api/admin/orders/:reference/tracking", auth.requireAdmin, (req, res) => {
  try {
    const reference = String(req.params.reference || "");
    const trackingCode = String(req.body?.trackingCode || "").trim().slice(0, 60);
    const order = db.getOrderByExternalReference(reference);
    if(!order){
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    db.updateOrderTracking(reference, trackingCode);
    res.json({ ok: true, trackingCode });
  } catch (err) {
    console.error("Erro ao salvar código de rastreio:", err);
    res.status(500).json({ error: "Não foi possível salvar o código de rastreio agora." });
  }
});

/* =========================================================================
   GET /api/products — catálogo público (nome/preço/foto já mesclando
   eventuais edições do painel administrativo). O front-end (js/main.js)
   busca isso para atualizar a vitrine sem precisar recarregar a página
   depois de uma edição — ver loadProductOverrides() em js/main.js.
========================================================================= */
app.get("/api/products", (req, res) => {
  const overridesMap = getProductOverridesMap();
  const products = Object.keys(PRODUCTS).map(Number).map(id => {
    const p = effectiveProduct(id, overridesMap);
    return { id, name: p.name, price: p.price, photoUrl: p.photoUrl, category: p.category, badges: p.badges };
  });
  // `paymentRules` viaja junto do catálogo (em vez de numa rota própria) para
  // não gastar mais uma das requisições do rate limit por carregamento de
  // página. A vitrine calcula os preços sozinha com o js/pricing.js que já
  // baixou — isto serve para ela CONFERIR se esse arquivo, que pode vir de
  // um cache de até 1h, ainda concorda com o que o servidor vai cobrar.
  // Ver loadProductOverrides() em js/main.js.
  res.json({ products, paymentRules: pricing.PAYMENT_RULES });
});

/* =========================================================================
   GESTÃO DE PRODUTOS (painel administrativo) — /api/admin/products
   -------------------------------------------------------------------------
   Só permite editar nome, preço, foto, categoria e selos de destaque
   ("Mais vendido"/"Novo") dos produtos que já existem em PRODUCTS — não
   cria nem remove produtos do catálogo (um produto novo de verdade
   também precisaria de peso/dimensões para o frete, que não são
   editáveis por aqui). Peso e dimensões continuam vindo só de PRODUCTS.
========================================================================= */
app.get("/api/admin/products", auth.requireAdmin, (req, res) => {
  const overridesMap = getProductOverridesMap();
  const products = Object.keys(PRODUCTS).map(Number).map(id => {
    const p = effectiveProduct(id, overridesMap);
    return { id, name: p.name, price: p.price, photoUrl: p.photoUrl, category: p.category, badges: p.badges };
  });
  res.json({ products, categories: PRODUCT_CATEGORIES, availableBadges: PRODUCT_BADGES });
});

function isValidProductPrice(v){
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100000;
}
// Padrão EXATO do nome de arquivo gerado por productPhotoUpload, acima —
// nunca aceita um caminho local fora desse formato (bloqueia qualquer
// tentativa de apontar `photoUrl` para outro arquivo do servidor, tipo
// "/img/products/../../server/.env", mandando o PATCH direto sem passar
// pelo upload).
const LOCAL_UPLOAD_PATTERN = /^\/img\/products\/produto-\d+-\d+\.(jpe?g|png|webp|gif)$/;
// Aceita vazio (remove a foto customizada, volta para o padrão calculado no
// front-end a partir do nome), uma URL http(s) (link colado à mão) ou um
// caminho local de upload (gerado por POST /api/admin/products/:id/photo,
// abaixo) — nunca javascript:/data: etc., que não fazem sentido como
// <img src> de um formulário.
function isValidPhotoUrl(v){
  if(!v) return true;
  if(typeof v !== "string" || v.length > 2000) return false;
  if(LOCAL_UPLOAD_PATTERN.test(v)) return true;
  try{
    const parsed = new URL(v);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }catch{
    return false;
  }
}
function isValidBadges(v){
  if(!Array.isArray(v)) return false;
  if(v.length > PRODUCT_BADGES.length) return false;
  return v.every(b => PRODUCT_BADGES.includes(b)) && new Set(v).size === v.length;
}

/* =========================================================================
   PATCH /api/admin/products/:id
   -------------------------------------------------------------------------
   Parcial de verdade: só valida/grava os campos que vieram no corpo da
   requisição (checados com `"campo" in req.body`, não truthiness — um
   valor vazio de propósito, como apagar a URL da foto, ainda precisa ser
   distinguível de "campo não enviado"). O painel manda só o que a lojista
   realmente mudou naquele clique em "Salvar" (ver js/admin.js), em vez do
   produto inteiro a cada edição — menos payload, e elimina o risco de um
   campo antigo em cache no navegador sobrescrever por acidente uma edição
   mais recente feita em outra aba.
========================================================================= */
app.patch("/api/admin/products/:id", auth.requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || !PRODUCTS[id]){
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const body = req.body || {};
    const fields = {};

    if("name" in body){
      const name = String(body.name || "").trim();
      if(name.length < 2 || name.length > 120){
        return res.status(400).json({ error: "Nome precisa ter entre 2 e 120 caracteres." });
      }
      fields.name = name;
    }
    if("price" in body){
      const price = Number(body.price);
      if(!isValidProductPrice(price)){
        return res.status(400).json({ error: "Preço inválido. Use um valor entre R$ 0,01 e R$ 99.999,99." });
      }
      fields.price = Math.round(price * 100) / 100;
    }
    if("photoUrl" in body){
      const photoUrl = body.photoUrl ? String(body.photoUrl).trim() : "";
      if(!isValidPhotoUrl(photoUrl)){
        return res.status(400).json({ error: "URL da foto inválida. Use um link http(s) ou deixe em branco." });
      }
      const previousPhotoUrl = effectiveProduct(id, getProductOverridesMap())?.photoUrl;
      if(previousPhotoUrl && previousPhotoUrl !== (photoUrl || null)){
        deleteOldLocalPhoto(previousPhotoUrl);
      }
      fields.photoUrl = photoUrl || null;
    }
    if("category" in body){
      const category = body.category ? String(body.category).trim() : "";
      if(category && !PRODUCT_CATEGORIES.includes(category)){
        return res.status(400).json({ error: "Categoria inválida." });
      }
      fields.category = category || null;
    }
    if("badges" in body){
      if(!isValidBadges(body.badges)){
        return res.status(400).json({ error: "Selo de destaque inválido." });
      }
      fields.badges = body.badges;
    }

    if(Object.keys(fields).length === 0){
      return res.status(400).json({ error: "Nada para salvar." });
    }

    db.upsertProductOverride(id, fields);

    const updated = effectiveProduct(id, getProductOverridesMap());
    res.json({ id, name: updated.name, price: updated.price, photoUrl: updated.photoUrl, category: updated.category, badges: updated.badges });
  } catch (err) {
    console.error("Erro ao atualizar produto:", err);
    res.status(500).json({ error: "Não foi possível salvar o produto agora." });
  }
});

/* =========================================================================
   POST /api/admin/products/:id/photo — upload de arquivo
   -------------------------------------------------------------------------
   Rota separada do PATCH acima de propósito: o corpo aqui é
   multipart/form-data (um arquivo), não JSON, então precisa de um parser
   diferente (multer) — misturar os dois no mesmo handler exigiria detectar
   o Content-Type manualmente e complicaria a rota que já funciona bem para
   os outros campos. Só GRAVA o arquivo e devolve o caminho; quem decide
   "salvar isso no produto" continua sendo o PATCH de sempre (ver
   js/admin.js: o caminho devolvido aqui vira o valor de `photoUrl` no
   próximo clique em "Salvar alterações", passando pelo mesmo payload
   compacto e pela mesma validação de sempre) — assim um upload feito e
   depois descartado (lojista fecha o modal sem salvar) nunca deixa o
   produto apontando para um arquivo indevido.
========================================================================= */
app.post("/api/admin/products/:id/photo", auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if(!Number.isInteger(id) || !PRODUCTS[id]){
    return res.status(404).json({ error: "Produto não encontrado." });
  }
  productPhotoUpload.single("photo")(req, res, (err) => {
    if(err instanceof multer.MulterError){
      if(err.code === "LIMIT_FILE_SIZE"){
        return res.status(413).json({ error: "Imagem muito grande. O limite é 4MB." });
      }
      return res.status(400).json({ error: "Não foi possível enviar a imagem." });
    }
    if(err){
      console.error("Erro no upload de foto:", err);
      return res.status(500).json({ error: "Não foi possível enviar a imagem agora." });
    }
    if(!req.file){
      return res.status(400).json({ error: "Envie um arquivo de imagem (JPEG, PNG, WEBP ou GIF)." });
    }
    res.status(201).json({ photoUrl: `/img/products/${req.file.filename}` });
  });
});

/* DELETE /api/admin/orders/:reference — apaga um pedido (carrinho
   abandonado, teste, etc.). NUNCA apaga um pedido "pago": isso é
   histórico financeiro do pedido, não um "carrinho" — remover um pago de
   verdade tem que ser uma decisão manual direta no banco, não um clique
   no painel. */
app.delete("/api/admin/orders/:reference", auth.requireAdmin, (req, res) => {
  try {
    const reference = String(req.params.reference || "");
    const order = db.getOrderByExternalReference(reference);
    if(!order){
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    if(order.status === "pago"){
      return res.status(409).json({ error: "Pedidos pagos não podem ser apagados — é o histórico financeiro do pedido." });
    }
    db.deleteOrder(reference);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao apagar pedido:", err);
    res.status(500).json({ error: "Não foi possível apagar o pedido agora." });
  }
});

/* =========================================================================
   GESTÃO DE CUPONS (painel administrativo) — /api/admin/coupons
   -------------------------------------------------------------------------
   Cria/lista/apaga cupons de desconto percentual. findCoupon() (usado no
   checkout de verdade) lê da mesma tabela — um cupom criado aqui já vale
   pro cliente no próximo checkout, sem precisar reiniciar o servidor.
========================================================================= */
app.get("/api/admin/coupons", auth.requireAdmin, (req, res) => {
  try {
    const coupons = db.listCoupons().map(c => ({
      code: c.code, percentOff: c.percent_off, description: c.description, createdAt: c.created_at,
    }));
    res.json({ coupons });
  } catch (err) {
    console.error("Erro ao listar cupons:", err);
    res.status(500).json({ error: "Não foi possível carregar os cupons agora." });
  }
});

app.post("/api/admin/coupons", auth.requireAdmin, (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase().replace(/\s+/g, "");
    const percentOff = Number(req.body?.percentOff);
    const description = String(req.body?.description || "").trim().slice(0, 200);

    if(!/^[A-Z0-9]{3,20}$/.test(code)){
      return res.status(400).json({ error: "Código precisa ter de 3 a 20 letras/números, sem espaço." });
    }
    if(!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 90){
      return res.status(400).json({ error: "Desconto precisa ser um número entre 1 e 90 (%)." });
    }
    if(db.getCoupon(code)){
      return res.status(409).json({ error: "Já existe um cupom com esse código." });
    }

    const created = db.createCoupon({ code, percentOff, description });
    res.status(201).json({
      code: created.code, percentOff: created.percent_off, description: created.description, createdAt: created.created_at,
    });
  } catch (err) {
    console.error("Erro ao criar cupom:", err);
    res.status(500).json({ error: "Não foi possível criar o cupom agora." });
  }
});

app.delete("/api/admin/coupons/:code", auth.requireAdmin, (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if(!db.getCoupon(code)){
      return res.status(404).json({ error: "Cupom não encontrado." });
    }
    db.deleteCoupon(code);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao apagar cupom:", err);
    res.status(500).json({ error: "Não foi possível apagar o cupom agora." });
  }
});

/* POST /api/admin/orders/:reference/generate-label — compra a etiqueta de
   envio no Melhor Envio para este pedido (ação manual, sob demanda —
   diferente de AUTO_PURCHASE_SHIPPING_LABEL, que é automático via
   webhook). ⚠️ Gasta saldo real da conta Melhor Envio: só funciona para
   pedido já pago, e é sempre a lojista quem decide clicar, pedido por
   pedido (nunca automático a partir daqui). */
app.post("/api/admin/orders/:reference/generate-label", auth.requireAdmin, async (req, res) => {
  const reference = String(req.params.reference || "");
  try {
    const orderRow = db.getOrderByExternalReference(reference);
    if(!orderRow){
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    if(orderRow.status !== "pago"){
      return res.status(409).json({ error: "Só é possível gerar etiqueta para pedidos pagos." });
    }

    const order = {
      items: JSON.parse(orderRow.items_json),
      address: JSON.parse(orderRow.address_json),
      shipping: JSON.parse(orderRow.shipping_json),
    };
    const generated = await purchaseShippingLabel(order);
    const trackingCode = generated?.[0]?.tracking || generated?.tracking || null;
    if(trackingCode){
      db.updateOrderTracking(reference, trackingCode);
    }
    res.json({ ok: true, trackingCode, raw: generated });
  } catch (err) {
    console.error(`Erro ao gerar etiqueta para o pedido ${reference}:`, err);
    res.status(502).json({ error: "Não foi possível gerar a etiqueta agora. Confira as credenciais do Melhor Envio ou gere manualmente no painel deles." });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});