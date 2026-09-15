// Lógica compartilhada entre as Serverless Functions do PRATA que calculam
// KPI/venda/receita/funil (api/assistant.js e api/kpis.js) — server-side,
// roda em Node, sem DOM. É a MESMA lógica pura que existe (obrigatoriamente
// duplicada, por não haver build step) em script.js (Dashboard Filho/Pai) e
// portal-cliente.js (Portal do Cliente): qualquer mudança de regra aqui só
// vale pra quem lê o banco via API (assistente de IA embutido no PRATA,
// endpoint /api/kpis usado por integrações externas como o agente de
// WhatsApp em n8n) — replique a mudança nos outros dois arquivos também.

const SUPABASE_URL = 'https://ldcpwadnvuotacwnkcop.supabase.co';

// GET por padrão (2 args, como sempre foi — retorna [] em erro, nunca
// lança). Passando `options.method` (POST/PATCH/DELETE) + `options.body`,
// vira escrita: erros então LANÇAM (quem escreve precisa saber se falhou,
// diferente de uma leitura que pode tolerar vir vazia).
async function sb(path, key, options) {
  const opts = options || {};
  const isWrite = opts.method && opts.method !== 'GET';
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) };
    if (isWrite) {
      headers['Content-Type'] = 'application/json';
      headers['Prefer'] = opts.prefer || 'return=representation';
    }
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      if (isWrite) throw new Error(`Supabase ${opts.method} ${path} falhou (${resp.status}): ${errText.slice(0, 300)}`);
      return [];
    }
    if (resp.status === 204) return [];
    const text = await resp.text();
    return text ? JSON.parse(text) : [];
  } catch (e) {
    if (isWrite) throw e;
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

// Motivos de perda: qualquer linha de leads_sales com loss_reason preenchido
// conta, independente da etapa (não é só quem está em "Descartado" — um lead
// pode ter um motivo registrado e ainda assim seguir em outra etapa). Mesma
// regra usada em buildClientDetailedDataFromReal (script.js).
function computeLossReasonsFromLeads(leadsRows) {
  const counts = {};
  (leadsRows || []).forEach(l => {
    const reason = (l.loss_reason || '').toString().trim();
    if (reason) counts[reason] = (counts[reason] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const reasons = Object.keys(counts)
    .map(name => ({ motivo: name, quantidade: counts[name], percentual: total > 0 ? Math.round((counts[name] / total) * 100) : 0 }))
    .sort((a, b) => b.quantidade - a.quantidade);
  return { motivos: reasons, total_com_motivo_registrado: total };
}

// Status simplificado (ROI + metas cadastradas) — não inclui tendência mês a
// mês/atualização de dados/campos pendentes (isso é só o Score de Saúde
// visual do painel, que roda no navegador). Suficiente pro nível de resposta
// de uma consulta via API/chat.
// targets.metric_name é um rótulo em português digitado por humano na tela
// de Metas ("CTR", "CPA", "Taxa de Conversão", "ROAS", "Custo por conversa",
// "CPL", "CPC" — nunca as chaves internas curtas tipo "ctr"/"convrate").
// Sem essa normalização, actualByMetric[t.metric_name] nunca batia com nada
// e toda meta cadastrada era silenciosamente ignorada na comparação meta x
// realizado (mesma correção aplicada em script.js/computeClientStatusFromData).
function normalizeMetricNameToKey(metricName) {
  const key = (metricName || '').toString().trim().toLowerCase();
  const map = {
    'ctr': 'ctr', 'cpa': 'cpa', 'cpc': 'cpc', 'cpl': 'cpl', 'cpm': 'cpm', 'roas': 'roas',
    'taxa de conversão': 'convrate', 'taxa de conversao': 'convrate',
    'custo por conversa': 'custoPorConversa',
    'investimento': 'invest', 'impressões': 'impress', 'impressoes': 'impress',
    'cliques': 'clicks', 'leads': 'leads', 'conversões': 'convs', 'conversoes': 'convs'
  };
  return map[key] || key;
}

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
    const actual = actualByMetric[normalizeMetricNameToKey(t.metric_name)];
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

// ==========================================================================
// Score de Saúde / Alertas da carteira — porte de script.js
// (computeClientStatusFromData / HEALTH_SCORE_PENALTY / computePortfolioAlerts)
// pro servidor, usado pelo Resumo Automático (e-mail) pra nunca mostrar um
// status diferente do que o Dashboard Pai mostra na tela. Mesma regra,
// reescrita só pra não depender de variável global (`allClients` no
// browser vira o parâmetro `clients` aqui).
// ==========================================================================

function formatNumber(valor) {
  return Math.round(valor).toLocaleString('pt-BR');
}

function formatCurrency(val) {
  return 'R$' + formatNumber(Math.round(val));
}

function formatDateBR(date) {
  if (!date) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateISO(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computePeriodDateForFrequency(frequency, refDate) {
  const d = new Date(refDate);
  d.setHours(0, 0, 0, 0);
  if (frequency === 'weekly') {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMonday);
  } else if (frequency === 'biweekly') {
    d.setDate(d.getDate() <= 15 ? 1 : 16);
  } else if (frequency === 'monthly') {
    d.setDate(1);
  }
  return d;
}

const HEALTH_SCORE_PENALTY = { critical: 25, attention: 10 };

function computeHealthScoreFromReasons(reasons) {
  let score = 100;
  (reasons || []).forEach(r => { score -= HEALTH_SCORE_PENALTY[r.severity] || 0; });
  return Math.max(0, Math.min(100, score));
}

function healthStatusFromScore(score) {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'attention';
  return 'critical';
}

// ROI/metas de UM cliente a partir dos totais já agregados (raw) — mesma
// regra do Dashboard Pai/Filho.
function computeClientStatusFromData(raw, targetsRows) {
  const reasons = [];
  let severity = 0;

  if (raw.invest > 0) {
    const roi = ((raw.revenue - raw.invest) / raw.invest) * 100;
    if (roi < 0) {
      reasons.push({ text: `ROI negativo (${Math.round(roi)}%): o investimento de ${formatCurrency(raw.invest)} ainda não voltou em receita.`, severity: 'critical' });
      severity = Math.max(severity, 2);
    } else if (roi < 50) {
      reasons.push({ text: `ROI baixo (${Math.round(roi)}%), abaixo do que se espera de uma campanha saudável.`, severity: 'attention' });
      severity = Math.max(severity, 1);
    }
    if (raw.conversions === 0) {
      reasons.push({ text: `Investimento de ${formatCurrency(raw.invest)} sem nenhuma conversão registrada até agora.`, severity: 'critical' });
      severity = Math.max(severity, 2);
    }
  }

  const actualByMetric = {
    invest: raw.invest, impress: raw.impressions, clicks: raw.clicks, views: raw.pageViews, leads: raw.leads, convs: raw.conversions,
    cpa: raw.conversions > 0 ? raw.invest / raw.conversions : null,
    cpc: raw.clicks > 0 ? raw.invest / raw.clicks : null,
    cpl: raw.leads > 0 ? raw.invest / raw.leads : null,
    cpm: raw.impressions > 0 ? (raw.invest / raw.impressions) * 1000 : null,
    ctr: raw.impressions > 0 ? (raw.clicks / raw.impressions) * 100 : null,
    convrate: raw.pageViews > 0 ? (raw.conversions / raw.pageViews) * 100 : null,
    roas: raw.invest > 0 ? raw.revenue / raw.invest : null,
    custoPorConversa: raw.messagesStarted > 0 ? raw.invest / raw.messagesStarted : null
  };

  (targetsRows || []).forEach(t => {
    const actual = actualByMetric[normalizeMetricNameToKey(t.metric_name)];
    const target = Number(t.target_value);
    if (actual === null || actual === undefined || !target) return;
    const rule = t.rule || '';
    let ratio = null;
    if (rule.includes('Menor')) ratio = actual / target;
    else if (rule.includes('Maior')) ratio = target / actual;
    if (ratio === null) return;
    const pctOff = Math.round(Math.abs(ratio - 1) * 100);
    if (ratio > 1.3) {
      reasons.push({ text: `${t.metric_name.toUpperCase()} está ${pctOff}% fora da meta definida em "${t.objective}".`, severity: 'critical' });
      severity = Math.max(severity, 2);
    } else if (ratio > 1.1) {
      reasons.push({ text: `${t.metric_name.toUpperCase()} está levemente fora da meta definida em "${t.objective}" (${pctOff}%).`, severity: 'attention' });
      severity = Math.max(severity, 1);
    }
  });

  const status = severity === 2 ? 'critical' : severity === 1 ? 'attention' : 'healthy';
  return { status, reasons };
}

const PORTFOLIO_ALERT_THRESHOLDS = {
  cpaIncreasePct: 30,
  revenueDropPct: 15,
  leadsDropPct: 30,
  staleSalesDays: 3,
  staleImportDays: 7,
  lowConversionInvest: 1000
};

function groupBy(rows, key) {
  const out = {};
  (rows || []).forEach(r => { const k = r[key]; if (!k) return; (out[k] = out[k] || []).push(r); });
  return out;
}

// Score de Saúde + alertas de TODA a carteira — porte 1:1 de
// computePortfolioAlerts (script.js), só que autocontido (calcula o status
// ROI/metas de cada cliente aqui dentro, em vez de esperar que outra função
// já tenha deixado isso pronto em `client.statusReasons`, como o browser
// faz). `clients` é [{slug, name}]; os outros arrays são as tabelas cruas
// já filtradas por workspace (não por período — alertas de mês a mês e
// pendência de dado precisam do histórico completo pra comparar).
function computeAgencyHealthAndAlerts({ clients, campaigns, leadsRows, customFields, customFieldValues, targets }) {
  const now = new Date();
  const curMonthKey = formatDateISO(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 7);
  const prevMonthKey = formatDateISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);

  const campaignsBySlug = groupBy(campaigns, 'client_slug');
  const leadsBySlug = groupBy(leadsRows, 'client_slug');
  const fieldsBySlug = groupBy(customFields, 'client_slug');
  const targetsBySlug = groupBy(targets, 'client_slug');
  const valuesByField = groupBy(customFieldValues, 'field_id');

  const alerts = [];
  const reasonsBySlug = {};
  clients.forEach(c => { reasonsBySlug[c.slug] = []; });

  function addReason(slug, severity, text) {
    if (!reasonsBySlug[slug]) reasonsBySlug[slug] = [];
    reasonsBySlug[slug].push({ severity, text });
    const client = clients.find(c => c.slug === slug);
    alerts.push({ severity, clientSlug: slug, clientName: client ? client.name : slug, message: text });
  }

  // --- 1) Status ROI/metas por cliente (equivalente a
  // updateClientStatusesFromCampaigns + computeClientStatusFromData) ---
  const rawBySlug = {};
  clients.forEach(client => {
    const slug = client.slug;
    const myCampaigns = campaignsBySlug[slug] || [];
    let invest = 0, impressions = 0, clicks = 0, pageViews = 0, leads = 0, conversions = 0, mediaRevenue = 0, messagesStarted = 0;
    myCampaigns.forEach(c => {
      invest += Number(c.invest) || 0;
      impressions += Number(c.impressions) || 0;
      clicks += Number(c.clicks) || 0;
      pageViews += Number(c.page_views) || 0;
      leads += Number(c.leads) || 0;
      conversions += Number(c.conversions) || 0;
      mediaRevenue += Number(c.revenue) || 0;
      messagesStarted += Number(c.messages_started) || 0;
    });

    const unified = resolveUnifiedSalesAndRevenue(leadsBySlug[slug] || [], fieldsBySlug[slug] || [], customFieldValues || []);
    const revenue = unified.revenue.records.length ? unified.revenue.total : mediaRevenue;
    const raw = { invest, revenue, leads, impressions, clicks, pageViews, conversions, messagesStarted };
    rawBySlug[slug] = raw;

    const { reasons } = computeClientStatusFromData(raw, targetsBySlug[slug] || []);
    reasons.forEach(r => addReason(slug, r.severity, r.text));
  });

  // --- 2) Mês atual x mês anterior (CPA/receita/leads) + campanha parada ---
  const bySlugMonth = {};
  const bySlugCampaignThisMonth = {};
  const latestDateBySlug = {};

  (campaigns || []).forEach(c => {
    const slug = c.client_slug;
    if (!slug || !c.date) return;
    const month = c.date.slice(0, 7);
    if (!latestDateBySlug[slug] || c.date > latestDateBySlug[slug]) latestDateBySlug[slug] = c.date;
    if (!bySlugMonth[slug]) bySlugMonth[slug] = {};
    if (!bySlugMonth[slug][month]) bySlugMonth[slug][month] = { invest: 0, clicks: 0, convs: 0, revenue: 0, leads: 0 };
    const m = bySlugMonth[slug][month];
    m.invest += Number(c.invest) || 0;
    m.clicks += Number(c.clicks) || 0;
    m.convs += Number(c.conversions) || 0;
    m.revenue += Number(c.revenue) || 0;
    m.leads += Number(c.leads) || 0;

    if (month === curMonthKey) {
      if (!bySlugCampaignThisMonth[slug]) bySlugCampaignThisMonth[slug] = {};
      const key = `${c.campaign_name}||${c.platform}`;
      if (!bySlugCampaignThisMonth[slug][key]) bySlugCampaignThisMonth[slug][key] = { name: c.campaign_name, invest: 0, convs: 0 };
      bySlugCampaignThisMonth[slug][key].invest += Number(c.invest) || 0;
      bySlugCampaignThisMonth[slug][key].convs += Number(c.conversions) || 0;
    }
  });

  clients.forEach(client => {
    const slug = client.slug;
    const cur = (bySlugMonth[slug] || {})[curMonthKey];
    const prev = (bySlugMonth[slug] || {})[prevMonthKey];

    if (cur && prev) {
      const curCpa = cur.convs > 0 ? cur.invest / cur.convs : null;
      const prevCpa = prev.convs > 0 ? prev.invest / prev.convs : null;
      if (curCpa !== null && prevCpa !== null && prevCpa > 0) {
        const pct = ((curCpa - prevCpa) / prevCpa) * 100;
        if (pct > PORTFOLIO_ALERT_THRESHOLDS.cpaIncreasePct) {
          addReason(slug, 'attention', `Aumento de ${Math.round(pct)}% no CPA em relação ao mês anterior (${formatCurrency(prevCpa)} → ${formatCurrency(curCpa)}).`);
        }
      }
      if (prev.revenue > 0 && cur.revenue < prev.revenue) {
        const pct = ((prev.revenue - cur.revenue) / prev.revenue) * 100;
        if (pct > PORTFOLIO_ALERT_THRESHOLDS.revenueDropPct) {
          addReason(slug, 'attention', `Receita caiu ${Math.round(pct)}% em relação ao mês anterior (${formatCurrency(prev.revenue)} → ${formatCurrency(cur.revenue)}).`);
        }
      }
      if (prev.leads > 0 && cur.leads < prev.leads) {
        const pct = ((prev.leads - cur.leads) / prev.leads) * 100;
        if (pct > PORTFOLIO_ALERT_THRESHOLDS.leadsDropPct) {
          addReason(slug, 'attention', `Queda de ${Math.round(pct)}% nos leads em relação ao mês anterior (${formatNumber(prev.leads)} → ${formatNumber(cur.leads)}).`);
        }
      }
    }

    const latest = latestDateBySlug[slug];
    if (latest) {
      const daysSince = Math.floor((now - new Date(latest + 'T00:00:00')) / 86400000);
      if (daysSince >= PORTFOLIO_ALERT_THRESHOLDS.staleImportDays) {
        addReason(slug, 'attention', `Dados importados desatualizados — última linha de campanha é de ${formatDateBR(new Date(latest + 'T00:00:00'))} (${daysSince} dias atrás).`);
      }
    }

    Object.values(bySlugCampaignThisMonth[slug] || {}).forEach(camp => {
      if (camp.invest >= PORTFOLIO_ALERT_THRESHOLDS.lowConversionInvest && camp.convs === 0) {
        addReason(slug, 'attention', `Campanha "${camp.name}" com ${formatCurrency(camp.invest)} investidos este mês e nenhuma conversão registrada.`);
      }
    });
  });

  // --- 3) Campos personalizados: obrigatório pendente + vendas sem atualizar ---
  clients.forEach(client => {
    (fieldsBySlug[client.slug] || []).forEach(field => {
      const values = valuesByField[field.id] || [];
      const isDailySalesField = field.metric_mapping === 'sales' && field.frequency === 'daily';
      if (field.required && field.frequency !== 'on_demand' && !isDailySalesField) {
        const periodIso = formatDateISO(computePeriodDateForFrequency(field.frequency, now));
        const hasValue = values.some(v => v.period_date === periodIso);
        if (!hasValue) {
          addReason(client.slug, 'attention', `Campo obrigatório "${field.name}" pendente de preenchimento.`);
        }
      }
      if (isDailySalesField) {
        const lastFill = values.map(v => v.period_date).filter(Boolean).sort().reverse()[0];
        const daysSince = lastFill ? Math.floor((now - new Date(lastFill + 'T00:00:00')) / 86400000) : null;
        if (daysSince === null || daysSince >= PORTFOLIO_ALERT_THRESHOLDS.staleSalesDays) {
          const prefix = daysSince === null ? 'Nunca preencheu' : `Está há ${daysSince} dia(s) sem preencher`;
          addReason(client.slug, 'attention', `${prefix} vendas ("${field.name}").`);
        }
      }
    });
  });

  // --- 4) Completude: cliente sem NENHUM dado configurado ainda ---
  const hasCampaignBySlug = new Set((campaigns || []).map(c => c.client_slug));
  const hasFieldBySlug = new Set((customFields || []).map(f => f.client_slug));
  const hasLeadsBySlug = new Set((leadsRows || []).map(l => l.client_slug));
  clients.forEach(client => {
    const slug = client.slug;
    if (!hasCampaignBySlug.has(slug) && !hasFieldBySlug.has(slug) && !hasLeadsBySlug.has(slug)) {
      addReason(slug, 'critical', 'Nenhum dado importado ou campo personalizado configurado ainda para este cliente.');
    }
  });

  const clientsWithHealth = clients.map(client => {
    const reasons = (reasonsBySlug[client.slug] || []).slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
    const healthScore = computeHealthScoreFromReasons(reasons);
    return {
      slug: client.slug,
      name: client.name,
      healthScore,
      status: healthStatusFromScore(healthScore),
      statusReasons: reasons,
      raw: rawBySlug[client.slug] || { invest: 0, revenue: 0, leads: 0, impressions: 0, clicks: 0, pageViews: 0, conversions: 0, messagesStarted: 0 }
    };
  });

  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return a.clientName.localeCompare(b.clientName);
  });

  return { clientsWithHealth, alerts: alerts.slice(0, 40) };
}

// Pendências de dados — versão estruturada (não texto) da mesma checagem do
// passo 3 de computeAgencyHealthAndAlerts, pro bloco "Atualização dos
// clientes" do Resumo Automático conseguir montar uma lista limpa em vez de
// ter que reinterpretar as strings dos alertas.
function computeDataPendencies(clients, customFields, customFieldValues) {
  const now = new Date();
  const fieldsBySlug = groupBy(customFields, 'client_slug');
  const valuesByField = groupBy(customFieldValues, 'field_id');
  const clientBySlug = {};
  clients.forEach(c => { clientBySlug[c.slug] = c.name; });

  const items = [];
  clients.forEach(client => {
    (fieldsBySlug[client.slug] || []).forEach(field => {
      if (!field.required || field.frequency === 'on_demand') return;
      const values = valuesByField[field.id] || [];
      const isDailySalesField = field.metric_mapping === 'sales' && field.frequency === 'daily';

      if (isDailySalesField) {
        const lastFill = values.map(v => v.period_date).filter(Boolean).sort().reverse()[0];
        const daysSince = lastFill ? Math.floor((now - new Date(lastFill + 'T00:00:00')) / 86400000) : null;
        const isStale = daysSince === null || daysSince >= PORTFOLIO_ALERT_THRESHOLDS.staleSalesDays;
        items.push({
          clientName: client.name,
          fieldName: field.name,
          status: isStale ? 'stale' : 'ok',
          lastFilledDate: lastFill || null,
          daysSince
        });
      } else {
        const periodIso = formatDateISO(computePeriodDateForFrequency(field.frequency, now));
        const hasValue = values.some(v => v.period_date === periodIso);
        const lastFill = values.map(v => v.period_date).filter(Boolean).sort().reverse()[0];
        items.push({
          clientName: client.name,
          fieldName: field.name,
          status: hasValue ? 'ok' : 'pending',
          lastFilledDate: lastFill || null,
          daysSince: lastFill ? Math.floor((now - new Date(lastFill + 'T00:00:00')) / 86400000) : null
        });
      }
    });
  });

  const upToDateCount = items.filter(i => i.status === 'ok').length;
  const pendingCount = items.filter(i => i.status === 'pending').length;
  const staleCount = items.filter(i => i.status === 'stale').length;

  return { items, upToDateCount, pendingCount, staleCount };
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
  computeLossReasonsFromLeads,
  quickStatus,
  normalizeMetricNameToKey,
  findClientSlug,
  todayBR,
  formatNumber,
  formatCurrency,
  formatDateBR,
  formatDateISO,
  computePeriodDateForFrequency,
  HEALTH_SCORE_PENALTY,
  computeHealthScoreFromReasons,
  healthStatusFromScore,
  computeClientStatusFromData,
  PORTFOLIO_ALERT_THRESHOLDS,
  computeAgencyHealthAndAlerts,
  computeDataPendencies
};
