# Configuração do Instagram (feed automático)

Passo único e manual, feito por quem tem acesso à conta
@adriana_melo_acessorios (precisa ser conta Business ou Creator — se
ainda for pessoal, troque em Instagram > Configurações > Conta antes de
começar).

1. Acesse developers.facebook.com/apps e crie um app (qualquer tipo, não
   precisa vincular a uma Página do Facebook).
2. No painel do app, adicione o produto "Instagram API with Instagram
   Login".
3. Em "Instagram API with Instagram Login" > Configuração da API,
   cadastre uma "Instagram business login" com uma OAuth redirect URI
   (qualquer URL sob seu controle que responda 200 — pode ser a própria
   home do site).
4. Gere a URL de autorização (o próprio painel monta o link), abra
   logado como @adriana_melo_acessorios, autorize o app, e copie o
   `code` que aparece na URL de redirect.
5. Troque o `code` pelo token de curta duração seguindo o `curl` exato
   que o painel do Meta mostra para o seu app (`POST` para
   `api.instagram.com/oauth/access_token`).
6. Copie o App Secret (Painel > Configurações básicas do app) para
   `INSTAGRAM_APP_SECRET` no `.env`.
7. Troque o token curto pelo primeiro token de LONGA duração (60 dias):
   ```
   curl "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=SEU_APP_SECRET&access_token=SEU_TOKEN_CURTO"
   ```
   Copie o `access_token` da resposta para `INSTAGRAM_ACCESS_TOKEN` no
   `.env`.
8. Reinicie o servidor. A partir daqui a renovação (a cada ~45 dias) é
   automática — só repita este processo se o token for revogado
   manualmente ou o app for excluído no painel do Meta.

## Testar sem credenciais reais

Pra ver o layout do feed (grid de fotos, avatar, etc.) sem precisar de um
token de verdade, defina no `.env` local (nunca em produção, nunca
commitado):

```
INSTAGRAM_MOCK_FEED=true
```

Isso faz o servidor devolver um feed de exemplo (fixture) em vez de
chamar a API real — só funciona fora de produção (`NODE_ENV !== "production"`).
