/**
 * =============================================================================
 *  BANCO DE DADOS — usuários, sessões e pedidos
 * =============================================================================
 *  Usa `node:sqlite` (nativo do Node 22.5+, sem dependência externa) em vez de
 *  um ORM ou um banco separado — é um arquivo único (`server/data.db`, fora do
 *  git, ver .gitignore) suficiente para o volume de uma loja pequena/média.
 *
 *  Todas as consultas usam parâmetros (`?`), nunca concatenação de string —
 *  isso é o que elimina a superfície de SQL Injection.
 * =============================================================================
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const crypto = require("crypto");

// ".." porque este arquivo mora em server/lib/ e o banco fica na raiz da
// aplicação (server/), ao lado do server.js — é lá que o data.db já existe
// nas instalações antigas. Em produção o caminho vem do DB_PATH, que aponta
// para fora da pasta publicada, para o banco sobreviver a cada deploy.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Redefinição de senha: mesma ideia da tabela sessions — só o HASH do
  -- token fica gravado, então nem quem lê o banco consegue reconstruir um
  -- link de redefinição válido.
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    external_reference  TEXT NOT NULL UNIQUE,
    user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'pendente',
    items_json          TEXT NOT NULL,
    address_json        TEXT NOT NULL,
    shipping_json       TEXT NOT NULL,
    coupon_code         TEXT,
    subtotal            REAL NOT NULL,
    discount            REAL NOT NULL DEFAULT 0,
    -- Desconto do Pix guardado separado do desconto de cupom: são duas
    -- linhas diferentes no resumo do pedido ("Desconto (CUPOM)" e "Desconto
    -- Pix"), e somar os dois numa coluna só tornaria impossível remontar o
    -- recibo depois.
    pix_discount        REAL NOT NULL DEFAULT 0,
    payment_method      TEXT NOT NULL DEFAULT 'card',
    shipping_price      REAL NOT NULL,
    total               REAL NOT NULL,
    payment_id          TEXT,
    tracking_code       TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );

  -- Edições feitas no painel administrativo (nome/preço/foto) por cima do
  -- catálogo estático em PRODUCTS (server.js). Uma linha por produto só
  -- quando ele foi editado; sem edição, o servidor usa o valor de PRODUCTS
  -- direto (ver effectiveProduct em server.js).
  CREATE TABLE IF NOT EXISTS product_overrides (
    product_id  INTEGER PRIMARY KEY,
    name        TEXT,
    price       REAL,
    photo_url   TEXT,
    category    TEXT,
    badges      TEXT,
    updated_at  INTEGER NOT NULL
  );

  -- Cupons criados pelo painel administrativo. BEMVINDA10 (o único cupom
  -- fixo que existia antes) é semeado aqui automaticamente na primeira
  -- vez que o servidor sobe com um banco novo/antigo sem essa tabela (ver
  -- seedDefaultCoupon logo abaixo) — depois disso, este banco é a única
  -- fonte da verdade pra cupom (nada mais fica hardcoded em server.js).
  -- Quem pediu o cupom de boas-vindas na home. Antes o e-mail só ia para o
  -- console e se perdia — a lista da loja nascia e morria no log.
  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    email      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );

  -- Mensagens do formulário "Vamos criar seu laço?" da home. Antes iam só
  -- para o console: quem escrevesse enquanto o servidor estivesse fora do
  -- ar, ou quando ninguém lesse o log, era simplesmente perdida.
  CREATE TABLE IF NOT EXISTS contact_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT NOT NULL,
    telefone   TEXT NOT NULL,
    ocasiao    TEXT,
    mensagem   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupons (
    code         TEXT PRIMARY KEY,
    percent_off  REAL NOT NULL,
    description  TEXT,
    created_at   INTEGER NOT NULL
  );

  -- Produtos criados pelo painel administrativo (botão "Adicionar produto"),
  -- em vez de editados no catálogo fixo PRODUCTS (server.js). Diferente de
  -- product_overrides (que só sobrepõe nome/preço/foto por cima de uma base
  -- fixa), esta tabela é a base inteira: também guarda peso/dimensões,
  -- porque não existe entrada em PRODUCTS para herdar isso. O id é atribuído
  -- pelo código (ver nextCustomProductId), a partir de 1000, para nunca
  -- colidir com os ids 1-8 do catálogo fixo.
  CREATE TABLE IF NOT EXISTS custom_products (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    price       REAL NOT NULL,
    weight      REAL NOT NULL,
    width       REAL NOT NULL,
    height      REAL NOT NULL,
    length      REAL NOT NULL,
    category    TEXT,
    photo_url   TEXT,
    badges      TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- Categorias criadas pelo painel administrativo (botão "Nova categoria"),
  -- além das 5 fixas em PRODUCT_CATEGORIES (server.js). O slug é o valor
  -- salvo em product_overrides.category/custom_products.category e usado
  -- nos chips de filtro da vitrine; o label é só o texto exibido.
  CREATE TABLE IF NOT EXISTS custom_categories (
    slug        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  /* Índices. Sem eles o SQLite varre a tabela inteira a cada consulta —
     imperceptível com centenas de pedidos, caro com dezenas de milhares.
     Só entram colunas que aparecem de fato em WHERE/ORDER BY das queries
     deste arquivo; índice que ninguém usa não acelera leitura nenhuma e
     ainda encarece toda escrita.

     Não estão aqui, de propósito: as colunas com UNIQUE ou PRIMARY KEY
     (users.email, orders.external_reference, coupons.code,
     sessions.token_hash, ...), porque o SQLite já cria um índice
     implícito para elas — declarar de novo seria duplicar. */
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

  /* Painel filtrando por status e ordenando por data. As duas colunas
     no mesmo índice, nesta ordem: com um índice só de status o SQLite
     achava as linhas mas ainda ordenava tudo à parte (USE TEMP B-TREE);
     incluindo created_at DESC a ordem já sai pronta do índice.

     Não há índice de coupon_code: medindo com 20 mil pedidos, o
     otimizador sempre prefere user_id ou customer_phone na validação de
     cupom (são bem mais seletivos que um código repetido em milhares de
     pedidos). Um índice que nunca é escolhido não acelera leitura e
     encarece toda escrita. */
  CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
  -- Histórico do cliente e listagens sem filtro, do mais recente ao mais antigo.
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
  -- Limpeza de sessões/tokens vencidos (WHERE expires_at < agora).
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_resets_expires ON password_resets(expires_at);
`);

// `orders` já existia (com dados reais) antes da coluna `tracking_code` ser
// criada — `CREATE TABLE IF NOT EXISTS` acima não adiciona colunas a uma
// tabela que já existe, então garantimos aqui, em bancos antigos, do mesmo
// jeito que uma migração faria (nome de tabela/coluna são strings fixas
// definidas neste arquivo, nunca entrada externa, então não há risco de
// injeção no ALTER TABLE abaixo).
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("orders", "tracking_code", "TEXT");
// Pedidos criados antes da forma de pagamento existir são todos de cartão
// (era a única opção), então o DEFAULT já deixa o histórico correto.
ensureColumn("orders", "pix_discount", "REAL NOT NULL DEFAULT 0");
ensureColumn("orders", "payment_method", "TEXT NOT NULL DEFAULT 'card'");
ensureColumn("product_overrides", "category", "TEXT");
ensureColumn("product_overrides", "badges", "TEXT");
// Telefone só com dígitos, copiado do endereço na hora de gravar o pedido.
// É o único identificador que sobra para quem compra sem conta — sem uma
// coluna própria, casar "(61) 98274-9808" com "61982749808" dentro do JSON
// do endereço seria frágil demais para valer como controle de uso de cupom.
ensureColumn("orders", "customer_phone", "TEXT");
// O índice de customer_phone fica AQUI, e não junto dos demais lá em cima:
// a coluna é criada por este ensureColumn, então num banco antigo ela ainda
// não existiria no momento em que o bloco CREATE TABLE roda.
db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);`);
// Cupom de uso único por cliente (ex.: o de boas-vindas). Fica no cupom, e
// não no código, para a loja poder ter os dois tipos.
ensureColumn("coupons", "once_per_customer", "INTEGER NOT NULL DEFAULT 0");
// CEP informado no cadastro (só dígitos), usado para já preencher o frete
// e o endereço no carrinho. Fica nulo para quem criou conta antes disso
// existir — o carrinho simplesmente não pré-preenche nesse caso.
ensureColumn("users", "cep", "TEXT");
// Descadastro da newsletter: token aleatório (mesmo padrão de sessions/
// password_resets) para o link do e-mail funcionar sem exigir login, e
// unsubscribed_at para parar de contar essa inscritа em qualquer envio
// futuro (hoje só o cupom de boas-vindas é enviado, mas a coluna já existe
// para quando houver um segundo envio para a lista).
ensureColumn("newsletter_subscribers", "unsubscribe_token", "TEXT");
ensureColumn("newsletter_subscribers", "unsubscribed_at", "INTEGER");

