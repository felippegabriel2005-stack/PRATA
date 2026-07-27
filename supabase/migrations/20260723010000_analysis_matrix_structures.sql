-- PRATA - Persiste a estrutura (linhas/métricas) de cada aba de análise por cliente.
-- Guarda uma única coluna jsonb com o array conversaoRows inteiro (nome da linha +
-- lista de métricas), pra sobreviver a exclusões de linha, edições de estrutura e
-- criação de novas abas de análise personalizadas.

create table public.analysis_matrix_structures (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null references public.clients(slug) on delete cascade,
  analysis_id text not null,
  rows jsonb not null,
  updated_at timestamptz not null default now(),
  unique (client_slug, analysis_id)
);

alter table public.analysis_matrix_structures enable row level security;
create policy "public access" on public.analysis_matrix_structures for all using (true) with check (true);
