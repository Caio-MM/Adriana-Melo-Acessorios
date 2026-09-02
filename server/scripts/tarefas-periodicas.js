/**
 * =============================================================================
 *  TAREFAS PERIÓDICAS — reenvio da fila de e-mail
 * =============================================================================
 *  Uso:
 *      cd server && node scripts/tarefas-periodicas.js
 *
 *  Na Hostinger, agendar no cron do hPanel a cada 15 minutos (mesmo lugar
 *  onde já roda o backup-db.js):
 *      cd ~/.../server && /usr/bin/node scripts/tarefas-periodicas.js
 *
 *  POR QUE CRON, E NÃO setInterval DENTRO DO SERVIDOR
 *  --------------------------------------------------------------------------
 *  O Passenger (que serve o app na Hostinger) hiberna o processo web quando
 *  não há visitas e o reinicia na próxima requisição. Um setInterval, ali,
 *  dispara em horários imprevisíveis — e duplica se o Passenger subir mais de
 *  um worker. O cron do sistema roda sempre, uma vez só, mesmo com o site
 *  parado. O backup do banco já é feito assim.
 *
 *  O QUE FAZ
 *  --------------------------------------------------------------------------
 *  Reenvia os e-mails de cliente que ficaram na fila (lib/db.js, tabela
 *  email_outbox) porque a tentativa na hora do pedido falhou — SMTP fora do
 *  ar, credencial vencida, caixa cheia. Cada falha aumenta a espera até a
 *  próxima tentativa (5min, 15, 45, 2h15, 6h45) e desiste após 5 tentativas,
 *  deixando o erro gravado em last_error para investigação.
 */
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const db = require("../lib/db.js");
const email = require("../lib/email.js");

const LOTE = 20;

async function reenviarFilaDeEmail(){
  const pendentes = db.pendingEmails(LOTE);
  if(!pendentes.length){
    console.log("Fila de e-mail vazia — nada a reenviar.");
    return { enviados: 0, falhas: 0 };
  }

  let enviados = 0;
  let falhas = 0;
  for(const linha of pendentes){
    try{
      await email.sendEmail({
        to: linha.to_email,
        subject: linha.subject,
        text: linha.text_body,
        html: linha.html_body,
      });
      db.markEmailSent(linha.id);
      enviados++;
      console.log(`  ✓ ${linha.kind} → ${linha.to_email} (pedido ${linha.order_reference || "-"})`);
    }catch(err){
      db.markEmailFailed(linha.id, err.message || err);
      falhas++;
      console.error(`  ✗ ${linha.kind} → ${linha.to_email}: ${err.message || err}`);
    }
  }
  console.log(`Fila de e-mail: ${enviados} enviado(s), ${falhas} falha(s), ${pendentes.length} tentado(s).`);
  return { enviados, falhas };
}

async function main(){
  await reenviarFilaDeEmail();
}

if(require.main === module){
  main().catch(err => {
    console.error("Erro nas tarefas periódicas:", err);
    process.exit(1);
  });
}

module.exports = { reenviarFilaDeEmail };