// Garante que o cupom que já existia fixo no código (BEMVINDA10) continua
// funcionando depois da migração pra banco — só insere se a tabela
// coupons estiver vazia (banco novo, ou banco de antes dessa tabela
// existir), nunca sobrescreve um cupom que a lojista já tenha editado/
// apagado de propósito pelo painel.
function seedDefaultCoupon() {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM coupons`).get();
  if (count === 0) {
    db.prepare(
      `INSERT INTO coupons (code, percent_off, description, created_at, once_per_customer)
       VALUES (?, ?, ?, ?, 1)`
    ).run("BEMVINDA10", 10, "10% de desconto — primeira compra", Date.now());
  }
  // Bancos criados antes da coluna existir têm BEMVINDA10 com o DEFAULT 0.
  // Ele é o cupom de "primeira compra": tem que ser de uso único mesmo em
  // quem já rodava o site antes desta versão.
  db.prepare(`UPDATE coupons SET once_per_customer = 1 WHERE code = 'BEMVINDA10'`).run();
}
seedDefaultCoupon();

/* ---------------------------- USERS ---------------------------- */
const stmtInsertUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, cep, created_at) VALUES (?, ?, ?, ?, ?)`
);
const stmtGetUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const stmtGetUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);

function createUser({ name, email, passwordHash, cep }) {
  const info = stmtInsertUser.run(name, email, passwordHash, cep || null, Date.now());
  return getUserById(Number(info.lastInsertRowid));
}
function getUserByEmail(email) {
  return stmtGetUserByEmail.get(email) || null;
}
function getUserById(id) {
  return stmtGetUserById.get(id) || null;
}

