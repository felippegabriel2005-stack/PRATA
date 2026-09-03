-- ============================================================================
-- Schema + views + usuário só-leitura pra integrações externas (agente de IA
-- no n8n via WhatsApp) explorarem o banco livremente por SQL SEM poder
-- calcular "venda"/"receita"/"funil" diferente do que o dashboard mostra.
--
-- Motivo: o agente mantém a tool de Postgres livre (SQL escrito pelo próprio
-- modelo), mas em vez de apontar pras tabelas cruas (public.*), passa a
-- apontar só pro schema prata_agent — que expõe as MESMAS tabelas só que já
-- com a regra de negócio aplicada (a mesma regra de api/_lib/prata-core.js:
-- venda = sale_value > 0, portal ganha do importado no mesmo dia sem somar
-- os dois, funil comercial vem de leads_sales.stage nunca misturado com
-- métrica de mídia). Qualquer SQL livre contra essas views chega sempre no
-- mesmo número que o dashboard e a API /api/kpis mostram, porque a conta já
-- foi feita — o agente só filtra/agrupa/ordena o que já está certo.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase (dashboard do projeto
-- > SQL Editor > New query). Troque a senha marcada abaixo antes de rodar,
-- ou troque depois com ALTER ROLE ... PASSWORD '...'.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS prata_agent;

-- ----------------------------------------------------------------------------
-- v_clients — lookup básico de cliente (o agente não tem acesso a
-- public.clients diretamente, então precisa de uma cópia aqui pra resolver
-- nome -> slug e vice-versa).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_clients AS
SELECT slug, name
FROM public.clients;

-- ----------------------------------------------------------------------------
-- v_client_sales_daily — A DEFINIÇÃO OFICIAL DE "VENDA", por dia.
-- Uma linha por (cliente, dia) onde existe alguma venda resolvida. Portal
-- ganha do importado no MESMO dia (nunca soma os dois); dias diferentes
-- somam normalmente. "venda" no histórico importado = sale_value > 0 (não é
-- stage/status — hoje coincide na prática, mas a regra de verdade é essa).
-- Somar "vendas" nesta view num intervalo de datas = exatamente o
-- vendas_reais que o dashboard e /api/kpis?action=client_kpis mostram.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_sales_daily AS
WITH imported AS (
  SELECT client_slug, date, COUNT(*)::numeric AS vendas
  FROM public.leads_sales
  WHERE COALESCE(sale_value, 0) > 0
  GROUP BY client_slug, date
),
portal_fields AS (
  SELECT id AS field_id, client_slug
  FROM public.custom_fields
  WHERE active = true AND metric_mapping = 'sales'
),
portal AS (
  SELECT v.client_slug, v.period_date AS date, SUM(v.value_number) AS vendas
  FROM public.custom_field_values v
  JOIN portal_fields f ON f.field_id = v.field_id AND f.client_slug = v.client_slug
  GROUP BY v.client_slug, v.period_date
),
all_dates AS (
  SELECT client_slug, date FROM imported
  UNION
  SELECT client_slug, date FROM portal
)
SELECT
  d.client_slug,
  c.name AS client_name,
  d.date,
  COALESCE(p.vendas, i.vendas) AS vendas,
  CASE WHEN p.vendas IS NOT NULL THEN 'portal' ELSE 'import' END AS fonte
FROM all_dates d
LEFT JOIN imported i ON i.client_slug = d.client_slug AND i.date = d.date
LEFT JOIN portal p ON p.client_slug = d.client_slug AND p.date = d.date
JOIN public.clients c ON c.slug = d.client_slug;

-- ----------------------------------------------------------------------------
-- v_client_revenue_daily — mesma ideia, pra receita comercial (não confundir
-- com receita de mídia, que é v_client_media_daily.media_revenue).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_revenue_daily AS
WITH imported AS (
  SELECT client_slug, date, SUM(COALESCE(NULLIF(revenue, 0), sale_value)) AS receita
  FROM public.leads_sales
  WHERE COALESCE(NULLIF(revenue, 0), sale_value, 0) > 0
  GROUP BY client_slug, date
),
portal_fields AS (
  SELECT id AS field_id, client_slug
  FROM public.custom_fields
  WHERE active = true AND metric_mapping = 'revenue'
),
portal AS (
  SELECT v.client_slug, v.period_date AS date, SUM(v.value_number) AS receita
  FROM public.custom_field_values v
  JOIN portal_fields f ON f.field_id = v.field_id AND f.client_slug = v.client_slug
  GROUP BY v.client_slug, v.period_date
),
all_dates AS (
  SELECT client_slug, date FROM imported
  UNION
  SELECT client_slug, date FROM portal
)
SELECT
  d.client_slug,
  c.name AS client_name,
  d.date,
  COALESCE(p.receita, i.receita) AS receita,
  CASE WHEN p.receita IS NOT NULL THEN 'portal' ELSE 'import' END AS fonte
