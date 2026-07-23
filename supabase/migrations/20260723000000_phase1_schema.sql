-- PRATA - Fase 1: clientes, colaboradores, pipeline comercial e análises de cliente
-- Estas são as áreas que já eram estado editável (antes em localStorage / apenas em memória).
-- Os dashboards de métricas (agencyPeriodData, clientDetailedData) continuam mockados por enquanto.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  status text not null default 'healthy' check (status in ('healthy','attention','critical')),
  pinned boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  email text not null,
  status text not null default 'Ativo' check (status in ('Ativo','Suspenso')),
  created_at timestamptz not null default now()
);

create table public.commercial_stages (
  id text primary key,
  name text not null,
  color text not null,
  position integer not null default 0
);

create table public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage_id text references public.commercial_stages(id) on delete set null,
  tag text,
  phone text,
  email text,
  role text,
  bu text,
  potential_value numeric not null default 0,
  negotiation text,
  loss_reason text,
  first_contact_date text,
  owner text,
  source text,
  next_action text,
  created_at timestamptz not null default now()
);

create table public.radar_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text,
  employees text,
  revenue text,
  decision_maker text,
  mapped boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.client_analyses (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  analysis_id text not null,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (client_slug, analysis_id)
);

-- RLS: sem sistema de login ainda no PRATA, então liberamos leitura/escrita
-- para a chave anon (front-end). Quando houver autenticação, trocar estas
-- políticas por regras baseadas em auth.uid().
alter table public.clients enable row level security;
alter table public.collaborators enable row level security;
alter table public.commercial_stages enable row level security;
alter table public.commercial_leads enable row level security;
alter table public.radar_companies enable row level security;
alter table public.client_analyses enable row level security;

create policy "public access" on public.clients for all using (true) with check (true);
create policy "public access" on public.collaborators for all using (true) with check (true);
create policy "public access" on public.commercial_stages for all using (true) with check (true);
create policy "public access" on public.commercial_leads for all using (true) with check (true);
create policy "public access" on public.radar_companies for all using (true) with check (true);
create policy "public access" on public.client_analyses for all using (true) with check (true);

-- Seed: preserva exatamente o que já existe hoje em código/localStorage.

insert into public.clients (slug, name, status, pinned, position) values
  ('drex', 'Drex Imóveis', 'healthy', true, 0),
  ('orion', 'Orion Tech', 'healthy', true, 1),
  ('lumera', 'Lumera Saúde', 'attention', true, 2),
  ('volks', 'Volks B2B', 'critical', true, 3),
  ('nexa-edu', 'Nexa Edu', 'healthy', false, 4),
  ('agrovale', 'AgroVale', 'attention', false, 5),
  ('retailmax', 'RetailMax', 'attention', false, 6),
  ('real-estate-pro', 'Real Estate Pro', 'healthy', false, 7);

insert into public.collaborators (name, role, email, status) values
  ('Caio Breno Carvalho de Freitas', 'SDR', 'caio.freitas@superaholdings.com.br', 'Ativo'),
  ('cerqueira.felipe', 'Hunter', 'cerqueira.felipe@outlook.com', 'Ativo'),
  ('felippe.alves', 'Hunter', 'felippe.alves@superaholdings.com.br', 'Ativo'),
  ('Marcelo Lira', 'Gestor(a) de Hunters', 'marcelo.lira@superaholdings.com.br', 'Ativo'),
  ('Mayara Cristina Da Silva', 'SDR', 'mayara.silva@superaholdings.com.br', 'Ativo');

insert into public.commercial_stages (id, name, color, position) values
  ('abordagem', 'Em abordagem', '#3b82f6', 0),
  ('qualificado', 'Lead qualificado', '#10b981', 1),
  ('reuniao', 'Reunião agendada', '#8b5cf6', 2),
  ('proposta', 'Proposta enviada', '#f97316', 3),
  ('followup', 'Follow-up proposta', '#f59e0b', 4),
  ('fechado', 'Fechado/Ganho', '#10b981', 5),
  ('descartado', 'Descartado/Perdido', '#ef4444', 6);

insert into public.commercial_leads (name, stage_id, tag, phone, email, role, bu, potential_value, negotiation, loss_reason, first_contact_date, owner, source, next_action) values
  ('OralGold Clínica Odontológica', 'abordagem', 'Saúde', '+55 11 2441-8833', 'contato@oralgold.com.br', 'Diretor Clínico', 'Clínicas Privadas', 0, '-', '-', '26/06/2026', 'Mayara Cristina Da Silva', 'Radar de empresas', 'Primeiro contato'),
  ('Startup TechX', 'qualificado', 'Tecnologia', '+55 11 98877-6655', 'ceo@techx.co', 'Co-Founder & CTO', 'SaaS Enterprise', 8000, '-', '-', '26/06/2026', 'Mayara Cristina Da Silva', 'LinkedIn', 'Apresentar case'),
  ('Crosst-it GRU', 'reuniao', 'Academia', '+55 11 97823-4411', 'contato@crossitgru.com.br', 'Sócio Administrador', 'Crossfit Box', 2400, '-', '-', '26/06/2026', 'Caio Breno Carvalho de Freitas', 'Radar de empresas', 'Reunião marcada para sexta'),
  ('Drex Imóveis', 'proposta', 'Imobiliário', '+55 11 91485-9517', 'diretoria@dreximoveis.com.br', 'Diretor Comercial', 'Vendas Internas', 4800, 'Em negociação', '-', '26/06/2026', 'felippe.alves', 'Indicação', 'Enviar proposta'),
  ('Sushi Hiroshi', 'followup', 'Alimentação', '+55 11 3285-7788', 'hiroshi@sushihiroshi.com.br', 'Proprietário', 'Restaurantes', 3200, 'Aguardando retorno', '-', '26/06/2026', 'felippe.alves', 'Evento', 'Follow-up amanhã');

insert into public.radar_companies (name, segment, employees, revenue, decision_maker, mapped) values
  ('Mundial Alimentos', 'Alimentos', '150-200', 'R$ 12M - 15M', 'Roberto Souza (Diretor)', false),
  ('TechCore Solutions', 'Tecnologia', '50-100', 'R$ 8M - 10M', 'Clara Mendes (Head de Vendas)', false),
  ('Vortex Logística', 'Logística', '200+', 'R$ 20M+', 'Joaquim Costa (COO)', false),
  ('Clínica Sorella', 'Saúde', '20-50', 'R$ 3M - 5M', 'Dr. André Lima (Proprietário)', false),
  ('AgroVale S/A', 'Agronegócio', '100-150', 'R$ 15M - 20M', 'Mariana Alves (Diretora)', false);

insert into public.client_analyses (client_slug, analysis_id, name, position)
select c.slug, a.analysis_id, a.name, a.position
from (values
  ('drex'), ('orion'), ('lumera'), ('volks')
) as c(slug)
cross join (values
  ('visao', 'Visão geral', 0),
  ('video', 'VideoView', 1),
  ('conversao', 'Conversão', 2),
  ('whatsapp', 'Captação WhatsApp', 3),
  ('fbleads', 'Captação FB Leads', 4),
  ('pesquisa', 'Pesquisa', 5),
  ('vendas', 'Vendas', 6),
  ('download', 'Download de aplicativo', 7),
  ('personalizado', 'Personalizado', 8)
) as a(analysis_id, name, position);
