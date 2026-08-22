/**
 * =============================================================================
 *  BACKUP CRIPTOGRAFADO DO BANCO — snapshot consistente + AES-256-GCM
 * =============================================================================
 *  Uso:
 *      cd server && node scripts/backup-db.js
 *
 *  O que faz:
 *    1. Tira um snapshot CONSISTENTE do banco com `VACUUM INTO` — funciona
 *       mesmo com o servidor no ar (modo WAL), sem copiar um arquivo pela
 *       metade.
 *    2. Criptografa o snapshot com AES-256-GCM (confidencialidade + verificação
 *       de integridade embutida no authTag) usando BACKUP_ENCRYPTION_KEY.
 *    3. Salva em BACKUP_DIR (padrão: server/backups) como
 *       data-AAAAMMDD-HHMMSS.db.enc e apaga o snapshot em texto puro.
 *    4. Remove backups com mais de BACKUP_RETENTION_DAYS (padrão: 30) dias.
 *
 *  Variáveis de ambiente (no server/.env ou no ambiente do cron):
 *    BACKUP_ENCRYPTION_KEY  (obrigatória) 32 bytes em hex (64 chars) ou base64.
 *        Gere uma com:
 *          node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *        Guarde-a FORA do servidor (senão quem invadir o servidor lê a chave
 *        e o backup junto). Sem ela, restaurar é impossível — não perca.
 *    DB_PATH                (opcional) caminho do banco; padrão server/data.db.
 *    BACKUP_DIR             (opcional) pasta de saída; padrão server/backups.
 *    BACKUP_RETENTION_DAYS  (opcional) dias a manter; padrão 30.
 *
 *  Formato do arquivo .enc:  [IV 12 bytes][authTag 16 bytes][ciphertext]
 *
 *  Agendamento (exemplo de cron diário às 3h, no hPanel da Hostinger):
 *      0 3 * * *  cd /caminho/para/server && node scripts/backup-db.js
 *  O script sai com código != 0 em caso de erro, então um MAILTO no cron já
 *  serve de alerta de falha.
 * =============================================================================
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.db");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);

// Aceita a chave em hex (64 chars) ou base64; exige exatamente 32 bytes.
function loadKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY não definida. Gere uma com:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`BACKUP_ENCRYPTION_KEY precisa ter 32 bytes (tem ${key.length}). Use 64 chars hex ou base64 de 32 bytes.`);
  }
  return key;
}

// AAAA-MM-DD-HH-MM-SS no fuso de Brasília, para nome de arquivo ordenável.
function stamp() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date());
  return parts.replace(/[ :]/g, "-"); // "2026-08-21 03:00:00" -> "2026-08-21-03-00-00"
}

function makeConsistentSnapshot(tmpPath) {
  // VACUUM INTO exige uma string literal (não aceita parâmetro `?`). O caminho
  // é gerado por este script (não é entrada externa); ainda assim escapamos
  // aspas simples por segurança.
  const safe = tmpPath.replace(/'/g, "''");
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec(`VACUUM INTO '${safe}'`);
  } finally {
    db.close();
  }
}

function encryptFile(srcPath, destPath, key) {
  const plaintext = fs.readFileSync(srcPath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fs.writeFileSync(destPath, Buffer.concat([iv, authTag, ciphertext]));
}

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.endsWith(".db.enc")) continue;
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  return removed;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Banco não encontrado em ${DB_PATH}.`);
  }
  const key = loadKey();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const s = stamp();
  const tmpPath = path.join(BACKUP_DIR, `.tmp-snapshot-${s}.db`);
  const destPath = path.join(BACKUP_DIR, `data-${s}.db.enc`);

  try {
    makeConsistentSnapshot(tmpPath);
    encryptFile(tmpPath, destPath, key);
  } finally {
    // O snapshot em texto puro nunca pode sobrar em disco.
    try { fs.unlinkSync(tmpPath); } catch {}
  }

  const size = fs.statSync(destPath).size;
  const removed = pruneOldBackups();
  console.log(`✅ Backup criado: ${destPath} (${(size / 1024).toFixed(1)} KB)`);
  console.log(`   Retenção: mantidos os últimos ${RETENTION_DAYS} dias${removed ? `, ${removed} antigo(s) removido(s)` : ""}.`);
}

try {
  main();
} catch (err) {
  console.error("❌ Falha no backup:", err.message);
  process.exit(1);
}
