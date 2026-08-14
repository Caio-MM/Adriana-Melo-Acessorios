/**
 * =============================================================================
 *  TESTE DE ENVIO DE E-MAIL — checa se o SMTP do .env está funcionando
 * =============================================================================
 *  Uso:
 *      cd server && node testar-email.js
 *
 *  Envia um e-mail de teste para OWNER_EMAIL usando exatamente as mesmas
 *  credenciais e o mesmo caminho de código que o site usa em produção
 *  (server/email.js → sendEmail), então se passar aqui, passa lá.
 *
 *  Não toca no banco, não sobe servidor e não usa nenhuma credencial de
 *  pagamento — só o bloco SMTP_* do .env.
 * =============================================================================
 */
require("dotenv").config();
const { sendEmail } = require("./email");

const REQUIRED = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];

(async () => {
  const missing = REQUIRED.filter(key => !process.env[key]);
  if (missing.length) {
    console.error(`\n❌ Faltando no server/.env: ${missing.join(", ")}`);
    if (missing.includes("SMTP_PASS")) {
      console.error(
        "\n   SMTP_PASS é a 'senha de app' de 16 letras gerada em\n" +
        "   https://myaccount.google.com/apppasswords (precisa de verificação\n" +
        "   em duas etapas ativada). A senha normal do Gmail não funciona."
      );
    }
    process.exit(1);
  }

  const to = process.env.OWNER_EMAIL;
  if (!to) {
    console.error("\n❌ OWNER_EMAIL não definido no server/.env — sem destinatário para o teste.");
    process.exit(1);
  }

  console.log(`\nEnviando e-mail de teste...`);
  console.log(`  de:   ${process.env.SMTP_FROM || process.env.SMTP_USER}`);
  console.log(`  para: ${to}`);
  console.log(`  via:  ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}\n`);

  try {
    await sendEmail({
      to,
      subject: "🎀 Teste de configuração de e-mail",
      text: "Se você está lendo isto, o SMTP do site está configurado corretamente.",
      html: '<div style="font-family:Arial,Helvetica,sans-serif;color:#3a2230">'
          + '<h2 style="color:#c05480">🎀 Deu certo!</h2>'
          + "<p>Se você está lendo isto, o SMTP do site está configurado corretamente.</p>"
          + "<p>Os avisos de pedido pago e os links de redefinição de senha já vão chegar normalmente.</p>"
          + "</div>",
    });
    console.log("✅ E-mail enviado. Confira a caixa de entrada (e o spam, na primeira vez).\n");
  } catch (err) {
    console.error(`❌ Falhou: ${err.message}\n`);
    // As duas causas que respondem por quase todo erro aqui.
    if (/invalid login|username and password not accepted|535/i.test(err.message)) {
      console.error(
        "   Credencial recusada pelo Gmail. Quase sempre é um destes:\n" +
        "     • SMTP_PASS está com a senha normal da conta, não a senha de app;\n" +
        "     • a senha de app foi colada com os espaços (tem que ser 16 letras seguidas);\n" +
        "     • SMTP_USER não é a mesma conta que gerou a senha de app.\n"
      );
    }
    process.exit(1);
  }
})();
