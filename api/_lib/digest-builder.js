// Monta os dados e o HTML do "Resumo Automático" (Relatórios > Envios
// automáticos) — reaproveita SEMPRE a mesma lógica de api/_lib/prata-core.js
// (a mesma que o Dashboard Pai/Filho e /api/kpis usam), pra nunca mostrar um
// número no e-mail diferente do que aparece na tela.

const core = require('./prata-core');

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return core.formatDateISO(d);
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return core.formatDateISO(d);
}

function firstDayOfMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return core.formatDateISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

function lastDayOfPrevMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return core.formatDateISO(new Date(d.getFullYear(), d.getMonth(), 0));
}

// periodType: 'today' | 'yesterday' | 'current_month' | 'last_7_days' |
// 'last_30_days' | 'custom'. `todayIso` é sempre a data de hoje em
// America/Sao_Paulo (core.todayBR()), nunca a data do servidor (UTC).
function resolvePeriodRange(periodType, customFrom, customTo, todayIso) {
  switch (periodType) {
    case 'today': return { from: todayIso, to: todayIso };
    case 'yesterday': { const y = addDays(todayIso, -1); return { from: y, to: y }; }
    case 'last_7_days': return { from: addDays(todayIso, -6), to: todayIso };
    case 'last_30_days': return { from: addDays(todayIso, -29), to: todayIso };
    case 'custom': return { from: customFrom || todayIso, to: customTo || todayIso };
    case 'current_month':
    default:
      return { from: firstDayOfMonth(todayIso), to: todayIso };
  }
}

