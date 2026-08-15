# Publicando o site na Hostinger

Guia específico deste projeto. Ele **não** é um site estático: o mesmo
processo Node serve as páginas *e* a API (pagamento, contas, painel), então
não dá para simplesmente arrastar os arquivos para o `public_html`.

---

## 1. O plano precisa ter Node.js

O painel da Hostinger (hPanel) oferece **Node.js 18, 20, 22 e 24**.

⚠️ **Escolha 22 ou 24.** O projeto usa `node:sqlite`, o módulo de banco
nativo do Node, que só existe a partir do **22.5**. Em 18 ou 20 o servidor
nem inicia.

---

## 2. Como o projeto está organizado (importante na hora de configurar)

```
Adriana-Melo-Acessorios/
└── server/                  ← o site inteiro mora aqui (index.html, css/,
    ├── index.html              js/, img/) junto com o back-end
    ├── css/, js/, img/
    ├── package.json         ← as dependências estão AQUI, não na raiz
    ├── server.js            ← arquivo de entrada
    └── data.db              ← banco (criado sozinho no primeiro boot)
```

`server.js` serve os arquivos do site a partir da própria pasta onde está
(`SITE_ROOT = __dirname`). Isso é proposital: builders de deploy como o da
Hostinger só deixam escolher uma pasta *existente* do repositório como raiz
da aplicação (não a raiz do repositório em si), então a pasta escolhida
precisa conter tudo — site e servidor juntos.

Configure a aplicação apontando o **diretório raiz** para **`server`**, com
arquivo de entrada **`server.js`** e comando de início **`npm start`**.

---

## 3. Variáveis de ambiente

**Não suba o arquivo `server/.env`** — ele é (e deve continuar) ignorado
pelo git. Cadastre cada variável no painel da Hostinger, na seção de
variáveis de ambiente da aplicação Node.

### As que MUDAM em relação ao seu `.env` local

| Variável | Valor local (hoje) | Valor em produção |
|---|---|---|
| `CLIENT_ORIGIN` | `http://localhost:3333` | `https://seudominio.com.br` |
| `SERVER_PUBLIC_URL` | `https://seu-servidor-em-producao.com` | `https://seudominio.com.br` |
| `PORT` | `3333` | **não cadastre** — a Hostinger injeta a dela |

⚠️ Errar `SERVER_PUBLIC_URL` é o erro mais caro: é nele que o Mercado Pago
chama o webhook para confirmar o pagamento. Se estiver errado, o pedido é
pago mas fica **"pendente" para sempre** no painel, e a cliente não recebe
confirmação.

### As que vão iguais ao local

Copie os valores do seu `server/.env`:

- `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` — já são de produção (`APP_USR-...`)
- `NODE_ENV=production`
- `ADMIN_EMAIL_HASHES` — quem entra no painel
- `ORIGIN_CEP` — CEP de origem dos envios
- `OWNER_EMAIL`, `OWNER_WHATSAPP_NUMBER` — para onde vão os avisos de venda
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_FROM`

### As que ainda faltam preencher

| Variável | O que fazer |
|---|---|
| `SMTP_PASS` | Senha de app do Gmail (16 letras, sem espaços) em [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) — exige verificação em duas etapas. Sem ela **nenhum e-mail sai**: nem aviso de venda, nem redefinição de senha, nem cupom da newsletter. |
| `MELHOR_ENVIO_TOKEN` | Token de produção em [melhorenvio.com.br/painel/gerenciar/tokens](https://melhorenvio.com.br/painel/gerenciar/tokens). Sem ele **o cálculo de frete não funciona** e ninguém consegue fechar pedido. |
| `MELHOR_ENVIO_BASE_URL` | Trocar para `https://melhorenvio.com.br` (hoje está no sandbox de testes). |
| `MELHOR_ENVIO_USER_AGENT` | `Adriana Melo Acessorios (adriana_melo_acessorios@gmail.com)` |

---

## 4. HTTPS é obrigatório

Ative o certificado SSL grátis da Hostinger e force HTTPS antes de divulgar
o site.

⚠️ Motivo: com `NODE_ENV=production`, o cookie de sessão sai marcado como
`Secure` e o navegador **só o envia por HTTPS**. Se o site abrir em `http://`
puro, ninguém consegue entrar na conta nem no painel — e não aparece erro
nenhum, o cookie é simplesmente descartado. É um problema que parece um bug
de login e não é.

---

## 5. Depois do primeiro deploy

### 5.1 Cadastrar o webhook no Mercado Pago

Em [mercadopago.com.br/developers/panel](https://www.mercadopago.com.br/developers/panel)
→ sua aplicação → **Webhooks**, cadastre:

```
https://seudominio.com.br/api/webhook
```

Marque o evento de **pagamentos**. É essa chamada que confirma o pedido —
a tela de "pagamento aprovado" que a cliente vê é só visual, não confirma
nada sozinha.

### 5.2 Criar a conta de administradora

O painel não tem cadastro próprio: acesse `https://seudominio.com.br/conta.html`
e crie a conta com o e-mail cujo hash está em `ADMIN_EMAIL_HASHES`. Ao
entrar, você já cai no painel.

### 5.3 Conferir que subiu inteiro

- [ ] Home abre e mostra os produtos
- [ ] Cadastro e login funcionam (se falhar, é o HTTPS do item 4)
- [ ] `/admin.html` abre o painel com a sua conta
- [ ] Frete calcula ao informar um CEP no carrinho
- [ ] `node server/testar-email.js` (ou um cadastro na newsletter) entrega e-mail

---

## 6. ⚠️ O que NÃO pode se perder entre deploys

Dois caminhos guardam dados que **não estão no git** e não voltam se forem
apagados:

| Caminho | O que é |
|---|---|
| `server/data.db` | Contas das clientes, pedidos, cupons, inscritos na newsletter, mensagens de contato |
| `img/products/` | As fotos dos produtos que você enviou pelo painel |

Antes de qualquer redeploy que reinstale a aplicação do zero, confirme com o
suporte da Hostinger que esses dois caminhos sobrevivem — ou baixe uma cópia
pelo gerenciador de arquivos. O plano tem backup diário, o que ajuda, mas
não substitui conferir antes de mexer.

---

## 7. Opcional, para o site ficar mais rápido

Nada disso bloqueia a publicação:

- Minificar CSS/JS (`npx clean-css-cli`, `npx terser`)
- Ativar o CDN que já vem no plano
