-- PRATA - Anexos de documentos no Pipeline Comercial
-- Guarda metadados dos arquivos anexados a cada lead (o arquivo em si vai
-- pro Supabase Storage, bucket "lead-attachments", já criado via API).

create table public.commercial_lead_attachments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

alter table public.commercial_lead_attachments enable row level security;
create policy "public access" on public.commercial_lead_attachments for all using (true) with check (true);

-- Sem sistema de login no PRATA ainda: libera leitura/escrita no bucket de
-- anexos pra chave anon, mesmo padrão já usado nas outras tabelas.
create policy "public insert lead-attachments" on storage.objects
  for insert with check (bucket_id = 'lead-attachments');

create policy "public select lead-attachments" on storage.objects
  for select using (bucket_id = 'lead-attachments');

create policy "public delete lead-attachments" on storage.objects
  for delete using (bucket_id = 'lead-attachments');
