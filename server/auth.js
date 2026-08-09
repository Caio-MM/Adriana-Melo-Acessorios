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
  // 72 bytes é o limite efetivo do bcrypt; truncar silenciosamente seria
  // uma falha sutil de segurança, então rejeitamos senhas maiores.
  return typeof v === "string" && v.length >= 8 && v.length <= 72;
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

function getUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = db.getSessionByTokenHash(hashToken(token));
  if (!session) return null;
  const user = db.getUserById(session.user_id);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email };
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
};
