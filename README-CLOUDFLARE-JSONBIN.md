# ARP Carta de Vinhos V6 — Cloudflare Pages + JSONBin.io

A V6 transforma a carta em uma ferramenta de salão: busca por contexto, recomendação por aderência, ficha profissional, favoritos, treinamento com perguntas menos óbvias e painel administrativo.

## Estrutura
- `index.html` — frontend responsivo, com fallback local dos 37 vinhos do seed.
- `data/wines-seed.json` — base inicial.
- `rotulos/` — imagens dos rótulos.
- `functions/api/[[path]].js` — autenticação, carta, favoritos e auditoria opcional.

## Cloudflare / JSONBin
Configure como Secrets/Variables no projeto: `JSONBIN_MASTER_KEY`, `SESSION_SECRET`, `WINES_BIN_ID`, `USERS_BIN_ID`, `ADMIN_USER`, `ADMIN_PASSWORD`, `COLAB_USER`, `COLAB_PASSWORD`.

Opcional: `AUDIT_BIN_ID` para registrar até 200 alterações recentes. `ALLOWED_ORIGIN` pode ser definido para restringir o CORS ao domínio do Pages.

Crie: `WINES_BIN_ID` com o conteúdo de `data/wines-seed.json` e `USERS_BIN_ID` com `{ "version": 1, "favorites": {} }`. Se usar auditoria, crie `AUDIT_BIN_ID` com `{ "version": 1, "items": [] }`.

O Worker mantém a chave mestre do JSONBin fora do navegador. A sessão é um token HMAC com validade de 12 horas.

## Deploy
Use Cloudflare Pages com Functions via Git/Wrangler. Mantenha `functions/`, `rotulos/`, `data/` e `index.html` na raiz do projeto.

## Observação
A carta funciona em modo local como fallback, então a interface não fica vazia quando a API ainda não foi configurada. Depois que o endpoint `/api/wines` estiver configurado, a versão publicada no JSONBin passa a ser a fonte sincronizada.
