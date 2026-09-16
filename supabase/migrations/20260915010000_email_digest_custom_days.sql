-- Frequência "Personalizado" não tinha nenhum campo pra dizer QUAIS dias —
-- era uma opção no menu sem implementação nenhuma por trás. Adiciona os
-- dias da semana escolhidos (0=domingo .. 6=sábado, mesma convenção do
-- Date.getDay() do JS, pra comparar direto sem tradução).
ALTER TABLE email_digest_configs
  ADD COLUMN IF NOT EXISTS custom_days_of_week JSONB NOT NULL DEFAULT '[]'::jsonb;