/* --------------------------- SESSIONS --------------------------- */
const stmtInsertSession = db.prepare(
  `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
);
const stmtGetSession = db.prepare(`SELECT * FROM sessions WHERE token_hash = ?`);
const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`);
const stmtDeleteExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);
const stmtDeleteUserSessions = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);

function createSession({ tokenHash, userId, expiresAt }) {
  stmtInsertSession.run(tokenHash, userId, Date.now(), expiresAt);
}
function getSessionByTokenHash(tokenHash) {
  stmtDeleteExpiredSessions.run(Date.now());
  return stmtGetSession.get(tokenHash) || null;
}
function deleteSession(tokenHash) {
  stmtDeleteSession.run(tokenHash);
}
function deleteAllSessionsForUser(userId) {
  stmtDeleteUserSessions.run(userId);
}

/* --------------------- REDEFINIÇÃO DE SENHA --------------------- */
const stmtInsertPasswordReset = db.prepare(
  `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
);
const stmtGetPasswordReset = db.prepare(`SELECT * FROM password_resets WHERE token_hash = ?`);
const stmtDeletePasswordReset = db.prepare(`DELETE FROM password_resets WHERE token_hash = ?`);
const stmtDeleteUserPasswordResets = db.prepare(`DELETE FROM password_resets WHERE user_id = ?`);
const stmtDeleteExpiredPasswordResets = db.prepare(`DELETE FROM password_resets WHERE expires_at < ?`);
const stmtUpdateUserPassword = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`);

