-- Caderneta · estrutura completa do banco no Supabase
-- Para um projeto novo: cole tudo no SQL Editor e clique em "Run".
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
  fixo_id        uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
alter table public.lancamentos add column if not exists fixo_id uuid;
create index if not exists lancamentos_user_data_idx on public.lancamentos (user_id, data desc);
create index if not exists lancamentos_fixo_idx on public.lancamentos (fixo_id) where fixo_id is not null;

-- 2) Preferências (categorias, contas e metas de gastos)
create table if not exists public.preferencias (
  user_id              uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  categorias_despesa   text[] not null,
  categorias_receita   text[] not null,
  contas               text[] not null,
  meta_mensal_centavos bigint check (meta_mensal_centavos is null or meta_mensal_centavos > 0),
  metas_categoria      jsonb not null default '{}'::jsonb,
  atualizado_em        timestamptz not null default now()
);
alter table public.preferencias add column if not exists meta_mensal_centavos bigint
  check (meta_mensal_centavos is null or meta_mensal_centavos > 0);
alter table public.preferencias add column if not exists metas_categoria jsonb not null default '{}'::jsonb;

-- 3) Gastos fixos (lançados automaticamente todo mês)
create table if not exists public.gastos_fixos (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  descricao          text not null check (char_length(descricao) between 1 and 80),
  valor_centavos     bigint not null check (valor_centavos > 0),
  categoria          text not null,
  conta              text not null,
  dia                smallint not null check (dia between 1 and 31),
  ativo              boolean not null default true,
  ultimo_mes_lancado text check (ultimo_mes_lancado ~ '^\d{4}-\d{2}$'),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index if not exists gastos_fixos_user_idx on public.gastos_fixos (user_id);

-- 4) Ações: cada compra ou venda
create table if not exists public.acoes_ops (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker         text not null check (ticker ~ '^[A-Z0-9.^=-]{1,15}$'),
  tipo           text not null check (tipo in ('compra', 'venda')),
  quantidade     numeric(20, 8) not null check (quantidade > 0),
  preco          numeric(20, 8) not null check (preco > 0),
  taxas_centavos bigint not null default 0 check (taxas_centavos >= 0),
  data           date not null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists acoes_ops_user_idx on public.acoes_ops (user_id, ticker);

-- 5) Renda fixa: caixinhas e seus aportes/resgates
create table if not exists public.caixinhas (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome           text not null check (char_length(nome) between 1 and 60),
  percentual_cdi numeric(7, 2) not null default 100 check (percentual_cdi > 0 and percentual_cdi <= 1000),
  saldo_conferido_centavos bigint check (saldo_conferido_centavos is null or saldo_conferido_centavos >= 0),
  saldo_conferido_em       date,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
-- saldo conferido com o banco (para bancos criados antes dessas colunas existirem)
alter table public.caixinhas add column if not exists saldo_conferido_centavos bigint
  check (saldo_conferido_centavos is null or saldo_conferido_centavos >= 0);
alter table public.caixinhas add column if not exists saldo_conferido_em date;
create index if not exists caixinhas_user_idx on public.caixinhas (user_id);

create table if not exists public.caixinha_movs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  caixinha_id    uuid not null references public.caixinhas (id) on delete cascade,
  tipo           text not null check (tipo in ('aporte', 'resgate')),
  valor_centavos bigint not null check (valor_centavos > 0),
  data           date not null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists caixinha_movs_user_idx on public.caixinha_movs (user_id);
create index if not exists caixinha_movs_caixinha_idx on public.caixinha_movs (caixinha_id);

-- 6) Segurança: cada usuário só enxerga e altera as próprias linhas (RLS)
drop policy if exists "preferencias: ler as proprias"     on public.preferencias;
drop policy if exists "preferencias: inserir as proprias" on public.preferencias;
drop policy if exists "preferencias: alterar as proprias" on public.preferencias;
do $$
declare t text;
begin
  foreach t in array array['lancamentos', 'preferencias', 'gastos_fixos', 'acoes_ops', 'caixinhas', 'caixinha_movs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ': ler os proprios', t);
    execute format('drop policy if exists %I on public.%I', t || ': inserir os proprios', t);
    execute format('drop policy if exists %I on public.%I', t || ': alterar os proprios', t);
    execute format('drop policy if exists %I on public.%I', t || ': excluir os proprios', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || ': ler os proprios', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || ': inserir os proprios', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || ': alterar os proprios', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || ': excluir os proprios', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Movimento só pode apontar para uma caixinha do próprio usuário
drop policy if exists "caixinha_movs: inserir os proprios" on public.caixinha_movs;
drop policy if exists "caixinha_movs: alterar os proprios" on public.caixinha_movs;
create policy "caixinha_movs: inserir os proprios" on public.caixinha_movs
  for insert to authenticated
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.caixinhas c where c.id = caixinha_id and c.user_id = (select auth.uid())));
create policy "caixinha_movs: alterar os proprios" on public.caixinha_movs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.caixinhas c where c.id = caixinha_id and c.user_id = (select auth.uid())));
