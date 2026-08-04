-- PRATA - Radar de Empresas: integração com Google Places (Text Search + Details)
-- A tabela radar_companies já existia (fase 1) mas nunca foi conectada a uma
-- busca real — ficava só sincronizada com um array mockado no front-end.
-- Aqui adicionamos os campos vindos do Google Places, com place_id como
-- identificador único pra evitar duplicidade ao "Adicionar ao Radar".

alter table public.radar_companies
  add column if not exists place_id text unique,
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists rating numeric,
  add column if not exists rating_count integer,
  add column if not exists business_status text,
  add column if not exists open_now boolean,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists google_maps_url text,
  add column if not exists added_owner text;