// comparisonType: 'none' | 'previous_period' | 'previous_month'.
function resolveComparisonRange(comparisonType, from, to, periodType) {
  if (comparisonType === 'none') return null;
  if (comparisonType === 'previous_month' && periodType === 'current_month') {
    // Mês corrente inteiro vs mês anterior inteiro (não só os mesmos dias já
    // passados) — é o que "mês anterior" normalmente quer dizer aqui.
    const prevTo = lastDayOfPrevMonth(from);
    const prevFrom = firstDayOfMonth(prevTo);
    return { from: prevFrom, to: prevTo };
  }
  if (comparisonType === 'previous_month') {
    return { from: addMonths(from, -1), to: addMonths(to, -1) };
  }
  // previous_period: mesma quantidade de dias, imediatamente antes.
  const days = Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

function filterByRange(rows, field, from, to) {
  if (!from && !to) return rows;
  return (rows || []).filter(r => {
    const d = r[field];
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// KPIs agregados de um conjunto de clientes num intervalo — mesma lógica de
// api/kpis.js?action=agency_totals, só reaproveitada aqui.
function computeScopeKpis(scopeSlugs, campaigns, leads, customFields, customFieldValues) {
  const fieldsBySlug = {}, valuesBySlug = {}, leadsBySlug = {};
  (customFields || []).forEach(f => { (fieldsBySlug[f.client_slug] = fieldsBySlug[f.client_slug] || []).push(f); });
  (customFieldValues || []).forEach(v => { (valuesBySlug[v.client_slug] = valuesBySlug[v.client_slug] || []).push(v); });
  (leads || []).forEach(l => { (leadsBySlug[l.client_slug] = leadsBySlug[l.client_slug] || []).push(l); });

  let invest = 0, clicks = 0, conversions = 0, leadsCount = 0, pageViews = 0;
  const mediaRevenueBySlug = {};
  (campaigns || []).forEach(c => {
    if (!scopeSlugs.has(c.client_slug)) return;
    invest += Number(c.invest) || 0;
    clicks += Number(c.clicks) || 0;
    conversions += Number(c.conversions) || 0;
    leadsCount += Number(c.leads) || 0;
    pageViews += Number(c.page_views) || 0;
    mediaRevenueBySlug[c.client_slug] = (mediaRevenueBySlug[c.client_slug] || 0) + (Number(c.revenue) || 0);
  });

  let revenue = 0, salesReais = 0;
  scopeSlugs.forEach(slug => {
    const unified = core.resolveUnifiedSalesAndRevenue(leadsBySlug[slug] || [], fieldsBySlug[slug] || [], valuesBySlug[slug] || []);
    revenue += unified.revenue.records.length ? unified.revenue.total : (mediaRevenueBySlug[slug] || 0);
    salesReais += unified.sales.records.length ? unified.sales.total : 0;
  });

  const conversaoPct = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const cpl = leadsCount > 0 ? invest / leadsCount : null;
  const cpa = conversions > 0 ? invest / conversions : null;
  const roas = invest > 0 ? revenue / invest : null;

  return { invest, revenue, sales: salesReais, conversoes: conversions, leads: leadsCount, conversaoPct, cpl, cpa, roas };
}

function pctChange(cur, prev) {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// Junta tudo que o e-mail precisa: resumo executivo, saúde da carteira,
// atenção hoje, tabela da carteira, pipeline comercial, pendências.
async function computeAgencyDigestData(key, config) {
  const todayIso = core.todayBR();

  const [allClients, campaignsAll, leadsAll, customFields, customFieldValuesAll, targets, commercialStages, commercialLeads] = await Promise.all([
    core.sb('clients?select=slug,name,pinned', key),
    core.sb('campaign_metrics?select=*', key),
    core.sb('leads_sales?select=*', key),
    core.sb('custom_fields?active=eq.true&select=*', key),
    core.sb('custom_field_values?select=*', key),
    core.sb('targets?select=*', key),
    core.sb('commercial_stages?select=*&order=position', key),
    core.sb('commercial_leads?select=*', key)
  ]);

  const scopeClients = (config.client_scope === 'selected' && Array.isArray(config.selected_clients) && config.selected_clients.length)
    ? allClients.filter(c => config.selected_clients.includes(c.slug))
    : allClients;
  const scopeSlugs = new Set(scopeClients.map(c => c.slug));

  const { from, to } = resolvePeriodRange(config.period_type, config.period_custom_from, config.period_custom_to, todayIso);
  const cmpRange = resolveComparisonRange(config.comparison_type, from, to, config.period_type);

  const campaignsPeriod = filterByRange(campaignsAll, 'date', from, to);
  const leadsPeriod = filterByRange(leadsAll, 'date', from, to);
  const valuesPeriod = filterByRange(customFieldValuesAll, 'period_date', from, to);

  const current = computeScopeKpis(scopeSlugs, campaignsPeriod, leadsPeriod, customFields, valuesPeriod);
  let comparison = null;
  if (cmpRange) {
    const campaignsCmp = filterByRange(campaignsAll, 'date', cmpRange.from, cmpRange.to);
    const leadsCmp = filterByRange(leadsAll, 'date', cmpRange.from, cmpRange.to);
    const valuesCmp = filterByRange(customFieldValuesAll, 'period_date', cmpRange.from, cmpRange.to);
    const prev = computeScopeKpis(scopeSlugs, campaignsCmp, leadsCmp, customFields, valuesCmp);
    comparison = {
      range: cmpRange,
      invest: pctChange(current.invest, prev.invest),
      revenue: pctChange(current.revenue, prev.revenue),
      sales: pctChange(current.sales, prev.sales),
      conversaoPct: current.conversaoPct - prev.conversaoPct, // p.p., não %
      cpl: pctChange(current.cpl, prev.cpl),
      cpa: pctChange(current.cpa, prev.cpa),
      roas: pctChange(current.roas, prev.roas)
    };
  }

  // Saúde/alertas — SEMPRE com o histórico completo (não filtrado pelo
  // período do e-mail), igual o Dashboard Pai calcula (alertas de mês a mês/
  // dado parado dependem da data real de cada linha, não do recorte escolhido).
  const { clientsWithHealth, alerts } = core.computeAgencyHealthAndAlerts({
    clients: scopeClients, campaigns: campaignsAll, leadsRows: leadsAll,
    customFields, customFieldValues: customFieldValuesAll, targets
  });

  const healthCounts = { healthy: 0, attention: 0, critical: 0 };
  clientsWithHealth.forEach(c => { healthCounts[c.status] = (healthCounts[c.status] || 0) + 1; });

  const severityRank = { critical: 0, attention: 1, healthy: 2 };
  const priorityClients = clientsWithHealth
    .slice()
    .sort((a, b) => severityRank[a.status] - severityRank[b.status] || a.healthScore - b.healthScore)
    .slice(0, 5);

  // "O que precisa da sua atenção hoje" — agrupa os alertas por cliente,
  // já ordenados por severidade (computeAgencyHealthAndAlerts já ordena).
  const attentionByClient = {};
  alerts.forEach(a => {
    if (!attentionByClient[a.clientSlug]) attentionByClient[a.clientSlug] = { clientName: a.clientName, severity: a.severity, messages: [] };
    attentionByClient[a.clientSlug].messages.push(a.message);
    if (a.severity === 'critical') attentionByClient[a.clientSlug].severity = 'critical';
  });
  const attentionToday = Object.values(attentionByClient).slice(0, 5);

  // Tabela da carteira — KPI por cliente no período escolhido.
  const clientTable = scopeClients.map(c => {
    const kpis = computeScopeKpis(new Set([c.slug]), campaignsPeriod, leadsPeriod, customFields, valuesPeriod);
    const health = clientsWithHealth.find(h => h.slug === c.slug);
    return { name: c.name, slug: c.slug, status: health ? health.status : 'healthy', ...kpis };
  }).sort((a, b) => b.invest - a.invest);

  // Pendências de dados — estruturado.
  const pendencies = core.computeDataPendencies(scopeClients, customFields, customFieldValuesAll);

  // Pipeline comercial DA AGÊNCIA (commercial_stages/commercial_leads) — não
  // confundir com o funil de vendas dos clientes.
  const stagesById = {};
  (commercialStages || []).forEach(s => { stagesById[s.id] = { id: s.id, name: s.name, count: 0, value: 0 }; });
  let openValue = 0;
  let openCount = 0;
  (commercialLeads || []).forEach(l => {
    const bucket = stagesById[l.stage_id];
    if (!bucket) return;
    const isClosed = /ganho|perdido|fechado/i.test(bucket.name);
    bucket.count += 1;
    bucket.value += Number(l.potential_value) || 0;
    if (!isClosed) {
      openValue += Number(l.potential_value) || 0;
      openCount += 1;
    }
  });
  const pipelineStages = (commercialStages || []).map(s => stagesById[s.id]);

  return {
    period: { from, to, type: config.period_type },
    comparison,
    executive: current,
    healthCounts,
    priorityClients,
    attentionToday,
    clientTable,
    pendencies,
    pipeline: { stages: pipelineStages, openValue, openCount },
    generatedAtIso: todayIso
  };
}

// Insight executivo — a IA só INTERPRETA números já calculados pelo
// backend, nunca calcula nada sozinha (regra explícita do pedido). Se não
// houver OPENAI_API_KEY configurada, ou a chamada falhar, simplesmente não
// gera insight (a seção não aparece) — nunca inventa texto sem dado real.
async function generateExecutiveInsight(data, openaiKey) {
  if (!openaiKey) return null;

  const fmt = (v, suffix) => (v === null || v === undefined) ? 'sem dado' : `${Math.round(v * 100) / 100}${suffix || ''}`;
  const factsLines = [
    `Investimento: ${fmt(data.executive.invest, ' BRL')}`,
    `Receita: ${fmt(data.executive.revenue, ' BRL')}`,
    `Vendas: ${fmt(data.executive.sales)}`,
    `ROAS: ${fmt(data.executive.roas, 'x')}`,
    `Carteira: ${data.healthCounts.healthy || 0} saudáveis, ${data.healthCounts.attention || 0} em atenção, ${data.healthCounts.critical || 0} críticos`,
    ...data.priorityClients.slice(0, 3).map(c => `Cliente prioritário: ${c.name} (${c.status}) — ${(c.statusReasons[0] || {}).text || 'sem motivo detalhado'}`)
  ];
  if (data.comparison) {
    factsLines.push(`Variação de receita vs período anterior: ${fmt(data.comparison.revenue, '%')}`);
  }

  const prompt = `Você é um analista sênior de growth marketing. Com base SOMENTE nos fatos abaixo (já calculados, não recalcule nada e não invente nenhum número que não esteja aqui), escreva um parágrafo curto (3-4 frases, português do Brasil, tom direto e executivo) resumindo a operação da agência pro dono ler antes de abrir o dashboard. Se um fato não estiver na lista, não mencione.\n\nFatos:\n${factsLines.join('\n')}`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 220,
        temperature: 0.4
      })
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return text ? text.trim() : null;
  } catch (e) {
    console.error('Erro ao gerar insight executivo:', e);
    return null;
  }
}

module.exports = { computeAgencyDigestData, resolvePeriodRange, resolveComparisonRange, generateExecutiveInsight };
