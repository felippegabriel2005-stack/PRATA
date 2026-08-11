-- PRATA - Expande os tipos de mapeamento de campo personalizado -> métrica
-- Antes: none/revenue/sales/leads/conversions/cancellations/service/custom.
-- "leads"/"conversions" saem da lista: são sempre métricas de mídia
-- (campaign_metrics), nunca sobrescritas por dado manual. "custom" vira
-- "custom_metric" (mais claro) e entram proposals/appointments/qualified.

alter table public.custom_fields drop constraint if exists custom_fields_metric_mapping_check;

update public.custom_fields set metric_mapping = 'custom_metric' where metric_mapping = 'custom';
update public.custom_fields set metric_mapping = 'none' where metric_mapping in ('leads', 'conversions');

alter table public.custom_fields add constraint custom_fields_metric_mapping_check check (metric_mapping in (
  'none', 'sales', 'revenue', 'proposals', 'appointments', 'service', 'cancellations', 'qualified', 'custom_metric'
));
