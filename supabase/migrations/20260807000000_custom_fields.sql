-- PRATA - Campos personalizados / Solicitações de dados por cliente
-- A agência define quais dados precisa que o cliente preencha (vendas
-- presenciais, faturamento offline, cancelamentos, etc.) sem precisar de uma
-- coluna física nova no banco a cada campo novo — estrutura EAV flexível:
-- 1 tabela de DEFINIÇÃO do campo (custom_fields) + 1 tabela de VALORES
-- preenchidos (custom_field_values), com uma coluna de valor por tipo de
-- dado (value_text/value_number/value_date/value_boolean/value_options).

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  name text not null,
  description text,
  field_type text not null check (field_type in (
    'number', 'currency', 'percentage', 'text_short', 'text_long',
    'date', 'boolean', 'single_select', 'multi_select'
  )),
  options jsonb,
  frequency text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly', 'on_demand')),
  required boolean not null default false,
  category text,
  unit text,
  -- Preparação para mapear o campo pra uma métrica do PRATA no futuro —
  -- guardado, mas ainda não usado em nenhum cálculo (ver relatório de entrega).
  metric_mapping text not null default 'none' check (metric_mapping in (
    'none', 'revenue', 'sales', 'leads', 'conversions', 'cancellations', 'service', 'custom'
  )),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text
);

create table public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  client_slug text not null references public.clients(slug) on delete cascade,
  -- Bucket de período a que esse preenchimento se refere (dia, segunda da
  -- semana, 1º/16º do mês, etc. — calculado em código a partir da
  -- frequência do campo). Um valor por (field_id, period_date): reenviar no
  -- mesmo período faz upsert em vez de duplicar linha.
  period_date date not null,
  value_text text,
  value_number numeric,
  value_date date,
  value_boolean boolean,
  value_options jsonb,
  submitted_by text,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted', 'pending_review')),
  unique (field_id, period_date)
);

alter table public.custom_fields enable row level security;
alter table public.custom_field_values enable row level security;

-- Mesmo padrão do resto do PRATA hoje: sem sistema de login por cliente
-- ainda, então liberado pra chave anon. Ver ressalvas de segurança no
-- relatório de entrega — isso é o ponto que mais precisa de atenção antes
-- de expor o portal do cliente publicamente.
create policy "public access" on public.custom_fields for all using (true) with check (true);
create policy "public access" on public.custom_field_values for all using (true) with check (true);
