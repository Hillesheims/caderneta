# Caderneta 📒

App de finanças pessoais que instala no Android, no iPhone e no computador (PWA).
Funciona sem internet e sincroniza tudo pelo Supabase.

---

## 1. Banco de dados no Supabase (uns 10 minutos)

1. Crie uma conta grátis em **supabase.com** e um projeto novo.
   - Nome: `caderneta`
   - Região: **South America (São Paulo)**
   - Guarde a senha do banco que ele pedir (não é a senha do app).
2. No menu do projeto, abra **SQL Editor**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Crie o seu usuário do app: **Authentication → Users → Add user → Create new user**.
   Use seu e-mail e uma senha, e marque **Auto Confirm User**.
4. Feche a porta para estranhos: nas configurações de **Authentication**, desligue
   **Allow new users to sign up**. Assim só o usuário que você criou consegue entrar.
5. Pegue os dois dados de conexão em **Project Settings**:
   - **Data API** → Project URL (algo como `https://abcdefghijkl.supabase.co`)
   - **API Keys** → Publishable key (começa com `sb_publishable_`)
6. Abra o arquivo `config.js` e cole os dois valores no lugar dos textos `COLE_AQUI`.

> A chave publicável foi feita para ficar no código do app. Quem protege os seus dados
> são o login e as regras de segurança (RLS) criadas pelo `schema.sql`: cada usuário só
> enxerga as próprias linhas. Nunca coloque a chave **secret** neste projeto.

## 2. Publicar no GitHub Pages (uns 5 minutos)

1. Crie uma conta grátis em **github.com**.
2. Crie um repositório novo chamado `caderneta`, **público**.
3. Na página do repositório, clique em **uploading an existing file** e arraste
   **todo o conteúdo** desta pasta (os arquivos e as pastas, não a pasta `caderneta` em si).
   Clique em **Commit changes**.
4. Vá em **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**,
   branch **main**, pasta **/ (root)** e clique em **Save**.
5. Em um ou dois minutos o app estará em:
   `https://SEU-USUARIO.github.io/caderneta/`

O repositório público tem só o código. Os seus lançamentos ficam no Supabase, atrás do login.

## 3. Instalar no celular (Android)

1. Abra o link do app no **Chrome** do celular e entre com o e-mail e a senha do passo 1.
2. Toque em **Instalar** no aviso que aparece no app
   (ou no menu ⋮ do Chrome → **Instalar app** / **Adicionar à tela inicial**).
3. Pronto: o ícone **Caderneta** aparece junto com os outros apps.

No computador: abra o link no Chrome ou no Edge e clique no ícone de instalar na barra de endereço.

### Quer um arquivo .apk?
Depois que o app estiver publicado, cole o link em **pwabuilder.com** e gere o pacote Android.
Para uso pessoal, a instalação pelo Chrome já resolve.

---

## Como o app funciona

- **Sem internet:** o lançamento fica salvo no aparelho e o indicador no topo mostra
  "Offline · 1 pendente". Quando a internet volta, ele envia sozinho.
- **Entre aparelhos:** ao abrir o app (ou voltar para ele), os dados mais recentes são baixados.
- **Exportar:** menu ⋮ → *Exportar o mês em CSV*. Abre direto no Excel (separador `;`).
- **Categorias e contas:** menu ⋮ → *Categorias e contas*. Ficam salvas no Supabase também.
- **Atualizações do app:** depois de publicar uma versão nova no GitHub, o celular pega na
  próxima vez que abrir o app (às vezes precisa abrir duas vezes).
- **Plano grátis do Supabase:** projetos parados por 7 dias são pausados. Usando o app,
  isso não acontece. Se pausar, é só restaurar no painel; os dados continuam lá.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html` | Telas do app (login, resumo, lançamentos, formulários) |
| `app.css` | Visual, tema claro e escuro |
| `app.js` | Lógica: login, cálculos do mês, fila offline e sincronização com o Supabase |
| `sw.js` | Service worker: guarda o app no aparelho para abrir sem internet |
| `manifest.webmanifest` | Nome, ícone e cores do app instalado |
| `config.js` | URL e chave publicável do seu Supabase |
| `supabase/schema.sql` | Tabelas `lancamentos` e `preferencias` com as regras de segurança |
| `vendor/supabase.js` | Biblioteca oficial supabase-js (licença MIT) |
| `fonts/` | Bricolage Grotesque, Figtree e IBM Plex Mono (licença OFL) |
| `icons/` | Ícones do app |

Valores são guardados em centavos (`valor_centavos`) para não ter erro de arredondamento.
