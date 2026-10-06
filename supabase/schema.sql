-- Caderneta · estrutura do banco no Supabase
-- Cole tudo no SQL Editor do seu projeto e clique em "Run".
-- Pode rodar de novo sem problema: nada é duplicado.

-- 1) Lançamentos (cada receita ou despesa)
create table if not exists public.lancamentos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo           text not null check (tipo in ('receita', 'despesa')),
  valor_centavos bigint not null check (valor_centavos > 0),
  descricao      text not null default '' check (char_length(descricao) <= 80),
  categoria      text not null,
  conta          text not null,
  data           date not null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists lancamentos_user_data_idx
  on public.lancamentos (user_id, data desc);

-- 2) Preferências (suas categorias e contas)
create table if not exists public.preferencias (
  user_id             uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  categorias_despesa  text[] not null,
  categorias_receita  text[] not null,
  contas              text[] not null,
  atualizado_em       timestamptz not null default now()
);

-- 3) Segurança: cada usuário só enxerga e altera as próprias linhas (RLS)
alter table public.lancamentos  enable row level security;
alter table public.preferencias enable row level security;

drop policy if exists "lancamentos: ler os proprios"      on public.lancamentos;
drop policy if exists "lancamentos: inserir os proprios"  on public.lancamentos;
drop policy if exists "lancamentos: alterar os proprios"  on public.lancamentos;
drop policy if exists "lancamentos: excluir os proprios"  on public.lancamentos;

create policy "lancamentos: ler os proprios"     on public.lancamentos
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "lancamentos: inserir os proprios" on public.lancamentos
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lancamentos: alterar os proprios" on public.lancamentos
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lancamentos: excluir os proprios" on public.lancamentos
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "preferencias: ler as proprias"     on public.preferencias;
drop policy if exists "preferencias: inserir as proprias" on public.preferencias;
drop policy if exists "preferencias: alterar as proprias" on public.preferencias;

create policy "preferencias: ler as proprias"     on public.preferencias
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "preferencias: inserir as proprias" on public.preferencias
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "preferencias: alterar as proprias" on public.preferencias
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 4) Permissões: só quem está logado acessa as tabelas
revoke all on public.lancamentos  from anon;
revoke all on public.preferencias from anon;
grant select, insert, update, delete on public.lancamentos  to authenticated;
grant select, insert, update        on public.preferencias to authenticated;