function createPasswordReset({ tokenHash, userId, expiresAt }) {
  stmtInsertPasswordReset.run(tokenHash, userId, Date.now(), expiresAt);
}
function getPasswordReset(tokenHash) {
  // Mesmo padrão de getSessionByTokenHash: a limpeza dos expirados acontece
  // na leitura, então não é preciso uma rotina agendada só para isso.
  stmtDeleteExpiredPasswordResets.run(Date.now());
  return stmtGetPasswordReset.get(tokenHash) || null;
}
function deletePasswordReset(tokenHash) {
  stmtDeletePasswordReset.run(tokenHash);
}
function deletePasswordResetsForUser(userId) {
  stmtDeleteUserPasswordResets.run(userId);
}
function updateUserPassword(userId, passwordHash) {
  stmtUpdateUserPassword.run(passwordHash, userId);
}

/* ---------------------------- ORDERS ---------------------------- */
const stmtInsertOrder = db.prepare(`
  INSERT INTO orders (
    external_reference, user_id, status, items_json, address_json, shipping_json,
    coupon_code, subtotal, discount, pix_discount, payment_method,
    shipping_price, total, customer_phone, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtGetOrderByRef = db.prepare(`SELECT * FROM orders WHERE external_reference = ?`);
const stmtUpdateOrderStatus = db.prepare(
  `UPDATE orders SET status = ?, payment_id = ?, updated_at = ? WHERE external_reference = ?`
);
const stmtListOrdersByUser = db.prepare(
  `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`
);
const stmtListAllOrders = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`);
const stmtUpdateOrderTracking = db.prepare(
  `UPDATE orders SET tracking_code = ?, updated_at = ? WHERE external_reference = ?`
);
// "Vendas" = pedidos com pagamento confirmado — pendente/recusado/cancelado
// não contam como venda na Visão Geral do painel administrativo.
const stmtOrderStats = db.prepare(
  `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE status = 'pago'`
);
const stmtDeleteOrder = db.prepare(`DELETE FROM orders WHERE external_reference = ?`);

function createOrder(order) {
  const now = Date.now();
  stmtInsertOrder.run(
    order.externalReference,
    order.userId ?? null,
    order.status ?? "pendente",
    JSON.stringify(order.items),
    JSON.stringify(order.address),
    JSON.stringify(order.shipping),
    order.couponCode ?? null,
    order.subtotal,
    order.discount ?? 0,
    order.pixDiscount ?? 0,
    order.paymentMethod ?? "card",
    order.shippingPrice,
    order.total,
    order.customerPhone ?? null,
    now,
    now
  );
  return getOrderByExternalReference(order.externalReference);
}

/* Já existe pedido PAGO desta cliente usando este cupom?
   Só conta status 'pago' de propósito: um carrinho abandonado (que fica
   'pendente' para sempre) não pode queimar o cupom de quem nunca chegou a
   comprar. `userId` e `phone` são checados em OR — quem comprou logada e
   depois volta sem entrar na conta continua sendo reconhecida pelo
   telefone, e vice-versa. */
const stmtCouponUsedByUser = db.prepare(
  `SELECT 1 FROM orders WHERE coupon_code = ? AND status = 'pago' AND user_id = ? LIMIT 1`
);
const stmtCouponUsedByPhone = db.prepare(
  `SELECT 1 FROM orders WHERE coupon_code = ? AND status = 'pago' AND customer_phone = ? LIMIT 1`
);

