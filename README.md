# Petit Laço / Adriana Melo Acessórios — guia de configuração

Este pacote contém o site e o back-end que processa pagamentos (Mercado
Pago), frete (Melhor Envio), contas de cliente e histórico de pedidos.

```
site/
├── index.html            ← loja
├── conta.html             ← login / cadastro
├── pedidos.html           ← histórico de pedidos (exige login)
├── admin.html             ← painel administrativo (exige login + ADMIN_EMAIL_HASHES)
├── css/style.css
├── js/
│   ├── main.js            ← catálogo, carrinho, frete, cupom, checkout
│   ├── auth.js             ← sessão + área de conta na navbar (toda página)
│   ├── conta.js            ← formulários de login/cadastro
│   ├── pedidos.js          ← histórico de pedidos
│   └── admin.js            ← painel administrativo (lista + código de rastreio)
└── server/                 ← back-end Node.js (também serve o site, ver seção 3)
    ├── server.js
    ├── db.js                ← usuários, sessões e pedidos (SQLite embutido)
    ├── auth.js              ← hashing de senha, sessão por cookie, checagem de admin
    ├── whatsapp.js           ← aviso de WhatsApp p/ lojista (WhatsApp Cloud API)
    ├── email.js              ← aviso de e-mail p/ lojista (Nodemailer/SMTP)
    ├── orderFormatting.js    ← cor/moeda/data compartilhados entre os avisos
    ├── package.json
    ├── .env.example
    └── .gitignore
```

## 1. O que tem aqui

- **Carrinho lateral (offcanvas)**: itens, quantidade (+/−), cupom de
  desconto, subtotal/desconto/frete/total e o botão "Ir para pagamento".
  Fica salvo em `localStorage` (sobrevive a um recarregamento de página).
- **Frete real (Melhor Envio)**: o carrinho pede o CEP e mostra as opções de
  entrega calculadas de verdade (ver seção 2).
- **Cupom de desconto**: hoje existe um cupom de exemplo, `BEMVINDA10` (10%),
  cadastrado em `COUPONS` no topo de `server/server.js` — adicione outros
  cupons ali. O desconto é sempre validado/calculado no servidor.
- **Checkout Mercado Pago (Checkout Pro)**: redireciona para o link oficial
  de pagamento (Pix, cartão ou boleto); a confirmação de verdade vem do
  webhook, nunca do redirecionamento do navegador.
- **Contas de cliente**: cadastro/login em `conta.html`, sessão por cookie
  httpOnly (não fica token nenhum acessível em JavaScript/localStorage).
- **Histórico de pedidos**: `pedidos.html` mostra os pedidos do cliente
  logado (itens, cupom usado, frete, total e status: pendente/pago/recusado/
  etc.), atualizado automaticamente pelo webhook do Mercado Pago.
