/**
 * =============================================================================
 *  RESTAURAÇÃO DE BACKUP CRIPTOGRAFADO — descriptografa e verifica integridade
 * =============================================================================
 *  Uso:
 *      cd server && node scripts/restore-db.js <arquivo.db.enc> [destino.db] [--force]
 *
 *  Exemplos:
 *      # descriptografa para server/data.restored.db e confere se está íntegro
 *      node scripts/restore-db.js backups/data-2026-08-21-03-00-00.db.enc
 *
 *      # restaura por cima do banco de produção (CUIDADO — exige --force)
 *      node scripts/restore-db.js backups/ultimo.db.enc data.db --force
 *
 *  O que faz:
 *    1. Descriptografa o .enc com BACKUP_ENCRYPTION_KEY (AES-256-GCM). Se a
 *       chave estiver errada ou o arquivo tiver sido adulterado, o authTag não
 *       confere e a restauração é abortada (nada é escrito).
 *    2. Grava o banco no destino. Por segurança, RECUSA sobrescrever um arquivo
 *       que já existe, a menos que venha --force (protege o data.db de produção
 *       contra sobrescrita acidental).
 *    3. Abre o banco restaurado e roda PRAGMA integrity_check + conta linhas
 *       de algumas tabelas, para confirmar que o backup é utilizável ANTES de
 *       você precisar dele de verdade.
 *
 *  Faça um teste de restauração periódico (ex.: mensal) para um destino
 *  descartável — um backup nunca testado não é um backup.
 * =============================================================================
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function loadKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) throw new Error("BACKUP_ENCRYPTION_KEY não definida — é a mesma chave usada no backup.");
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`BACKUP_ENCRYPTION_KEY precisa ter 32 bytes (tem ${key.length}).`);
  return key;
}

function decryptFile(srcPath, key) {
  const blob = fs.readFileSync(srcPath);
  if (blob.length < 12 + 16 + 1) throw new Error("Arquivo de backup muito curto ou corrompido.");
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  // Se a chave/arquivo estiverem errados, .final() lança — e nada é gravado.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function verifyDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    const result = integrity.integrity_check || Object.values(integrity)[0];
    const tables = ["users", "orders", "contact_messages"];
    const counts = {};
    for (const t of tables) {
      try { counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
      catch { counts[t] = "(tabela ausente)"; }
    }
    return { integrity: result, counts };
  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter(a => a !== "--force");
  const srcPath = positional[0];
  const destPath = positional[1] || path.join(__dirname, "..", "data.restored.db");

  if (!srcPath) {
    throw new Error("Informe o arquivo .db.enc.\nUso: node scripts/restore-db.js <arquivo.db.enc> [destino.db] [--force]");
  }
  if (!fs.existsSync(srcPath)) throw new Error(`Arquivo não encontrado: ${srcPath}`);
  if (fs.existsSync(destPath) && !force) {
    throw new Error(`Destino já existe: ${destPath}\nUse outro caminho, ou --force para sobrescrever de propósito.`);
  }

  const key = loadKey();
  const plaintext = decryptFile(srcPath, key); // lança se adulterado/chave errada
  fs.writeFileSync(destPath, plaintext);

  const { integrity, counts } = verifyDatabase(destPath);
  const ok = integrity === "ok";
  console.log(`${ok ? "✅" : "⚠️ "} Restaurado em: ${destPath}`);
  console.log(`   integrity_check: ${integrity}`);
  console.log(`   linhas: users=${counts.users}, orders=${counts.orders}, contact_messages=${counts.contact_messages}`);
  if (!ok) process.exit(2);
}

try {
  main();
} catch (err) {
  console.error("❌ Falha na restauração:", err.message);
  process.exit(1);
}
