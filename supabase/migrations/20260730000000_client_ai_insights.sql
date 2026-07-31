-- PRATA - Cache de Insights Estratégicos gerados por IA (por cliente)
-- Evita chamar a OpenAI toda vez que o dashboard do cliente é aberto: o
-- insight só é regerado quando o fingerprint dos dados reais do cliente muda
-- (nova importação, valores diferentes) ou quando ainda não existe cache.

create table public.client_ai_insights (
  client_slug text primary key references public.clients(slug) on delete cascade,
  insights jsonb not null default '[]'::jsonb,
  data_fingerprint text not null,
  generated_at timestamptz not null default now()
);

alter table public.client_ai_insights enable row level security;
create policy "public access" on public.client_ai_insights for all using (true) with check (true);
