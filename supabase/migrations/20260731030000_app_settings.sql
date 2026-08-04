-- PRATA - Tela de Configurações (Meu Perfil / Conta e Workspace)
-- Sem sistema de login ainda: cada tabela guarda uma única linha fixa
-- (id = 'singleton'), representando "o" usuário/workspace do PRATA.

create table public.app_profile (
  id text primary key default 'singleton' check (id = 'singleton'),
  full_name text,
  phone text,
  role text,
  department text,
  timezone text,
  language text,
  updated_at timestamptz not null default now()
);

create table public.app_workspace (
  id text primary key default 'singleton' check (id = 'singleton'),
  company_name text,
  cnpj text,
  segment text,
  website text,
  phone text,
  contact_email text,
  address text,
  primary_color text,
  account_owner text,
  updated_at timestamptz not null default now()
);

alter table public.app_profile enable row level security;
alter table public.app_workspace enable row level security;

create policy "public access" on public.app_profile for all using (true) with check (true);
create policy "public access" on public.app_workspace for all using (true) with check (true);

insert into public.app_profile (id) values ('singleton');
insert into public.app_workspace (id) values ('singleton');
