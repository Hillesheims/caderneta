-- Caderneta · investimentos (ações e caixinhas), metas de gastos e gastos fixos
-- Aplicada no projeto em 06/10/2026.

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

alter table public.lancamentos add column if not exists fixo_id uuid;
create index if not exists lancamentos_fixo_idx on public.lancamentos (fixo_id) where fixo_id is not null;

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

create table if not exists public.caixinhas (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome           text not null check (char_length(nome) between 1 and 60),
  percentual_cdi numeric(7, 2) not null default 100 check (percentual_cdi > 0 and percentual_cdi <= 1000),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
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

alter table public.preferencias add column if not exists meta_mensal_centavos bigint
  check (meta_mensal_centavos is null or meta_mensal_centavos > 0);
alter table public.preferencias add column if not exists metas_categoria jsonb not null default '{}'::jsonb;

alter table public.gastos_fixos  enable row level security;
alter table public.acoes_ops     enable row level security;
alter table public.caixinhas     enable row level security;
alter table public.caixinha_movs enable row level security;

create policy "gastos_fixos: ler os proprios" on public.gastos_fixos for select to authenticated using ((select auth.uid()) = user_id);
create policy "gastos_fixos: inserir os proprios" on public.gastos_fixos for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "gastos_fixos: alterar os proprios" on public.gastos_fixos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "gastos_fixos: excluir os proprios" on public.gastos_fixos for delete to authenticated using ((select auth.uid()) = user_id);

create policy "acoes_ops: ler os proprios" on public.acoes_ops for select to authenticated using ((select auth.uid()) = user_id);
create policy "acoes_ops: inserir os proprios" on public.acoes_ops for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "acoes_ops: alterar os proprios" on public.acoes_ops for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "acoes_ops: excluir os proprios" on public.acoes_ops for delete to authenticated using ((select auth.uid()) = user_id);

create policy "caixinhas: ler os proprios" on public.caixinhas for select to authenticated using ((select auth.uid()) = user_id);
create policy "caixinhas: inserir os proprios" on public.caixinhas for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "caixinhas: alterar os proprios" on public.caixinhas for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "caixinhas: excluir os proprios" on public.caixinhas for delete to authenticated using ((select auth.uid()) = user_id);

create policy "caixinha_movs: ler os proprios" on public.caixinha_movs for select to authenticated using ((select auth.uid()) = user_id);
create policy "caixinha_movs: inserir os proprios" on public.caixinha_movs for insert to authenticated
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.caixinhas c where c.id = caixinha_id and c.user_id = (select auth.uid())));
create policy "caixinha_movs: alterar os proprios" on public.caixinha_movs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.caixinhas c where c.id = caixinha_id and c.user_id = (select auth.uid())));
create policy "caixinha_movs: excluir os proprios" on public.caixinha_movs for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.gastos_fixos, public.acoes_ops, public.caixinhas, public.caixinha_movs to authenticated;
