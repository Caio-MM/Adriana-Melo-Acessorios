/**
 * =============================================================================
 *  AUTENTICAÇÃO — hashing de senha, sessões e validação de entrada
 * =============================================================================
 *  Decisões de segurança (por quê):
 *  - Sessão por cookie httpOnly (não JWT em localStorage): um JWT guardado em
 *    localStorage pode ser lido por qualquer script — inclusive um script
 *    injetado por XSS — e roubado. Um cookie httpOnly não pode ser lido por
 *    JavaScript, só é enviado automaticamente pelo navegador para o servidor.
 *  - O token de sessão é aleatório (crypto.randomBytes) e só o HASH dele fica
 *    no banco — se o arquivo do banco vazar, os tokens de sessão de verdade
 *    não podem ser reconstruídos a partir do que foi vazado.
 *  - Senhas usam bcrypt (custo 12): lento de propósito, torna ataques de
 *    força bruta/rainbow table inviáveis mesmo se o hash vazar.
 *  - Mensagens de erro de login são genéricas ("e-mail ou senha inválidos")
 *    para não revelar se um e-mail existe ou não (evita enumeração de contas).
 * =============================================================================
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");

const SESSION_COOKIE_NAME = "plc_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const BCRYPT_COST = 12;

// Usado para comparar contra quando o e-mail informado não existe, mantendo
// o tempo de resposta do login parecido nos dois casos (mitiga enumeração
// de contas por análise de tempo de resposta).
const DUMMY_HASH = bcrypt.hashSync("senha-de-referencia-para-tempo-constante", BCRYPT_COST);

/* ------------------------------ SENHAS ------------------------------ */
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash || DUMMY_HASH);
}

/* ------------------------------ VALIDAÇÃO ------------------------------ */
function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}
function isValidPassword(v) {
  // 72 BYTES (não caracteres) é o limite efetivo do bcrypt — acima disso ele
  // trunca silenciosamente, o que seria uma falha sutil de segurança. Por
  // isso medimos Buffer.byteLength em vez de v.length: uma senha com
  // acentos/emoji pode ter 72 *caracteres* e passar de 72 bytes em UTF-8
  // (ex.: "á" = 2 bytes), e v.length não pegaria isso.
  return typeof v === "string" && v.length >= 8 && Buffer.byteLength(v, "utf8") <= 72;
}
function isValidName(v) {
  return typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 120;
}

/* ------------------------------ COOKIES ------------------------------ */
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  });
  return out;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/* ------------------------------ SESSÕES ------------------------------ */
function issueSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.createSession({
    tokenHash: hashToken(token),
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
}

function clearSession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) db.deleteSession(hashToken(token));
  res.clearCookie(SESSION_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/* ------------------------------ ADMIN ------------------------------ */
// Não existe uma tabela/coluna "role": o acesso de administrador é dado por
// e-mail, via ADMIN_EMAIL_HASHES no .env (lista de hashes SHA-256,
// separados por vírgula — nunca o e-mail em texto puro). Isso evita uma
// migração de schema e uma tela de "promover usuário a admin" — quem tem
// acesso ao .env do servidor já é, por definição, de confiança.
//
// Por que hash em vez do e-mail direto: se o .env vazar por engano (log,
// captura de tela, backup mal guardado), quem ler não descobre de cara
// qual é o e-mail com acesso de admin — só um hash. Isso NÃO é o que
// impede um cliente comum de virar admin mexendo no DevTools (isso já é
// impossível por construção: o cookie de sessão é um token aleatório
// opaco, sem papel/role nenhum embutido, e o servidor recalcula
// isAdminEmail() a cada requisição a partir da sessão — nunca confia em
// nada que o navegador declare sobre si mesmo). O hash é uma camada a
// mais, especificamente contra vazamento do próprio arquivo .env.
function hashEmail(email) {
  return crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");
}
function isAdminEmail(email) {
  if (!email) return false;
  const candidate = Buffer.from(hashEmail(email), "hex");
  const adminHashes = String(process.env.ADMIN_EMAIL_HASHES || "")
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
  // timingSafeEqual em vez de === / includes(): evita que o tempo de
  // resposta vaze informação sobre quantos bytes do hash bateram (mesmo
  // racional do DUMMY_HASH usado no login, acima).
  return adminHashes.some(stored => {
    const storedBuf = Buffer.from(stored, "hex");
    return storedBuf.length === candidate.length && crypto.timingSafeEqual(storedBuf, candidate);
  });
}

function getUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = db.getSessionByTokenHash(hashToken(token));
  if (!session) return null;
  const user = db.getUserById(session.user_id);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, isAdmin: isAdminEmail(user.email) };
}

/* ------------------------------ MIDDLEWARES ------------------------------ */
function attachUser(req, res, next) {
  req.user = getUserFromRequest(req);
  next();
}
function requireAuth(req, res, next) {
  req.user = getUserFromRequest(req);
  if (!req.user) {
    return res.status(401).json({ error: "Faça login para continuar." });
  }
  next();
}
// Painel administrativo e suas rotas de API (/api/admin/*): exige sessão
// válida E e-mail com hash cadastrado em ADMIN_EMAIL_HASHES. Resposta
// genérica 403 (não revela se a rota existiria para outro usuário).
function requireAdmin(req, res, next) {
  req.user = getUserFromRequest(req);
  if (!req.user) {
    return res.status(401).json({ error: "Faça login para continuar." });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: "Acesso restrito ao administrador da loja." });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  isValidEmail,
  normalizeEmail,
  isValidPassword,
  isValidName,
  issueSession,
  clearSession,
  attachUser,
  requireAuth,
  requireAdmin,
};
