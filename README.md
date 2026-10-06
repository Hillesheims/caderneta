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

## Abas do app

- **Painel** (tela inicial): visão dos últimos 3, 6 ou 12 meses.
  - Gastos: gasto médio por mês (comparado com o período anterior), quanto sobrou da renda,
    peso dos gastos fixos, maior categoria, gráfico de receitas e despesas e cada categoria
    com um minigráfico mês a mês e a meta.
  - Investimentos: patrimônio, resultado, aportes no período, quanto da renda foi investido,
    evolução do patrimônio no fim de cada mês (ações pelo fechamento do mês, caixinhas pelo CDI)
    e onde está o dinheiro. Todo gráfico tem a opção "Ver tabela".
- **Mês:** saldo, receitas, despesas, gastos por categoria, últimos 6 meses e a lista de lançamentos.
- **Investimentos**
  - **Ações:** registre compras e vendas (ticker, quantidade, preço, data e taxas). O app calcula o
    preço médio pelo método usado no Brasil (taxas entram no custo; vendas não mudam o preço médio),
    busca a cotação da B3 (atraso de até 15 min) e mostra o resultado e o lucro realizado nas vendas.
  - **Renda fixa (caixinhas):** registre aportes e resgates e informe quanto do CDI a caixinha rende.
    O saldo é estimado com o CDI diário oficial do Banco Central (série SGS 12), antes do imposto de renda.
    Se não bater com o banco, toque na caixinha → **Conferir com o banco** e digite o saldo que aparece
    no app do banco: o Caderneta parte desse valor e soma o CDI dali pra frente. O rendimento total
    do app inclui o que já saiu junto com os resgates, por isso costuma ficar acima do rendimento que o banco mostra.
- **Metas:** meta de gastos do mês (vale para todos os meses) e metas por categoria, com barra de
  progresso e quanto ainda dá para gastar por dia.
- **Fixos:** aluguel, assinaturas e outras contas que se repetem. Todo dia 1º os fixos ativos entram
  sozinhos nos lançamentos do mês, com a data do vencimento. Se você apagar um desses lançamentos,
  ele não volta. Mudanças no valor valem a partir do próximo lançamento.

As cotações e o CDI vêm da função `mercado` (Supabase Edge Function, em `supabase/functions/mercado`).
Ela só responde para quem está logado no app.

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
| `supabase/schema.sql` | Estrutura completa do banco (lançamentos, preferências e metas, gastos fixos, ações, caixinhas) com as regras de segurança |
| `supabase/migrations/` | Alterações aplicadas no banco ao longo do tempo |
| `supabase/functions/mercado/` | Função que busca cotações da B3 e o CDI diário do Banco Central |
| `vendor/supabase.js` | Biblioteca oficial supabase-js (licença MIT) |
| `fonts/` | Bricolage Grotesque, Figtree e IBM Plex Mono (licença OFL) |
| `icons/` | Ícones do app |

Valores são guardados em centavos (`valor_centavos`) para não ter erro de arredondamento.
