-- PRATA - Camada de dados real/importável (campanhas, leads e vendas, metas)
-- Substitui os dados mockados de dashboard/análise por dados vindos de planilha.

-- Campos novos na tabela de clientes (planilha "Clientes")
alter table public.clients
  add column if not exists segment text,
  add column if not exists owner text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists active boolean not null default true;

-- Métricas de campanha por dia (planilha "Campanhas"). Uma linha por
-- cliente+campanha+plataforma+data; reimportar a mesma linha atualiza em vez
-- de duplicar. Não existe um "campaign_id" técnico: o sistema identifica a
-- campanha pela combinação (cliente, nome da campanha, plataforma).
create table public.campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  date date not null,
  campaign_name text not null,
  platform text not null,
  objective text,
  campaign_status text,
  invest numeric not null default 0,
  impressions numeric not null default 0,
  reach numeric not null default 0,
  clicks numeric not null default 0,
  link_clicks numeric not null default 0,
  page_views numeric not null default 0,
  leads numeric not null default 0,
  conversions numeric not null default 0,
  purchases numeric not null default 0,
  revenue numeric not null default 0,
  messages_started numeric not null default 0,
  forms_submitted numeric not null default 0,
  video_views numeric not null default 0,
  thruplay numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (client_slug, campaign_name, platform, date)
);

-- Leads e vendas (planilha "Leads e Vendas") — funil comercial, origem dos
-- leads, motivos de perda e receita. Diferente do pipeline (kanban) que já
-- existe em commercial_leads/commercial_stages.
create table public.leads_sales (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  date date not null,
  lead_name text,
  company text,
  phone text,
  email text,
  source text,
  campaign_name text,
  owner text,
  stage text,
  status text,
  sale_value numeric not null default 0,
  revenue numeric not null default 0,
  loss_reason text,
  created_at timestamptz not null default now(),
  unique (client_slug, lead_name, date)
);

-- Metas por cliente + objetivo (aba opcional "Metas")
create table public.targets (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  objective text not null,
  metric_name text not null,
  target_value numeric,
  target_format text,
  rule text,
  created_at timestamptz not null default now(),
  unique (client_slug, objective, metric_name)
);

alter table public.campaign_metrics enable row level security;
create policy "public access" on public.campaign_metrics for all using (true) with check (true);

alter table public.leads_sales enable row level security;
create policy "public access" on public.leads_sales for all using (true) with check (true);

alter table public.targets enable row level security;
create policy "public access" on public.targets for all using (true) with check (true);