function hasUsedCoupon({ code, userId, phone }) {
  if (!code) return false;
  if (userId && stmtCouponUsedByUser.get(code, userId)) return true;
  if (phone && stmtCouponUsedByPhone.get(code, phone)) return true;
  return false;
}
function getOrderByExternalReference(ref) {
  return stmtGetOrderByRef.get(ref) || null;
}
function updateOrderStatus(ref, status, paymentId) {
  stmtUpdateOrderStatus.run(status, paymentId ?? null, Date.now(), ref);
}
function listOrdersByUser(userId) {
  return stmtListOrdersByUser.all(userId);
}
function listAllOrders() {
  return stmtListAllOrders.all();
}
function updateOrderTracking(ref, trackingCode) {
  stmtUpdateOrderTracking.run(trackingCode || null, Date.now(), ref);
  return getOrderByExternalReference(ref);
}
function getOrderStats() {
  return stmtOrderStats.get();
}
// Quem chama decide SE pode apagar (nunca um pedido "pago" — ver checagem
// de status na rota /api/admin/orders/:reference em server.js); esta
// função só executa o DELETE, sem regra de negócio nenhuma, igual ao
// resto deste arquivo.
function deleteOrder(ref) {
  stmtDeleteOrder.run(ref);
}

/* ------------------------- PRODUCT OVERRIDES ------------------------- */
const stmtGetProductOverride = db.prepare(`SELECT * FROM product_overrides WHERE product_id = ?`);
const stmtListProductOverrides = db.prepare(`SELECT * FROM product_overrides`);
const stmtUpsertProductOverride = db.prepare(`
  INSERT INTO product_overrides (product_id, name, price, photo_url, category, badges, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(product_id) DO UPDATE SET
    name = excluded.name, price = excluded.price, photo_url = excluded.photo_url,
    category = excluded.category, badges = excluded.badges, updated_at = excluded.updated_at
`);

function getProductOverride(productId) {
  return stmtGetProductOverride.get(productId) || null;
}
function listProductOverrides() {
  return stmtListProductOverrides.all();
}
// Merge parcial de propósito: `fields` só traz as chaves que o painel
// administrativo realmente alterou (ver PATCH /api/admin/products/:id em
// server.js — payload compacto, não manda o produto inteiro a cada
// edição). Uma chave AUSENTE em `fields` preserva o valor já salvo; só uma
// chave presente com valor vazio ("", null) apaga o override daquele campo
// (volta a usar o padrão de PRODUCTS). Sem esse cuidado, salvar só um selo
// novo apagaria silenciosamente nome/preço/foto já customizados.
function upsertProductOverride(productId, fields) {
  const current = getProductOverride(productId) || {};
  const name = "name" in fields ? (fields.name || null) : (current.name ?? null);
  const price = "price" in fields ? (fields.price ?? null) : (current.price ?? null);
  const photoUrl = "photoUrl" in fields ? (fields.photoUrl || null) : (current.photo_url ?? null);
  const category = "category" in fields ? (fields.category || null) : (current.category ?? null);
  const badges = "badges" in fields
    ? (fields.badges && fields.badges.length ? JSON.stringify(fields.badges) : null)
    : (current.badges ?? null);
  stmtUpsertProductOverride.run(productId, name, price, photoUrl, category, badges, Date.now());
  return getProductOverride(productId);
}

