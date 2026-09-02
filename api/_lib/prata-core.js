// Lógica compartilhada entre as Serverless Functions do PRATA que calculam
// KPI/venda/receita/funil (api/assistant.js e api/kpis.js) — server-side,
// roda em Node, sem DOM. É a MESMA lógica pura que existe (obrigatoriamente
// duplicada, por não haver build step) em script.js (Dashboard Filho/Pai) e
// portal-cliente.js (Portal do Cliente): qualquer mudança de regra aqui só
// vale pra quem lê o banco via API (assistente de IA embutido no PRATA,
// endpoint /api/kpis usado por integrações externas como o agente de
// WhatsApp em n8n) — replique a mudança nos outros dois arquivos também.

const SUPABASE_URL = 'https://ldcpwadnvuotacwnkcop.supabase.co';

async function sb(path, key) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch (e) {
    console.error('Erro ao consultar Supabase:', path, e);
    return [];
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Conta vendas (linhas com sale_value > 0) e soma receita (revenue, ou
// sale_value se revenue não foi preenchido) por dia, a partir do histórico
// importado (leads_sales). "Venda" pro PRATA é sale_value > 0 — não é uma
// checagem de stage/status (hoje as duas coisas coincidem na prática porque
// só linhas com stage='Venda' têm sale_value preenchido, mas isso é
// convenção de dado, não regra do código).
function buildImportedDailyCounts(leadsRows) {
  const sales = {}, revenue = {};
  (leadsRows || []).forEach(l => {
    const date = l.date;
    if (!date) return;
    const saleVal = Number(l.sale_value) || 0;
    if (saleVal > 0) sales[date] = (sales[date] || 0) + 1;
    const rev = Number(l.revenue) || saleVal;
    if (rev > 0) revenue[date] = (revenue[date] || 0) + rev;
  });
  return { sales, revenue };
}

// Soma os valores preenchidos no portal (custom_field_values), por dia,
// pra campos ativos mapeados num tipo de métrica específico (ex: 'sales').
function buildPortalDailyValues(customFields, customFieldValues, mappingType) {
  const fieldIds = new Set((customFields || []).filter(f => f.active && f.metric_mapping === mappingType).map(f => f.id));
  const byDate = {};
  (customFieldValues || []).forEach(v => {
    if (!fieldIds.has(v.field_id)) return;
    byDate[v.period_date] = (byDate[v.period_date] || 0) + (Number(v.value_number) || 0);
  });
  return byDate;
}

// Combina as duas séries diárias numa só: por dia, portal > importado (nunca
// os dois somados no mesmo dia). Retorna o total, a quebra por origem (pra
// mensagens tipo "fonte: importação + portal do cliente") e os registros
// individuais, em ordem cronológica.
function unifyDailySeries(importByDate, portalByDate) {
  const dates = new Set([...Object.keys(importByDate || {}), ...Object.keys(portalByDate || {})]);
  const records = [];
  dates.forEach(date => {
    if (portalByDate[date] !== undefined) records.push({ date, value: portalByDate[date], source: 'portal' });
    else records.push({ date, value: importByDate[date], source: 'import' });
  });
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = records.reduce((s, r) => s + r.value, 0);
  const bySource = { import: 0, portal: 0 };
  records.forEach(r => { bySource[r.source] += r.value; });
  return { total, bySource, records };
}

// Vendas/Receita: histórico importado (leads_sales) + portal, sem duplicar
// no mesmo dia — só entra em jogo depois que existe campo mapeado (mesma
// regra do app: campo não é o que "libera" o histórico, é o que dita se a
// unificação vale a pena calcular).
function resolveUnifiedSalesAndRevenue(leadsRows, customFields, customFieldValues) {
  const importedDaily = buildImportedDailyCounts(leadsRows);
  const portalSalesDaily = buildPortalDailyValues(customFields, customFieldValues, 'sales');
  const portalRevenueDaily = buildPortalDailyValues(customFields, customFieldValues, 'revenue');
  return {
    sales: unifyDailySeries(importedDaily.sales, portalSalesDaily),
    revenue: unifyDailySeries(importedDaily.revenue, portalRevenueDaily)
  };
}

function sourceLabel(bySource) {
  const hasImport = bySource.import > 0;
  const hasPortal = bySource.portal > 0;
  if (hasImport && hasPortal) return 'importação + portal do cliente';
  if (hasPortal) return 'informado pelo cliente no portal';
  if (hasImport) return 'importação (histórico)';
  return 'mídia (sem dado comercial mapeado ainda)';
}

// Ordem de progressão real do funil comercial (leads_sales.stage).
// "Descartado" fica de fora da barra sequencial — é uma saída que pode
// acontecer a partir de qualquer etapa, não um degrau de avanço.
const COMMERCIAL_FUNNEL_STAGE_ORDER = ['Novo', 'Em abordagem', 'Qualificado', 'Atendido', 'Proposta enviada', 'Venda'];

// Funil comercial de verdade: agrupa leads_sales pela etapa real do negócio,
// nunca misturado com métrica de mídia (impressões/cliques/page views são
// "Funil de mídia", separado). Etapas fora da lista conhecida (pipeline
// customizado) entram no fim, antes de Descartado.
function computeCommercialFunnelFromLeads(leadsRows) {
  const rows = leadsRows || [];
  const counts = {};
  let discarded = 0;
  rows.forEach(l => {
    const stage = (l.stage || '').toString().trim();
    if (!stage) return;
    if (stage === 'Descartado') { discarded++; return; }
    counts[stage] = (counts[stage] || 0) + 1;
  });
  const stages = COMMERCIAL_FUNNEL_STAGE_ORDER.map(name => ({ name, count: counts[name] || 0 }));
  Object.keys(counts).forEach(name => {
    if (!COMMERCIAL_FUNNEL_STAGE_ORDER.includes(name)) stages.push({ name, count: counts[name] });
  });
  return { stages, discarded, total: rows.length };
}

// Status simplificado (ROI + metas cadastradas) — não inclui tendência mês a
// mês/atualização de dados/campos pendentes (isso é só o Score de Saúde
// visual do painel, que roda no navegador). Suficiente pro nível de resposta
// de uma consulta via API/chat.
function quickStatus(invest, revenue, conversions, targets, actualByMetric) {
  const reasons = [];
  let severity = 0;
  if (invest > 0) {
    const roi = ((revenue - invest) / invest) * 100;
    if (roi < 0) { reasons.push(`ROI negativo (${Math.round(roi)}%)`); severity = 2; }
    else if (roi < 50) { reasons.push(`ROI baixo (${Math.round(roi)}%)`); severity = Math.max(severity, 1); }
    if (conversions === 0) { reasons.push('Investimento sem nenhuma conversão de mídia registrada'); severity = 2; }
  }
  (targets || []).forEach(t => {
    const actual = actualByMetric[t.metric_name];
    const target = Number(t.target_value);
    if (actual === null || actual === undefined || !target) return;
    const rule = t.rule || '';
    let ratio = null;
    if (rule.includes('Menor')) ratio = actual / target;
    else if (rule.includes('Maior')) ratio = target / actual;
    if (ratio === null) return;
    if (ratio > 1.3) { reasons.push(`${t.metric_name.toUpperCase()} fora da meta definida`); severity = 2; }
    else if (ratio > 1.1) { reasons.push(`${t.metric_name.toUpperCase()} levemente fora da meta`); severity = Math.max(severity, 1); }
  });
  return { status: severity === 2 ? 'crítico' : severity === 1 ? 'atenção' : 'saudável', motivos: reasons };
}

async function findClientSlug(clientName, key) {
  const rows = await sb(`clients?name=ilike.${encodeURIComponent(clientName)}&select=name,slug`, key);
  if (rows.length) return rows[0];
  const all = await sb('clients?select=name,slug', key);
  const lower = clientName.toLowerCase();
  return all.find(c => c.name.toLowerCase().includes(lower)) || null;
}

// Data de hoje em America/Sao_Paulo, formato YYYY-MM-DD — resolve de vez o
// problema de "o modelo não sabe que data é hoje" e o de fuso (Postgres do
// Supabase roda em UTC, a operação é Brasil): o SERVIDOR informa a data,
// nem o agente nem o SQL precisam adivinhar.
function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

module.exports = {
  SUPABASE_URL,
  sb,
  round2,
  buildImportedDailyCounts,
  buildPortalDailyValues,
  unifyDailySeries,
  resolveUnifiedSalesAndRevenue,
  sourceLabel,
  COMMERCIAL_FUNNEL_STAGE_ORDER,
  computeCommercialFunnelFromLeads,
  quickStatus,
  findClientSlug,
  todayBR
};
