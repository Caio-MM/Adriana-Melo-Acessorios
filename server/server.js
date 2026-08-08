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

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app = express();
const PORT = process.env.PORT || 3333;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5500";

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
  1: { name:"Laço Bailarina",        price:34.90, weight:0.05, width:16, height:2, length:11 },
  2: { name:"Laço Duquesa",          price:49.90, weight:0.08, width:16, height:3, length:11 },
  3: { name:"Laço Recém-nascida",    price:29.90, weight:0.04, width:16, height:2, length:11 },
  4: { name:"Laço Pérola",           price:59.90, weight:0.08, width:16, height:3, length:11 },
  5: { name:"Laço Borboleta",        price:44.90, weight:0.06, width:16, height:2, length:11 },
  6: { name:"Kit Presente 3 Laços",  price:89.90, weight:0.20, width:20, height:6, length:15 },
  7: { name:"Laço Tiara Flor",       price:39.90, weight:0.07, width:16, height:3, length:11 },
  8: { name:"Laço Personalizado",    price:64.90, weight:0.08, width:16, height:3, length:11 },
};

/* Dimensões mínimas aceitas pelos Correios/transportadoras — nunca cotar
   abaixo disso, mesmo que o produto seja minúsculo. */
const MIN_PACKAGE = { weight:0.1, width:16, height:2, length:11 };

/* -------------------------- MIDDLEWARES DE SEGURANÇA -------------------------- */
app.use(helmet());                         // cabeçalhos HTTP de segurança (CSP, HSTS, X-Content-Type-Options, etc.)
app.use(cors({ origin: CLIENT_ORIGIN }));   // só o seu site pode chamar esta API
app.use(express.json({ limit: "50kb" }));   // corpo pequeno: evita payloads gigantes (DoS simples)

// Limite geral: 100 requisições / 15 min por IP
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Limite mais rígido para rotas sensíveis (evita spam/força bruta)
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

/* =========================================================================
   Validação e montagem de itens a partir do que o CLIENTE enviou.
   Nunca usa preço/peso vindos do navegador — sempre busca em PRODUCTS.
========================================================================= */
function buildValidatedItems(items){
  if(!Array.isArray(items) || items.length === 0){
    throw { status:400, message:"Carrinho vazio ou inválido." };
  }
  if(items.length > 50){
    throw { status:400, message:"Carrinho excede o limite de itens." };
  }
  return items.map(raw => {
    const id = Number(raw?.id);
    const qty = Number(raw?.qty);
    if(!Number.isInteger(id) || !PRODUCTS[id]){
      throw { status:400, message:`Produto inválido: ${raw?.id}` };
    }
    if(!Number.isInteger(qty) || qty < 1 || qty > 10){
      throw { status:400, message:`Quantidade inválida para o produto ${id}.` };
    }
    return { id, qty, product: PRODUCTS[id] };
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
    if(err.status && err.message){
      console.error("Erro de validação/frete:", err.message);
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Erro ao calcular frete:", err);
    res.status(502).json({ error: "Não foi possível calcular o frete agora. Tente novamente em instantes." });
  }
});

/* =========================================================================
   POST /api/create-preference
   -------------------------------------------------------------------------
   Recebe { items: [{id, qty}], cep, shipping_service_id, address } do
   front-end — SEM preço de produto, SEM preço de frete. O servidor:
     1) recalcula os itens a partir de PRODUCTS;
     2) recalcula o frete de novo junto ao Melhor Envio e confirma que
        `shipping_service_id` ainda é uma opção válida para esse pedido
        (nunca confia no preço de frete que o navegador mostrou);
     3) guarda o pedido (itens + endereço + frete escolhido) para uso no
        webhook, quando o pagamento for confirmado;
     4) cria a preferência no Mercado Pago com o frete somado como um
        item da compra.
========================================================================= */

/* Guardar pedidos "pendentes de pagamento" em memória é só para este
   exemplo funcionar sem banco de dados. Em produção, troque este Map por
   uma tabela `orders` de verdade — um restart do servidor aqui perde os
   pedidos que ainda não foram pagos. */
const pendingOrders = new Map(); // external_reference -> { items, address, shipping, cep }

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
    const requiredAddress = ["nome","telefone","rua","numero","bairro","cidade","uf"];
    if(!address || requiredAddress.some(f => !String(address[f] || "").trim())){
      return res.status(400).json({ error: "Endereço de entrega incompleto." });
    }

    const validatedItems = buildValidatedItems(req.body?.items);

    const preferenceItems = validatedItems.map(({ id, qty, product }) => ({
      id: String(id),
      title: product.name,
      quantity: qty,
      unit_price: product.price,   // <- preço vem do servidor, não do cliente
      currency_id: "BRL",
    }));

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
    pendingOrders.set(orderRef, {
      items: validatedItems.map(({ id, qty }) => ({ id, qty })),
      address,
      cep,
      shipping: chosenShipping,
      createdAt: Date.now(),
    });

    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: preferenceItems,
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

    // init_point = link de pagamento (Checkout Pro) para redirecionar o cliente
    res.json({ id: result.id, init_point: result.init_point });
  } catch (err) {
    if(err.status && err.message){
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

  const items = order.items.map(({ id, qty }) => {
    const p = PRODUCTS[id];
    return { name: p.name, quantity: qty, unitary_value: p.price };
  });
  const pkg = buildPackage(order.items.map(({ id, qty }) => ({ qty, product: PRODUCTS[id] })));

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
        postal_code: order.cep,
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
app.post("/api/webhook", async (req, res) => {
  try {
    const paymentId = req.query?.["data.id"] || req.body?.data?.id;
    const topic = req.query?.type || req.body?.type;

    if (topic === "payment" && paymentId) {
      const payment = new Payment(mpClient);
      const info = await payment.get({ id: paymentId });
      console.log(`Webhook recebido — pagamento ${paymentId}: ${info.status}`);

      if(info.status === "approved"){
        const order = pendingOrders.get(info.external_reference);
        // TODO: em produção, isto deveria vir de um banco de dados
        // (marcar o pedido como pago, salvar o payment_id etc.), não só
        // deste Map em memória.

        if(order && process.env.AUTO_PURCHASE_SHIPPING_LABEL === "true"){
          try{
            const label = await purchaseShippingLabel(order);
            console.log("Etiqueta de envio comprada:", label);
            // TODO: salvar o código de rastreio e enviar por e-mail/WhatsApp ao cliente.
          }catch(labelErr){
            console.error("Falha ao comprar etiqueta automaticamente (pedido ficou pago, mas sem etiqueta — gere manualmente no painel do Melhor Envio):", labelErr);
          }
        } else if(order){
          console.log("Pagamento aprovado. Gere a etiqueta manualmente no painel do Melhor Envio para o pedido:", order);
        }

        pendingOrders.delete(info.external_reference);
      }
    }

    // Responder 200 rápido é importante: o Mercado Pago reenvia se não receber OK.
    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

/* =========================================================================
   POST /api/contact e /api/newsletter — exemplos de validação server-side.
   O front-end já valida (main.js), mas isso NUNCA é suficiente sozinho:
   qualquer pessoa pode chamar a API diretamente (curl/Postman) pulando o
   HTML. Por isso validamos e limitamos tudo de novo aqui.
========================================================================= */
function isValidEmail(v){ return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254; }

app.post("/api/newsletter", strictLimiter, (req, res) => {
  const email = (req.body?.email || "").trim();
  if(!isValidEmail(email)){
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

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});