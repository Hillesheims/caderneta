-- Saldo conferido com o banco: o app parte desse valor na data informada e soma o CDI dali pra frente.
-- Não apaga nada: só acrescenta duas colunas opcionais em public.caixinhas.
alter table public.caixinhas
  add column if not exists saldo_conferido_centavos bigint
    check (saldo_conferido_centavos is null or saldo_conferido_centavos >= 0);
alter table public.caixinhas
  add column if not exists saldo_conferido_em date;