/* ------------------------- CUSTOM PRODUCTS ------------------------- */
const stmtListCustomProducts = db.prepare(`SELECT * FROM custom_products ORDER BY id`);
const stmtGetCustomProduct = db.prepare(`SELECT * FROM custom_products WHERE id = ?`);
const stmtMaxCustomProductId = db.prepare(`SELECT MAX(id) AS maxId FROM custom_products`);
const stmtInsertCustomProduct = db.prepare(`
  INSERT INTO custom_products
    (id, name, price, weight, width, height, length, category, photo_url, badges, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateCustomProduct = db.prepare(`
  UPDATE custom_products SET
    name = ?, price = ?, category = ?, photo_url = ?, badges = ?, updated_at = ?
  WHERE id = ?
`);
const stmtDeleteCustomProduct = db.prepare(`DELETE FROM custom_products WHERE id = ?`);

function listCustomProducts() {
  return stmtListCustomProducts.all();
}
function getCustomProduct(id) {
  return stmtGetCustomProduct.get(id) || null;
}
// ids >= CUSTOM_PRODUCT_ID_START (server.js) — nunca reaproveita um id
// apagado, então o histórico de pedidos antigos continua apontando para o
// produto certo mesmo que ele não exista mais no catálogo hoje.
function nextCustomProductId(startAt) {
  const { maxId } = stmtMaxCustomProductId.get();
  return Math.max(startAt - 1, maxId || 0) + 1;
}
function insertCustomProduct({ startAt, name, price, weight, width, height, length, category, badges }) {
  const id = nextCustomProductId(startAt);
  const now = Date.now();
  stmtInsertCustomProduct.run(
    id, name, price, weight, width, height, length, category || null, null,
    badges && badges.length ? JSON.stringify(badges) : null, now, now
  );
  return getCustomProduct(id);
}
// Mesmo racional parcial de upsertProductOverride: só grava as chaves
// presentes em `fields`, preservando as demais. Diferente dele, exige que o
// produto já exista — não há "base" para criar um registro do zero aqui.
function updateCustomProduct(id, fields) {
  const current = getCustomProduct(id);
  if (!current) return null;
  const name = "name" in fields ? fields.name : current.name;
  const price = "price" in fields ? fields.price : current.price;
  const category = "category" in fields ? (fields.category || null) : current.category;
  const photoUrl = "photoUrl" in fields ? (fields.photoUrl || null) : current.photo_url;
  const badges = "badges" in fields
    ? (fields.badges && fields.badges.length ? JSON.stringify(fields.badges) : null)
    : current.badges;
  stmtUpdateCustomProduct.run(name, price, category, photoUrl, badges, Date.now(), id);
  return getCustomProduct(id);
}
// Não apaga a foto em disco — quem chama (server.js) já leu photo_url ANTES
// de chamar isto, e cuida do arquivo separado, do mesmo jeito que o PATCH
// de troca de foto já faz (deleteOldLocalPhoto). Pedidos antigos que
// referenciam este id continuam funcionando: effectiveProduct() devolve
// null e quem monta nome/preço para exibição já trata isso com um
// "Produto #<id>" de reserva (ver server.js).
function deleteCustomProduct(id) {
  stmtDeleteCustomProduct.run(id);
}

/* ------------------------- CUSTOM CATEGORIES ------------------------- */
const stmtListCustomCategories = db.prepare(`SELECT * FROM custom_categories ORDER BY created_at`);
const stmtInsertCustomCategory = db.prepare(
  `INSERT INTO custom_categories (slug, label, created_at) VALUES (?, ?, ?)`
);

function listCustomCategories() {
  return stmtListCustomCategories.all();
}
function insertCustomCategory({ slug, label }) {
  stmtInsertCustomCategory.run(slug, label, Date.now());
  return { slug, label };
}

/* ------------------------------ COUPONS ------------------------------ */
/* ------------------------- NEWSLETTER ------------------------- */
// OR IGNORE: pedir o cupom de novo com o mesmo e-mail não é erro — só não
// duplica a linha (e a data original de inscrição é preservada).
const stmtInsertSubscriber = db.prepare(
  `INSERT OR IGNORE INTO newsletter_subscribers (email, created_at) VALUES (?, ?)`
);
const stmtListSubscribers = db.prepare(
  `SELECT * FROM newsletter_subscribers ORDER BY created_at DESC`
);

function addNewsletterSubscriber(email) {
  stmtInsertSubscriber.run(email, Date.now());
}
function listNewsletterSubscribers() {
  return stmtListSubscribers.all();
}

// Gera (ou reaproveita) o token de descadastro de uma inscrita, para colocar
// no link "List-Unsubscribe" do e-mail. Preso ao e-mail em vez de à data de
// inscrição — assim continua válido mesmo que o e-mail seja enviado de novo.
const stmtGetSubscriberToken = db.prepare(
  `SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = ?`
);
const stmtSetSubscriberToken = db.prepare(
  `UPDATE newsletter_subscribers SET unsubscribe_token = ? WHERE email = ?`
);
function getOrCreateUnsubscribeToken(email) {
  const existing = stmtGetSubscriberToken.get(email)?.unsubscribe_token;
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString("hex");
  stmtSetSubscriberToken.run(token, email);
  return token;
}

// Confere o token do link/POST de descadastro e marca unsubscribed_at.
// Comparação em tempo constante (mesmo padrão de auth.js) — não é um dado
// sigiloso como senha, mas evita que alguém descubra o token por tentativa.
const stmtMarkUnsubscribed = db.prepare(
  `UPDATE newsletter_subscribers SET unsubscribed_at = ? WHERE email = ?`
);
function unsubscribeNewsletter(email, token) {
  const stored = stmtGetSubscriberToken.get(email)?.unsubscribe_token;
  if (!stored || !token) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  stmtMarkUnsubscribed.run(Date.now(), email);
  return true;
}

/* ---------------------- CONTATOS ---------------------- */
const stmtInsertContactMessage = db.prepare(
  `INSERT INTO contact_messages (nome, telefone, ocasiao, mensagem, created_at)
   VALUES (?, ?, ?, ?, ?)`
);
const stmtListContactMessages = db.prepare(
  `SELECT * FROM contact_messages ORDER BY created_at DESC`
);
const stmtGetContactMessage = db.prepare(`SELECT * FROM contact_messages WHERE id = ?`);
const stmtDeleteContactMessage = db.prepare(`DELETE FROM contact_messages WHERE id = ?`);

function createContactMessage({ nome, telefone, ocasiao, mensagem }) {
  stmtInsertContactMessage.run(nome, telefone, ocasiao || null, mensagem, Date.now());
}
function listContactMessages() {
  return stmtListContactMessages.all();
}
function getContactMessage(id) {
  return stmtGetContactMessage.get(id) || null;
}
function deleteContactMessage(id) {
  stmtDeleteContactMessage.run(id);
}

/* -------------------------- CUPONS -------------------------- */
const stmtGetCoupon = db.prepare(`SELECT * FROM coupons WHERE code = ?`);
const stmtListCoupons = db.prepare(`SELECT * FROM coupons ORDER BY created_at DESC`);
const stmtInsertCoupon = db.prepare(
  `INSERT INTO coupons (code, percent_off, description, created_at) VALUES (?, ?, ?, ?)`
);
const stmtDeleteCoupon = db.prepare(`DELETE FROM coupons WHERE code = ?`);

function getCoupon(code) {
  return stmtGetCoupon.get(code) || null;
}
function listCoupons() {
  return stmtListCoupons.all();
}
function createCoupon({ code, percentOff, description }) {
  stmtInsertCoupon.run(code, percentOff, description ?? null, Date.now());
  return getCoupon(code);
}
function deleteCoupon(code) {
  stmtDeleteCoupon.run(code);
}

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  createSession,
  getSessionByTokenHash,
  deleteSession,
  deleteAllSessionsForUser,
  createPasswordReset,
  getPasswordReset,
  deletePasswordReset,
  deletePasswordResetsForUser,
  updateUserPassword,
  createOrder,
  getOrderByExternalReference,
  updateOrderStatus,
  listOrdersByUser,
  listAllOrders,
  updateOrderTracking,
  getOrderStats,
  deleteOrder,
  hasUsedCoupon,
  // getProductOverride não é exportada de propósito: ninguém fora daqui lê
  // um override isolado — quem consome sempre quer o mapa inteiro
  // (listProductOverrides) para montar o catálogo de uma vez.
  listProductOverrides,
  upsertProductOverride,
  listCustomProducts,
  getCustomProduct,
  insertCustomProduct,
  updateCustomProduct,
  deleteCustomProduct,
  listCustomCategories,
  insertCustomCategory,
  addNewsletterSubscriber,
  listNewsletterSubscribers,
  getOrCreateUnsubscribeToken,
  unsubscribeNewsletter,
  createContactMessage,
  listContactMessages,
  getContactMessage,
  deleteContactMessage,
  getCoupon,
  listCoupons,
  createCoupon,
  deleteCoupon,
};
