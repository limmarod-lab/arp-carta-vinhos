# ARP Carta de Vinhos V5 — Cloudflare + JSONBin.io

Arquitetura: Cloudflare Pages (frontend + Pages Functions) → Cloudflare Worker runtime → JSONBin.io. A chave do JSONBin não aparece no navegador. O JSONBin usa os endpoints v3 `/b/{BIN_ID}/latest` para leitura e `/b/{BIN_ID}` com PUT para atualização.

## 1. Criar os Bins

Crie dois Bins privados no JSONBin:
- `WINES_BIN_ID`: conteúdo inicial em `data/wines-seed.json`
- `USERS_BIN_ID`: `{ "version": 1, "favorites": {} }`

Ative versionamento dos Bins para preservar versões das alterações.

## 2. Publicar no Cloudflare Pages

Suba esta pasta como projeto do Pages. O `index.html`, a pasta `rotulos/` e `functions/` devem permanecer na raiz. Como o projeto usa Pages Functions, use Git ou Wrangler para deploy; o upload direto pelo dashboard não é suportado para projetos com Functions.

## 3. Configurar Secrets no Cloudflare

No projeto/Worker, configure como **Secrets**:
- `JSONBIN_MASTER_KEY` = sua chave do JSONBin
- `SESSION_SECRET` = uma sequência longa e aleatória (32+ caracteres)
- `WINES_BIN_ID` = ID do bin dos vinhos
- `USERS_BIN_ID` = ID do bin de favoritos
- `ADMIN_USER` / `ADMIN_PASSWORD` = credencial de liderança
- `COLAB_USER` / `COLAB_PASSWORD` = credencial da equipe

Cloudflare recomenda Secrets para dados sensíveis; não coloque a chave do JSONBin no HTML ou em `vars`.

## 4. Login

O sistema usa duas credenciais compartilhadas por papel:
- Colaborador: `COLAB_USER` / `COLAB_PASSWORD`
- Administrador: `ADMIN_USER` / `ADMIN_PASSWORD`

A sessão é um token assinado pelo Worker, válido por 12 horas.

## 5. Imagens

Os rótulos originais continuam em `rotulos/`. O Admin aceita um caminho relativo (ex.: `rotulos/meu-vinho.jpg`) ou uma URL de imagem. Isso evita colocar arquivos binários dentro do JSONBin. Para adicionar novos rótulos localmente, coloque a imagem na pasta `rotulos/` e publique uma nova versão no Cloudflare. Se quiser upload real pelo painel sem novo deploy, a evolução ideal é Cloudflare R2.

## 6. Observação sobre concorrência

A V5 lê o Bin mais recente antes de gravar e ativa versionamento. Para uma carta com poucos administradores e alterações pontuais, isso é adequado. Se várias pessoas administrativas começarem a editar o mesmo registro simultaneamente, a próxima evolução deve usar um armazenamento com operações por registro/controle de concorrência.

## 7. Backup

O Admin permite exportar a carta para JSON. O JSONBin também mantém versões quando o versionamento está habilitado.

## 8. Segurança

O navegador nunca recebe `JSONBIN_MASTER_KEY`. O acesso de escrita passa pelo endpoint `/api/wines`, e o Worker verifica o token e o papel `admin` antes de alterar o Bin.
