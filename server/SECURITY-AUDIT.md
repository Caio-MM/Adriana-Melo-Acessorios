# Auditoria de segurança e performance — Petit Laço

Auditoria do código enviado (`index.html`, `css/style.css`, `js/main.js`) e
do que foi adicionado nesta rodada (carrinho + checkout).

## Achados e correções

### 🔴 Crítico — Access Token do Mercado Pago nunca pode ir ao front-end
O pedido original era "integrar o SDK oficial... indique onde inserir meu
Access Token". Colocar o Access Token em qualquer arquivo servido ao
navegador (HTML/CSS/JS) o expõe publicamente — qualquer visitante pode
copiá-lo pelo "Ver código-fonte" e usá-lo para criar cobranças na sua conta
ou consultar seus pagamentos.
**Correção aplicada:** criado `server/server.js`, um back-end mínimo que
guarda o Access Token em `server/.env` (fora do código versionado) e é o
único responsável por falar com a API do Mercado Pago. O front-end só chama
o seu próprio back-end (`/api/create-preference`) e nunca vê o token.

### 🔴 Crítico — manipulação de preço pelo cliente
Um carrinho que envia `{ id, preço, quantidade }` para o servidor confia no
preço que o próprio navegador informou — que pode ser editado no DevTools
antes de enviar.
**Correção aplicada:** o front-end envia só `{ id, qty }`. O backend
(`server/server.js`) busca o preço de verdade em `PRODUCTS` (um catálogo só
dele) antes de criar a preferência de pagamento. Mesma lógica se aplica ao
`localStorage` do carrinho: ele guarda apenas `id`/`qty`, nunca preço.

### 🟠 Médio — XSS potencial se o catálogo passar a vir de fora
Hoje os produtos são um array fixo no próprio `main.js` (risco baixo). Mas
o código montava HTML com template strings (`innerHTML = ...${p.name}...`)
sem escapar nada — se amanhã o nome/descrição do produto vier de um
formulário, banco de dados ou CMS, um valor como
`<img src=x onerror=alert(1)>` seria executado como código na página de
todo mundo que visse aquele produto.
**Correção aplicada:** toda inserção de texto dinâmico (nome, categoria,
badge, descrição, itens do carrinho) agora passa por `escapeHTML()` antes de
entrar no `innerHTML`.

### 🟠 Médio — confiar apenas em validação no navegador
Os formulários de contato e newsletter só validavam com `required`/regex no
JavaScript do navegador — o que é só conveniência de UX, não é proteção
real, porque dá para chamar a API diretamente (curl/Postman) ignorando o
HTML por completo.
**Correção aplicada:** `server/server.js` traz rotas de exemplo
(`/api/contact`, `/api/newsletter`) que validam e limitam o tamanho dos
campos de novo no servidor, além de *rate limiting* (`express-rate-limit`)
para dificultar spam/força bruta.

### 🟡 Baixo — falta de cabeçalhos de segurança HTTP
O site não define `Content-Security-Policy` nem cabeçalhos correlatos, o que
facilita a execução de scripts injetados caso surja alguma outra falha de
XSS no futuro, e não define proteções básicas como `X-Content-Type-Options`.
**Correção aplicada:** adicionada uma CSP via `<meta>` no `index.html`
(camada extra, restringe de onde scripts/imagens/estilos podem carregar) e
`helmet()` no back-end (define os cabeçalhos de segurança no servidor, que é
o lugar correto/mais forte para isso — uma `<meta>` no HTML não cobre tudo
que um cabeçalho HTTP cobre).

### 🟡 Baixo — CORS aberto por padrão em uma futura API
Como não havia back-end antes, não havia CORS configurado. Ao adicionar um,
o risco de deixá-lo aberto (`*`) é qualquer site na internet poder chamar
sua API de criação de pagamentos.
**Correção aplicada:** `cors({ origin: CLIENT_ORIGIN })` — só o domínio do
seu próprio site (configurado no `.env`) pode chamar a API.

### 🟡 Baixo — dados corrompidos no `localStorage`
O carrinho lê do `localStorage`, que pode ser editado manualmente pelo
usuário (ou corrompido). Um `JSON.parse` sem tratamento quebraria a página.
**Correção aplicada:** leitura do carrinho é validada item a item
(`Number.isInteger`, limites de quantidade 1–10) dentro de um `try/catch`,
descartando qualquer entrada inválida em vez de travar a página.

### ℹ️ Sobre "SQL Injection"
O projeto não usa banco de dados (o `console.log` nos formulários é só um
placeholder). Não há, portanto, superfície de SQL Injection hoje. Se/quando
um banco for adicionado, a recomendação é sempre usar consultas
parametrizadas (ex.: `db.query("... WHERE id = $1", [id])`) e nunca montar
SQL por concatenação de strings — isso já está anotado como `TODO` nos
pontos do `server.js` onde dados de formulário seriam persistidos.

## Performance — resumo
Ver `README.md`, seção 5, para a lista completa. Em resumo: imagens com
`lazy loading`/dimensões fixas, scripts com `defer`, `preconnect` de fontes,
scroll throttled com `requestAnimationFrame`, e recomendações de minificação
para o momento do deploy (não executadas aqui por dependerem do seu pipeline
de build).

## O que **não** foi feito nesta rodada (e por quê)
- **Rodar `npm install` de fato / testar a chamada real ao Mercado Pago**:
  este ambiente não tem acesso à internet para instalar pacotes ou chamar
  APIs externas — o código foi escrito seguindo a documentação oficial do
  SDK, mas recomendo testar localmente com uma credencial de **teste**
  antes de usar a de produção.
- **Banco de dados / persistência de pedidos**: fora do escopo pedido;
  pontos de extensão marcados com `TODO` em `server.js`.
- **Cálculo automático de frete**: não solicitado explicitamente; hoje o
  carrinho informa que o frete é calculado na etapa de pagamento.