FROM all_dates d
LEFT JOIN imported i ON i.client_slug = d.client_slug AND i.date = d.date
LEFT JOIN portal p ON p.client_slug = d.client_slug AND p.date = d.date
JOIN public.clients c ON c.slug = d.client_slug;

-- ----------------------------------------------------------------------------
-- v_client_media_daily — pass-through limpo de campaign_metrics (uma linha
-- por campanha por dia). "media_revenue" é a receita atribuída pelo próprio
-- anúncio — NUNCA é a mesma coisa que a receita comercial de
-- v_client_revenue_daily (ver client_kpis_summary pra entender a prioridade
-- entre as duas).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_media_daily AS
SELECT
  cm.client_slug,
  c.name AS client_name,
  cm.date,
  cm.platform,
  cm.campaign_name,
  cm.objective,
  cm.campaign_status,
  cm.invest,
  cm.impressions,
  cm.clicks,
  cm.page_views,
  cm.leads,
  cm.conversions,
  cm.messages_started,
  cm.revenue AS media_revenue
FROM public.campaign_metrics cm
JOIN public.clients c ON c.slug = cm.client_slug;

-- ----------------------------------------------------------------------------
-- v_client_leads — pipeline comercial real, um lead por linha (etapa,
-- motivo de perda, valor de venda). stage_order dá a ordem de progressão
-- real (Descartado = 99, fora da sequência — é uma saída, não um avanço).
-- Serve tanto pro "funil comercial" (GROUP BY stage) quanto pros "motivos
-- de perda" (WHERE loss_reason IS NOT NULL GROUP BY loss_reason).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_leads AS
SELECT
  ls.client_slug,
  c.name AS client_name,
  ls.date,
  ls.lead_name,
  ls.company,
  ls.source,
  ls.campaign_name,
  ls.owner,
  ls.stage,
  CASE ls.stage
    WHEN 'Novo' THEN 1
    WHEN 'Em abordagem' THEN 2
    WHEN 'Qualificado' THEN 3
    WHEN 'Atendido' THEN 4
    WHEN 'Proposta enviada' THEN 5
    WHEN 'Venda' THEN 6
    WHEN 'Descartado' THEN 99
    ELSE 50
  END AS stage_order,
  ls.status,
  ls.sale_value,
  ls.revenue,
  ls.loss_reason
FROM public.leads_sales ls
JOIN public.clients c ON c.slug = ls.client_slug;

-- ----------------------------------------------------------------------------
-- v_client_custom_field_values — campos do portal do cliente + valores
-- enviados. Esta é a tabela que o schema antigo do agente não conhecia —
-- causa raiz de boa parte da divergência com o dashboard (vendas/receita
-- informadas pelo cliente no portal, sem lead individual em leads_sales).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_custom_field_values AS
SELECT
  f.client_slug,
  c.name AS client_name,
  f.name AS field_name,
  f.field_type,
  f.metric_mapping,
  f.frequency,
  f.required,
  f.active,
  f.unit,
  v.period_date,
  v.value_number,
  v.value_text,
  v.value_options,
  v.value_boolean,
  v.value_date,
  v.submitted_by,
  v.submitted_at
FROM public.custom_fields f
JOIN public.clients c ON c.slug = f.client_slug
LEFT JOIN public.custom_field_values v ON v.field_id = f.id AND v.client_slug = f.client_slug;

