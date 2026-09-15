-- ============================================================================
-- Envios automáticos (Resumos automáticos) — Relatórios > Envios automáticos.
-- Duas tabelas: configuração de cada automação (email_digest_configs) e o
-- histórico de cada tentativa de envio (email_digest_logs).
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_digest_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,

  -- 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'
  frequency TEXT NOT NULL DEFAULT 'weekdays',
  send_time TIME NOT NULL DEFAULT '08:00',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',

  -- 'today' | 'yesterday' | 'current_month' | 'last_7_days' | 'last_30_days' | 'custom'
  period_type TEXT NOT NULL DEFAULT 'current_month',
  period_custom_from DATE,
  period_custom_to DATE,

  -- 'none' | 'previous_period' | 'previous_month'
  comparison_type TEXT NOT NULL DEFAULT 'previous_month',

  -- 'all_active' | 'selected'
  client_scope TEXT NOT NULL DEFAULT 'all_active',
  selected_clients JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- { executive_summary, attention_today, portfolio_health, client_performance,
  --   commercial_pipeline, data_pending, ai_insights: boolean }
  sections JSONB NOT NULL DEFAULT '{
    "executive_summary": true,
    "attention_today": true,
    "portfolio_health": true,
    "client_performance": true,
    "commercial_pipeline": true,
    "data_pending": true,
    "ai_insights": true
  }'::jsonb,

  -- MVP: sempre travado em felippegabriel2005@gmail.com (ver seção 3 do
  -- pedido) — guardado aqui só pra exibição; o backend NUNCA confia neste
  -- campo pra decidir o destinatário real do envio (ver ALLOWED_EMAIL_
  -- RECIPIENTS em api/_lib/prata-core.js).
  recipient_email TEXT NOT NULL DEFAULT 'felippegabriel2005@gmail.com',

  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at TIMESTAMPTZ,
  next_send_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_digest_configs_due
  ON email_digest_configs (active, next_send_at)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS email_digest_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES email_digest_configs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'queued' | 'sent' | 'failed' | 'blocked'
  status TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_digest_logs_config ON email_digest_logs (config_id, sent_at DESC);

-- RLS: mesmo modelo de confiança já usado pelas outras tabelas do PRATA
-- (agência única, sem multi-tenant por enquanto) — qualquer usuário
-- autenticado do app pode ler/gerenciar suas próprias automações. O envio
-- de e-mail em si (e a validação do destinatário) só acontece no backend,
-- nunca direto do navegador.
ALTER TABLE email_digest_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_digest_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access" ON email_digest_configs;
CREATE POLICY "authenticated_full_access" ON email_digest_configs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_logs" ON email_digest_logs;
CREATE POLICY "authenticated_read_logs" ON email_digest_logs
  FOR SELECT TO authenticated USING (true);

-- Logs só são escritos pelo backend (service_role), nunca direto do
-- navegador — sem policy de INSERT/UPDATE/DELETE pra "authenticated".

-- ----------------------------------------------------------------------------
-- Configuração padrão pro workspace (seção 28 do pedido).
-- ----------------------------------------------------------------------------
INSERT INTO email_digest_configs (
  name, active, frequency, send_time, timezone,
  period_type, comparison_type, client_scope, selected_clients, sections,
  recipient_email, created_by, next_send_at
)
SELECT
  'Resumo diário da agência', true, 'weekdays', '08:00', 'America/Sao_Paulo',
  'current_month', 'previous_month', 'all_active', '[]'::jsonb,
  '{
    "executive_summary": true,
    "attention_today": true,
    "portfolio_health": true,
    "client_performance": true,
    "commercial_pipeline": true,
    "data_pending": true,
    "ai_insights": true
  }'::jsonb,
  'felippegabriel2005@gmail.com', 'felippegabriel2005@gmail.com',
  -- next_send_at inicial: próximo dia às 08:00 America/Sao_Paulo (ponto de
  -- partida só — o backend recalcula depois de cada envio, já considerando
  -- dias úteis). O "AT TIME ZONE" final é essencial: sem ele, o timestamp
  -- "naive" (08:00 de amanhã, sem timezone) seria reinterpretado no fuso da
  -- sessão do Postgres (normalmente UTC) ao virar timestamptz — resultando
  -- em 08:00 UTC (= 05:00 em SP) em vez de 08:00 em SP de verdade. Esse bug
  -- existiu numa versão anterior desta migration; corrigido aqui.
  (((now() AT TIME ZONE 'America/Sao_Paulo')::date + INTERVAL '1 day' + INTERVAL '8 hours') AT TIME ZONE 'America/Sao_Paulo')
WHERE NOT EXISTS (SELECT 1 FROM email_digest_configs WHERE name = 'Resumo diário da agência');