- **Catálogo com fotos**: via [Picsum Photos](https://picsum.photos) por
  enquanto, com *lazy loading* e fallback para o ícone de laço se falhar.
- **Aviso de WhatsApp para a lojista**: quando o webhook confirma um
  pagamento aprovado, `server/whatsapp.js` monta a mensagem (itens,
  quantidade, cor, total, data/hora) e envia via WhatsApp Cloud API oficial
  (Meta) para `OWNER_WHATSAPP_NUMBER` (ver seção 2). Falha no envio nunca
  afeta a confirmação do pedido — só fica registrada no log do servidor.
  ⚠️ A API oficial só entrega texto livre para números que falaram com o
  WhatsApp Business da loja nas últimas 24h — ver aviso em `whatsapp.js`.
- **Aviso de e-mail para a lojista**: mesmo gatilho (webhook de pagamento
  aprovado) dispara um e-mail para `OWNER_EMAIL` via `server/email.js`
  (Nodemailer/SMTP), com o resumo do pedido e um link direto para o pedido
  no painel administrativo. Também best-effort — nunca afeta a confirmação.
- **Painel administrativo** (`admin.html`): só abre para quem faz login com
  um e-mail cujo hash SHA-256 está em `ADMIN_EMAIL_HASHES` (ver seção 2 —
  o e-mail nunca fica em texto puro no `.env`) — qualquer outra pessoa
  logada recebe 403 e visitante sem login é mandado para o login. O link
  "Admin" só aparece na navbar para quem tem acesso. Três áreas:
  - **Visão geral**: vendas totais (R$) e total de pedidos, somando só os
    pedidos com status "pago" (`GET /api/admin/orders`, campo `stats`).
  - **Produtos**: tabela com todos os produtos do catálogo — "Editar" abre
    um modal para trocar nome, preço e a URL da foto. Salvar grava em
    `product_overrides` (server/db.js) e o preço novo já vale no próximo
    checkout (server.js usa o mesmo `effectiveProduct()` tanto para montar
    a vitrine quanto para cobrar) — nunca é só cosmético. A vitrine
    (`js/main.js`) busca essas edições sozinha ao carregar a página, sem
    precisar reiniciar o servidor.
  - **Pedidos**: cliente, telefone, itens (quantidade/cor), endereço de
    entrega, total, e um campo para a lojista preencher o código de
    rastreio dos Correios depois de postar.
- **Segurança**: ver `SECURITY-AUDIT.md`.
- **Performance**: ver seção 6 abaixo.

## 2. 🔑 Configurando o `server/.env`

```bash
cd server
cp .env.example .env
```

Depois abra `.env` e preencha (o arquivo já explica cada uma):

| Variável | Onde conseguir | Observação |
|---|---|---|
| `MP_ACCESS_TOKEN` | [painel do Mercado Pago](https://www.mercadopago.com.br/developers/panel) → Credenciais | **Secreta.** Use `TEST-...` para testar, `APP_USR-...` só em produção. |
| `MELHOR_ENVIO_TOKEN` | [painel do Melhor Envio](https://melhorenvio.com.br/painel/gerenciar/tokens) | Use o token de **sandbox** até validar o fluxo. |
| `ORIGIN_CEP` | CEP do ateliê/remetente | Usado para cotar o frete. |
| `WHATSAPP_CLOUD_API_TOKEN` | [business.facebook.com](https://business.facebook.com) → Configurações do negócio → Usuários do sistema → gerar token | **Secreta.** Token temporário (24h) em developers.facebook.com funciona para testar. |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | [developers.facebook.com](https://developers.facebook.com) → seu app → WhatsApp → Introdução | Número que **envia** o aviso (precisa estar verificado no app da Meta). |
| `OWNER_WHATSAPP_NUMBER` | número da própria loja, só dígitos com DDI+DDD | Ex.: `5561982749808`. É quem **recebe** o aviso. |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` | conta de e-mail que **envia** o aviso | Para Gmail: `smtp.gmail.com`, porta `587`, `SMTP_PASS` = "senha de app" em [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (exige verificação em duas etapas). |
| `OWNER_EMAIL` | endereço que **recebe** o aviso | `adriana_melo_acessorios@gmail.com`. |
| `ADMIN_EMAIL_HASHES` | hash SHA-256 do(s) e-mail(s) já cadastrado(s) no site, separados por vírgula | Gere com `node -e "console.log(require('crypto').createHash('sha256').update('email@exemplo.com').digest('hex'))"`. Nunca o e-mail em texto puro. |
| `SESSION`/login | nada a configurar | a sessão de login usa um token aleatório por usuário, guardado com hash no banco — não precisa de nenhuma chave extra no `.env`. |

**Nunca** cole valores reais em `.env.example` (esse arquivo fica versionado
no git) — só em `.env`, que está protegido pelo `.gitignore` desta pasta.

## 3. Rodando localmente

Requer [Node.js](https://nodejs.org) **22.5 ou mais recente** (o banco de
dados usa o módulo nativo `node:sqlite`, sem dependência externa).

```bash
cd server
npm install
npm start
```

O servidor sobe em `http://localhost:3333` **e também serve o site inteiro**
(index.html, conta.html, pedidos.html, css/, js/) — abra
`http://localhost:3333` direto no navegador. Não é mais necessário abrir o
`index.html` separado com Live Server/outra porta: site e API precisam estar
na mesma origem para o cookie de sessão de login funcionar corretamente.

Para o **webhook** (`/api/webhook`) funcionar, o Mercado Pago precisa
conseguir chamar seu servidor pela internet. Em desenvolvimento, use algo
como [ngrok](https://ngrok.com) para gerar uma URL pública temporária e
configure-a em `SERVER_PUBLIC_URL` (no `.env`) e no painel do Mercado Pago.
Em produção, publique a pasta inteira (site + `server/`) em um serviço como
Render, Railway, Fly.io ou uma VPS, e use a URL real de produção.

### Dependências (instaladas via `npm install`)

- `express` — servidor web (também serve os arquivos do site)
- `cors` — libera chamadas só do domínio configurado
- `helmet` — cabeçalhos HTTP de segurança (CSP, HSTS, etc.)
- `dotenv` — carrega o `.env`
- `express-rate-limit` — limita requisições por IP (anti-spam/força bruta)
- `mercadopago` — SDK oficial do Mercado Pago
- `bcryptjs` — hash de senha das contas de cliente
- `nodemailer` — envio do e-mail de aviso por SMTP (único serviço de e-mail
  do projeto; WhatsApp e Melhor Envio usam `fetch` nativo, sem SDK)

Banco de dados: `node:sqlite` (nativo do Node, sem dependência extra). O
arquivo fica em `server/data.db` (fora do git — apagar esse arquivo reseta
usuários/pedidos, útil em desenvolvimento).

## 4. Páginas de retorno do pagamento

O `server.js` aponta `back_urls` para `/pagamento-sucesso.html`,
`/pagamento-erro.html` e `/pagamento-pendente.html` — as três existem no
site (mesmo estilo visual do resto, com o número do pedido quando
disponível na URL e um botão de próximo passo). Elas são só para a
experiência do usuário — a confirmação **de verdade** do pagamento vem do
webhook (`/api/webhook`), não do fato de o navegador ter chegado nessas
páginas, então o texto de cada uma evita afirmar mais do que o
redirecionamento garante (a de "pendente", por exemplo, não promete prazo
igual para Pix e boleto).

## 5. Contas de cliente e histórico de pedidos

- O carrinho e o checkout funcionam **sem** exigir login (evita perder
  venda por fricção). Quando o cliente está logado, o pedido é gravado com
  o `user_id` dele e passa a aparecer em `pedidos.html`; sem login, o
  pedido é processado normalmente, só não fica associado a nenhuma conta.
- Sessão por cookie `httpOnly` (nunca por `localStorage`/JWT no
  navegador) — ver `server/auth.js` para o porquê.
- Não há (ainda) recuperação de senha por e-mail nem verificação de
  e-mail — ficou fora do escopo deste pacote por exigir um provedor de
  e-mail transacional. É um bom próximo passo (seção 7).

## 6. Performance — o que foi feito e o que fazer no deploy

Já aplicado no código:

- `loading="lazy"` + `decoding="async"` em todas as imagens de produto,
  carrinho e galeria.
- `width`/`height` fixos nas imagens, evitando "pulos" de layout (CLS).
- Scripts carregam com `defer`, sem bloquear a renderização inicial.
- `preconnect` para os domínios de fonte.
- Scroll throttled com `requestAnimationFrame`.
- Alteração de quantidade no carrinho atualiza só o número na tela (não
  reconstrói a linha inteira/a imagem) — sem o "flash" de recarregamento
  que existia antes a cada clique em +/−.
- Lookup de produto por `Map` (O(1)) em vez de busca linear no array.
- Cálculo de desconto do cupom refeito localmente a cada mudança de
  quantidade, sem chamar a API de novo.

Recomendado para quando for publicar (não incluído aqui por depender do seu
ambiente de build/deploy):

- **Minificar** `css/style.css` e os arquivos de `js/` antes do deploy, por
  exemplo com `npx clean-css-cli` e `npx terser`.
- Servir o site por trás de um CDN/HTTP2 (Netlify, Vercel, Cloudflare
  Pages, ou o próprio Render) para compressão automática (gzip/brotli).
- Trocar as fotos do Picsum por fotos reais dos produtos, já otimizadas
  (formato `.webp`, ~600×600px, comprimidas).

## 7. Próximos passos sugeridos (fora do escopo deste pacote)

- Validar a assinatura do webhook do Mercado Pago (header `x-signature`,
  configurável no painel deles) — hoje a segurança do webhook vem inteira
  de sempre reconsultar o pagamento pela API deles (nunca confiar só no
  payload recebido), o que já é sólido, mas a assinatura é uma camada
  extra fácil de somar.
- Cupons de desconto além do `BEMVINDA10` fixo em `COUPONS`
  (`server/server.js`) — hoje qualquer cupom novo exige editar o código.
- E-mail transacional de recuperação de senha (hoje só existe o aviso de
  pedido pago, `server/email.js`).