-- ----------------------------------------------------------------------------
-- v_client_targets — meta x realizado por métrica cadastrada em "Metas".
-- "realizado" é sempre all-time (agregado de todo o campaign_metrics do
-- cliente) — filtre por v_client_media_daily.date à parte se quiser um
-- "realizado" recortado por período; targets em si não têm período próprio.
-- A tradução de metric_name (rótulo em português digitado por humano, tipo
-- "Taxa de Conversão"/"Custo por conversa") pra métrica interna é a MESMA
-- normalização de normalizeMetricNameToKey (api/_lib/prata-core.js) — sem
-- ela, a comparação nunca batia (bug real que existia até esta correção;
-- ver commit "Adiciona 4 novas actions ao /api/kpis + corrige metas nunca
-- comparadas").
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_targets AS
SELECT
  client_slug, client_name, metric_name, objective, rule, target_value, realizado,
  CASE
    WHEN realizado IS NULL OR target_value IS NULL OR target_value = 0 THEN 'sem_dado_suficiente'
    WHEN rule ILIKE '%menor%' AND realizado / target_value > 1.3 THEN 'fora_da_meta'
    WHEN rule ILIKE '%menor%' AND realizado / target_value > 1.1 THEN 'levemente_fora_da_meta'
    WHEN rule ILIKE '%menor%' THEN 'dentro_da_meta'
    WHEN rule ILIKE '%maior%' AND target_value / realizado > 1.3 THEN 'fora_da_meta'
    WHEN rule ILIKE '%maior%' AND target_value / realizado > 1.1 THEN 'levemente_fora_da_meta'
    WHEN rule ILIKE '%maior%' THEN 'dentro_da_meta'
    ELSE 'sem_regra_de_direcao'
  END AS status
FROM (
  SELECT
    nt.client_slug,
    c.name AS client_name,
    nt.metric_name,
    nt.objective,
    nt.rule,
    nt.target_value,
    CASE nt.metric_key
      WHEN 'invest' THEN a.invest
      WHEN 'impress' THEN a.impress
      WHEN 'clicks' THEN a.clicks
      WHEN 'views' THEN a.views
      WHEN 'leads' THEN a.leads
      WHEN 'convs' THEN a.convs
      WHEN 'cpa' THEN a.cpa
      WHEN 'cpc' THEN a.cpc
      WHEN 'cpl' THEN a.cpl
      WHEN 'cpm' THEN a.cpm
      WHEN 'ctr' THEN a.ctr
      WHEN 'convrate' THEN a.convrate
      WHEN 'roas' THEN a.roas
      WHEN 'custo_por_conversa' THEN a.custo_por_conversa
      ELSE NULL
    END AS realizado
  FROM (
    SELECT
      t.*,
      CASE lower(trim(t.metric_name))
        WHEN 'ctr' THEN 'ctr'
        WHEN 'cpa' THEN 'cpa'
        WHEN 'cpc' THEN 'cpc'
        WHEN 'cpl' THEN 'cpl'
        WHEN 'cpm' THEN 'cpm'
        WHEN 'roas' THEN 'roas'
        WHEN 'taxa de conversão' THEN 'convrate'
        WHEN 'taxa de conversao' THEN 'convrate'
        WHEN 'custo por conversa' THEN 'custo_por_conversa'
        WHEN 'investimento' THEN 'invest'
        WHEN 'impressões' THEN 'impress'
        WHEN 'impressoes' THEN 'impress'
        WHEN 'cliques' THEN 'clicks'
        WHEN 'leads' THEN 'leads'
        WHEN 'conversões' THEN 'convs'
        WHEN 'conversoes' THEN 'convs'
        ELSE lower(trim(t.metric_name))
      END AS metric_key
    FROM public.targets t
  ) nt
  JOIN public.clients c ON c.slug = nt.client_slug
  LEFT JOIN (
    SELECT
      client_slug,
      SUM(invest) AS invest,
      SUM(impressions) AS impress,
      SUM(clicks) AS clicks,
      SUM(page_views) AS views,
      SUM(leads) AS leads,
      SUM(conversions) AS convs,
      CASE WHEN SUM(conversions) > 0 THEN SUM(invest) / SUM(conversions) END AS cpa,
      CASE WHEN SUM(clicks) > 0 THEN SUM(invest) / SUM(clicks) END AS cpc,
      CASE WHEN SUM(leads) > 0 THEN SUM(invest) / SUM(leads) END AS cpl,
      CASE WHEN SUM(impressions) > 0 THEN (SUM(invest) / SUM(impressions)) * 1000 END AS cpm,
      CASE WHEN SUM(impressions) > 0 THEN (SUM(clicks)::numeric / SUM(impressions)) * 100 END AS ctr,
      CASE WHEN SUM(page_views) > 0 THEN (SUM(conversions)::numeric / SUM(page_views)) * 100 END AS convrate,
      CASE WHEN SUM(invest) > 0 THEN SUM(revenue) / SUM(invest) END AS roas,
      CASE WHEN SUM(messages_started) > 0 THEN SUM(invest) / SUM(messages_started) END AS custo_por_conversa
    FROM public.campaign_metrics
    GROUP BY client_slug
  ) a ON a.client_slug = nt.client_slug
) resolved;

-- ----------------------------------------------------------------------------
-- v_client_kpis_summary — um resumo por cliente (all-time), equivalente ao
-- /api/kpis?action=client_kpis sem from/to. Útil pra uma primeira leitura
-- rápida sem escrever agregação nenhuma; pra período específico, use
-- v_client_sales_daily/v_client_revenue_daily/v_client_media_daily com
-- WHERE date BETWEEN ... AND ... e agregue você mesmo (o resultado será
-- automaticamente correto, porque a resolução portal-x-importado por dia já
-- está feita nessas views).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW prata_agent.v_client_kpis_summary AS
WITH media AS (
  SELECT
    client_slug,
    SUM(invest) AS invest,
    SUM(conversions) AS conversions,
    SUM(leads) AS leads,
    SUM(revenue) AS media_revenue
  FROM public.campaign_metrics
  GROUP BY client_slug
),
sales AS (
  SELECT client_slug, SUM(vendas) AS vendas_reais, MAX(fonte) AS vendas_fonte_amostra
  FROM prata_agent.v_client_sales_daily
  GROUP BY client_slug
),
revenue AS (
  SELECT client_slug, SUM(receita) AS receita_comercial
  FROM prata_agent.v_client_revenue_daily
  GROUP BY client_slug
)
SELECT
  c.slug AS client_slug,
  c.name AS client_name,
  COALESCE(m.invest, 0) AS investimento_total,
  COALESCE(r.receita_comercial, m.media_revenue, 0) AS receita_total,
  CASE WHEN r.receita_comercial IS NOT NULL THEN 'comercial (importação/portal)' ELSE 'mídia (campanhas)' END AS receita_fonte,
  s.vendas_reais,
  COALESCE(m.conversions, 0) AS conversoes_de_midia,
  COALESCE(m.leads, 0) AS leads,
  CASE WHEN COALESCE(m.invest, 0) > 0 THEN ROUND(((COALESCE(r.receita_comercial, m.media_revenue, 0) - m.invest) / m.invest) * 100, 1) END AS roi_percentual
FROM public.clients c
LEFT JOIN media m ON m.client_slug = c.slug
LEFT JOIN sales s ON s.client_slug = c.slug
LEFT JOIN revenue r ON r.client_slug = c.slug;

-- ============================================================================
-- Usuário/role só-leitura, enxergando SÓ o schema prata_agent — troque a
-- senha abaixo antes de rodar. É essa credencial que vai no node Postgres
-- do n8n (não o service_role key nem o Postgres do dono do projeto).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prata_agent_reader') THEN
    CREATE ROLE prata_agent_reader LOGIN PASSWORD 'mpNrXHSeKaCikrRA6HFEZSYhSTBRx0C';
  END IF;
END
$$;

ALTER ROLE prata_agent_reader NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE prata_agent_reader SET search_path TO prata_agent;

-- Garante que essa credencial não enxerga NADA fora de prata_agent — nem o
-- schema public com as tabelas cruas, nem outros schemas do Supabase.
REVOKE ALL ON SCHEMA public FROM prata_agent_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM prata_agent_reader;

GRANT USAGE ON SCHEMA prata_agent TO prata_agent_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA prata_agent TO prata_agent_reader;

-- Views criadas DEPOIS deste script também ficam visíveis automaticamente
-- pro mesmo usuário, sem precisar rodar GRANT de novo toda vez.
ALTER DEFAULT PRIVILEGES IN SCHEMA prata_agent GRANT SELECT ON TABLES TO prata_agent_reader;

-- ============================================================================
-- IMPORTANTE — eu (Claude) não tenho uma conexão Postgres direta com esse
-- projeto, só a REST API (service_role key), que não executa DDL solto tipo
-- CREATE SCHEMA/CREATE ROLE. Então este arquivo foi escrito e revisado a
-- mão, mas NUNCA RODADO nem testado contra o banco real — diferente de todo
-- o resto do trabalho desta sessão (que sempre validei ao vivo antes de
-- reportar como pronto). Rodem no SQL Editor do Supabase e me avisem o
-- resultado (sucesso ou o erro exato) — se dermos algum passo em falso na
-- sintaxe, é rápido de ajustar, mas não posso garantir "primeira tentativa
-- perfeita" nesta parte específica como garanti no resto.
--
-- Depois de rodar, ANTES de apontar a credencial do n8n pra cá, façam esse
-- teste de isolamento (conectados como prata_agent_reader, não como o dono
-- do projeto):
--   SELECT * FROM public.clients LIMIT 1;   -- TEM que falhar (permission denied)
--   SELECT * FROM prata_agent.v_clients LIMIT 1;  -- TEM que funcionar
-- Se o primeiro SELECT não falhar, o isolamento entre schemas não está
-- completo (pode ser RLS desligada em alguma tabela, ou GRANT herdado do
-- role PUBLIC do Postgres que esse script não cobre) — não uso essa
-- credencial no n8n até esse teste passar.
-- ============================================================================
