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

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");
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
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
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

/* ---------------------------- USERS ---------------------------- */
const stmtInsertUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)`
);
const stmtGetUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const stmtGetUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);

function createUser({ name, email, passwordHash }) {
  const info = stmtInsertUser.run(name, email, passwordHash, Date.now());
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

/* ---------------------------- ORDERS ---------------------------- */
const stmtInsertOrder = db.prepare(`
  INSERT INTO orders (
    external_reference, user_id, status, items_json, address_json, shipping_json,
    coupon_code, subtotal, discount, shipping_price, total, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    order.shippingPrice,
    order.total,
    now,
    now
  );
  return getOrderByExternalReference(order.externalReference);
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

/* ------------------------- PRODUCT OVERRIDES ------------------------- */
const stmtGetProductOverride = db.prepare(`SELECT * FROM product_overrides WHERE product_id = ?`);
const stmtListProductOverrides = db.prepare(`SELECT * FROM product_overrides`);
const stmtUpsertProductOverride = db.prepare(`
  INSERT INTO product_overrides (product_id, name, price, photo_url, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(product_id) DO UPDATE SET
    name = excluded.name, price = excluded.price, photo_url = excluded.photo_url, updated_at = excluded.updated_at
`);

function getProductOverride(productId) {
  return stmtGetProductOverride.get(productId) || null;
}
function listProductOverrides() {
  return stmtListProductOverrides.all();
}
function upsertProductOverride(productId, { name, price, photoUrl }) {
  stmtUpsertProductOverride.run(productId, name ?? null, price ?? null, photoUrl ?? null, Date.now());
  return getProductOverride(productId);
}

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  createSession,
  getSessionByTokenHash,
  deleteSession,
  deleteAllSessionsForUser,
  createOrder,
  getOrderByExternalReference,
  updateOrderStatus,
  listOrdersByUser,
  listAllOrders,
  updateOrderTracking,
  getOrderStats,
  getProductOverride,
  listProductOverrides,
  upsertProductOverride,
};
