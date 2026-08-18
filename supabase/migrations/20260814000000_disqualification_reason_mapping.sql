-- PRATA - Adiciona "disqualification_reason" (Motivo de desqualificação de
-- leads) como novo valor válido de metric_mapping em custom_fields.
-- Diferente das outras métricas comerciais (sales/revenue/...), esse
-- mapeamento é categórico (picklist ou texto livre), não numérico — a
-- aplicação já trata isso separado (resolveDisqualificationReasons), essa
-- migração só libera o valor no banco.

alter table public.custom_fields drop constraint if exists custom_fields_metric_mapping_check;

alter table public.custom_fields add constraint custom_fields_metric_mapping_check check (metric_mapping in (
  'none', 'sales', 'revenue', 'proposals', 'appointments', 'service', 'cancellations', 'qualified', 'custom_metric', 'disqualification_reason'
));
