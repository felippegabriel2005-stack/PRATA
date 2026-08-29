/* ==========================================================================
   PRATA - Script de Controle de Arquitetura de Telas (Pai & Filho)
   ========================================================================== */

// ==========================================================================
// SUPABASE - Cliente e camada de acesso a dados
// ==========================================================================
const SUPABASE_URL = 'https://ldcpwadnvuotacwnkcop.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3eLKeEjjegJgKLf1bUHQ6Q_GQPJ_5v6';
// persistSession: false — o usuário pede login sempre que abre/recarrega o
// PRATA, em vez de continuar logado indefinidamente entre sessões.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

// Lista de clientes carregada do Supabase (tabela `clients`)
let allClients = [];

function slugify(str) {
  return str
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function clientSlugFromName(name) {
  const c = allClients.find(c => c.name === name);
  return c ? c.slug : null;
}

function clientNameFromSlug(slug) {
  const c = allClients.find(c => c.slug === slug);
  return c ? c.name : null;
}

async function fetchClients() {
  const { data, error } = await supabaseClient.from('clients').select('*').order('position');
  if (error) { console.error('Erro ao carregar clientes', error); return []; }
  return data;
}

async function insertClient(name, status, segment) {
  const slug = slugify(name);
  const position = allClients.length;
  const { data, error } = await supabaseClient
    .from('clients')
    .insert({ slug, name, status, segment: segment || null, pinned: true, position })
    .select()
    .single();
  if (error) { console.error('Erro ao criar cliente', error); return null; }
  return data;
}

// ==========================================================================
// CAMADA DE DADOS REAIS (importados via planilha) — substitui os mocks de
// clientDetailedData / agencyPeriodData quando existe dado real no Supabase.
// Se não houver dado importado para um cliente, os mocks continuam servindo
// de fallback (comportamento de demonstração inalterado).
// ==========================================================================

const realClientDataChecked = new Set();
let usingRealAgencyData = false;

// O slider de período do Dashboard Filho (updateFilhoPeriodValues) assume que
// metrics.investimento/receita vêm no formato "R$Xk" (milhares) — ele faz o
// parse removendo tudo que não é dígito e depois multiplica de volta por 1000.
// Precisamos seguir essa mesma convenção aqui, senão os cálculos de CPL/CPA
// daquele slider ficam inflados em 1000x.
function formatCurrencyThousands(val) {
  return `R$${Math.round(val / 1000)}k`;
}

// Decide o status (healthy/attention/critical) de um cliente a partir dos
// dados reais — ROI, ausência de conversão apesar de investimento, e
// comparação com as metas cadastradas na aba "Metas" — em vez de depender
// de um valor fixo definido na importação/cadastro manual. Também devolve
// os motivos em texto (reasons), pra IA conseguir explicar exatamente por
// que aquele cliente está em atenção/crítico quando o usuário perguntar.
// Cada motivo carrega sua própria severidade ({text, severity}), não só o
// texto — é isso que permite o score de saúde (computeClientHealthScore)
// converter "quantos e quão graves são os problemas" num número 0-100, em
// vez de só um status geral healthy/attention/critical.
function computeClientStatusFromData(raw, targetsRows) {
  const reasons = [];
  let severity = 0; // 0 = saudável, 1 = atenção, 2 = crítico

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

  // Mapeia as chaves de métrica usadas na aba "Metas" (mesmas da matriz de
  // Análise de Conversão) pros valores reais equivalentes deste cliente.
  const actualByMetric = {
    invest: raw.invest,
    impress: raw.impressions,
    clicks: raw.clicks,
    views: raw.pageViews,
    convs: raw.conversions,
    cpa: raw.conversions > 0 ? raw.invest / raw.conversions : null,
    cpc: raw.clicks > 0 ? raw.invest / raw.clicks : null,
    cpm: raw.impressions > 0 ? (raw.invest / raw.impressions) * 1000 : null,
    ctr: raw.impressions > 0 ? (raw.clicks / raw.impressions) * 100 : null,
    convrate: raw.pageViews > 0 ? (raw.conversions / raw.pageViews) * 100 : null
  };

  (targetsRows || []).forEach(t => {
    const actual = actualByMetric[t.metric_name];
    const target = Number(t.target_value);
    if (actual === null || actual === undefined || !target) return;

    const rule = t.rule || '';
    let ratio = null;
    if (rule.includes('Menor')) ratio = actual / target; // acima de 1 é pior
    else if (rule.includes('Maior')) ratio = target / actual; // acima de 1 é pior
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

// Cores conhecidas por plataforma de mídia; qualquer plataforma nova (ex:
// TikTok Ads, LinkedIn Ads) que apareça nos dados reais do cliente usa uma
// cor de um rodízio de fallback, em vez de ficar sem cor ou quebrar telas
// que hoje só previam Google Ads / Meta Ads.
const PLATFORM_COLORS = { 'Google Ads': '#3b82f6', 'Meta Ads': '#8b5cf6', 'LinkedIn Ads': '#0a66c2' };
const PLATFORM_COLOR_FALLBACKS = ['#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];
function getPlatformColor(platform, index) {
  if (PLATFORM_COLORS[platform]) return PLATFORM_COLORS[platform];
  return PLATFORM_COLOR_FALLBACKS[(index || 0) % PLATFORM_COLOR_FALLBACKS.length];
}

// Métricas comerciais que podem ser "assumidas" por um campo personalizado
// mapeado — nunca métricas de mídia (investimento/impressões/cliques/page
// views/leads/conversões de mídia), que são sempre de campaign_metrics.
const COMMERCIAL_METRIC_LABELS = {
  sales: 'Vendas',
  revenue: 'Receita',
  proposals: 'Propostas',
  appointments: 'Agendamentos',
  service: 'Atendimentos',
  cancellations: 'Cancelamentos',
  qualified: 'Leads qualificados'
};

// Soma os custom_field_values de cada campo ATIVO mapeado, agrupando por
// tipo de métrica comercial (sales/revenue/...). Quando existe valor
// mapeado pra um tipo, ele é a fonte OFICIAL dessa métrica — quem decide o
// fallback (o que usar quando não há mapeamento) é o código que chama isso.
function resolveCommercialMetrics(customFields, customFieldValues) {
  const resolved = {};
  const customMetrics = [];

  const valuesByField = {};
  (customFieldValues || []).forEach(v => {
    if (!valuesByField[v.field_id]) valuesByField[v.field_id] = [];
    valuesByField[v.field_id].push(v);
  });

  (customFields || []).forEach(field => {
    if (!field.active || !field.metric_mapping || field.metric_mapping === 'none') return;
    // Motivo de desqualificação é categórico (texto/seleção), não um número
    // pra somar — tem resolução própria em resolveDisqualificationReasons.
    if (field.metric_mapping === 'disqualification_reason') return;
    const values = valuesByField[field.id] || [];
    const sum = values.reduce((s, v) => s + (Number(v.value_number) || 0), 0);

    if (field.metric_mapping === 'custom_metric') {
      customMetrics.push({ name: field.name, value: sum, unit: field.unit || '' });
      return;
    }

    if (!resolved[field.metric_mapping]) resolved[field.metric_mapping] = { value: 0, fieldNames: [] };
    resolved[field.metric_mapping].value += sum;
    resolved[field.metric_mapping].fieldNames.push(field.name);
  });

  return { resolved, customMetrics };
}

// Motivos de desqualificação de leads: campo(s) personalizados mapeados
// como "Motivo de desqualificação" podem ser picklist (single/multi_select)
// ou texto livre. Picklist vira um breakdown com % (igual "Motivos de
// perda"); texto livre não tem como virar % (resposta livre demais), então
// só entra como lista de respostas recentes.
function resolveDisqualificationReasons(customFields, customFieldValues) {
  const valuesByField = {};
  (customFieldValues || []).forEach(v => {
    if (!valuesByField[v.field_id]) valuesByField[v.field_id] = [];
    valuesByField[v.field_id].push(v);
  });

  const counts = {};
  const freeTextEntries = [];

  (customFields || []).forEach(field => {
    if (!field.active || field.metric_mapping !== 'disqualification_reason') return;
    const values = valuesByField[field.id] || [];
    const isPicklist = field.field_type === 'single_select' || field.field_type === 'multi_select';

    values.forEach(v => {
      if (isPicklist) {
        if (field.field_type === 'multi_select' && Array.isArray(v.value_options)) {
          v.value_options.forEach(opt => { counts[opt] = (counts[opt] || 0) + 1; });
        } else if (v.value_text) {
          counts[v.value_text] = (counts[v.value_text] || 0) + 1;
        }
      } else if (v.value_text && v.value_text.trim()) {
        freeTextEntries.push({ text: v.value_text.trim(), date: v.period_date, fieldName: field.name });
      }
    });
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const colors = ['#ef4444', '#f59e0b', '#8b5cf6', '#6b7280', '#4b5563'];
  const reasons = Object.keys(counts).map((reason, i) => ({
    name: reason,
    pct: total > 0 ? Math.round((counts[reason] / total) * 100) : 0,
    color: colors[i % colors.length]
  })).sort((a, b) => b.pct - a.pct);

  freeTextEntries.sort((a, b) => (a.date < b.date ? 1 : -1));

  return { reasons, freeTextEntries: freeTextEntries.slice(0, 20) };
}

// --------------------------------------------------
// Unificação Vendas/Receita: histórico importado (leads_sales) + portal
// --------------------------------------------------
// leads_sales é a planilha de leads/negócios importada pela agência (antes
// de existir campo personalizado): cada linha é um negócio, com `date`,
// `sale_value` (preenchido quando o negócio virou venda) e `revenue`. Uma
// linha com sale_value > 0 é uma venda real histórica — mesma lógica que já
// decide os "Motivos de perda" a partir dessa tabela.
//
// custom_field_values é o preenchimento novo, feito pelo cliente no portal
// a partir do dia em que o campo foi criado.
//
// As duas fontes alimentam a MESMA métrica (Vendas/Receita), nunca duas
// métricas separadas: pra cada dia, se o portal tem valor, ele é usado (é
// mais recente/direto); se não tem, usa o importado. NUNCA soma as duas no
// mesmo dia (duplicaria). Dias diferentes somam normalmente.

// Conta vendas (linhas com sale_value > 0) e soma receita (revenue, ou
// sale_value se revenue não foi preenchido) por dia, a partir do histórico
// importado de leads_sales.
function buildImportedDailyCounts(leadsRows) {
  const sales = {};
  const revenue = {};
  (leadsRows || []).forEach(l => {
    const date = l.date;
    if (!date) return;
    const saleVal = Number(l.sale_value) || 0;
    if (saleVal > 0) {
      sales[date] = (sales[date] || 0) + 1;
    }
    const rev = Number(l.revenue) || saleVal;
    if (rev > 0) {
      revenue[date] = (revenue[date] || 0) + rev;
    }
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
    const val = Number(v.value_number) || 0;
    byDate[v.period_date] = (byDate[v.period_date] || 0) + val;
  });
  return byDate;
}

// Combina as duas séries diárias numa só: por dia, portal > importado
// (nunca os dois somados no mesmo dia). Retorna o total, a quebra por
// origem (pra badges tipo "Fonte: importação + portal") e os registros
// individuais (pra exportação/auditoria e pro histórico que a IA usa).
function unifyDailySeries(importByDate, portalByDate) {
  const dates = new Set([...Object.keys(importByDate || {}), ...Object.keys(portalByDate || {})]);
  const records = [];
  dates.forEach(date => {
    if (portalByDate[date] !== undefined) {
      records.push({ date, value: portalByDate[date], source: 'portal' });
    } else {
      records.push({ date, value: importByDate[date], source: 'import' });
    }
  });
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = records.reduce((s, r) => s + r.value, 0);
  const bySource = { import: 0, portal: 0 };
  records.forEach(r => { bySource[r.source] += r.value; });
  return { total, bySource, records };
}

// Função central: Vendas e Receita unificadas de um cliente (histórico
// importado + portal), prontas pra alimentar Dashboard Filho, Dashboard Pai
// e o contexto da IA — sempre respeitando o recorte de linhas já filtrado
// pelo período (quem chama já filtra leadsRows/customFieldValues por data).
//
// Vendas/Receita reais importadas (linhas de leads_sales com sale_value ou
// revenue preenchidos) SEMPRE aparecem, com ou sem campo personalizado —
// o campo personalizado (metric_mapping) não é uma "chave" pra desbloquear
// esse histórico, ele só define de onde vêm os preenchimentos NOVOS feitos
// pelo cliente no portal a partir de quando o campo existir. Sem campo
// nenhum, a métrica é só o histórico importado; com campo, some com o que
// o portal for preenchendo dali pra frente (portal tem prioridade no
// mesmo dia, nunca duplica).
function resolveUnifiedSalesAndRevenue(leadsRows, customFields, customFieldValues) {
  const importedDaily = buildImportedDailyCounts(leadsRows);
  const portalSalesDaily = buildPortalDailyValues(customFields, customFieldValues, 'sales');
  const portalRevenueDaily = buildPortalDailyValues(customFields, customFieldValues, 'revenue');
  return {
    sales: unifyDailySeries(importedDaily.sales, portalSalesDaily),
    revenue: unifyDailySeries(importedDaily.revenue, portalRevenueDaily)
  };
}

// Rótulo curto de origem pra badges — usado sempre que uma métrica pode vir
// de mais de uma fonte (nunca esconde de onde veio o dado).
function describeSourceLabel(bySource) {
  const hasImport = bySource.import > 0;
  const hasPortal = bySource.portal > 0;
  if (hasImport && hasPortal) return { key: 'mixed', text: 'Fonte: importação + portal do cliente' };
  if (hasPortal) return { key: 'portal', text: 'Fonte: informado pelo cliente' };
  if (hasImport) return { key: 'import', text: 'Fonte: importação' };
  return { key: 'none', text: '' };
}

// Preenche a seção "Métricas comerciais" do Dashboard Filho — só aparece
// quando existe pelo menos um campo personalizado mapeado com valor. Cada
// card deixa a origem explícita ("Fonte: Informado pelo cliente") pra nunca
// esconder que o dado veio do portal, não de mídia.
function renderCommercialMetrics(data) {
  const separator = document.getElementById('c-commercial-separator');
  const section = document.getElementById('c-commercial-section');
  const metricsGrid = document.getElementById('c-commercial-metrics-grid');
  const customGrid = document.getElementById('c-custom-metrics-grid');
  if (!section || !metricsGrid || !customGrid) return;

  const commercial = data.commercial || {};
  const customMetrics = data.customMetrics || [];
  const stats = data.commercialStats || {};
  const hasCommercial = Object.keys(commercial).length > 0;
  const hasCustom = customMetrics.length > 0;

  const receitaBadge = document.getElementById('c-receita-source-badge');
  if (receitaBadge) {
    if (data.revenueSourceLabel && data.revenueSourceLabel.key !== 'none') {
      receitaBadge.innerText = data.revenueSourceLabel.text;
      receitaBadge.style.display = 'block';
    } else {
      receitaBadge.style.display = 'none';
    }
  }
  const vendasBadge = document.getElementById('c-vendas-source-badge');
  if (vendasBadge) {
    if (data.salesSourceLabel && data.salesSourceLabel.key !== 'none') {
      vendasBadge.innerText = data.salesSourceLabel.text;
      vendasBadge.style.display = 'block';
    } else {
      vendasBadge.style.display = 'none';
    }
  }

  if (!hasCommercial && !hasCustom) {
    separator.style.display = 'none';
    section.style.display = 'none';
    return;
  }
  separator.style.display = 'flex';
  section.style.display = 'block';

  const cardHtml = (title, value, extra) => `
    <div class="metric-card">
      <span class="card-title">${escapeHtml(title)}</span>
      <div class="card-value">${value}</div>
      <span class="card-source-badge" style="font-size:9px; color:var(--text-secondary); margin-top:2px; display:block;">${extra || 'Fonte: Informado pelo cliente'}</span>
    </div>
  `;

  let html = '';
  Object.keys(COMMERCIAL_METRIC_LABELS).forEach(type => {
    if (!commercial[type]) return;
    const label = COMMERCIAL_METRIC_LABELS[type];
    const value = type === 'revenue' ? formatCurrency(commercial[type].value) : formatNumber(commercial[type].value);
    const sourceLabel = (type === 'sales' || type === 'revenue') && commercial[type].bySource
      ? describeSourceLabel(commercial[type].bySource).text
      : null;
    html += cardHtml(label, value, sourceLabel);
  });

  if (stats.custoPorVenda !== null && stats.custoPorVenda !== undefined) {
    html += cardHtml('Custo por venda', formatCurrency(stats.custoPorVenda), 'Investimento ÷ Vendas (real)');
  }
  if (stats.taxaLeadVenda !== null && stats.taxaLeadVenda !== undefined) {
    html += cardHtml('Taxa lead → venda', `${stats.taxaLeadVenda.toFixed(1)}%`, 'Vendas (real) ÷ Leads');
  }
  if (stats.ticketMedio !== null && stats.ticketMedio !== undefined) {
    html += cardHtml('Ticket médio', formatCurrency(stats.ticketMedio), 'Receita (real) ÷ Vendas (real)');
  }
  if (stats.roas !== null && stats.roas !== undefined) {
    html += cardHtml('ROAS', `${stats.roas.toFixed(1)}x`, 'Receita (real) ÷ Investimento');
  }
  metricsGrid.innerHTML = html;

  customGrid.innerHTML = customMetrics.map(m => cardHtml(m.name, `${formatNumber(m.value)}${m.unit ? ' ' + escapeHtml(m.unit) : ''}`)).join('');
}

// Motivos de desqualificação de leads — mesma UI de "Motivos de perda"
// (breakdown com barra de %) quando o campo é picklist; lista simples de
// respostas recentes quando é texto livre. Some quando não há nada mapeado.
function renderDisqualificationReasons(data) {
  const section = document.getElementById('c-disqualification-section');
  const list = document.getElementById('c-disqualification-list');
  const freeTextEl = document.getElementById('c-disqualification-freetext');
  if (!section || !list || !freeTextEl) return;

  const reasons = data.disqualificationReasons || [];
  const freeText = data.disqualificationFreeText || [];

  if (!reasons.length && !freeText.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  list.innerHTML = reasons.map(item => `
    <li class="progress-item">
      <div class="progress-header">
        <span class="progress-name">${escapeHtml(item.name)}</span>
        <span class="progress-value">${item.pct}%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${item.pct}%; background-color: ${item.color};"></div>
      </div>
    </li>
  `).join('');

  if (freeText.length) {
    freeTextEl.style.display = 'flex';
    freeTextEl.innerHTML = freeText.map(entry => `
      <div style="border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); padding: 8px 10px; font-size: 11px;">
        <span style="color: var(--text-primary);">${escapeHtml(entry.text)}</span>
        <span style="color: var(--text-muted); font-size: 10px; margin-left: 6px;">${entry.date ? formatDate(new Date(entry.date + 'T00:00:00')) : ''}</span>
      </div>
    `).join('');
  } else {
    freeTextEl.style.display = 'none';
    freeTextEl.innerHTML = '';
  }
}

function buildClientDetailedDataFromReal(campaigns, leadsRows, targetsRows, customFields, customFieldValues) {
  let totalInvest = 0, totalImpress = 0, totalClicks = 0, totalPageViews = 0, totalLeads = 0, totalConvs = 0, totalRevenue = 0;
  const byPlatform = {};
  const byDate = {};

  campaigns.forEach(c => {
    totalInvest += Number(c.invest) || 0;
    totalImpress += Number(c.impressions) || 0;
    totalClicks += Number(c.clicks) || 0;
    totalPageViews += Number(c.page_views) || 0;
    totalLeads += Number(c.leads) || 0;
    totalConvs += Number(c.conversions) || 0;
    totalRevenue += Number(c.revenue) || 0;

    const plat = c.platform || 'Outra';
    if (!byPlatform[plat]) byPlatform[plat] = { invest: 0, clicks: 0, convs: 0, leads: 0 };
    byPlatform[plat].invest += Number(c.invest) || 0;
    byPlatform[plat].clicks += Number(c.clicks) || 0;
    byPlatform[plat].convs += Number(c.conversions) || 0;
    byPlatform[plat].leads += Number(c.leads) || 0;

    if (!byDate[c.date]) byDate[c.date] = { invest: 0, convs: 0 };
    byDate[c.date].invest += Number(c.invest) || 0;
    byDate[c.date].convs += Number(c.conversions) || 0;
  });

  // Métricas comerciais mapeadas por campo personalizado: quando existir
  // campo ativo mapeado, o valor informado pelo cliente vira a fonte
  // OFICIAL (prioridade sobre dado de mídia) — vendas/receita/propostas/
  // atendimentos/cancelamentos/qualificados normalmente não vêm de mídia
  // paga, então dado manual mapeado tem prioridade quando existir.
  const { resolved: commercial, customMetrics } = resolveCommercialMetrics(customFields, customFieldValues);
  const disqualification = resolveDisqualificationReasons(customFields, customFieldValues);

  // Vendas e Receita são as duas métricas com fonte histórica confiável
  // (leads_sales, da planilha importada) — unifica isso com o que o portal
  // preencher depois, dia a dia, sem duplicar (ver resolveUnifiedSalesAndRevenue).
  const unified = resolveUnifiedSalesAndRevenue(leadsRows, customFields, customFieldValues);
  if (unified.sales.records.length) {
    commercial.sales = { value: unified.sales.total, fieldNames: commercial.sales ? commercial.sales.fieldNames : [], bySource: unified.sales.bySource, records: unified.sales.records };
  }
  if (unified.revenue.records.length) {
    commercial.revenue = { value: unified.revenue.total, fieldNames: commercial.revenue ? commercial.revenue.fieldNames : [], bySource: unified.revenue.bySource, records: unified.revenue.records };
  }

  const revenueSource = commercial.revenue ? describeSourceLabel(commercial.revenue.bySource || { import: 0, portal: commercial.revenue.value }).key : 'media';
  if (commercial.revenue) totalRevenue = commercial.revenue.value;
  const salesResolved = commercial.sales ? commercial.sales.value : null;
  const salesSourceLabel = commercial.sales ? describeSourceLabel(commercial.sales.bySource || { import: 0, portal: commercial.sales.value }) : null;
  const revenueSourceLabel = commercial.revenue ? describeSourceLabel(commercial.revenue.bySource || { import: 0, portal: commercial.revenue.value }) : null;

  const conversaoPct = totalClicks > 0 ? (totalConvs / totalClicks) * 100 : 0;
  const cpl = totalLeads > 0 ? totalInvest / totalLeads : 0;
  const cpa = totalConvs > 0 ? totalInvest / totalConvs : 0;
  const roi = totalInvest > 0 ? ((totalRevenue - totalInvest) / totalInvest) * 100 : 0;

  // O último estágio do funil é rotulado "Vendas" na tela — quando existe
  // venda real mapeada, mostra ela (e a % final bate com ela); sem
  // mapeamento, continua caindo no proxy de conversões de mídia (como já
  // era antes, só que agora deixando claro que é um proxy, não a venda em si).
  const finalFunnelValue = salesResolved !== null ? salesResolved : totalConvs;
  const finalFunnelPct = totalClicks > 0 ? (finalFunnelValue / totalClicks) * 100 : 0;

  const funnel = [formatNumber(totalImpress), formatNumber(totalClicks), formatNumber(totalPageViews), formatNumber(finalFunnelValue)];
  const funnelPct = [
    '100%',
    totalImpress > 0 ? `${((totalClicks / totalImpress) * 100).toFixed(0)}%` : '0%',
    totalClicks > 0 ? `${((totalPageViews / totalClicks) * 100).toFixed(0)}%` : '0%',
    `${finalFunnelPct.toFixed(1)}% final`
  ];

  // Estatísticas derivadas de vendas/receita reais (só fazem sentido quando
  // existe um valor mapeado por campo personalizado — sem venda real
  // informada, custo por venda/ticket médio real não têm como ser calculados).
  const custoPorVenda = salesResolved > 0 ? totalInvest / salesResolved : null;
  const taxaLeadVenda = salesResolved !== null && totalLeads > 0 ? (salesResolved / totalLeads) * 100 : null;
  const taxaCliqueVenda = salesResolved !== null && totalClicks > 0 ? (salesResolved / totalClicks) * 100 : null;
  const ticketMedio = salesResolved > 0 && commercial.revenue ? commercial.revenue.value / salesResolved : null;
  const roas = commercial.revenue && totalInvest > 0 ? commercial.revenue.value / totalInvest : null;

  const platformColors = { 'Google Ads': '#3b82f6', 'Meta Ads': '#8b5cf6', 'LinkedIn Ads': '#0a66c2' };
  const platformList = Object.keys(byPlatform);
  const sourceBasis = platformList.reduce((s, p) => s + (byPlatform[p].leads || byPlatform[p].clicks), 0) || 1;
  const leadsSource = platformList.map((p, i) => {
    const val = byPlatform[p].leads || byPlatform[p].clicks;
    return {
      name: p,
      pct: Math.round((val / sourceBasis) * 100),
      value: `${formatNumber(val)} leads`,
      color: platformColors[p] || ['#10b981', '#f59e0b', '#ef4444', '#6b7280'][i % 4]
    };
  });

  const lossCounts = {};
  leadsRows.forEach(l => {
    if (l.loss_reason && l.loss_reason.toString().trim()) {
      lossCounts[l.loss_reason] = (lossCounts[l.loss_reason] || 0) + 1;
    }
  });
  const totalLoss = Object.values(lossCounts).reduce((a, b) => a + b, 0);
  const lossColors = ['#ef4444', '#f59e0b', '#6b7280', '#4b5563'];
  const lossReasons = Object.keys(lossCounts).map((reason, i) => ({
    name: reason,
    pct: totalLoss > 0 ? Math.round((lossCounts[reason] / totalLoss) * 100) : 0,
    color: lossColors[i % lossColors.length]
  }));

  const dateKeys = Object.keys(byDate).sort();
  const weeks = {};
  dateKeys.forEach(d => {
    const dt = new Date(d + 'T00:00:00');
    const firstDay = new Date(dt.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((dt - firstDay) / 86400000) + firstDay.getDay() + 1) / 7);
    const key = `${dt.getFullYear()}-W${weekNum}`;
    weeks[key] = (weeks[key] || 0) + byDate[d].invest;
  });
  const weekKeys = Object.keys(weeks).sort().slice(-4);
  const evolution = weekKeys.map((k, i) => {
    const val = weeks[k];
    const prev = i > 0 ? weeks[weekKeys[i - 1]] : val;
    const trendPct = prev > 0 ? ((val - prev) / prev) * 100 : 0;
    return {
      label: `Semana ${i + 1}`,
      val: formatCurrency(val),
      trend: `${trendPct >= 0 ? '▲' : '▼'} ${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(0)}%`,
      trendClass: trendPct >= 0 ? 'up' : 'down'
    };
  });

  const chartDates = dateKeys.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
  });

  const gads = byPlatform['Google Ads'] || { invest: 0, clicks: 0, convs: 0 };
  const mads = byPlatform['Meta Ads'] || { invest: 0, clicks: 0, convs: 0 };

  const campaignGroups = {};
  campaigns.forEach(c => {
    const key = `${c.campaign_name}||${c.platform}`;
    if (!campaignGroups[key]) {
      campaignGroups[key] = {
        id: key, name: c.campaign_name, platform: c.platform,
        labelColor: platformColors[c.platform] || '#6b7280',
        invest: 0, impress: 0, clicks: 0, convs: 0,
        status: c.campaign_status || 'Ativo', objective: c.objective || ''
      };
    }
    campaignGroups[key].invest += Number(c.invest) || 0;
    campaignGroups[key].impress += Number(c.impressions) || 0;
    campaignGroups[key].clicks += Number(c.clicks) || 0;
    campaignGroups[key].convs += Number(c.conversions) || 0;
  });
  const campaignsList = Object.values(campaignGroups).map(c => ({
    ...c,
    ctr: c.impress > 0 ? Number(((c.clicks / c.impress) * 100).toFixed(2)) : 0,
    cpc: c.clicks > 0 ? Number((c.invest / c.clicks).toFixed(2)) : 0,
    cpa: c.convs > 0 ? Number((c.invest / c.convs).toFixed(2)) : 0
  }));

  const importedAt = new Date().toLocaleString('pt-BR');
  const topSource = leadsSource.slice().sort((a, b) => b.pct - a.pct)[0];

  // Valores numéricos "crus" (não formatados) pra qualquer função que
  // precise recalcular sem ter que reparsear texto formatado — evita
  // arredondamento em cascata e denominador errado (ex: CPL usando
  // impressões em vez de leads).
  const raw = {
    invest: totalInvest,
    revenue: totalRevenue,
    leads: totalLeads,
    impressions: totalImpress,
    clicks: totalClicks,
    pageViews: totalPageViews,
    conversions: totalConvs,
    sales: salesResolved
  };

  const { status: computedStatus, reasons: statusReasons } = computeClientStatusFromData(raw, targetsRows);
  const statusLabels = { healthy: 'Saudável', attention: 'Atenção', critical: 'Crítico' };

  return {
    segment: '',
    period: 'Dados importados',
    owner: '',
    updated: importedAt,
    status: statusLabels[computedStatus],
    statusClass: computedStatus,
    statusReasons,
    metrics: {
      investimento: formatCurrencyThousands(totalInvest),
      receita: formatCurrencyThousands(totalRevenue),
      conversao: `${conversaoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
      cpl: totalLeads > 0 ? formatCurrency(cpl) : '—',
      cpa: totalConvs > 0 ? formatCurrency(cpa) : '—',
      roi: `${Math.round(roi)}%`
    },
    raw,
    // Métricas comerciais resolvidas a partir de campos personalizados
    // mapeados (vendas, receita, propostas, etc.) — cada uma com a origem
    // ("manual" = informado pelo cliente no portal) pra nunca esconder de
    // onde veio o dado. `customMetrics` são campos mapeados como "métrica
    // personalizada" (usam o próprio nome do campo, ex: "Visitas presenciais").
    commercial,
    customMetrics,
    disqualificationReasons: disqualification.reasons,
    disqualificationFreeText: disqualification.freeTextEntries,
    revenueSource,
    revenueSourceLabel,
    salesSourceLabel,
    salesResolved,
    commercialStats: {
      custoPorVenda,
      taxaLeadVenda,
      taxaCliqueVenda,
      ticketMedio,
      roas
    },
    updates: [
      { source: 'Planilha importada', time: importedAt, status: 'Atualizado', statusClass: 'healthy', obs: `${campaigns.length} linha(s) de campanha, ${leadsRows.length} lead(s)/venda(s) importados.` }
    ],
    funnel,
    funnelPct,
    leadsSource,
    lossReasons,
    evolution,
    insights: [
      `Investimento total de ${formatCurrency(totalInvest)} gerou receita de ${formatCurrency(totalRevenue)} (ROI de ${Math.round(roi)}%).`,
      `Taxa de conversão geral (cliques → conversões): ${conversaoPct.toFixed(1)}%.`,
      `Custo por lead médio de ${formatCurrency(cpl)} e custo por conversão de ${formatCurrency(cpa)}.`,
      topSource ? `A plataforma ${topSource.name} concentrou a maior parte do volume de leads.` : 'Dados importados via planilha de campanhas.'
    ],
    adsKpis: {
      period: 'Dados importados',
      investimento: totalInvest,
      cliques: totalClicks,
      conversoes: totalConvs,
      cpa: cpa,
      ctr: totalImpress > 0 ? Number(((totalClicks / totalImpress) * 100).toFixed(2)) : 0
    },
    adsPlatforms: {
      gads: { investimento: gads.invest, cliques: gads.clicks, conversoes: gads.convs, cpa: gads.convs > 0 ? gads.invest / gads.convs : 0 },
      mads: { investimento: mads.invest, cliques: mads.clicks, conversoes: mads.convs, cpa: mads.convs > 0 ? mads.invest / mads.convs : 0 }
    },
    campaigns: campaignsList,
    chartData: {
      dates: chartDates,
      investimento: dateKeys.map(d => byDate[d].invest),
      conversoes: dateKeys.map(d => byDate[d].convs)
    }
  };
}

// Verifica (uma vez por sessão) se existe dado real importado para este cliente;
// se sim, substitui a entrada de clientDetailedData por dados calculados de verdade.
async function refreshClientDetailedDataIfReal(clientName) {
  const slug = clientSlugFromName(clientName) || slugify(clientName);
  if (realClientDataChecked.has(slug)) return;
  realClientDataChecked.add(slug);

  const [{ data: campaigns }, { data: leadsRows }, { data: targetsRows }, { data: customFields }, { data: customFieldValues }] = await Promise.all([
    supabaseClient.from('campaign_metrics').select('*').eq('client_slug', slug),
    supabaseClient.from('leads_sales').select('*').eq('client_slug', slug),
    supabaseClient.from('targets').select('*').eq('client_slug', slug),
    supabaseClient.from('custom_fields').select('*').eq('client_slug', slug).eq('active', true),
    supabaseClient.from('custom_field_values').select('*').eq('client_slug', slug)
  ]);

  // Sempre monta o dashboard a partir do que existir no banco (zerado se não
  // houver nada ainda) — não usa mais o mock fictício como fallback.
  const built = buildClientDetailedDataFromReal(campaigns || [], leadsRows || [], targetsRows || [], customFields || [], customFieldValues || []);

  // Guarda dados "crus" e definições que o filtro de período (ver
  // updateDashboardFilhoForCustomPeriod) precisa pra refazer o cálculo
  // filtrando de verdade por data real (campaign_metrics.date e
  // custom_field_values.period_date), em vez de aproximar por "fator".
  built.slug = slug;
  built.customFieldsDefs = customFields || [];
  built.customFieldValuesAll = customFieldValues || [];
  built.leadsRowsAll = leadsRows || [];
  built.targetsRowsAll = targetsRows || [];
  const allDates = [
    ...(campaigns || []).map(c => c.date),
    ...(customFieldValues || []).map(v => v.period_date),
    ...(leadsRows || []).map(l => l.date)
  ].filter(Boolean).map(d => new Date(d + 'T00:00:00')).filter(d => !isNaN(d));
  built.earliestDate = allDates.length ? new Date(Math.min(...allDates)) : null;
  built.latestDate = allDates.length ? new Date(Math.max(...allDates)) : null;

  clientDetailedData[clientName] = built;

  // NÃO sobrescreve clientRef.status/.statusReasons/.healthScore aqui — desde
  // que o Score de Saúde existe, quem calcula esses três de forma completa
  // (ROI/metas + tendência mês a mês + atualização de dados + campos
  // pendentes) é computePortfolioAlerts, chamado sempre que o Dashboard Pai
  // carrega (inclusive no boot do app, antes de qualquer cliente ser aberto).
  // O status calculado aqui (built.statusClass/.statusReasons) é mais pobre
  // (só ROI/metas) e sobrescrever com ele deixaria a sidebar/IA
  // inconsistentes com o score já calculado.

  // Insights estratégicos por IA: usa cache do Supabase (client_ai_insights) e
  // só chama a OpenAI de novo quando os dados reais do cliente mudaram
  // (fingerprint diferente) — evita custo/latência a cada visita ao cliente.
  maybeGenerateStrategicInsights(clientName, slug, campaigns || [], leadsRows || [], targetsRows || [], built, customFieldValues || []);
}

// Assinatura compacta e determinística dos dados reais de um cliente. Muda
// sempre que uma reimportação altera valores/quantidade de linhas, e serve
// pra decidir se o cache de insights estratégicos ainda é válido.
function computeDataFingerprint(campaigns, leadsRows, targetsRows, customFieldValues) {
  const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const cfValues = customFieldValues || [];
  return [
    campaigns.length,
    leadsRows.length,
    (targetsRows || []).length,
    sum(campaigns, 'invest').toFixed(2),
    sum(campaigns, 'revenue').toFixed(2),
    sum(campaigns, 'leads').toFixed(2),
    sum(campaigns, 'conversions').toFixed(2),
    sum(campaigns, 'impressions').toFixed(2),
    sum(campaigns, 'clicks').toFixed(2),
    sum(campaigns, 'page_views').toFixed(2),
    sum(leadsRows, 'sale_value').toFixed(2),
    // Campos personalizados (vendas/receita informadas etc.) também entram
    // no fingerprint — sem isso, um novo preenchimento no portal não
    // invalidava o cache e os insights nunca refletiam o dado novo.
    cfValues.length,
    sum(cfValues, 'value_number').toFixed(2)
  ].join('|');
}

// Monta um resumo rico dos dados reais de UM cliente (totais, plataformas,
// campanhas de destaque, evolução semanal, metas e motivos de perda) pra
// alimentar a IA na geração de insights estratégicos — vai além do que os
// cards já mostram, permitindo comparações e recomendações de verdade.
function buildStrategicInsightsContext(clientName, built, campaigns, leadsRows, targetsRows) {
  const lines = [];
  lines.push(`Cliente: ${clientName}.`);
  lines.push(`Resumo geral (todo o período importado): Investimento ${formatCurrency(built.raw.invest)}, Receita ${formatCurrency(built.raw.revenue)}, ROI ${built.metrics.roi}, Leads ${built.raw.leads}, Conversão de mídia (cliques → conversões rastreadas pelo anúncio, NÃO é venda confirmada) ${built.metrics.conversao}, CPL ${built.metrics.cpl}, CPA ${built.metrics.cpa}.`);

  // Métricas comerciais informadas manualmente pelo cliente no portal
  // (vendas, receita, propostas etc.) — quando existir campo mapeado, é o
  // dado OFICIAL, e os insights devem priorizar/citar isso, não confundir
  // com o proxy de "conversão de mídia" acima.
  if (built.commercial && Object.keys(built.commercial).length) {
    const commercialLines = Object.keys(COMMERCIAL_METRIC_LABELS)
      .filter(t => built.commercial[t])
      .map(t => {
        const label = COMMERCIAL_METRIC_LABELS[t];
        const val = t === 'revenue' ? formatCurrency(built.commercial[t].value) : Math.round(built.commercial[t].value).toLocaleString('pt-BR');
        const source = (t === 'sales' || t === 'revenue') && built.commercial[t].bySource ? ` [${describeSourceLabel(built.commercial[t].bySource).text}]` : ' [Fonte: Informado pelo cliente]';
        return `${label}: ${val}${source}`;
      });
    lines.push(`Dado comercial OFICIAL (real, prioritário sobre métricas de mídia): ${commercialLines.join('; ')}.`);
  }
  if (built.commercialStats) {
    const s = built.commercialStats;
    const statParts = [];
    if (s.custoPorVenda !== null && s.custoPorVenda !== undefined) statParts.push(`Custo por venda: ${formatCurrency(s.custoPorVenda)}`);
    if (s.ticketMedio !== null && s.ticketMedio !== undefined) statParts.push(`Ticket médio: ${formatCurrency(s.ticketMedio)}`);
    if (s.roas !== null && s.roas !== undefined) statParts.push(`ROAS: ${s.roas.toFixed(1)}x`);
    if (statParts.length) lines.push(`Métricas comerciais derivadas: ${statParts.join(', ')}.`);
  }

  if (built.leadsSource && built.leadsSource.length) {
    lines.push(`Distribuição por plataforma: ${built.leadsSource.map(s => `${s.name} (${s.pct}% dos leads)`).join(', ')}.`);
  }

  if (built.campaigns && built.campaigns.length) {
    const topInvest = [...built.campaigns].sort((a, b) => b.invest - a.invest).slice(0, 3);
    lines.push(`Top campanhas por investimento: ${topInvest.map(c => `${c.name} (${c.platform}): investimento ${formatCurrency(c.invest)}, CTR ${c.ctr}%, CPA ${c.cpa > 0 ? formatCurrency(c.cpa) : '—'}`).join('; ')}.`);

    const withCpa = built.campaigns.filter(c => c.convs > 0);
    if (withCpa.length > 1) {
      const worstCpa = [...withCpa].sort((a, b) => b.cpa - a.cpa).slice(0, 2);
      lines.push(`Campanhas com maior custo por conversão (candidatas a otimização): ${worstCpa.map(c => `${c.name} (${c.platform}): CPA ${formatCurrency(c.cpa)}`).join('; ')}.`);
    }
  }

  if (built.evolution && built.evolution.length) {
    lines.push(`Evolução de investimento nas últimas semanas: ${built.evolution.map(e => `${e.label}: ${e.val} (${e.trend})`).join('; ')}.`);
  }

  if (targetsRows && targetsRows.length) {
    lines.push(`Metas definidas pelo cliente: ${targetsRows.map(t => `${t.objective} / ${t.metric_name}: meta de ${t.target_value}`).join('; ')}.`);
  }

  if (built.lossReasons && built.lossReasons.length) {
    lines.push(`Motivos de perda de leads: ${built.lossReasons.map(r => `${r.name} (${r.pct}%)`).join(', ')}.`);
  }

  return lines.join('\n');
}

// Gera (via OpenAI) os insights estratégicos de um cliente e guarda em cache
// no Supabase, associados ao fingerprint dos dados no momento da geração.
// Só chama a IA de fato quando não existe cache ainda ou quando os dados
// mudaram desde a última geração; caso contrário reaproveita o cache.
async function maybeGenerateStrategicInsights(clientName, slug, campaigns, leadsRows, targetsRows, built, customFieldValues) {
  if (!campaigns.length) return;

  const fingerprint = computeDataFingerprint(campaigns, leadsRows, targetsRows, customFieldValues);

  const { data: cached } = await supabaseClient
    .from('client_ai_insights')
    .select('insights, data_fingerprint')
    .eq('client_slug', slug)
    .maybeSingle();

  if (cached && cached.data_fingerprint === fingerprint) {
    if (Array.isArray(cached.insights) && cached.insights.length) {
      built.insights = cached.insights;
      if (currentClient === clientName) renderClientInsights(clientName);
    }
    return;
  }

  try {
    const context = buildStrategicInsightsContext(clientName, built, campaigns, leadsRows, targetsRows);
    const response = await fetch('/api/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName, context })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.insights) || !data.insights.length) return;

    built.insights = data.insights;
    if (currentClient === clientName) renderClientInsights(clientName);

    await supabaseClient.from('client_ai_insights').upsert({
      client_slug: slug,
      insights: data.insights,
      data_fingerprint: fingerprint,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Erro ao gerar insights estratégicos', err);
  }
}

// Renderiza a lista de insights do cliente atualmente ativo no card
// "Insights de IA" do Dashboard Filho — reaproveitada tanto na abertura
// inicial do cliente quanto quando um insight estratégico chega em segundo
// plano (após o cache ser preenchido/atualizado).
function renderClientInsights(clientName) {
  const insightsUl = document.getElementById('c-insights-list');
  if (!insightsUl) return;
  const data = clientDetailedData[clientName];
  if (!data) return;

  insightsUl.innerHTML = '';
  const activeInsights = (currentAnalysis && currentAnalysis !== 'Visão geral') ?
                          getAnalysisInsights(clientName, currentAnalysis) :
                          data.insights;

  activeInsights.forEach(insight => {
    const li = document.createElement('li');
    li.innerText = insight;
    insightsUl.appendChild(li);
  });
}

// Recalcula o status de cada cliente em allClients a partir dos dados reais
// de TODOS eles de uma vez (uma única leitura de campaign_metrics/targets,
// em vez de uma consulta por cliente). Clientes sem nenhuma campanha
// importada mantêm o status atual (nada pra analisar ainda).
//
// A Receita usada no ROI é a UNIFICADA (leads_sales + portal, quando existe
// campo mapeado) — não só campaign_metrics.revenue — pelo mesmo motivo que
// o resto do app já faz isso: revenue de mídia sozinho pode estar muito
// longe do resultado comercial real do cliente (ver resolveUnifiedSalesAndRevenue).
function updateClientStatusesFromCampaigns(campaigns, targets, allCustomFields, allCustomFieldValues, allLeadsRows) {
  const byClient = {};
  campaigns.forEach(c => {
    if (!byClient[c.client_slug]) {
      byClient[c.client_slug] = { invest: 0, revenue: 0, impressions: 0, clicks: 0, pageViews: 0, leads: 0, conversions: 0 };
    }
    const r = byClient[c.client_slug];
    r.invest += Number(c.invest) || 0;
    r.revenue += Number(c.revenue) || 0;
    r.impressions += Number(c.impressions) || 0;
    r.clicks += Number(c.clicks) || 0;
    r.pageViews += Number(c.page_views) || 0;
    r.leads += Number(c.leads) || 0;
    r.conversions += Number(c.conversions) || 0;
  });

  const targetsByClient = {};
  (targets || []).forEach(t => {
    if (!targetsByClient[t.client_slug]) targetsByClient[t.client_slug] = [];
    targetsByClient[t.client_slug].push(t);
  });

  const fieldsByClient = {};
  (allCustomFields || []).forEach(f => {
    if (!fieldsByClient[f.client_slug]) fieldsByClient[f.client_slug] = [];
    fieldsByClient[f.client_slug].push(f);
  });
  const valuesByClient = {};
  (allCustomFieldValues || []).forEach(v => {
    if (!valuesByClient[v.client_slug]) valuesByClient[v.client_slug] = [];
    valuesByClient[v.client_slug].push(v);
  });
  const leadsByClient = {};
  (allLeadsRows || []).forEach(l => {
    if (!leadsByClient[l.client_slug]) leadsByClient[l.client_slug] = [];
    leadsByClient[l.client_slug].push(l);
  });

  allClients.forEach(c => {
    const raw = byClient[c.slug];
    if (!raw) return;

    // Só a Receita é substituída pela unificada — Conversões continua sendo
    // a métrica de mídia pura (usada no CPA/metas de conversão), nunca a
    // venda real: misturar os dois aqui repetiria o erro que o resto do app
    // já corrigiu (conversão de mídia ≠ venda confirmada).
    const unified = resolveUnifiedSalesAndRevenue(leadsByClient[c.slug] || [], fieldsByClient[c.slug] || [], valuesByClient[c.slug] || []);
    const rawForStatus = unified.revenue.records.length ? { ...raw, revenue: unified.revenue.total } : raw;

    const { status, reasons } = computeClientStatusFromData(rawForStatus, targetsByClient[c.slug] || []);
    c.status = status;
    c.statusReasons = reasons;
  });
}

// ==========================================================================
// ALERTAS AUTOMÁTICOS (sino do Dashboard Pai) + SCORE DE SAÚDE DO CLIENTE
// ==========================================================================
// Cada alerta é { severity: 'critical'|'attention', clientName, message }.
// Parte reaproveita o que já existe (client.statusReasons, calculado acima em
// computeClientStatusFromData: ROI negativo/baixo, meta fora do alvo,
// investimento sem nenhuma conversão) — o resto é novo: campo obrigatório
// pendente, cliente sem atualizar vendas há dias, dados importados
// desatualizados, comparação com o mês anterior (receita, CPA, leads) e
// completude (cliente sem nenhum dado configurado ainda).
//
// A MESMA lista de motivos vira o Score de Saúde (0-100): cada motivo já
// carrega uma severidade, então o score é só 100 menos as penalidades de
// tudo que foi encontrado — client.status/.statusReasons (usados em todo
// canto: sidebar, cards de atenção, Assistente de IA) passam a ser
// derivados do score, não mais só do ROI/metas isoladamente. Isso roda toda
// vez que o Dashboard Pai carrega/atualiza (refreshAgencyPeriodDataFromReal)
// — não é um valor calculado uma vez e cacheado, é recalculado do zero a
// cada visita com os dados mais recentes do Supabase.
let portfolioAlerts = [];

const PORTFOLIO_ALERT_THRESHOLDS = {
  cpaIncreasePct: 30,        // CPA subiu mais de 30% vs mês anterior
  revenueDropPct: 15,        // Receita caiu mais de 15% vs mês anterior
  leadsDropPct: 30,          // Queda de leads considerada "brusca"
  staleSalesDays: 3,         // Dias sem preencher vendas pra alertar
  staleImportDays: 7,        // Dias sem nova linha de campanha importada
  lowConversionInvest: 1000  // Investimento (R$) considerado "alto" numa campanha sem nenhuma conversão no mês
};

// Quanto cada motivo tira do score de 100 — crítico pesa mais que atenção,
// mas nenhum motivo isolado zera o cliente sozinho (só o acúmulo de vários).
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

function computePortfolioAlerts(campaigns, allCustomFields, allCustomFieldValues, allLeadsRows) {
  const alerts = [];
  const now = new Date();
  const curMonthKey = formatDateISO(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 7);
  const prevMonthKey = formatDateISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);

  // Acumula, por cliente, TODOS os motivos com severidade — a mesma lista
  // alimenta o sino (achatada abaixo) e o score de saúde (soma penalidades).
  const reasonsBySlug = {};
  allClients.forEach(c => { reasonsBySlug[c.slug] = []; });

  function addReason(slug, severity, text) {
    if (!reasonsBySlug[slug]) reasonsBySlug[slug] = [];
    reasonsBySlug[slug].push({ severity, text });
    const client = allClients.find(c => c.slug === slug);
    alerts.push({ severity, clientName: client ? client.name : slug, message: text });
  }

  // --- 1) Reaproveita o status já calculado por cliente (ROI/metas) ---
  allClients.forEach(c => {
    (c.statusReasons || []).forEach(r => addReason(c.slug, r.severity, r.text));
  });

  // --- 2) Agrupa campanhas por cliente+mês (mês atual e anterior) e por
  // cliente+campanha (só mês atual, pra achar campanha parada sem conversão) ---
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

  allClients.forEach(client => {
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
        addReason(slug, 'attention', `Dados importados desatualizados — última linha de campanha é de ${formatDate(new Date(latest + 'T00:00:00'))} (${daysSince} dias atrás).`);
      }
    }

    Object.values(bySlugCampaignThisMonth[slug] || {}).forEach(camp => {
      if (camp.invest >= PORTFOLIO_ALERT_THRESHOLDS.lowConversionInvest && camp.convs === 0) {
        addReason(slug, 'attention', `Campanha "${camp.name}" com ${formatCurrency(camp.invest)} investidos este mês e nenhuma conversão registrada.`);
      }
    });
  });

  // --- 3) Campos personalizados: obrigatório pendente + vendas sem atualizar ---
  const fieldsBySlug = {};
  (allCustomFields || []).forEach(f => {
    if (!fieldsBySlug[f.client_slug]) fieldsBySlug[f.client_slug] = [];
    fieldsBySlug[f.client_slug].push(f);
  });
  const valuesByField = {};
  (allCustomFieldValues || []).forEach(v => {
    if (!valuesByField[v.field_id]) valuesByField[v.field_id] = [];
    valuesByField[v.field_id].push(v);
  });

  allClients.forEach(client => {
    (fieldsBySlug[client.slug] || []).forEach(field => {
      const values = valuesByField[field.id] || [];

      // Campo obrigatório mapeado como vendas diárias já cai no alerta mais
      // específico "sem preencher vendas há N dias" logo abaixo — evita
      // dois alertas diferentes sobre o mesmo campo pendente.
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

  // --- 4) Completude: cliente sem NENHUM dado configurado ainda (nem
  // campanha importada, nem campo personalizado, nem venda histórica) — o
  // Score de Saúde precisa refletir isso, não só performance de campanha. ---
  const hasCampaignBySlug = new Set((campaigns || []).map(c => c.client_slug));
  const hasFieldBySlug = new Set((allCustomFields || []).map(f => f.client_slug));
  const hasLeadsBySlug = new Set((allLeadsRows || []).map(l => l.client_slug));
  allClients.forEach(client => {
    const slug = client.slug;
    if (!hasCampaignBySlug.has(slug) && !hasFieldBySlug.has(slug) && !hasLeadsBySlug.has(slug)) {
      addReason(slug, 'critical', 'Nenhum dado importado ou campo personalizado configurado ainda para este cliente.');
    }
  });

  // --- Score de Saúde (0-100): soma as penalidades de todos os motivos
  // encontrados acima. status/statusReasons de cada cliente passam a vir
  // daqui — fonte única, usada pelo sino, pelos cards de atenção, pela
  // sidebar e pelo Assistente de IA. ---
  allClients.forEach(client => {
    const reasons = (reasonsBySlug[client.slug] || []).slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
    client.healthScore = computeHealthScoreFromReasons(reasons);
    client.status = healthStatusFromScore(client.healthScore);
    client.statusReasons = reasons;
  });

  // Crítico primeiro, depois por cliente — e um teto pra não virar uma
  // lista infinita se a carteira for grande.
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return a.clientName.localeCompare(b.clientName);
  });
  return alerts.slice(0, 40);
}

function renderPaiAlerts() {
  const badge = document.getElementById('pai-bell-badge');
  const list = document.getElementById('pai-alerts-list');
  const empty = document.getElementById('pai-alerts-empty');
  if (!badge || !list || !empty) return;

  const criticalCount = portfolioAlerts.filter(a => a.severity === 'critical').length;

  if (portfolioAlerts.length > 0) {
    badge.style.display = 'block';
    badge.innerText = portfolioAlerts.length;
    badge.style.backgroundColor = criticalCount > 0 ? 'var(--color-red)' : 'var(--color-orange, #f59e0b)';
  } else {
    badge.style.display = 'none';
  }

  empty.style.display = portfolioAlerts.length ? 'none' : 'block';
  list.innerHTML = portfolioAlerts.map(a => `
    <div class="pai-alert-item" style="border: 1px solid ${a.severity === 'critical' ? 'var(--color-red-border, #ef4444)' : 'var(--border-color)'}; border-radius: var(--border-radius-sm); padding: 8px 10px; cursor: pointer;" onclick="selectClient('${a.clientName.replace(/'/g, "\\'")}'); document.getElementById('pai-alerts-dropdown').style.display='none';">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">${escapeHtml(a.clientName)}</span>
        <span class="table-badge ${a.severity}" style="font-size: 8px;">${a.severity === 'critical' ? 'Crítico' : 'Atenção'}</span>
      </div>
      <div style="font-size: 10px; color: var(--text-secondary); margin-top: 3px;">${escapeHtml(a.message)}</div>
    </div>
  `).join('');
}

function togglePaiAlertsDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('pai-alerts-dropdown');
  if (!dropdown) return;
  dropdown.style.display = dropdown.style.display === 'none' || !dropdown.style.display ? 'block' : 'none';
}

document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('pai-alerts-dropdown');
  const btn = document.getElementById('pai-bell-btn');
  if (dropdown && dropdown.style.display !== 'none' && !dropdown.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

// Agrega dados reais de TODOS os clientes pro Dashboard Pai (agência). Se não
// houver nenhum dado importado ainda, mantém agencyPeriodData mockado.
// Aproveita a mesma leitura de campaign_metrics pra também recalcular o
// status (healthy/attention/critical) de cada cliente a partir dos dados
// reais, em vez de depender só do valor gravado na importação/cadastro.
async function refreshAgencyPeriodDataFromReal() {
  const [{ data }, { data: targets }, { data: allCustomFields }, { data: allCustomFieldValues }, { data: allLeadsRows }] = await Promise.all([
    supabaseClient.from('campaign_metrics').select('*'),
    supabaseClient.from('targets').select('*'),
    supabaseClient.from('custom_fields').select('*').eq('active', true),
    supabaseClient.from('custom_field_values').select('*'),
    supabaseClient.from('leads_sales').select('*')
  ]);
  const campaigns = data || [];

  updateClientStatusesFromCampaigns(campaigns, targets || [], allCustomFields || [], allCustomFieldValues || [], allLeadsRows || []);

  // Campos personalizados mapeados, agrupados por cliente — usados abaixo
  // pra substituir receita/vendas de mídia pelo valor informado pelo
  // cliente (fonte oficial), cliente a cliente, somando o resultado na
  // carteira inteira. Mesma prioridade do Dashboard Filho: dado manual
  // mapeado > dado de mídia, quando existir.
  const customFieldsBySlug = {};
  (allCustomFields || []).forEach(f => {
    if (!customFieldsBySlug[f.client_slug]) customFieldsBySlug[f.client_slug] = [];
    customFieldsBySlug[f.client_slug].push(f);
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  function aggregate(rows, cfValues, leadsRowsForPeriod) {
    let invest = 0, impress = 0, clicks = 0, pageViews = 0, leads = 0, convs = 0, revenue = 0, sales = 0;
    const revenueBySource = { import: 0, portal: 0 };
    const salesBySource = { import: 0, portal: 0 };

    const byClient = {};
    rows.forEach(c => {
      const slug = c.client_slug;
      if (!byClient[slug]) byClient[slug] = { invest: 0, impress: 0, clicks: 0, pageViews: 0, leads: 0, convs: 0, revenue: 0 };
      byClient[slug].invest += Number(c.invest) || 0;
      byClient[slug].impress += Number(c.impressions) || 0;
      byClient[slug].clicks += Number(c.clicks) || 0;
      byClient[slug].pageViews += Number(c.page_views) || 0;
      byClient[slug].leads += Number(c.leads) || 0;
      byClient[slug].convs += Number(c.conversions) || 0;
      byClient[slug].revenue += Number(c.revenue) || 0;

      invest += Number(c.invest) || 0;
      impress += Number(c.impressions) || 0;
      clicks += Number(c.clicks) || 0;
      pageViews += Number(c.page_views) || 0;
      leads += Number(c.leads) || 0;
      convs += Number(c.conversions) || 0;
    });

    // União dos clientes com campanha, com campo personalizado mapeado ou
    // com histórico de leads_sales (podem não coincidir) — todos entram na
    // soma da carteira.
    const leadsBySlugForPeriod = {};
    (leadsRowsForPeriod || []).forEach(l => {
      if (!leadsBySlugForPeriod[l.client_slug]) leadsBySlugForPeriod[l.client_slug] = [];
      leadsBySlugForPeriod[l.client_slug].push(l);
    });
    const clientSlugs = new Set([...Object.keys(byClient), ...Object.keys(customFieldsBySlug), ...Object.keys(leadsBySlugForPeriod)]);
    clientSlugs.forEach(slug => {
      const clientTotals = byClient[slug] || { invest: 0, impress: 0, clicks: 0, pageViews: 0, leads: 0, convs: 0, revenue: 0 };
      const clientFields = customFieldsBySlug[slug] || [];
      const clientValues = (cfValues || []).filter(v => v.client_slug === slug);
      const clientLeads = leadsBySlugForPeriod[slug] || [];
      const unified = resolveUnifiedSalesAndRevenue(clientLeads, clientFields, clientValues);

      revenue += unified.revenue.records.length ? unified.revenue.total : clientTotals.revenue;
      sales += unified.sales.records.length ? unified.sales.total : clientTotals.convs;
      revenueBySource.import += unified.revenue.bySource.import;
      revenueBySource.portal += unified.revenue.bySource.portal;
      salesBySource.import += unified.sales.bySource.import;
      salesBySource.portal += unified.sales.bySource.portal;
    });

    const conv = clicks > 0 ? (convs / clicks) * 100 : 0;
    const cpl = leads > 0 ? invest / leads : 0;
    const cpa = convs > 0 ? invest / convs : 0;
    const roi = invest > 0 ? ((revenue - invest) / invest) * 100 : 0;
    const finalPct = clicks > 0 ? (sales / clicks) * 100 : 0;
    const trendLabel = rows.length > 0 ? '■ Dados importados' : '— Sem dados importados';
    const revenueSourceLabel = describeSourceLabel(revenueBySource);
    const salesSourceLabel = describeSourceLabel(salesBySource);
    return {
      investimento: formatCurrency(invest),
      trendInvestimento: trendLabel,
      receita: formatCurrency(revenue),
      trendReceita: trendLabel,
      vendas: formatNumber(sales),
      revenueSourceLabel,
      salesSourceLabel,
      hasManualRevenue: revenueBySource.portal > 0,
      hasManualSales: salesBySource.portal > 0,
      conversao: `${conv.toFixed(1)}%`,
      cpl: leads > 0 ? formatCurrency(cpl) : '—',
      trendCpl: leads > 0 ? '■ Estável' : '— Sem leads',
      cpa: convs > 0 ? formatCurrency(cpa) : '—',
      roi: `${Math.round(roi)}%`,
      trendRoi: trendLabel,
      funnel: [formatNumber(impress), formatNumber(clicks), formatNumber(pageViews), formatNumber(sales)],
      funnelPct: [
        '100%',
        impress > 0 ? `${((clicks / impress) * 100).toFixed(0)}%` : '0%',
        clicks > 0 ? `${((pageViews / clicks) * 100).toFixed(0)}%` : '0%',
        `${finalPct.toFixed(1)}% final`
      ]
    };
  }

  const valuesInRange = (start) => (allCustomFieldValues || []).filter(v => !start || new Date(v.period_date) >= start);
  const leadsInRange = (start) => (allLeadsRows || []).filter(l => !start || new Date(l.date) >= start);

  agencyPeriodData['All Time'] = aggregate(campaigns, allCustomFieldValues || [], allLeadsRows || []);
  agencyPeriodData['Mês'] = aggregate(campaigns.filter(c => new Date(c.date) >= monthStart), valuesInRange(monthStart), leadsInRange(monthStart));
  agencyPeriodData['Trimestre'] = aggregate(campaigns.filter(c => new Date(c.date) >= quarterStart), valuesInRange(quarterStart), leadsInRange(quarterStart));

  portfolioAlerts = computePortfolioAlerts(campaigns, allCustomFields, allCustomFieldValues, allLeadsRows);
  renderPaiAlerts();

  usingRealAgencyData = campaigns.length > 0;
}

// Base de Dados do Dashboard Pai (Agência) por Períodos
const agencyPeriodData = {
  "All Time": {
    investimento: "R$482k",
    trendInvestimento: "▲ +18%",
    receita: "R$2,84M",
    trendReceita: "▲ +32%",
    conversao: "2,7%",
    cpl: "R$37",
    trendCpl: "■ Estável",
    cpa: "R$121",
    roi: "489%",
    trendRoi: "▲ +12%",
    funnel: ["12.840", "5.136", "1.541", "342"],
    funnelPct: ["40%", "30%", "22%", "2,7% final"]
  },
  "Mês": {
    investimento: "R$42k",
    trendInvestimento: "▲ +8%",
    receita: "R$264k",
    trendReceita: "▲ +15%",
    conversao: "2,9%",
    cpl: "R$35",
    trendCpl: "▼ -5% melhor",
    cpa: "R$112",
    roi: "628%",
    trendRoi: "▲ +24%",
    funnel: ["1.200", "480", "144", "35"],
    funnelPct: ["40%", "30%", "24%", "2,9% final"]
  },
  "Trimestre": {
    investimento: "R$128k",
    trendInvestimento: "▲ +14%",
    receita: "R$812k",
    trendReceita: "▲ +22%",
    conversao: "2,6%",
    cpl: "R$38",
    trendCpl: "▲ +2% aumento",
    cpa: "R$125",
    roi: "634%",
    trendRoi: "▲ +18%",
    funnel: ["3.800", "1.520", "456", "99"],
    funnelPct: ["40%", "30%", "21%", "2,6% final"]
  }
};

// Base de Dados Detalhada do Dashboard Filho (Clientes Individuais)
const clientDetailedData = {
  "Drex Imóveis": {
    segment: "Imobiliário",
    period: "Maio 2025",
    owner: "Felippe G.",
    updated: "Hoje às 13:10",
    status: "Saudável",
    statusClass: "healthy",
    metrics: {
      investimento: "R$52k",
      receita: "R$520k",
      conversao: "3,1%",
      cpl: "R$42",
      cpa: "R$52",
      roi: "900%"
    },
    updates: [
      { source: "Google Ads", time: "Hoje às 13:10", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Meta Ads", time: "Hoje às 14:32", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Dados comerciais", time: "Ontem", status: "Atualizado", statusClass: "healthy", obs: "Atualizado manualmente pelo cliente" },
      { source: "CRM (leads)", time: "Hoje às 09:00", status: "Atualizado", statusClass: "healthy", obs: "Integração ativa com RD Station" }
    ],
    funnel: ["1.240", "496", "148", "38"],
    funnelPct: ["40%", "30%", "25%", "3,1% final"],
    leadsSource: [
      { name: "Google Ads", pct: 48, value: "595 leads", color: "#3b82f6" },
      { name: "Meta Ads", pct: 32, value: "397 leads", color: "#8b5cf6" },
      { name: "Orgânico", pct: 12, value: "149 leads", color: "#10b981" },
      { name: "Indicação", pct: 8, value: "99 leads", color: "#f59e0b" }
    ],
    lossReasons: [
      { name: "Preço / Achou caro", pct: 42, color: "#ef4444" },
      { name: "Sem resposta", pct: 28, color: "#f59e0b" },
      { name: "Sem budget / Verba", pct: 20, color: "#6b7280" },
      { name: "Não qualificado", pct: 10, color: "#4b5563" }
    ],
    evolution: [
      { label: "Semana 1", val: "R$110k", trend: "▲ +5%", trendClass: "up" },
      { label: "Semana 2", val: "R$135k", trend: "▲ +22%", trendClass: "up" },
      { label: "Semana 3", val: "R$128k", trend: "▼ -5%", trendClass: "down" },
      { label: "Semana 4", val: "R$147k", trend: "▲ +15%", trendClass: "up" }
    ],
    insights: [
      "A taxa de qualificação da Drex Imóveis está excelente, mantendo 40%.",
      "O canal Google Ads gerou mais vendas para este cliente (58% do total de conversões).",
      "O principal motivo de perda registrado pelo cliente comercial é 'Preço/Achou caro' (42%).",
      "O Custo por Lead (CPL) geral caiu 12% nas últimas duas semanas nas campanhas ativas."
    ],
    // Mídia Ads Específicos
    adsKpis: {
      period: "12/05 a 22/06",
      investimento: 28530.22,
      cliques: 9805,
      conversoes: 312,
      cpa: 91.44,
      ctr: 1.42
    },
    adsPlatforms: {
      gads: { investimento: 16500.00, cliques: 4120, conversoes: 242, cpa: 68.18 },
      mads: { investimento: 12030.22, cliques: 5685, conversoes: 70, cpa: 171.86 }
    },
    campaigns: [
      { id: 1, name: "[G] SEARCH | LEAD | IMOVEIS ALTO PADRAO", platform: "Google Ads", labelColor: "#3b82f6", invest: 9450.00, impress: 120000, clicks: 2500, ctr: 2.08, cpc: 3.78, convs: 155, cpa: 60.97, status: "Ativo", objective: "Leads" },
      { id: 2, name: "[M] LEADS | FORMS | Lancamentos Bairro A", platform: "Meta Ads", labelColor: "#ec4899", invest: 8230.00, impress: 95000, clicks: 3820, ctr: 4.02, cpc: 2.15, convs: 45, cpa: 182.88, status: "Ativo", objective: "Leads" },
      { id: 3, name: "[G] PMAX | BRAND AWARENESS | Drex", platform: "Google Ads", labelColor: "#3b82f6", invest: 7050.00, impress: 250000, clicks: 1620, ctr: 0.65, cpc: 4.35, convs: 87, cpa: 81.03, status: "Ativo", objective: "PMAX" },
      { id: 4, name: "[M] ENGAJAMENTO | INSTAGRAM | Bairro B", platform: "Meta Ads", labelColor: "#ec4899", invest: 3850.22, impress: 80000, clicks: 1865, ctr: 2.33, cpc: 2.06, convs: 25, cpa: 154.00, status: "Ativo", objective: "Engajamento" }
    ],
    chartData: {
      dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
      investimento: [2000, 3500, 4800, 5000, 4500, 5500, 3230],
      conversoes: [15, 32, 45, 52, 48, 70, 50]
    }
  },
  "Orion Tech": {
    segment: "Tecnologia B2B",
    period: "Maio 2025",
    owner: "Felippe G.",
    updated: "Hoje às 12:45",
    status: "Saudável",
    statusClass: "healthy",
    metrics: {
      investimento: "R$35k",
      receita: "R$310k",
      conversao: "2,8%",
      cpl: "R$58",
      cpa: "R$245",
      roi: "785%"
    },
    updates: [
      { source: "LinkedIn Ads", time: "Ontem", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Google Ads", time: "Hoje às 08:30", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "CRM (leads)", time: "Hoje às 12:45", status: "Atualizado", statusClass: "healthy", obs: "Integração ativa com Salesforce CRM" }
    ],
    funnel: ["850", "340", "102", "24"],
    funnelPct: ["40%", "30%", "23.5%", "2,8% final"],
    leadsSource: [
      { name: "Google Ads", pct: 55, value: "467 leads", color: "#3b82f6" },
      { name: "Meta Ads", pct: 25, value: "213 leads", color: "#ec4899" },
      { name: "Indicação", pct: 15, value: "127 leads", color: "#10b981" },
      { name: "Outros", pct: 5, value: "43 leads", color: "#6b7280" }
    ],
    lossReasons: [
      { name: "Sem budget / Verba", pct: 48, color: "#ef4444" },
      { name: "Já possui concorrente", pct: 32, color: "#f59e0b" },
      { name: "Sem resposta comercial", pct: 12, color: "#6b7280" },
      { name: "Outros", pct: 8, color: "#4b5563" }
    ],
    evolution: [
      { label: "Semana 1", val: "R$65k", trend: "▲ +12%", trendClass: "up" },
      { label: "Semana 2", val: "R$82k", trend: "▲ +26%", trendClass: "up" },
      { label: "Semana 3", val: "R$78k", trend: "▼ -4%", trendClass: "down" },
      { label: "Semana 4", val: "R$85k", trend: "▲ +9%", trendClass: "up" }
    ],
    insights: [
      "Google Ads representa a principal origem de atração de leads qualificados (55%).",
      "A meta de vendas foi atingida em 102% para o período acumulado do mês corrente.",
      "Investimento nas campanhas de busca está estável com alto índice de propostas convertidas."
    ],
    // Mídia Ads Específicos
    adsKpis: {
      period: "12/05 a 22/06",
      investimento: 22840.15,
      cliques: 4850,
      conversoes: 98,
      cpa: 233.06,
      ctr: 0.98
    },
    adsPlatforms: {
      gads: { investimento: 12500.00, cliques: 2150, conversoes: 64, cpa: 195.31 },
      mads: { investimento: 10340.15, cliques: 2700, conversoes: 34, cpa: 304.12 }
    },
    campaigns: [
      { id: 1, name: "[G] SEARCH | B2B | SOFTWARE ENTERPRISE", platform: "Google Ads", labelColor: "#3b82f6", invest: 8500.00, impress: 24000, clicks: 1200, ctr: 5.00, cpc: 7.08, convs: 48, cpa: 177.08, status: "Ativo", objective: "Leads" },
      { id: 2, name: "[M] LEADS | FORMS | CTO Target", platform: "Meta Ads", labelColor: "#ec4899", invest: 6840.15, impress: 45000, clicks: 1850, ctr: 4.11, cpc: 3.70, convs: 22, cpa: 310.91, status: "Ativo", objective: "Leads" },
      { id: 3, name: "[G] SEARCH | INSTITUCIONAL | Orion", platform: "Google Ads", labelColor: "#3b82f6", invest: 4000.00, impress: 15000, clicks: 950, ctr: 6.33, cpc: 4.21, convs: 16, cpa: 250.00, status: "Ativo", objective: "Leads" },
      { id: 4, name: "[M] TRAFEGO | INSTITUCIONAL", platform: "Meta Ads", labelColor: "#ec4899", invest: 3500.00, impress: 38000, clicks: 850, ctr: 2.24, cpc: 4.12, convs: 12, cpa: 291.66, status: "Ativo", objective: "Conversão" }
    ],
    chartData: {
      dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
      investimento: [1500, 2800, 3500, 4200, 3800, 4500, 2540],
      conversoes: [5, 12, 18, 22, 14, 17, 10]
    }
  },
  "Lumera Saúde": {
    segment: "Clínico/Saúde",
    period: "Maio 2025",
    owner: "Lucas M.",
    updated: "Hoje às 11:30",
    status: "Atenção",
    statusClass: "attention",
    metrics: {
      investimento: "R$48k",
      receita: "R$220k",
      conversao: "2,2%",
      cpl: "R$28",
      cpa: "R$182",
      roi: "358%"
    },
    updates: [
      { source: "Meta Ads", time: "Hoje às 11:30", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Google Ads", time: "Hoje às 09:15", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Dados comerciais", time: "Há 3 dias", status: "Atenção", statusClass: "attention", obs: "Atualizado manualmente pelo cliente" },
      { source: "CRM (leads)", time: "Hoje às 11:30", status: "Atualizado", statusClass: "healthy", obs: "Integração ativa com RD Station" }
    ],
    funnel: ["2.200", "770", "192", "48"],
    funnelPct: ["35%", "25%", "25%", "2,2% final"],
    leadsSource: [
      { name: "Meta Ads", pct: 62, value: "1.364 leads", color: "#ec4899" },
      { name: "Google Ads", pct: 28, value: "616 leads", color: "#3b82f6" },
      { name: "Orgânico", pct: 6, value: "132 leads", color: "#10b981" },
      { name: "Outros", pct: 4, value: "88 leads", color: "#6b7280" }
    ],
    lossReasons: [
      { name: "Sem resposta", pct: 52, color: "#ef4444" },
      { name: "Preço / Achou caro", pct: 28, color: "#f59e0b" },
      { name: "Não qualificado", pct: 15, color: "#6b7280" },
      { name: "Outros", pct: 5, color: "#4b5563" }
    ],
    evolution: [
      { label: "Semana 1", val: "R$48k", trend: "▼ -8%", trendClass: "down" },
      { label: "Semana 2", val: "R$52k", trend: "▲ +8%", trendClass: "up" },
      { label: "Semana 3", val: "R$58k", trend: "▲ +11%", trendClass: "up" },
      { label: "Semana 4", val: "R$62k", trend: "▲ +6%", trendClass: "up" }
    ],
    insights: [
      "A taxa de qualificação de leads comerciais caiu 22% em 3 semanas.",
      "O Custo por Lead (CPL) geral subiu 15% nos últimos 10 dias de campanhas ativas.",
      "O principal motivo de descarte comercial cadastrado é 'Sem resposta' do lead (52%)."
    ],
    // Mídia Ads Específicos
    adsKpis: {
      period: "12/05 a 22/06",
      investimento: 32400.00,
      cliques: 15200,
      conversoes: 180,
      cpa: 180.00,
      ctr: 1.15
    },
    adsPlatforms: {
      gads: { investimento: 12400.00, cliques: 3200, conversoes: 110, cpa: 112.72 },
      mads: { investimento: 20000.00, cliques: 12000, conversoes: 70, cpa: 285.71 }
    },
    campaigns: [
      { id: 1, name: "[M] LEADS | MATERNIDADE", platform: "Meta Ads", labelColor: "#ec4899", invest: 12500.00, impress: 130000, clicks: 7800, ctr: 6.00, cpc: 1.60, convs: 45, cpa: 277.77, status: "Ativo", objective: "Leads" },
      { id: 2, name: "[G] SEARCH | CLINICO | GERAL", platform: "Google Ads", labelColor: "#3b82f6", invest: 8400.00, impress: 48000, clicks: 2100, ctr: 4.37, cpc: 4.00, convs: 82, cpa: 102.43, status: "Ativo", objective: "Leads" },
      { id: 3, name: "[M] LEADS | FORMS | Estetica", platform: "Meta Ads", labelColor: "#ec4899", invest: 7500.00, impress: 90000, clicks: 4200, ctr: 4.66, cpc: 1.78, convs: 25, cpa: 300.00, status: "Ativo", objective: "Leads" },
      { id: 4, name: "[G] SEARCH | PMAX | Clinica Geral", platform: "Google Ads", labelColor: "#3b82f6", invest: 4000.00, impress: 65000, clicks: 1100, ctr: 1.69, cpc: 3.63, convs: 28, cpa: 142.85, status: "Ativo", objective: "PMAX" }
    ],
    chartData: {
      dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
      investimento: [3000, 4200, 5100, 5800, 5200, 6000, 3100],
      conversoes: [12, 25, 29, 32, 28, 36, 18]
    }
  },
  "Volks B2B": {
    segment: "Automotivo",
    period: "Maio 2025",
    owner: "Lucas M.",
    updated: "Hoje às 10:15",
    status: "Crítico",
    statusClass: "critical",
    metrics: {
      investimento: "R$64k",
      receita: "R$122k",
      conversao: "1,8%",
      cpl: "R$85",
      cpa: "R$420",
      roi: "90%" // Faturamento R$122k / Investimento R$64k = 1.9x ROAS (90% ROI)
    },
    updates: [
      { source: "Meta Ads", time: "Hoje às 10:15", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Google Ads", time: "Hoje às 08:00", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente via API" },
      { source: "Dados comerciais", time: "Há 8 dias", status: "Atenção", statusClass: "attention", obs: "Atualizado manualmente pelo cliente" },
      { source: "CRM (leads)", time: "Hoje às 10:15", status: "Atualizado", statusClass: "healthy", obs: "Integração ativa com RD Station" }
    ],
    funnel: ["1.800", "540", "135", "32"],
    funnelPct: ["30%", "25%", "23.7%", "1,8% final"],
    leadsSource: [
      { name: "Meta Ads", pct: 45, value: "810 leads", color: "#ec4899" },
      { name: "Google Ads", pct: 35, value: "630 leads", color: "#3b82f6" },
      { name: "LinkedIn Ads", pct: 15, value: "270 leads", color: "#10b981" },
      { name: "Outros", pct: 5, value: "90 leads", color: "#6b7280" }
    ],
    lossReasons: [
      { name: "Sem resposta", pct: 38, color: "#ef4444" },
      { name: "Já possui fornecedor", pct: 30, color: "#f59e0b" },
      { name: "Preço / Achou caro", pct: 22, color: "#6b7280" },
      { name: "Sem budget / Verba", pct: 10, color: "#4b5563" }
    ],
    evolution: [
      { label: "Semana 1", val: "R$35k", trend: "▼ -15%", trendClass: "down" },
      { label: "Semana 2", val: "R$28k", trend: "▼ -20%", trendClass: "down" },
      { label: "Semana 3", val: "R$31k", trend: "▲ +10%", trendClass: "up" },
      { label: "Semana 4", val: "R$28k", trend: "▼ -9%", trendClass: "down" }
    ],
    insights: [
      "A taxa de qualificação da Volks B2B caiu 22% em 3 semanas.",
      "O ROAS consolidado de 1,9x está abaixo do break-even financeiro planejado do cliente.",
      "Dados comerciais do CRM estão desatualizados pelo time do cliente há 8 dias.",
      "Custo por Lead (CPL) subiu 28% no canal de mídia Meta Ads comparado ao mês anterior."
    ],
    // Mídia Ads Específicos (Valores da imagem de referência para Volks B2B)
    adsKpis: {
      period: "12/05 a 22/06",
      investimento: 43628.62,
      cliques: 22803,
      conversoes: 382,
      cpa: 114.25,
      ctr: 1.28
    },
    adsPlatforms: {
      gads: { investimento: 18148.09, cliques: 6059, conversoes: 347, cpa: 52.32 },
      mads: { investimento: 25480.53, cliques: 16744, conversoes: 35, cpa: 728.02 }
    },
    campaigns: [
      { id: 1, name: "[2B] SEARCH | LEAD | PROMOTORIA| BR", platform: "Google Ads", labelColor: "#3b82f6", invest: 11069.00, impress: 26930, clicks: 2982, ctr: 11.07, cpc: 3.71, convs: 259, cpa: 42.66, status: "Ativo", objective: "Leads" },
      { id: 2, name: "[LEADS] FORMS - Brasil - volume", platform: "Meta Ads", labelColor: "#ec4899", invest: 9626.69, impress: 283199, clicks: 3684, ctr: 1.30, cpc: 2.61, convs: 20, cpa: 481.33, status: "Ativo", objective: "Leads" },
      { id: 3, name: "[LEADS] FORMS - Brasil - Qualificação por Preço", platform: "Meta Ads", labelColor: "#ec4899", invest: 5526.81, impress: 287155, clicks: 4595, ctr: 1.60, cpc: 1.20, convs: 15, cpa: 368.45, status: "Ativo", objective: "Leads" },
      { id: 4, name: "Captação Promotores de Vendas - Leads WhatsApp", platform: "Meta Ads", labelColor: "#ec4899", invest: 4022.94, impress: 253547, clicks: 4942, ctr: 1.95, cpc: 0.81, convs: 0, cpa: 0.00, status: "Ativo", objective: "Leads" },
      { id: 5, name: "[2B] SEARCH | LEAD | MERCHANDISING| BR | MAX CLIQUES", platform: "Google Ads", labelColor: "#3b82f6", invest: 3311.88, impress: 19773, clicks: 1056, ctr: 5.34, cpc: 3.14, convs: 8, cpa: 413.98, status: "Ativo", objective: "Leads" },
      { id: 6, name: "[APAS] - ALCANCE - RAIO 1KM", platform: "Meta Ads", labelColor: "#ec4899", invest: 2207.49, impress: 644738, clicks: 980, ctr: 0.15, cpc: 2.25, convs: 0, cpa: 0.00, status: "Pausado", objective: "Engajamento" },
      { id: 7, name: "[LEADS] FORMS - Brasil - Integração RD Station", platform: "Meta Ads", labelColor: "#ec4899", invest: 2091.24, impress: 55972, clicks: 601, ctr: 1.07, cpc: 3.48, convs: 0, cpa: 0.00, status: "Ativo", objective: "Leads" },
      { id: 8, name: "[2B] SEARCH | INSTITUCIONAL | CPC | TRÁFEGO | BR", platform: "Google Ads", labelColor: "#3b82f6", invest: 1901.59, impress: 4338, clicks: 888, ctr: 20.47, cpc: 2.14, convs: 63, cpa: 30.23, status: "Ativo", objective: "Leads" },
      { id: 9, name: "[2B] PERF | LEADS | MIA | PMAX | BR", platform: "Google Ads", labelColor: "#3b82f6", invest: 662.14, impress: 6085, clicks: 562, ctr: 9.24, cpc: 1.18, convs: 15, cpa: 45.66, status: "Ativo", objective: "PMAX" },
      { id: 10, name: "[LEADS] FORMS META - APAS", platform: "Meta Ads", labelColor: "#ec4899", invest: 508.24, impress: 7526, clicks: 147, ctr: 1.95, cpc: 3.46, convs: 0, cpa: 0.00, status: "Ativo", objective: "Leads" }
    ],
    chartData: {
      dates: ["13/05", "15/05", "17/05", "19/05", "21/05", "23/05", "25/05", "27/05", "29/05", "31/05", "02/06", "04/06", "06/06", "08/06", "10/06", "12/06", "14/06", "16/06", "18/06", "20/06", "22/06"],
      investimento: [350, 400, 200, 500, 2400, 700, 800, 1400, 1300, 1800, 1100, 2300, 4400, 700, 1200, 1600, 1700, 1500, 500, 400, 100, 450],
      conversoes: [2, 1, 0, 4, 11, 2, 1, 14, 11, 12, 6, 25, 18, 13, 8, 23, 27, 21, 15, 7, 7, 10, 0, 3]
    }
  }
};

let currentPeriod = "All Time";
let currentClient = "";
let clientCampaigns = [];
let adsActivePlatform = "Todas";

// --------------------------------------------------
// 1. Controle de Visualização das Telas (Pai vs Filho)
// --------------------------------------------------

// Exibe o Dashboard Pai da Agência
let agencyRealDataChecked = false;

async function showDashboardPai() {
  currentClient = "";
  // Ajusta visibilidade dos blocos
  document.getElementById('view-dashboard-pai').style.display = 'block';
  document.getElementById('view-dashboard-filho').style.display = 'none';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  const viewColab = document.getElementById('view-colaboradores');
  if (viewColab) viewColab.style.display = 'none';
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  const viewConfig = document.getElementById('view-configuracoes');
  if (viewConfig) viewConfig.style.display = 'none';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();

  // Atualiza classes ativas da sidebar
  document.getElementById('menu-dashboard-link').classList.add('active');
  const menuColab = document.getElementById('menu-colaboradores-link');
  if (menuColab) menuColab.classList.remove('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  const menuConfig = document.getElementById('menu-configuracoes-link');
  if (menuConfig) menuConfig.classList.remove('active');

  const clientItems = document.querySelectorAll('.client-item');
  clientItems.forEach(item => item.classList.remove('active'));
  
  // Reseta seletor de clientes do header
  document.getElementById('client-filter').value = "Todos os clientes";
  
  // Reset date picker for dashboard pai
  calendarStates['pai'].startDate = new Date(2025, 4, 1);
  calendarStates['pai'].endDate = new Date(2025, 4, 31);
  calendarStates['pai'].currentYear = 2025;
  calendarStates['pai'].currentMonth = 4;
  const paiPeriodText = document.getElementById('pai-period-btn-text');
  if (paiPeriodText) paiPeriodText.innerText = "01/05/2025 - 31/05/2025";
  const paiStartInput = document.getElementById('pai-period-start');
  if (paiStartInput) paiStartInput.value = "01/05/2025";
  const paiEndInput = document.getElementById('pai-period-end');
  if (paiEndInput) paiEndInput.value = "31/05/2025";

  // Sempre recarrega do Supabase ao (re)abrir o Dashboard Pai — o Score de
  // Saúde e o sino de alertas precisam refletir o estado atual da carteira
  // a cada visita, não um snapshot da primeira vez que a tela foi aberta
  // nesta sessão (antes só rodava uma vez, controlado por agencyRealDataChecked).
  agencyRealDataChecked = true;
  await refreshAgencyPeriodDataFromReal();
  updateSidebarHealthScores();

  const headerCountEl = document.getElementById('header-client-count');
  if (headerCountEl) headerCountEl.innerText = `${allClients.length} cliente${allClients.length === 1 ? '' : 's'} ativo${allClients.length === 1 ? '' : 's'}`;

  renderAttentionCards();
  renderMrrBreakdown();
  renderHealthSection();

  // Atualiza valores do Dashboard Pai com base no período atual
  updateDashboardPaiValues(agencyPeriodData[currentPeriod]);
}

// Mostra um card por cliente com status "attention"/"critical". Se não houver
// nenhum cliente real nesse estado, esconde a seção inteira (nada de dado fictício).
function renderAttentionCards() {
  const section = document.getElementById('attention-section');
  const grid = document.getElementById('attention-grid');
  const tableSection = document.getElementById('attention-table-section');
  const tableBody = document.getElementById('attention-table-body');
  if (!section || !grid) return;

  const flagged = allClients.filter(c => c.status === 'attention' || c.status === 'critical');

  if (flagged.length === 0) {
    section.style.display = 'none';
    if (tableSection) tableSection.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = '';
  if (tableSection) tableSection.style.display = 'block';
  if (tableBody) tableBody.innerHTML = '';

  flagged.forEach(c => {
    const isCritical = c.status === 'critical';
    const reasons = Array.isArray(c.statusReasons) ? c.statusReasons : [];
    const reasonTexts = reasons.map(r => (r && typeof r === 'object') ? r.text : r);
    const desc = reasonTexts[0] ? escapeHtml(reasonTexts[0]) : `${escapeHtml(c.name)} está com status "${isCritical ? 'Crítico' : 'Atenção'}".`;
    const impact = reasonTexts[1] ? escapeHtml(reasonTexts[1]) : 'Pergunte ao Assistente PRATA o motivo para mais detalhes.';
    const problemCell = reasonTexts.length ? escapeHtml(reasonTexts.join(' ')) : `Status "${isCritical ? 'Crítico' : 'Atenção'}" — revise os dados importados.`;
    const scoreText = typeof c.healthScore === 'number' ? `${c.healthScore}/100` : '';

    const card = document.createElement('div');
    card.className = `attention-card ${isCritical ? 'critical-indicator' : 'attention-indicator'}`;
    card.onclick = () => selectClient(c.name);
    card.innerHTML = `
      <div class="attention-card-header">
        <span class="attention-client-name">${escapeHtml(c.name)}${scoreText ? ` <span class="attention-score">${scoreText}</span>` : ''}</span>
        <span class="attention-badge ${isCritical ? 'critical' : 'attention'}">${isCritical ? 'Crítico' : 'Atenção'}</span>
      </div>
      <div class="attention-card-body">
        <span class="attention-desc">${desc}</span>
        <span class="attention-impact">${impact}</span>
      </div>
    `;
    grid.appendChild(card);

    if (tableBody) {
      const row = document.createElement('tr');
      row.style.cursor = 'pointer';
      row.onclick = () => selectClient(c.name);
      row.innerHTML = `
        <td class="table-client-cell">
          <span class="status-dot ${isCritical ? 'critical' : 'attention'}"></span>
          <span>${escapeHtml(c.name)}</span>
        </td>
        <td><span class="table-badge ${isCritical ? 'critical' : 'attention'}">${isCritical ? 'Crítico' : 'Atenção'}</span></td>
        <td>—</td>
        <td class="table-problem-cell">${problemCell}</td>
      `;
      tableBody.appendChild(row);
    }
  });
}

// Conta clientes reais por status (Saudável/Atenção/Crítico). Esconde a
// seção inteira quando não há nenhum cliente cadastrado ainda.
function renderHealthSection() {
  const section = document.getElementById('health-section');
  if (!section) return;

  if (allClients.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  const groups = {
    healthy: allClients.filter(c => c.status === 'healthy'),
    attention: allClients.filter(c => c.status === 'attention'),
    critical: allClients.filter(c => c.status === 'critical')
  };

  Object.keys(groups).forEach(status => {
    const list = groups[status];
    document.getElementById(`health-count-${status}`).innerText = list.length;

    const examplesEl = document.getElementById(`health-examples-${status}`);
    const names = list.slice(0, 3).map(c => c.name);
    let html = names.join(', ');
    if (list.length > 3) html += ` <span class="health-examples-muted">+ ${list.length - 3} mais</span>`;
    examplesEl.innerHTML = html;
  });

  const avgScoreEl = document.getElementById('health-avg-score');
  if (avgScoreEl) {
    const withScore = allClients.filter(c => typeof c.healthScore === 'number');
    avgScoreEl.innerText = withScore.length
      ? Math.round(withScore.reduce((s, c) => s + c.healthScore, 0) / withScore.length)
      : '—';
  }
}

// Gera o donut de MRR a partir da receita real por cliente (campaign_metrics).
// Sem faturamento real ainda, esconde a seção inteira em vez de mostrar mock.
async function renderMrrBreakdown() {
  const section = document.getElementById('mrr-section');
  if (!section) return;

  const { data } = await supabaseClient.from('campaign_metrics').select('client_slug, revenue');
  const rows = data || [];

  const byClient = {};
  rows.forEach(r => {
    byClient[r.client_slug] = (byClient[r.client_slug] || 0) + (Number(r.revenue) || 0);
  });

  const total = Object.values(byClient).reduce((a, b) => a + b, 0);

  if (total <= 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const donutColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#f97316'];
  const sorted = Object.entries(byClient)
    .map(([slug, revenue]) => ({ slug, name: clientNameFromSlug(slug) || slug, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const restTotal = rest.reduce((s, c) => s + c.revenue, 0);

  const segments = top.map((c, i) => ({ name: c.name, revenue: c.revenue, color: donutColors[i % donutColors.length] }));
  if (restTotal > 0) segments.push({ name: `Outros (${rest.length})`, revenue: restTotal, color: '#4b5563' });

  const circumference = 2 * Math.PI * 45;
  const svg = document.getElementById('mrr-donut-svg');
  svg.innerHTML = '<circle class="donut-segment-bg" cx="65" cy="65" r="45"></circle>';
  let cumulative = 0;
  segments.forEach(seg => {
    const len = (seg.revenue / total) * circumference;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'donut-segment');
    circle.setAttribute('cx', '65');
    circle.setAttribute('cy', '65');
    circle.setAttribute('r', '45');
    circle.setAttribute('stroke', seg.color);
    circle.setAttribute('stroke-dasharray', `${len.toFixed(1)} ${(circumference - len).toFixed(1)}`);
    circle.setAttribute('stroke-dashoffset', `${(-cumulative).toFixed(1)}`);
    svg.appendChild(circle);
    cumulative += len;
  });

  document.getElementById('mrr-total-inner').innerText = formatCurrencyThousands(total);
  document.getElementById('mrr-total-value').innerText = formatCurrencyThousands(total);

  const legendList = document.getElementById('mrr-legend-list');
  legendList.innerHTML = segments.map(seg => `
    <li class="mrr-legend-item">
      <div class="legend-label-wrapper">
        <span class="legend-color-indicator" style="background-color: ${seg.color};"></span>
        <span class="legend-name">${seg.name}</span>
      </div>
      <div class="legend-values">
        <span class="legend-value-cash">${formatCurrencyThousands(seg.revenue)}</span>
        <span class="legend-value-pct">${Math.round((seg.revenue / total) * 100)}%</span>
      </div>
    </li>
  `).join('');
}

function formatNumber(valor) {
  return Math.round(valor).toLocaleString('pt-BR');
}

// Injection of styles for custom context menus and rename inputs
(function() {
  const style = document.createElement('style');
  style.innerHTML = `
    .custom-context-menu {
      position: absolute;
      z-index: 1000;
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4);
      padding: 4px 0;
      min-width: 120px;
      backdrop-filter: blur(10px);
      animation: fadeInContextMenu 0.12s ease-out;
    }
    @keyframes fadeInContextMenu {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .context-menu-item {
      padding: 8px 12px;
      font-size: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .context-menu-item:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-primary);
    }
    .context-menu-item.delete:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .analysis-rename-input {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 12px;
      width: 80%;
      outline: none;
      font-family: inherit;
      transition: border-color 0.2s;
    }
    .analysis-rename-input:focus {
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.08);
    }
  `;
  document.head.appendChild(style);
})();

// Global state for dynamic client analyses
let clientAnalyses = {};
let currentAnalysis = "Visão geral";
let currentAnalysisId = "visao";

const defaultAnalyses = [
  { id: "visao", name: "Visão geral" },
  { id: "video", name: "VideoView" },
  { id: "conversao", name: "Conversão" },
  { id: "whatsapp", name: "Captação WhatsApp" },
  { id: "fbleads", name: "Captação FB Leads" },
  { id: "pesquisa", name: "Pesquisa" },
  { id: "vendas", name: "Vendas" },
  { id: "download", name: "Download de aplicativo" },
  { id: "personalizado", name: "Personalizado" }
];

async function initClientAnalyses() {
  const { data, error } = await supabaseClient
    .from('client_analyses')
    .select('*')
    .order('position');

  if (error) {
    console.error('Erro ao carregar análises de cliente', error);
    clientAnalyses = {
      drex: JSON.parse(JSON.stringify(defaultAnalyses)),
      orion: JSON.parse(JSON.stringify(defaultAnalyses)),
      lumera: JSON.parse(JSON.stringify(defaultAnalyses)),
      volks: JSON.parse(JSON.stringify(defaultAnalyses))
    };
    return;
  }

  clientAnalyses = {};
  data.forEach(row => {
    if (!clientAnalyses[row.client_slug]) clientAnalyses[row.client_slug] = [];
    clientAnalyses[row.client_slug].push({ id: row.analysis_id, name: row.name });
  });
}

// Sincroniza as abas de análise de UM único cliente por vez (nunca de todos os
// clientes carregados em memória de uma vez) — evita que uma edição num cliente
// apague/sobrescreva os dados de outro por causa de estado em memória incompleto.
// Faz upsert das abas atuais primeiro e só then remove as que não existem mais,
// pra nunca deixar a tabela momentaneamente vazia se algum passo falhar.
async function saveClientAnalyses(clientKey) {
  if (!clientKey) return;

  const currentList = clientAnalyses[clientKey] || [];
  const rows = currentList.map((a, i) => ({
    client_slug: clientKey,
    analysis_id: a.id,
    name: a.name,
    position: i
  }));

  if (rows.length) {
    const { error: upsertError } = await supabaseClient
      .from('client_analyses')
      .upsert(rows, { onConflict: 'client_slug,analysis_id' });
    if (upsertError) {
      console.error('Erro ao salvar análises do cliente', clientKey, upsertError);
      return; // não prossegue para o delete se o upsert falhou
    }
  }

  const currentIds = currentList.map(a => a.id);
  let deleteQuery = supabaseClient.from('client_analyses').delete().eq('client_slug', clientKey);
  if (currentIds.length) {
    deleteQuery = deleteQuery.not('analysis_id', 'in', `(${currentIds.join(',')})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) console.error('Erro ao remover análises antigas do cliente', clientKey, deleteError);
}

function renderClientSidebar(clientKey) {
  const menu = document.getElementById(`analysis-menu-${clientKey}`);
  if (!menu) return;

  menu.innerHTML = '';

  const clientName = clientNameFromSlug(clientKey);

  const analysesList = clientAnalyses[clientKey] || [];
  
  analysesList.forEach(ana => {
    const li = document.createElement('li');
    li.className = 'analysis-item';
    li.id = `analysis-${clientKey}-${ana.id}`;
    
    if (currentClient === clientName && currentAnalysis === ana.name) {
      li.classList.add('active');
    }
    
    // Create text span
    const spanText = document.createElement('span');
    spanText.className = 'analysis-title-text';
    spanText.innerText = ana.name;
    li.appendChild(spanText);
    
    // Create more dots span
    const dotsSpan = document.createElement('span');
    dotsSpan.className = 'analysis-more-dots';
    dotsSpan.innerText = '⋮';
    dotsSpan.onclick = function(e) {
      e.stopPropagation();
      showAnalysisMenu(e, clientKey, ana.id);
    };
    li.appendChild(dotsSpan);
    
    li.onclick = function() {
      selectAnalysis(clientName, ana.name, ana.id);
    };
    
    menu.appendChild(li);
  });
  
  // + Nova análise
  const addLi = document.createElement('li');
  addLi.className = 'analysis-item new-analysis';
  addLi.innerText = '+ Nova análise';
  addLi.onclick = function(e) {
    e.stopPropagation();
    showNewAnalysisPicker(e, clientKey);
  };
  menu.appendChild(addLi);
}

let activeContextMenu = null;

function showAnalysisMenu(e, clientKey, analysisId) {
  closeActiveContextMenu();
  
  const menu = document.createElement('div');
  menu.className = 'custom-context-menu';
  
  // Calculate positioning relative to window
  const rect = e.target.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX - 90}px`;
  
  const renameItem = document.createElement('div');
  renameItem.className = 'context-menu-item';
  renameItem.innerHTML = '✏️ Renomear';
  renameItem.onclick = function(evt) {
    evt.stopPropagation();
    closeActiveContextMenu();
    renameAnalysisInline(clientKey, analysisId);
  };
  menu.appendChild(renameItem);
  
  // Only allow deleting non-overview items
  if (analysisId !== 'visao') {
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item delete';
    deleteItem.innerHTML = '🗑️ Excluir';
    deleteItem.onclick = function(evt) {
      evt.stopPropagation();
      closeActiveContextMenu();
      if (confirm('Tem certeza que deseja excluir esta análise?')) {
        deleteAnalysis(clientKey, analysisId);
      }
    };
    menu.appendChild(deleteItem);
  }
  
  document.body.appendChild(menu);
  activeContextMenu = menu;
  
  // Timeout is needed so that this click event listener doesn't immediately capture the current click event
  setTimeout(() => {
    window.addEventListener('click', closeActiveContextMenu);
  }, 10);
}

function closeActiveContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
  window.removeEventListener('click', closeActiveContextMenu);
}

function renameAnalysisInline(clientKey, analysisId) {
  const itemEl = document.getElementById(`analysis-${clientKey}-${analysisId}`);
  if (!itemEl) return;
  
  const spanText = itemEl.querySelector('.analysis-title-text');
  if (!spanText) return;
  
  const originalName = spanText.innerText;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = originalName;
  input.className = 'analysis-rename-input';
  
  // Hide label text and dots
  spanText.style.display = 'none';
  const dots = itemEl.querySelector('.analysis-more-dots');
  if (dots) dots.style.display = 'none';
  
  itemEl.insertBefore(input, spanText);
  input.focus();
  input.select();
  
  input.onclick = function(e) {
    e.stopPropagation();
  };
  
  let saved = false;
  function saveChanges() {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    if (newName && newName !== originalName) {
      const list = clientAnalyses[clientKey] || [];
      const ana = list.find(a => a.id === analysisId);
      if (ana) {
        const oldName = ana.name;
        ana.name = newName;
        saveClientAnalyses(clientKey);

        const clientName = clientNameFromSlug(clientKey);

        if (currentClient === clientName && currentAnalysis === oldName) {
          currentAnalysis = newName;
          updateActiveAnalysisView(clientName, newName);
        }
      }
    }
    renderClientSidebar(clientKey);
  }
  
  input.onkeydown = function(e) {
    if (e.key === 'Enter') {
      saveChanges();
    } else if (e.key === 'Escape') {
      saved = true;
      renderClientSidebar(clientKey);
    }
  };
  
  input.onblur = function() {
    saveChanges();
  };
}

function deleteAnalysis(clientKey, analysisId) {
  const list = clientAnalyses[clientKey] || [];
  const index = list.findIndex(a => a.id === analysisId);
  if (index !== -1) {
    const deleted = list.splice(index, 1)[0];
    saveClientAnalyses(clientKey);

    const clientName = clientNameFromSlug(clientKey);

    if (currentClient === clientName && currentAnalysis === deleted.name) {
      selectAnalysis(clientName, 'Visão geral', 'visao');
    }
    // Sempre redesenha a lista da sidebar, senão a aba excluída continua
    // aparecendo visualmente mesmo depois de removida dos dados.
    renderClientSidebar(clientKey);
  }
}

// Cria de fato a aba de análise (usado tanto pela opção padrão escolhida no
// menu quanto pelo fluxo de nome personalizado).
function createAnalysisTab(clientKey, id, name) {
  if (!clientAnalyses[clientKey]) {
    clientAnalyses[clientKey] = [];
  }
  clientAnalyses[clientKey].push({ id, name });
  saveClientAnalyses(clientKey);
  renderClientSidebar(clientKey);

  const clientName = clientNameFromSlug(clientKey);
  selectAnalysis(clientName, name, id);
}

function promptCustomAnalysisName(clientKey) {
  const name = prompt("Digite o nome da nova análise:");
  if (name && name.trim()) {
    createAnalysisTab(clientKey, 'ana_' + Date.now(), name.trim());
  }
}

// Menu "+ Nova análise": mostra as abas padrão que o cliente ainda não tem
// (VideoView, Conversão, WhatsApp, etc.) pra facilitar, além da opção de
// digitar um nome personalizado.
function showNewAnalysisPicker(e, clientKey) {
  closeActiveContextMenu();

  const existingIds = new Set((clientAnalyses[clientKey] || []).map(a => a.id));
  const availableDefaults = defaultAnalyses.filter(a => a.id !== 'personalizado' && !existingIds.has(a.id));

  const menu = document.createElement('div');
  menu.className = 'custom-context-menu';
  menu.style.minWidth = '210px';
  menu.style.whiteSpace = 'nowrap';

  const rect = e.target.getBoundingClientRect();
  const menuWidth = 210;
  let left = rect.left + window.scrollX;
  if (left + menuWidth > window.innerWidth - 10) {
    left = window.innerWidth - menuWidth - 10;
  }
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${left}px`;

  availableDefaults.forEach(a => {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    item.innerText = a.name;
    item.onclick = function(evt) {
      evt.stopPropagation();
      closeActiveContextMenu();
      createAnalysisTab(clientKey, a.id, a.name);
    };
    menu.appendChild(item);
  });

  const customItem = document.createElement('div');
  customItem.className = 'context-menu-item';
  customItem.innerHTML = '✏️ Personalizado...';
  customItem.onclick = function(evt) {
    evt.stopPropagation();
    closeActiveContextMenu();
    promptCustomAnalysisName(clientKey);
  };
  menu.appendChild(customItem);

  document.body.appendChild(menu);
  activeContextMenu = menu;

  setTimeout(() => {
    window.addEventListener('click', closeActiveContextMenu);
  }, 10);
}

// Helper to format currency
function formatCurrency(val) {
  return 'R$' + formatNumber(Math.round(val));
}

// Dynamic Mock Metrics Generator for each analysis type
function getAnalysisMetrics(clientName, analysisName) {
  const base = clientDetailedData[clientName];
  if (!base) return null;
  
  const baseInvest = parseFloat(base.metrics.investimento.replace(/[^\d]/g, '')) * 1000;
  const baseRevenue = parseFloat(base.metrics.receita.replace(/[^\d,M]/g, '').replace(',', '.')) * (base.metrics.receita.includes('M') ? 1000000 : 1000);
  
  if (analysisName === 'Visão geral') {
    return {
      labels: ['Investimento', 'Receita', 'Conversão', 'CPL', 'CPA', 'ROI'],
      values: [base.metrics.investimento, base.metrics.receita, base.metrics.conversao, base.metrics.cpl, base.metrics.cpa, base.metrics.roi],
      isGreen: [false, true, false, false, false, true]
    };
  }
  
  let hash = 0;
  for (let i = 0; i < analysisName.length; i++) {
    hash += analysisName.charCodeAt(i);
  }
  
  if (analysisName.includes('Video') || analysisName.includes('video')) {
    const views = Math.round(baseInvest * (3 + (hash % 5)));
    const cpv = (baseInvest * 0.15 / views).toFixed(2);
    const viewRate = (25 + (hash % 20)) + '%';
    const clicks = Math.round(views * 0.015);
    const avgRetention = (35 + (hash % 30)) + '%';
    
    return {
      labels: ['Investimento', 'Visualizações', 'CPV Médio', 'Taxa de View', 'Retenção Média', 'Cliques no Link'],
      values: [formatCurrency(baseInvest * 0.25), formatNumber(views), 'R$ ' + cpv, viewRate, avgRetention, formatNumber(clicks)],
      isGreen: [false, false, false, false, false, false]
    };
  }
  
  if (analysisName.includes('WhatsApp') || analysisName.includes('whats') || analysisName.includes('Whats')) {
    const clicks = Math.round(baseInvest * 0.08);
    const initiated = Math.round(clicks * 0.65);
    const cwp = (baseInvest * 0.2 / initiated).toFixed(2);
    const sales = Math.round(initiated * 0.08);
    const roas = (4 + (hash % 6)) + 'x';
    
    return {
      labels: ['Investimento', 'Cliques Whats', 'Contatos Inc.', 'Custo p/ Whats', 'Vendas Whats', 'ROAS Whats'],
      values: [formatCurrency(baseInvest * 0.2), formatNumber(clicks), formatNumber(initiated), 'R$ ' + cwp, formatNumber(sales), roas],
      isGreen: [false, false, false, false, false, true]
    };
  }
  
  if (analysisName.includes('FB Leads') || analysisName.includes('Facebook') || analysisName.includes('fbleads')) {
    const leads = Math.round(baseInvest * 0.06);
    const fillRate = (70 + (hash % 15)) + '%';
    const cpl = 'R$ ' + (baseInvest * 0.18 / leads).toFixed(2);
    const qualified = Math.round(leads * 0.4);
    const cpq = 'R$ ' + (baseInvest * 0.18 / qualified).toFixed(2);
    
    return {
      labels: ['Investimento', 'Leads no Form', 'Taxa Preench.', 'CPL Form', 'Leads Qualif.', 'Custo p/ Qualif.'],
      values: [formatCurrency(baseInvest * 0.18), formatNumber(leads), fillRate, cpl, formatNumber(qualified), cpq],
      isGreen: [false, false, false, false, false, false]
    };
  }
  
  if (analysisName.includes('Pesquisa') || analysisName.includes('Search') || analysisName.includes('busca')) {
    const impressions = Math.round(baseInvest * 8);
    const clicks = Math.round(impressions * 0.035);
    const ctr = '3.50%';
    const cpc = 'R$ ' + (baseInvest * 0.35 / clicks).toFixed(2);
    const convs = Math.round(clicks * 0.08);
    
    return {
      labels: ['Investimento', 'Impressões', 'Cliques', 'CTR Search', 'CPC Médio', 'Conversões'],
      values: [formatCurrency(baseInvest * 0.35), formatNumber(impressions), formatNumber(clicks), ctr, cpc, formatNumber(convs)],
      isGreen: [false, false, false, false, false, false]
    };
  }
  
  if (analysisName.includes('Vendas') || analysisName.includes('Sales') || analysisName.includes('vendas')) {
    const sales = Math.round(baseInvest * 0.005);
    const avgTicket = 'R$ ' + (1500 + (hash % 2000));
    const cac = 'R$ ' + (baseInvest * 0.5 / sales).toFixed(2);
    const ltv = 'R$ ' + (4000 + (hash % 8000));
    const revenue = sales * (1500 + (hash % 2000));
    
    return {
      labels: ['Investimento', 'Vendas Totais', 'Ticket Médio', 'Faturamento', 'CAC', 'LTV'],
      values: [formatCurrency(baseInvest * 0.5), formatNumber(sales), avgTicket, formatCurrency(revenue), cac, ltv],
      isGreen: [false, false, false, true, false, true]
    };
  }
  
  if (analysisName.includes('Download') || analysisName.includes('app') || analysisName.includes('App')) {
    const downloads = Math.round(baseInvest * 0.4);
    const cpi = 'R$ ' + (baseInvest * 0.15 / downloads).toFixed(2);
    const signups = Math.round(downloads * 0.6);
    const signupRate = '60.0%';
    const activeUsers = Math.round(signups * 0.3);
    
    return {
      labels: ['Investimento', 'Downloads', 'CPI Médio', 'Signups App', 'Taxa Signups', 'Usuários Ativos'],
      values: [formatCurrency(baseInvest * 0.15), formatNumber(downloads), cpi, formatNumber(signups), signupRate, formatNumber(activeUsers)],
      isGreen: [false, false, false, false, false, false]
    };
  }
  
  // Default dynamic custom metrics
  const clicks = Math.round(baseInvest * 0.05);
  const convs = Math.round(clicks * 0.06);
  const cpa = 'R$ ' + (baseInvest * 0.1 / convs).toFixed(2);
  const cpc = 'R$ ' + (baseInvest * 0.1 / clicks).toFixed(2);
  const roi = (100 + (hash % 800)) + '%';
  
  return {
    labels: ['Investimento', 'Ações Custom', 'Cliques', 'CPA Custom', 'CPC Custom', 'ROI Estimado'],
    values: [formatCurrency(baseInvest * 0.1), formatNumber(convs), formatNumber(clicks), cpa, cpc, roi],
    isGreen: [false, false, false, false, false, true]
  };
}

function updateActiveAnalysisView(clientName, analysisName) {
  const clientKey = clientSlugFromName(clientName);

  // Highlight the sidebar menu
  renderClientSidebar(clientKey);
  
  // If the dashboard is child view
  const isMatrixView = currentAnalysis !== 'Visão geral';

  if (isMatrixView) {
    document.getElementById('conv-c-welcome').innerText = clientName;
  } else {
    const clientData = clientDetailedData[clientName];
    if (clientData) {
      if (analysisName === 'Visão geral') {
        document.getElementById('c-welcome').innerText = clientName;
        document.getElementById('c-meta').innerText = `${clientData.segment} · ${clientData.period}`;
      } else {
        document.getElementById('c-welcome').innerText = `${clientName} > ${analysisName}`;
        document.getElementById('c-meta').innerText = `${clientData.segment} · ${clientData.period} · Análise de ${analysisName}`;
      }
    }
    renderAnalysisMetricsCards(clientName, analysisName);
  }
}

function renderAnalysisMetricsCards(clientName, analysisName) {
  const metricsData = getAnalysisMetrics(clientName, analysisName);
  if (!metricsData) return;
  
  const cards = document.querySelectorAll('.metrics-row-six .metric-card');
  if (cards.length < 6) return;
  
  for (let i = 0; i < 6; i++) {
    const titleEl = cards[i].querySelector('.card-title') || cards[i].querySelector('#c-roi-title');
    const valueEl = cards[i].querySelector('.card-value') || cards[i].querySelector('#c-num-roi');
    
    if (titleEl) titleEl.innerText = metricsData.labels[i];
    if (valueEl) {
      valueEl.innerText = metricsData.values[i];
      valueEl.className = 'card-value';
      if (metricsData.isGreen[i]) {
        valueEl.classList.add('highlight-green');
      }
    }
  }
}

function getAnalysisInsights(clientName, analysisName) {
  if (analysisName.includes('Video') || analysisName.includes('video')) {
    return [
      `As campanhas de vídeo para ${clientName} geraram um aumento de 25% em recall de marca.`,
      `O Custo por Visualização (CPV) médio está em R$ 0,15, abaixo da meta histórica.`,
      `Públicos de remarketing que assistiram a 75% dos vídeos apresentam taxa de conversão 2x maior.`,
      `Recomendamos focar a verba nos criativos de 15 segundos que possuem taxa de retenção de 52%.`
    ];
  }
  if (analysisName.includes('WhatsApp') || analysisName.includes('whats') || analysisName.includes('Whats')) {
    return [
      `O tráfego direto para o WhatsApp representa 45% das conversões qualificadas de ${clientName}.`,
      `O tempo médio de primeira resposta da equipe comercial no WhatsApp reduziu para 8 minutos.`,
      `Campanhas no Meta Ads direcionando para o WhatsApp estão com custo por lead 12% menor.`,
      `Mensagens automáticas de saudação personalizadas aumentaram a taxa de engajamento inicial em 18%.`
    ];
  }
  if (analysisName.includes('FB Leads') || analysisName.includes('Facebook') || analysisName.includes('fbleads')) {
    return [
      `Os formulários nativos do Facebook Ads reduziram o atrito, aumentando o volume de leads em 30%.`,
      `A taxa de qualificação dos leads vindos do Facebook Forms subiu para 28% com o campo de validação de telefone.`,
      `Campanhas de lookalike baseadas na lista de clientes compradores performaram melhor.`,
      `Recomendamos desativar criativos estáticos e focar 100% em Reels curtos com depoimentos.`
    ];
  }
  if (analysisName.includes('Pesquisa') || analysisName.includes('Search') || analysisName.includes('busca')) {
    return [
      `As campanhas de busca do Google Ads respondem por 60% das vendas de ${clientName}.`,
      `O índice de qualidade das palavras-chave institucionais atingiu nota 9/10.`,
      `Títulos dinâmicos nos anúncios aumentaram a taxa de clique (CTR) geral para 3.50%.`,
      `A palavra-chave principal do segmento apresentou um aumento de 15% no custo por clique (CPC).`
    ];
  }
  if (analysisName.includes('Vendas') || analysisName.includes('Sales') || analysisName.includes('vendas')) {
    return [
      `A evolução das vendas comerciais indica um crescimento acumulado de 18% no trimestre.`,
      `O ticket médio de vendas subiu para valores acima de R$ 1.800 neste período.`,
      `O Custo de Aquisição de Clientes (CAC) diminuiu 10% devido a otimizações de público.`,
      `O tempo de fechamento (sales cycle) reduziu de 14 para 11 dias.`
    ];
  }
  return [
    `Insights específicos para a análise '${analysisName}' de ${clientName}.`,
    `A performance geral desta métrica está dentro do esperado com variação de +/- 5%.`,
    `Os canais de atração estão operando de forma integrada para maximizar os resultados.`,
    `Recomendamos manter o monitoramento semanal desta aba para identificar tendências de comportamento.`
  ];
}

let usingRealCampaignData = false;

async function loadConversaoCampaignsForClient(clientName, analysisName) {
  conversaoCampaigns.length = 0;
  usingRealCampaignData = false;

  const clientSlug = clientSlugFromName(clientName) || slugify(clientName);
  const { data, error } = await supabaseClient
    .from('campaign_metrics')
    .select('*')
    .eq('client_slug', clientSlug);

  if (!error && data && data.length > 0) {
    let rows = data;

    // Se a aba for de um canal reconhecido (VideoView, WhatsApp, etc.), tenta
    // restringir às campanhas cujo "Objetivo" da planilha bate com esse canal.
    const known = matchKnownMatrixTemplate(analysisName);
    if (known && analysisName !== 'Conversão') {
      const filtered = rows.filter(r => matchKnownMatrixTemplate(r.objective) === known);
      if (filtered.length > 0) rows = filtered;
    }

    const grouped = {};
    rows.forEach(r => {
      const key = `${r.campaign_name}||${r.platform}`;
      if (!grouped[key]) {
        grouped[key] = {
          id: key, name: r.campaign_name, platform: r.platform, checked: true,
          invest: 0, impress: 0, clicks: 0, views: 0, convs: 0, sales: 0
        };
      }
      grouped[key].invest += Number(r.invest) || 0;
      grouped[key].impress += Number(r.impressions) || 0;
      grouped[key].clicks += Number(r.clicks) || 0;
      grouped[key].views += Number(r.page_views) || 0;
      grouped[key].convs += Number(r.conversions) || 0;
      grouped[key].sales += Number(r.purchases) || 0;
    });

    conversaoCampaigns.push(...Object.values(grouped));
    usingRealCampaignData = true;
    return;
  }

  // Fallback: sem dados importados ainda para este cliente, mantém os dados
  // fictícios de demonstração (mesmo comportamento de antes da importação existir).
  if (clientName === 'Drex Imóveis') {
    conversaoCampaigns.push(
      { id: 1, name: "Search | Lead | Imóvel BR", platform: "Google Ads", checked: false, invest: 12000, impress: 350000, clicks: 2100, views: 1800, convs: 150, sales: 4.65 },
      { id: 2, name: "Forms - Brasil - Volume", platform: "Meta Ads", checked: true, invest: 15000, impress: 480000, clicks: 3100, views: 2600, convs: 210, sales: 6.51 },
      { id: 3, name: "Forms - Qualif. por Preço", platform: "Meta Ads", checked: true, invest: 13000, impress: 410000, clicks: 2275, views: 1990, convs: 170, sales: 5.27 },
      { id: 4, name: "Captação WA - Leads Imóveis", platform: "Meta Ads", checked: false, invest: 8000, impress: 250000, clicks: 1500, views: 1200, convs: 90, sales: 2.79 },
      { id: 5, name: "Search | Institucional | CPC", platform: "Google Ads", checked: false, invest: 5000, impress: 150000, clicks: 1200, views: 1000, convs: 80, sales: 2.48 },
      { id: 6, name: "Retargeting | Site Visitantes", platform: "Meta Ads", checked: false, invest: 6000, impress: 180000, clicks: 1400, views: 1100, convs: 95, sales: 2.945 },
      { id: 7, name: "PMAX | Leads Imóveis SP", platform: "Google Ads", checked: false, invest: 9000, impress: 270000, clicks: 1800, views: 1500, convs: 115, sales: 3.565 }
    );
  } else if (clientName === 'Orion Tech') {
    conversaoCampaigns.push(
      { id: 1, name: "LinkedIn | Lead Gen B2B", platform: "LinkedIn Ads", checked: true, invest: 14000, impress: 180000, clicks: 1100, views: 950, convs: 45, sales: 11.25 },
      { id: 2, name: "Google Search | Software ERP", platform: "Google Ads", checked: true, invest: 10000, impress: 220000, clicks: 1300, views: 1100, convs: 38, sales: 9.50 },
      { id: 3, name: "Meta | Retargeting Demo", platform: "Meta Ads", checked: false, invest: 5000, impress: 90000, clicks: 650, views: 500, convs: 12, sales: 3.00 },
      { id: 4, name: "LinkedIn | Decisores C-Level", platform: "LinkedIn Ads", checked: false, invest: 6000, impress: 70000, clicks: 450, views: 380, convs: 8, sales: 2.00 }
    );
  } else if (clientName === 'Lumera Saúde') {
    conversaoCampaigns.push(
      { id: 1, name: "Meta | Agendamento Consulta", platform: "Meta Ads", checked: true, invest: 9000, impress: 310000, clicks: 2200, views: 1900, convs: 120, sales: 24.00 },
      { id: 2, name: "Google | Clínicas Médicas", platform: "Google Ads", checked: true, invest: 8000, impress: 150000, clicks: 1400, views: 1200, convs: 85, sales: 17.00 },
      { id: 3, name: "Meta | Vídeo Doutores", platform: "Meta Ads", checked: false, invest: 4000, impress: 120000, clicks: 980, views: 800, convs: 30, sales: 6.00 }
    );
  } else {
    conversaoCampaigns.push(
      { id: 1, name: "Google | Frotas B2B Search", platform: "Google Ads", checked: true, invest: 25000, impress: 600000, clicks: 4800, views: 4100, convs: 210, sales: 105.00 },
      { id: 2, name: "LinkedIn | Gestores Frota", platform: "LinkedIn Ads", checked: true, invest: 15000, impress: 190000, clicks: 1600, views: 1300, convs: 65, sales: 32.50 },
      { id: 3, name: "Meta | Retargeting Dealer", platform: "Meta Ads", checked: false, invest: 8000, impress: 240000, clicks: 1800, views: 1500, convs: 48, sales: 24.00 }
    );
  }
}

let conversaoCampaigns = [];

function toggleClientExpand(clientName) {
  const clientKey = clientSlugFromName(clientName);

  const container = document.getElementById(`container-client-${clientKey}`);
  const menu = document.getElementById(`analysis-menu-${clientKey}`);
  
  if (!container || !menu) return;
  
  const isExpanded = container.classList.contains('expanded');
  
  // Collapse all other containers
  const allContainers = document.querySelectorAll('.client-container');
  allContainers.forEach(c => {
    if (c !== container) {
      c.classList.remove('expanded');
    }
  });
  
  const allMenus = document.querySelectorAll('.analysis-menu');
  allMenus.forEach(m => {
    if (m !== menu) {
      m.style.display = 'none';
    }
  });
  
  if (!isExpanded) {
    container.classList.add('expanded');
    menu.style.display = 'flex';
    // When expanding, go to standard default client view first, or "Conversão" if it is Drex Imóveis
    if (clientName === 'Drex Imóveis') {
      selectAnalysis('Drex Imóveis', 'Conversão');
    } else {
      selectAnalysis(clientName, 'Visão geral');
    }
  } else {
    container.classList.remove('expanded');
    menu.style.display = 'none';
    // Recolher o submenu só esconde as sub-análises na sidebar — não navega
    // pra fora da Visão geral do cliente que já está aberta.
  }
}

async function selectAnalysis(clientName, analysisName, analysisId) {
  currentClient = clientName;
  currentAnalysis = analysisName;
  const clientKey = clientSlugFromName(clientName);

  if (!analysisId) {
    const list = clientAnalyses[clientKey] || [];
    const item = list.find(a => a.name === analysisName);
    analysisId = item ? item.id : 'visao';
  }
  currentAnalysisId = analysisId;

  // Highlight client container
  const allContainers = document.querySelectorAll('.client-container');
  allContainers.forEach(c => c.classList.remove('expanded'));
  const activeContainer = document.getElementById(`container-client-${clientKey}`);
  if (activeContainer) activeContainer.classList.add('expanded');
  
  const allMenus = document.querySelectorAll('.analysis-menu');
  allMenus.forEach(m => m.style.display = 'none');
  const activeMenu = document.getElementById(`analysis-menu-${clientKey}`);
  if (activeMenu) activeMenu.style.display = 'flex';

  // Set active analysis in sidebar
  const allAnalysisItems = document.querySelectorAll('.analysis-item');
  allAnalysisItems.forEach(item => item.classList.remove('active'));
  
  const activeItem = document.getElementById(`analysis-${clientKey}-${analysisId}`);
  if (activeItem) activeItem.classList.add('active');

  // Highlight client item header
  const allClientItems = document.querySelectorAll('.client-item');
  allClientItems.forEach(item => {
    item.classList.remove('active');
    item.style.backgroundColor = 'transparent';
  });
  const clientItem = document.getElementById(`sidebar-client-${clientKey}`);
  if (clientItem) {
    clientItem.classList.add('active');
    clientItem.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
  }

  // Deactivate main general dashboard highlights
  document.getElementById('menu-dashboard-link').classList.remove('active');
  const menuColab = document.getElementById('menu-colaboradores-link');
  if (menuColab) menuColab.classList.remove('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  const menuConfig = document.getElementById('menu-configuracoes-link');
  if (menuConfig) menuConfig.classList.remove('active');
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  const viewConfig = document.getElementById('view-configuracoes');
  if (viewConfig) viewConfig.style.display = 'none';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();

  // Load screen view
  // Todas as abas de análise (exceto "Visão geral") usam a tela de matriz de métricas
  const isMatrixView = analysisName !== 'Visão geral';
  if (isMatrixView) {
    document.getElementById('view-dashboard-pai').style.display = 'none';
    document.getElementById('view-dashboard-filho').style.display = 'none';
    document.getElementById('view-dashboard-conversao').style.display = 'block';
    const viewColab = document.getElementById('view-colaboradores');
    if (viewColab) viewColab.style.display = 'none';

    // Aplica o template de métricas específico desta aba (estrutura + rótulos),
    // mas prioriza uma estrutura salva no Supabase caso o usuário já tenha
    // editado essa aba antes (linha excluída, métrica adicionada, etc.)
    const matrixTemplate = getAnalysisMatrixTemplate(analysisName);
    const savedRows = await loadMatrixStructure(clientKey, analysisId);

    if (savedRows) {
      conversaoRows = savedRows;
    } else {
      conversaoRows = JSON.parse(JSON.stringify(matrixTemplate.rows));
      if (matrixTemplate.isCustom) {
        // Primeira vez que essa aba personalizada é aberta: já salva zerada
        saveMatrixStructure(clientKey, analysisId, conversaoRows);
      }
    }

    const matrixTitleEl = document.getElementById('conv-matrix-title');
    if (matrixTitleEl) matrixTitleEl.innerText = matrixTemplate.title;

    // Update client name in Conversão View Header
    document.getElementById('conv-c-welcome').innerText = clientName;
    document.getElementById('conv-c-meta').innerText = `${analysisName} · Maio 2025`;

    // Breadcrumb dinâmico
    const breadcrumbClientEl = document.getElementById('conv-breadcrumb-client');
    if (breadcrumbClientEl) {
      breadcrumbClientEl.innerText = clientName;
      breadcrumbClientEl.onclick = () => selectClient(clientName);
    }
    const breadcrumbAnalysisEl = document.getElementById('conv-breadcrumb-analysis');
    if (breadcrumbAnalysisEl) breadcrumbAnalysisEl.innerText = analysisName;

    // Init default filter values
    document.getElementById('conv-filter-platform').value = 'Todas';
    document.getElementById('conv-campaigns-search').value = '';
    
    // Reset period button and input fields to May 2025
    calendarStates['conv'].startDate = new Date(2025, 4, 1);
    calendarStates['conv'].endDate = new Date(2025, 4, 31);
    calendarStates['conv'].currentYear = 2025;
    calendarStates['conv'].currentMonth = 4;
    
    document.getElementById('conv-period-btn-text').innerText = "01/05/2025 - 31/05/2025";
    document.getElementById('conv-period-start').value = "01/05/2025";
    document.getElementById('conv-period-end').value = "31/05/2025";
    
    // Load dynamic campaigns based on the client!
    await loadConversaoCampaignsForClient(clientName, analysisName);

    if (!usingRealCampaignData) {
      // Dados fictícios: seleciona as duas primeiras campanhas por padrão
      conversaoCampaigns.forEach((c, idx) => {
        c.checked = (idx < 2);
      });
    }


    renderConvCampaignsDropdown();
    updateConvCampaignsCountText();
    updateConversaoMetrics();
    renderCalendarDaysGrid('conv');

    // Nova análise/cliente aberto: limpa comparação de mês ativa (era de
    // outro contexto) e força recarregar a série mensal na próxima vez que
    // o usuário abrir "Comparar mês" aqui.
    conversaoComparisonState = null;
    monthlyCampaignSeriesCacheKey = null;
    comparisonSortState = { key: null, dir: 1 };
    renderMonthComparison();
  } else {
    // Show standard child view
    document.getElementById('view-dashboard-pai').style.display = 'none';
    document.getElementById('view-dashboard-conversao').style.display = 'none';
    
    selectClient(clientName);
    
    // Customise metrics cards & headers for the selected analysis!
    renderAnalysisMetricsCards(clientName, analysisName);
  }
}

// Global State for Calendars (conv, pai, filho)
const calendarStates = {
  conv: {
    currentYear: 2025,
    currentMonth: 4,
    startDate: new Date(2025, 4, 1),
    endDate: new Date(2025, 4, 31)
  },
  pai: {
    currentYear: 2025,
    currentMonth: 4,
    startDate: new Date(2025, 4, 1),
    endDate: new Date(2025, 4, 31)
  },
  filho: {
    currentYear: 2025,
    currentMonth: 4,
    startDate: new Date(2025, 4, 1),
    endDate: new Date(2025, 4, 31)
  }
};

const monthNamesPT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function togglePeriodDropdown(prefix, event) {
  event.stopPropagation();
  const dropdown = document.getElementById(`${prefix}-period-dropdown`);
  if (!dropdown) return;
  const isHidden = dropdown.style.display === 'none';
  
  // Fechar outros dropdowns de período que possam estar abertos
  document.querySelectorAll('.period-dropdown-box').forEach(d => {
    if (d.id !== `${prefix}-period-dropdown`) d.style.display = 'none';
  });
  if (prefix === 'conv') {
    const compareDropdown = document.getElementById('conv-compare-dropdown');
    if (compareDropdown) compareDropdown.style.display = 'none';
    const campaignsDropdown = document.getElementById('conv-campaigns-dropdown');
    if (campaignsDropdown) campaignsDropdown.style.display = 'none';
  }

  dropdown.style.display = isHidden ? 'flex' : 'none';
  
  if (isHidden) {
    renderCalendarDaysGrid(prefix);
  }
}

// Abre/fecha o menu do avatar (FG) no header — mostra a opção "Sair".
// Um único dropdown compartilhado, reposicionado embaixo do avatar clicado.
function toggleUserMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('user-menu-dropdown');
  if (!menu) return;

  if (menu.style.display === 'block') {
    menu.style.display = 'none';
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(10, rect.right - 140)}px`;
  menu.style.display = 'block';
}

// Event listener global para fechar dropdowns ao clicar fora
document.addEventListener('click', function(event) {
  const path = event.composedPath();

  // Fecha o menu do avatar (FG) se clicado fora dele
  const userMenu = document.getElementById('user-menu-dropdown');
  if (userMenu && userMenu.style.display !== 'none' && !path.includes(userMenu)) {
    userMenu.style.display = 'none';
  }

  // Fecha o menu de três pontos da Análise de Conversão se clicado fora
  const convThreeDropdown = document.getElementById('conv-three-point-dropdown');
  const convThreeBtn = document.getElementById('conv-menu-trigger');
  if (convThreeDropdown && convThreeDropdown.style.display !== 'none') {
    if (!path.includes(convThreeDropdown) && event.target !== convThreeBtn && !convThreeBtn.contains(event.target)) {
      convThreeDropdown.style.display = 'none';
    }
  }
  
  ['conv', 'pai', 'filho'].forEach(prefix => {
    const dropdown = document.getElementById(`${prefix}-period-dropdown`);
    const btn = document.getElementById(`${prefix}-filter-period-btn`);
    
    if (dropdown && dropdown.style.display !== 'none') {
      const clickedInsideDropdown = path.includes(dropdown);
      const clickedBtn = (event.target === btn || btn.contains(event.target));
      
      if (!clickedInsideDropdown && !clickedBtn) {
        dropdown.style.display = 'none';
      }
    }
  });
});

function prevCalendarMonth(prefix) {
  const state = calendarStates[prefix];
  state.currentMonth--;
  if (state.currentMonth < 0) {
    state.currentMonth = 11;
    state.currentYear--;
  }
  renderCalendarDaysGrid(prefix);
}

function nextCalendarMonth(prefix) {
  const state = calendarStates[prefix];
  state.currentMonth++;
  if (state.currentMonth > 11) {
    state.currentMonth = 0;
    state.currentYear++;
  }
  renderCalendarDaysGrid(prefix);
}

function renderCalendarDaysGrid(prefix) {
  const state = calendarStates[prefix];
  const monthYearLabel = document.getElementById(`${prefix}-calendar-month-year`);
  if (monthYearLabel) {
    monthYearLabel.innerText = `${monthNamesPT[state.currentMonth]} ${state.currentYear}`;
  }
  
  const grid = document.getElementById(`${prefix}-calendar-days-grid`);
  if (!grid) return;
  grid.innerHTML = '';
  
  const firstDay = new Date(state.currentYear, state.currentMonth, 1);
  const startDayOfWeek = firstDay.getDay();
  const totalDays = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const prevMonthTotalDays = new Date(state.currentYear, state.currentMonth, 0).getDate();
  
  // Desenha dias do mês anterior
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayVal = prevMonthTotalDays - i;
    const daySpan = document.createElement('span');
    daySpan.className = 'calendar-day disabled';
    daySpan.innerText = dayVal;
    grid.appendChild(daySpan);
  }
  
  // Desenha dias do mês atual
  for (let d = 1; d <= totalDays; d++) {
    const daySpan = document.createElement('span');
    daySpan.className = 'calendar-day';
    daySpan.innerText = d;
    
    const thisDate = new Date(state.currentYear, state.currentMonth, d);
    
    if (state.startDate && thisDate.getTime() === state.startDate.getTime()) {
      daySpan.classList.add('active-range-bound');
    } else if (state.endDate && thisDate.getTime() === state.endDate.getTime()) {
      daySpan.classList.add('active-range-bound');
    } else if (state.startDate && state.endDate && thisDate > state.startDate && thisDate < state.endDate) {
      daySpan.classList.add('active-range-mid');
    }
    
    daySpan.onclick = () => {
      onCalendarDayClick(prefix, d);
    };
    
    grid.appendChild(daySpan);
  }
  
  // Desenha dias do mês seguinte
  const cellsFilled = startDayOfWeek + totalDays;
  const remainingCells = 42 - cellsFilled;
  for (let i = 1; i <= remainingCells; i++) {
    const daySpan = document.createElement('span');
    daySpan.className = 'calendar-day disabled';
    daySpan.innerText = i;
    grid.appendChild(daySpan);
  }
}

function formatDate(date) {
  if (!date) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// yyyy-mm-dd local (sem fuso) — usado nos filtros gte/lte contra colunas
// `date`/`period_date` do Supabase, que são DATE puro (sem hora).
function formatDateISO(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Bucket de período de um campo personalizado a partir da frequência — mesma
// lógica do portal (portal-cliente.js), duplicada aqui pro painel da agência
// (cálculo de pendências e status "em dia"/"atrasado" em Solicitar dados).
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

function parseDateStr(str) {
  const parts = str.split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0]);
    const m = parseInt(parts[1]) - 1;
    const y = parseInt(parts[2]);
    return new Date(y, m, d);
  }
  return null;
}

function onCalendarDayClick(prefix, day) {
  const state = calendarStates[prefix];
  const clickedDate = new Date(state.currentYear, state.currentMonth, day);
  
  if (!state.startDate || (state.startDate && state.endDate)) {
    state.startDate = clickedDate;
    state.endDate = null;
  } else if (state.startDate && !state.endDate) {
    if (clickedDate < state.startDate) {
      state.startDate = clickedDate;
    } else {
      state.endDate = clickedDate;
    }
  }
  
  document.getElementById(`${prefix}-period-start`).value = formatDate(state.startDate);
  document.getElementById(`${prefix}-period-end`).value = formatDate(state.endDate);
  
  // Clear active preset tags since manual selection overrides presets
  const dropdown = document.getElementById(`${prefix}-period-dropdown`);
  if (dropdown) {
    dropdown.querySelectorAll('.quick-filter-tag').forEach(tag => tag.classList.remove('active'));
  }
  
  renderCalendarDaysGrid(prefix);
}

function onPeriodInputChange(prefix) {
  const state = calendarStates[prefix];
  const startVal = document.getElementById(`${prefix}-period-start`).value;
  const endVal = document.getElementById(`${prefix}-period-end`).value;
  
  const startDate = parseDateStr(startVal);
  const endDate = parseDateStr(endVal);
  
  if (startDate) state.startDate = startDate;
  if (endDate) state.endDate = endDate;
  
  renderCalendarDaysGrid(prefix);
}

function setPeriodPreset(prefix, preset) {
  const state = calendarStates[prefix];
  const endDate = new Date(); // hoje de verdade — não mais fixo em Maio/2025
  endDate.setHours(0, 0, 0, 0);
  let startDate;

  if (preset === 'all') {
    // "Todo período": data bem antiga garante cobrir qualquer dado real
    // (equivalente a não filtrar, já que gte/lte contra ela sempre bate).
    startDate = new Date(2000, 0, 1);
  } else {
    const days = parseInt(preset);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (days - 1));
  }

  state.startDate = startDate;
  state.endDate = endDate;
  state.currentYear = endDate.getFullYear();
  state.currentMonth = endDate.getMonth();
  
  document.getElementById(`${prefix}-period-start`).value = formatDate(startDate);
  document.getElementById(`${prefix}-period-end`).value = formatDate(endDate);
  
  // Highlight active quick filter tag
  const dropdown = document.getElementById(`${prefix}-period-dropdown`);
  if (dropdown) {
    const tags = dropdown.querySelectorAll('.quick-filter-tag');
    tags.forEach(tag => tag.classList.remove('active'));
    // Find the tag that matches this preset
    const presetLabels = { 7: '7D', 14: '14D', 30: '30D', 180: '6M', 'all': 'Todo período' };
    const label = presetLabels[preset];
    tags.forEach(tag => {
      if (tag.textContent.trim() === label) {
        tag.classList.add('active');
      }
    });
  }
  
  renderCalendarDaysGrid(prefix);
}

function applyPeriodFilter(prefix, event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById(`${prefix}-period-dropdown`);
  if (dropdown) dropdown.style.display = 'none';
  
  const state = calendarStates[prefix];
  const startText = document.getElementById(`${prefix}-period-start`).value;
  const endText = document.getElementById(`${prefix}-period-end`).value;
  
  const btnText = document.getElementById(`${prefix}-period-btn-text`);
  if (btnText) {
    if (startText && endText) {
      btnText.innerText = `${startText} - ${endText}`;
    } else if (startText) {
      btnText.innerText = startText;
    } else {
      btnText.innerText = "Maio 2025";
    }
  }
  
  if (prefix === 'conv') {
    updateConversaoMetrics();
  } else if (prefix === 'pai') {
    updateDashboardPaiForCustomPeriod(state.startDate, state.endDate);
  } else if (prefix === 'filho') {
    updateDashboardFilhoForCustomPeriod(state.startDate, state.endDate);
  }
}

function updateDashboardPaiForCustomPeriod(startDate, endDate) {
  if (!startDate || !endDate) return;
  const diffTime = Math.abs(endDate - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const factor = Math.min(1.0, diffDays / 31);
  
  const formattedPeriod = `${formatDate(startDate)} - ${formatDate(endDate)}`;
  const textEl = document.getElementById('current-period-text');
  if (textEl) textEl.innerText = formattedPeriod;
  
  const investBase = 482;
  const receitaBase = 2.84;
  const leadsBase = 12840;
  const qualBase = 5136;
  const propBase = 1541;
  const salesBase = 342;
  
  const currentInvest = Math.round(investBase * factor);
  const currentReceita = (receitaBase * factor).toFixed(2);
  
  document.getElementById('val-investimento').innerText = `R$${currentInvest}k`;
  document.getElementById('val-receita').innerText = `R$${currentReceita}M`;
  
  const currentLeads = Math.round(leadsBase * factor);
  const currentQual = Math.round(qualBase * factor);
  const currentProp = Math.round(propBase * factor);
  const currentSales = Math.round(salesBase * factor);
  
  document.getElementById('funnel-val-1').innerText = currentLeads.toLocaleString('pt-BR');
  document.getElementById('funnel-val-2').innerText = currentQual.toLocaleString('pt-BR');
  document.getElementById('funnel-val-3').innerText = currentProp.toLocaleString('pt-BR');
  document.getElementById('funnel-val-4').innerText = currentSales.toLocaleString('pt-BR');
}

// Escreve no DOM os cards grandes + funil + seção de métricas comerciais do
// Dashboard Filho a partir de um objeto já calculado (mesmo formato de
// buildClientDetailedDataFromReal) — usado tanto no filtro de período quanto
// (indiretamente) na carga inicial do cliente.
function applyFilhoDashboardData(built) {
  document.getElementById('c-num-investimento').innerText = built.metrics.investimento;
  document.getElementById('c-num-receita').innerText = built.metrics.receita;

  document.getElementById('c-funnel-val-1').innerText = built.funnel[0];
  document.getElementById('c-funnel-val-2').innerText = built.funnel[1];
  document.getElementById('c-funnel-val-3').innerText = built.funnel[2];
  document.getElementById('c-funnel-val-4').innerText = built.funnel[3];
  document.getElementById('c-funnel-pct-1').innerText = built.funnelPct[0];
  document.getElementById('c-funnel-pct-2').innerText = built.funnelPct[1];
  document.getElementById('c-funnel-pct-3').innerText = built.funnelPct[2];
  document.getElementById('c-funnel-pct-final').innerText = built.funnelPct[3];

  document.getElementById('c-num-cpl').innerText = built.metrics.cpl;
  document.getElementById('c-num-cpa').innerText = built.metrics.cpa;

  if (currentClient === "Volks B2B") {
    document.getElementById('c-roi-title').innerText = "ROAS";
    const roasVal = built.raw.invest > 0 ? (built.raw.revenue / built.raw.invest).toFixed(1) : '0.0';
    document.getElementById('c-num-roi').innerText = `${roasVal}x`;
  } else {
    document.getElementById('c-roi-title').innerText = "ROI";
    document.getElementById('c-num-roi').innerText = built.metrics.roi;
  }

  document.getElementById('c-num-conversao').innerText = built.metrics.conversao;

  renderCommercialMetrics(built);
}

async function updateDashboardFilhoForCustomPeriod(startDate, endDate) {
  if (!startDate || !endDate) return;

  const formattedPeriod = `${formatDate(startDate)} - ${formatDate(endDate)}`;

  const metaEl = document.getElementById('c-meta');
  if (metaEl) {
    const segment = metaEl.innerText.split('·')[0].trim();
    metaEl.innerText = `${segment} · ${formattedPeriod}`;
  }

  const clientData = clientDetailedData[currentClient];
  if (!clientData) return;

  // Cliente com dado real importado: refiltra de verdade por data
  // (campaign_metrics.date e custom_field_values.period_date) e reusa o
  // mesmo cálculo da carga inicial — nada de aproximar por "fator de dias",
  // que ignorava as datas reais das linhas.
  if (clientData.raw) {
    const clientAtRequest = currentClient;
    const slug = clientData.slug || clientSlugFromName(currentClient) || slugify(currentClient);
    const startISO = formatDateISO(startDate);
    const endISO = formatDateISO(endDate);

    const [{ data: campaigns }, { data: cfValues }, { data: leadsRows }] = await Promise.all([
      supabaseClient.from('campaign_metrics').select('*').eq('client_slug', slug).gte('date', startISO).lte('date', endISO),
      supabaseClient.from('custom_field_values').select('*').eq('client_slug', slug).gte('period_date', startISO).lte('period_date', endISO),
      supabaseClient.from('leads_sales').select('*').eq('client_slug', slug).gte('date', startISO).lte('date', endISO)
    ]);

    // Só recalcula se ainda estivermos olhando pro mesmo cliente quando a
    // resposta chegar (evita sobrescrever a tela se o usuário já trocou de
    // cliente enquanto a query estava em andamento).
    if (currentClient !== clientAtRequest) return;

    const built = buildClientDetailedDataFromReal(
      campaigns || [],
      leadsRows || [],
      clientData.targetsRowsAll || [],
      clientData.customFieldsDefs || [],
      cfValues || []
    );
    applyFilhoDashboardData(built);
    return;
  }

  const diffTime = Math.abs(endDate - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const factor = Math.min(1.0, diffDays / 31);

  // Fallback (sem "raw" — dado fictício de demonstração antigo): não tem
  // campos personalizados, então a seção de Métricas Comerciais some.
  renderCommercialMetrics({ commercial: {}, customMetrics: [], commercialStats: {} });

  const getVal = (str) => {
    if (!str) return 0;
    return parseInt(str.replace(/\./g, '').replace(/[^0-9]/g, ''));
  };

  const investBase = getVal(clientData.metrics.investimento);
  const receitaBase = getVal(clientData.metrics.receita);

  const currentInvest = Math.round(investBase * factor);
  const currentReceita = Math.round(receitaBase * factor);

  document.getElementById('c-num-investimento').innerText = `R$${currentInvest}k`;
  document.getElementById('c-num-receita').innerText = `R$${currentReceita}k`;

  const f1 = Math.round(getVal(clientData.funnel[0]) * factor);
  const f2 = Math.round(getVal(clientData.funnel[1]) * factor);
  const f3 = Math.round(getVal(clientData.funnel[2]) * factor);
  const f4 = Math.round(getVal(clientData.funnel[3]) * factor);

  document.getElementById('c-funnel-val-1').innerText = f1.toLocaleString('pt-BR');
  document.getElementById('c-funnel-val-2').innerText = f2.toLocaleString('pt-BR');
  document.getElementById('c-funnel-val-3').innerText = f3.toLocaleString('pt-BR');
  document.getElementById('c-funnel-val-4').innerText = f4.toLocaleString('pt-BR');

  const investVal = currentInvest * 1000;
  const receitaVal = currentReceita * 1000;

  const cplVal = f1 > 0 ? Math.round(investVal / f1) : 0;
  const cpaVal = f4 > 0 ? Math.round(investVal / f4) : 0;

  document.getElementById('c-num-cpl').innerText = cplVal > 0 ? `R$${cplVal}` : '—';
  document.getElementById('c-num-cpa').innerText = cpaVal > 0 ? `R$${cpaVal}` : '—';

  if (currentClient === "Volks B2B") {
    document.getElementById('c-roi-title').innerText = "ROAS";
    const roasVal = currentInvest > 0 ? (receitaVal / investVal).toFixed(1) : '0.0';
    document.getElementById('c-num-roi').innerText = `${roasVal}x`;
  } else {
    document.getElementById('c-roi-title').innerText = "ROI";
    const roiVal = currentInvest > 0 ? Math.round((receitaVal / investVal) * 100) : 0;
    document.getElementById('c-num-roi').innerText = roiVal > 0 ? `${roiVal}%` : '0%';
  }

  const convVal = f1 > 0 ? ((f4 / f1) * 100).toFixed(1) : '0.0';
  document.getElementById('c-num-conversao').innerText = `${convVal}%`;
}

// campaigns dropdown overlay controls
function toggleConvCampaignsDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('conv-campaigns-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.style.display === 'none';

  // Close period dropdown if open
  const periodDropdown = document.getElementById('conv-period-dropdown');
  if (periodDropdown) periodDropdown.style.display = 'none';
  const compareDropdown = document.getElementById('conv-compare-dropdown');
  if (compareDropdown) compareDropdown.style.display = 'none';

  dropdown.style.display = isHidden ? 'flex' : 'none';
}

document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('conv-campaigns-dropdown');
  const btn = document.getElementById('conv-filter-campaigns-btn');
  if (dropdown && dropdown.style.display !== 'none' && !dropdown.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('conv-compare-dropdown');
  const btn = document.getElementById('conv-compare-btn');
  if (dropdown && dropdown.style.display !== 'none' && !dropdown.contains(event.target) && event.target !== btn && !btn.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

function renderConvCampaignsDropdown() {
  const container = document.getElementById('conv-campaigns-list-container');
  if (!container) return;
  container.innerHTML = '';
  
  const platformFilter = document.getElementById('conv-filter-platform').value;
  const searchQuery = document.getElementById('conv-campaigns-search').value.toLowerCase().trim();
  
  conversaoCampaigns.forEach(camp => {
    if (platformFilter !== 'Todas' && camp.platform !== platformFilter) return;
    if (searchQuery && !camp.name.toLowerCase().includes(searchQuery)) return;
    
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '6px 8px';
    item.style.borderRadius = '4px';
    item.style.cursor = 'pointer';
    item.style.transition = 'background-color 0.15s ease';
    
    item.onmouseenter = () => item.style.backgroundColor = 'rgba(255,255,255,0.03)';
    item.onmouseleave = () => item.style.backgroundColor = 'transparent';
    
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = camp.checked;
    checkbox.style.cursor = 'pointer';
    checkbox.style.accentColor = 'var(--color-green)';
    checkbox.onchange = (e) => {
      camp.checked = e.target.checked;
      updateConvCampaignsCountText();
    };
    
    item.onclick = (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        camp.checked = checkbox.checked;
        updateConvCampaignsCountText();
      }
    };
    
    const nameSpan = document.createElement('span');
    nameSpan.innerText = camp.name;
    nameSpan.style.fontSize = '11px';
    nameSpan.style.color = 'var(--text-primary)';
    
    left.appendChild(checkbox);
    left.appendChild(nameSpan);
    
    const platformSpan = document.createElement('span');
    platformSpan.innerText = camp.platform;
    platformSpan.style.fontSize = '9px';
    platformSpan.style.color = 'var(--text-muted)';
    
    item.appendChild(left);
    item.appendChild(platformSpan);
    container.appendChild(item);
  });
}

function filterConvCampaignsDropdown() {
  renderConvCampaignsDropdown();
}

function selectAllConvCampaigns() {
  const platformFilter = document.getElementById('conv-filter-platform').value;
  conversaoCampaigns.forEach(camp => {
    if (platformFilter === 'Todas' || camp.platform === platformFilter) {
      camp.checked = true;
    }
  });
  renderConvCampaignsDropdown();
  updateConvCampaignsCountText();
}

function clearAllConvCampaigns() {
  const platformFilter = document.getElementById('conv-filter-platform').value;
  conversaoCampaigns.forEach(camp => {
    if (platformFilter === 'Todas' || camp.platform === platformFilter) {
      camp.checked = false;
    }
  });
  renderConvCampaignsDropdown();
  updateConvCampaignsCountText();
}

function applyConvCampaignsFilter(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('conv-campaigns-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  updateConversaoMetrics();
}

function updateConvCampaignsCountText() {
  const checkedCount = conversaoCampaigns.filter(c => c.checked).length;
  const totalCount = conversaoCampaigns.length;
  const btnText = document.getElementById('conv-campaigns-btn-text');
  if (!btnText) return;
  
  if (checkedCount === totalCount) {
    btnText.innerText = "Todas as campanhas";
  } else if (checkedCount === 0) {
    btnText.innerText = "Nenhuma campanha";
  } else {
    btnText.innerText = `${checkedCount} campanhas selecionadas`;
  }
  
  const badge = document.getElementById('conv-camp-badge');
  if (badge) {
    badge.innerText = `${checkedCount} campanhas`;
  }
}

function updateConversaoData() {
  const platformFilter = document.getElementById('conv-filter-platform').value;
  conversaoCampaigns.forEach(camp => {
    if (platformFilter === 'Todas') {
      camp.checked = (camp.id === 2 || camp.id === 3);
    } else {
      camp.checked = (camp.platform === platformFilter);
    }
  });
  renderConvCampaignsDropdown();
  updateConvCampaignsCountText();
  updateConversaoMetrics();
}

// ==========================================================================
// TEMPLATES DE MATRIZ DE MÉTRICAS POR TIPO DE ANÁLISE
// ==========================================================================
// Todas as abas de análise (exceto "Visão geral") usam a mesma tela e o mesmo
// conjunto fixo de chaves (invest/impress/clicks/views/convs/cpm/cpc/cppv/cpa/
// ctr/pvrate/convrate/buyerate) para reaproveitar o cálculo já existente em
// updateConversaoMetrics(). Só o rótulo/descrição de cada métrica muda,
// adaptado ao tipo de canal daquela aba.
const ANALYSIS_MATRIX_TEMPLATES = {
  'Conversão': {
    title: 'ANÁLISE DE CONVERSÃO',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 30000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 900000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 6000, format: "Número", rule: "Maior é melhor" },
        { name: "Page View", key: "views", desc: "visualizações de página", meta: 4800, format: "Número", rule: "Maior é melhor" },
        { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 400, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 30, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 5, format: "Moeda", rule: "Menor é melhor" },
        { name: "Custo por Page View", key: "cppv", desc: "custo por visualização", meta: 6, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPA", key: "cpa", desc: "CPA de conversão", meta: 80, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.2, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Page View", key: "pvrate", desc: "page views / cliques", meta: 80, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Conversão", key: "convrate", desc: "conversões / page views", meta: 8, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Compra", key: "buyerate", desc: "conversões / leads", meta: 3, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  },
  'VideoView': {
    title: 'ANÁLISE DE VIDEOVIEW',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 25000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 900000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques no vídeo", key: "clicks", desc: "no criativo", meta: 5000, format: "Número", rule: "Maior é melhor" },
        { name: "Visualizações", key: "views", desc: "vídeo assistido", meta: 6000, format: "Número", rule: "Maior é melhor" },
        { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 250, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 28, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 6, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPV", key: "cppv", desc: "custo por visualização", meta: 0.15, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPA", key: "cpa", desc: "CPA de conversão", meta: 100, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.0, format: "Percentual", rule: "Maior é melhor" },
        { name: "VTR", key: "pvrate", desc: "visualizações / impressões", meta: 35, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Conversão", key: "convrate", desc: "conversões / visualizações", meta: 5, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Engajamento", key: "buyerate", desc: "interação com o criativo", meta: 8, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  },
  'Captação WhatsApp': {
    title: 'ANÁLISE DE CAPTAÇÃO WHATSAPP',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 20000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 700000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 5500, format: "Número", rule: "Maior é melhor" },
        { name: "Conversas iniciadas", key: "views", desc: "abriram o WhatsApp", meta: 3500, format: "Número", rule: "Maior é melhor" },
        { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 350, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 25, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 4, format: "Moeda", rule: "Menor é melhor" },
        { name: "Custo por Conversa", key: "cppv", desc: "custo por conversa iniciada", meta: 7, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPA", key: "cpa", desc: "CPA de conversão", meta: 70, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.3, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Conversa", key: "pvrate", desc: "conversas / cliques", meta: 65, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Conversão", key: "convrate", desc: "conversões / conversas", meta: 10, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Resposta", key: "buyerate", desc: "conversas respondidas", meta: 85, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  },
  'Captação FB Leads': {
    title: 'ANÁLISE DE CAPTAÇÃO FB LEADS',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 22000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 800000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 5800, format: "Número", rule: "Maior é melhor" },
        { name: "Formulários abertos", key: "views", desc: "abriram o formulário", meta: 4200, format: "Número", rule: "Maior é melhor" },
        { name: "Leads enviados", key: "convs", desc: "formulários enviados", meta: 380, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 27, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 4.5, format: "Moeda", rule: "Menor é melhor" },
        { name: "Custo por Formulário", key: "cppv", desc: "custo por formulário aberto", meta: 5.5, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPL", key: "cpa", desc: "custo por lead enviado", meta: 65, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.4, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Abertura", key: "pvrate", desc: "formulários / cliques", meta: 72, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Envio", key: "convrate", desc: "leads / formulários", meta: 9, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Qualificação", key: "buyerate", desc: "leads qualificados", meta: 40, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  },
  'Pesquisa': {
    title: 'ANÁLISE DE PESQUISA',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 28000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 850000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 5900, format: "Número", rule: "Maior é melhor" },
        { name: "Page View", key: "views", desc: "visualizações de página", meta: 4700, format: "Número", rule: "Maior é melhor" },
        { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 390, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 31, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 5.2, format: "Moeda", rule: "Menor é melhor" },
        { name: "Custo por Page View", key: "cppv", desc: "custo por visualização", meta: 6.2, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPA", key: "cpa", desc: "CPA de conversão", meta: 78, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.25, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Page View", key: "pvrate", desc: "page views / cliques", meta: 78, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Conversão", key: "convrate", desc: "conversões / page views", meta: 8.2, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Compra", key: "buyerate", desc: "conversões / leads", meta: 3.2, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  },
  'Vendas': {
    title: 'ANÁLISE DE VENDAS',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 30000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 900000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 6000, format: "Número", rule: "Maior é melhor" },
        { name: "Oportunidades", key: "views", desc: "leads qualificados no comercial", meta: 900, format: "Número", rule: "Maior é melhor" },
        { name: "Vendas", key: "convs", desc: "negócios fechados", meta: 120, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 30, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 5, format: "Moeda", rule: "Menor é melhor" },
        { name: "Custo por Oportunidade", key: "cppv", desc: "custo por oportunidade gerada", meta: 33, format: "Moeda", rule: "Menor é melhor" },
        { name: "CAC", key: "cpa", desc: "custo de aquisição de cliente", meta: 250, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.2, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Oportunidade", key: "pvrate", desc: "oportunidades / cliques", meta: 15, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Fechamento", key: "convrate", desc: "vendas / oportunidades", meta: 13, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Recompra", key: "buyerate", desc: "clientes que voltaram a comprar", meta: 18, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  },
  'Download de aplicativo': {
    title: 'ANÁLISE DE DOWNLOAD DE APLICATIVO',
    rows: [
      { name: "Funil principal", metrics: [
        { name: "Valor investido", key: "invest", desc: "total no período", meta: 24000, format: "Moeda", rule: "Menor é melhor" },
        { name: "Impressões", key: "impress", desc: "exibições totais", meta: 950000, format: "Número", rule: "Maior é melhor" },
        { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 6200, format: "Número", rule: "Maior é melhor" },
        { name: "Acessos à loja", key: "views", desc: "abriram a página da loja", meta: 4900, format: "Número", rule: "Maior é melhor" },
        { name: "Instalações", key: "convs", desc: "app instalado", meta: 320, format: "Número", rule: "Maior é melhor" }
      ]},
      { name: "Custos de aquisição", metrics: [
        { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 26, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPC", key: "cpc", desc: "custo por clique", meta: 4.8, format: "Moeda", rule: "Menor é melhor" },
        { name: "Custo por Acesso à Loja", key: "cppv", desc: "custo por acesso à página", meta: 5, format: "Moeda", rule: "Menor é melhor" },
        { name: "CPI", key: "cpa", desc: "custo por instalação", meta: 75, format: "Moeda", rule: "Menor é melhor" }
      ]},
      { name: "Eficiência", metrics: [
        { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.15, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Acesso à Loja", key: "pvrate", desc: "acessos / cliques", meta: 79, format: "Percentual", rule: "Maior é melhor" },
        { name: "Taxa de Instalação", key: "convrate", desc: "instalações / acessos", meta: 7, format: "Percentual", rule: "Maior é melhor" },
        { name: "Retenção D7", key: "buyerate", desc: "usuários ativos após 7 dias", meta: 35, format: "Percentual", rule: "Maior é melhor" }
      ]}
    ]
  }
};

function matchKnownMatrixTemplate(analysisName) {
  if (ANALYSIS_MATRIX_TEMPLATES[analysisName]) return ANALYSIS_MATRIX_TEMPLATES[analysisName];

  // Correspondência por palavra-chave, pra continuar funcionando mesmo se a aba for renomeada
  const name = (analysisName || '').toLowerCase();
  if (name.includes('conversão') || name.includes('conversao')) return ANALYSIS_MATRIX_TEMPLATES['Conversão'];
  if (name.includes('video')) return ANALYSIS_MATRIX_TEMPLATES['VideoView'];
  if (name.includes('whatsapp') || name.includes('whats')) return ANALYSIS_MATRIX_TEMPLATES['Captação WhatsApp'];
  if (name.includes('facebook') || name.includes('fb ') || name.includes('fbleads')) return ANALYSIS_MATRIX_TEMPLATES['Captação FB Leads'];
  if (name.includes('pesquisa') || name.includes('busca') || name.includes('search')) return ANALYSIS_MATRIX_TEMPLATES['Pesquisa'];
  if (name.includes('venda')) return ANALYSIS_MATRIX_TEMPLATES['Vendas'];
  if (name.includes('download') || name.includes('aplicativo') || name.includes('app')) return ANALYSIS_MATRIX_TEMPLATES['Download de aplicativo'];

  return null;
}

// Estrutura em branco usada por abas personalizadas/novas que não
// correspondem a nenhum canal conhecido — ex: "Personalizado" ou qualquer aba
// criada via "+ Nova análise". Usa os mesmos rótulos e keys da Conversão como
// ponto de partida, com value vazio — igual métrica adicionada pelo catálogo
// (addMetricToActiveRow) — pra puxar os dados reais de campanha pela key em
// vez de ficar travada num "0" fixo (renderConversaoMatrix só usa a key/dado
// dinâmico quando value está vazio).
function buildBlankMatrixRows() {
  const base = JSON.parse(JSON.stringify(ANALYSIS_MATRIX_TEMPLATES['Conversão'].rows));
  base.forEach(row => {
    row.metrics.forEach(m => {
      m.value = '';
    });
  });
  return base;
}

function getAnalysisMatrixTemplate(analysisName) {
  const known = matchKnownMatrixTemplate(analysisName);
  if (known) {
    return { title: known.title, rows: known.rows, isCustom: false };
  }
  return {
    title: `ANÁLISE DE ${(analysisName || '').toUpperCase()}`,
    rows: buildBlankMatrixRows(),
    isCustom: true
  };
}

// Persistência da estrutura (linhas/métricas) por cliente + aba de análise no Supabase
async function loadMatrixStructure(clientSlug, analysisId) {
  if (!clientSlug || !analysisId) return null;
  const { data, error } = await supabaseClient
    .from('analysis_matrix_structures')
    .select('rows')
    .eq('client_slug', clientSlug)
    .eq('analysis_id', analysisId)
    .maybeSingle();
  if (error) {
    console.error('Erro ao carregar estrutura da análise', error);
    return null;
  }
  return data ? data.rows : null;
}

async function saveMatrixStructure(clientSlug, analysisId, rows) {
  if (!clientSlug || !analysisId) return;
  const cleanRows = JSON.parse(JSON.stringify(rows));
  cleanRows.forEach(row => row.metrics.forEach(m => { delete m.isEditing; }));

  const { error } = await supabaseClient
    .from('analysis_matrix_structures')
    .upsert(
      { client_slug: clientSlug, analysis_id: analysisId, rows: cleanRows, updated_at: new Date().toISOString() },
      { onConflict: 'client_slug,analysis_id' }
    );
  if (error) console.error('Erro ao salvar estrutura da análise', error);
}

// ==========================================================================
// AÇÕES POR MÉTRICA: editar meta / comentário do analista
// (só na matriz de métricas das análises)
// ==========================================================================
// Tudo guardado direto no próprio objeto da métrica (metric.meta,
// metric.comment), dentro da MESMA estrutura JSON já persistida por
// saveMatrixStructure — sem tabela nova. O ⋮ de cada célula abre um menu
// com as duas ações; o 💬 só aparece quando já existe comentário (atalho
// pra abrir direto sem passar pelo menu).
let activeMetricTarget = null; // { rowIndex, metricIndex }
let activeMetricRect = null;   // posição do controle clicado, pra ancorar o popover/menu seguinte

function positionFloatingPanel(panel, width) {
  if (!activeMetricRect) return;
  const left0 = activeMetricRect.left + (activeMetricRect.width / 2) - (width / 2);
  const left = Math.max(8, Math.min(left0, window.innerWidth - width - 8));
  panel.style.top = `${activeMetricRect.bottom + 6}px`;
  panel.style.left = `${left}px`;
}

function openMetricActionsMenu(event, rowIndex, metricIndex) {
  event.stopPropagation();
  activeMetricTarget = { rowIndex, metricIndex };
  activeMetricRect = event.currentTarget.getBoundingClientRect();
  closeMetricCommentPopover();
  closeMetricMetaPopover();

  const menu = document.getElementById('metric-actions-menu');
  const commentItem = document.getElementById('metric-actions-comment-item');
  if (!menu || !commentItem) return;

  const metric = conversaoRows[rowIndex].metrics[metricIndex];
  commentItem.innerText = metric.comment ? 'Editar comentário' : 'Adicionar comentário';

  menu.style.display = 'flex';
  positionFloatingPanel(menu, 170);
}

function closeMetricActionsMenu() {
  const menu = document.getElementById('metric-actions-menu');
  if (menu) menu.style.display = 'none';
}

function openMetricMetaPopoverFromMenu() {
  closeMetricActionsMenu();
  if (!activeMetricTarget) return;
  const { rowIndex, metricIndex } = activeMetricTarget;
  const metric = conversaoRows[rowIndex].metrics[metricIndex];

  const popover = document.getElementById('metric-meta-popover');
  const input = document.getElementById('metric-meta-input');
  if (!popover || !input) return;

  input.value = (metric.meta !== undefined && metric.meta !== null) ? metric.meta : '';
  popover.style.display = 'block';
  positionFloatingPanel(popover, 220);
  input.focus();
}

function closeMetricMetaPopover() {
  const popover = document.getElementById('metric-meta-popover');
  if (popover) popover.style.display = 'none';
}

function saveMetricMeta() {
  if (!activeMetricTarget) return;
  const { rowIndex, metricIndex } = activeMetricTarget;
  const raw = document.getElementById('metric-meta-input').value.trim();

  if (raw) {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!isNaN(parsed)) conversaoRows[rowIndex].metrics[metricIndex].meta = parsed;
  } else {
    delete conversaoRows[rowIndex].metrics[metricIndex].meta;
  }

  saveMatrixStructure(clientSlugFromName(currentClient), currentAnalysisId, conversaoRows);
  closeMetricMetaPopover();
  updateConversaoMetrics();
}

function openMetricCommentPopoverFromMenu() {
  closeMetricActionsMenu();
  openMetricCommentPopoverCore();
}

// Clique direto no badge 💬 (atalho quando a métrica já tem comentário).
function openMetricCommentPopoverDirect(event, rowIndex, metricIndex) {
  event.stopPropagation();
  activeMetricTarget = { rowIndex, metricIndex };
  activeMetricRect = event.currentTarget.getBoundingClientRect();
  closeMetricActionsMenu();
  openMetricCommentPopoverCore();
}

function openMetricCommentPopoverCore() {
  if (!activeMetricTarget) return;
  const { rowIndex, metricIndex } = activeMetricTarget;
  const metric = conversaoRows[rowIndex].metrics[metricIndex];

  const popover = document.getElementById('metric-comment-popover');
  const input = document.getElementById('metric-comment-input');
  const removeBtn = document.getElementById('metric-comment-remove');
  if (!popover || !input || !removeBtn) return;

  input.value = metric.comment || '';
  removeBtn.style.display = metric.comment ? 'inline' : 'none';
  popover.style.display = 'block';
  positionFloatingPanel(popover, 260);
  input.focus();
}

function closeMetricCommentPopover() {
  const popover = document.getElementById('metric-comment-popover');
  if (popover) popover.style.display = 'none';
}

function saveMetricComment() {
  if (!activeMetricTarget) return;
  const { rowIndex, metricIndex } = activeMetricTarget;
  const text = document.getElementById('metric-comment-input').value.trim();

  if (text) conversaoRows[rowIndex].metrics[metricIndex].comment = text;
  else delete conversaoRows[rowIndex].metrics[metricIndex].comment;

  saveMatrixStructure(clientSlugFromName(currentClient), currentAnalysisId, conversaoRows);
  closeMetricCommentPopover();
  updateConversaoMetrics();
}

function removeMetricComment() {
  if (!activeMetricTarget) return;
  const { rowIndex, metricIndex } = activeMetricTarget;
  delete conversaoRows[rowIndex].metrics[metricIndex].comment;

  saveMatrixStructure(clientSlugFromName(currentClient), currentAnalysisId, conversaoRows);
  closeMetricCommentPopover();
  updateConversaoMetrics();
}

document.addEventListener('click', function(event) {
  const menu = document.getElementById('metric-actions-menu');
  if (menu && menu.style.display !== 'none' && !menu.contains(event.target) && !event.target.classList.contains('metric-actions-icon')) {
    closeMetricActionsMenu();
  }
  const metaPopover = document.getElementById('metric-meta-popover');
  if (metaPopover && metaPopover.style.display !== 'none' && !metaPopover.contains(event.target) && !event.target.classList.contains('metric-actions-icon')) {
    closeMetricMetaPopover();
  }
  const commentPopover = document.getElementById('metric-comment-popover');
  if (commentPopover && commentPopover.style.display !== 'none' && !commentPopover.contains(event.target) && !event.target.classList.contains('metric-actions-icon') && !event.target.classList.contains('metric-comment-icon')) {
    closeMetricCommentPopover();
  }
});

// Fator determinístico que diferencia os números de cada aba (Conversão = 100% do
// tráfego do cliente; as demais abas representam uma fatia plausível e estável dele).
function getAnalysisFactor(analysisName) {
  if (analysisName === 'Conversão') return 1;
  let hash = 0;
  for (let i = 0; i < analysisName.length; i++) hash += analysisName.charCodeAt(i);
  return 0.35 + (hash % 40) / 100;
}

// Estado Global do Construtor de Análise de Conversão
let conversaoRows = [
  {
    name: "Funil principal",
    metrics: [
      { name: "Valor investido", key: "invest", desc: "total no período", meta: 30000, format: "Moeda", rule: "Menor é melhor", value: "" },
      { name: "Impressões", key: "impress", desc: "exibições totais", meta: 900000, format: "Número", rule: "Maior é melhor", value: "" },
      { name: "Cliques", key: "clicks", desc: "no anúncio", meta: 6000, format: "Número", rule: "Maior é melhor", value: "" },
      { name: "Page View", key: "views", desc: "visualizações de página", meta: 4800, format: "Número", rule: "Maior é melhor", value: "" },
      { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 400, format: "Número", rule: "Maior é melhor", value: "" }
    ]
  },
  {
    name: "Custos de aquisição",
    metrics: [
      { name: "CPM", key: "cpm", desc: "custo por mil impressões", meta: 30, format: "Moeda", rule: "Menor é melhor", value: "" },
      { name: "CPC", key: "cpc", desc: "custo por clique", meta: 5, format: "Moeda", rule: "Menor é melhor", value: "" },
      { name: "Custo por Page View", key: "cppv", desc: "custo por visualização", meta: 6, format: "Moeda", rule: "Menor é melhor", value: "" },
      { name: "CPA", key: "cpa", desc: "CPA de conversão", meta: 80, format: "Moeda", rule: "Menor é melhor", value: "" }
    ]
  },
  {
    name: "Eficiência",
    metrics: [
      { name: "CTR", key: "ctr", desc: "cliques / impressões", meta: 1.2, format: "Percentual", rule: "Maior é melhor", value: "" },
      { name: "Taxa de Page View", key: "pvrate", desc: "page views / cliques", meta: 80, format: "Percentual", rule: "Maior é melhor", value: "" },
      { name: "Taxa de Conversão", key: "convrate", desc: "conversões / page views", meta: 8, format: "Percentual", rule: "Maior é melhor", value: "" },
      { name: "Taxa de Compra", key: "buyerate", desc: "conversões / leads", meta: 3, format: "Percentual", rule: "Maior é melhor", value: "" }
    ]
  }
];

// Metas de Conversão Padrão (Compatibilidade)
let currentMetas = {
  invest: 30000,
  impress: 900000,
  clicks: 6000,
  views: 4800,
  convs: 400,
  cpm: 30.00,
  cpc: 5.00,
  cppv: 6.00,
  cpa: 80.00,
  ctr: 1.2,
  pvrate: 80.0,
  convrate: 8.0,
  buyerate: 3.0
};

// Variáveis de Controle dos Modais
let tempRows = [];
let activeCatalogRowIndex = -1;

function toggleConvMenu(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('conv-three-point-dropdown');
  if (dropdown) {
    const isShowing = dropdown.style.display === 'flex';
    dropdown.style.display = isShowing ? 'none' : 'flex';
  }
}

// Modal de Metas (Legado / Compatibilidade)
function openMetasModal(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('conv-three-point-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  
  // Sincroniza metas atuais a partir do estado global das métricas, se existirem
  conversaoRows.forEach(row => {
    row.metrics.forEach(m => {
      if (m.key && currentMetas.hasOwnProperty(m.key)) {
        currentMetas[m.key] = m.meta;
      }
    });
  });

  document.getElementById('input-meta-invest').value = currentMetas.invest;
  document.getElementById('input-meta-impress').value = currentMetas.impress;
  document.getElementById('input-meta-clicks').value = currentMetas.clicks;
  document.getElementById('input-meta-views').value = currentMetas.views;
  document.getElementById('input-meta-convs').value = currentMetas.convs;
  document.getElementById('input-meta-cpm').value = currentMetas.cpm;
  document.getElementById('input-meta-cpc').value = currentMetas.cpc;
  document.getElementById('input-meta-cppv').value = currentMetas.cppv;
  document.getElementById('input-meta-cpa').value = currentMetas.cpa;
  document.getElementById('input-meta-ctr').value = currentMetas.ctr;
  document.getElementById('input-meta-pvrate').value = currentMetas.pvrate;
  document.getElementById('input-meta-convrate').value = currentMetas.convrate;
  document.getElementById('input-meta-buyerate').value = currentMetas.buyerate;
  
  const modal = document.getElementById('metas-modal');
  if (modal) modal.style.display = 'flex';
}

function closeMetasModal() {
  const modal = document.getElementById('metas-modal');
  if (modal) modal.style.display = 'none';
}

function saveMetasForm() {
  currentMetas.invest = parseFloat(document.getElementById('input-meta-invest').value) || 0;
  currentMetas.impress = parseInt(document.getElementById('input-meta-impress').value) || 0;
  currentMetas.clicks = parseInt(document.getElementById('input-meta-clicks').value) || 0;
  currentMetas.views = parseInt(document.getElementById('input-meta-views').value) || 0;
  currentMetas.convs = parseInt(document.getElementById('input-meta-convs').value) || 0;
  currentMetas.cpm = parseFloat(document.getElementById('input-meta-cpm').value) || 0;
  currentMetas.cpc = parseFloat(document.getElementById('input-meta-cpc').value) || 0;
  currentMetas.cppv = parseFloat(document.getElementById('input-meta-cppv').value) || 0;
  currentMetas.cpa = parseFloat(document.getElementById('input-meta-cpa').value) || 0;
  currentMetas.ctr = parseFloat(document.getElementById('input-meta-ctr').value) || 0;
  currentMetas.pvrate = parseFloat(document.getElementById('input-meta-pvrate').value) || 0;
  currentMetas.convrate = parseFloat(document.getElementById('input-meta-convrate').value) || 0;
  currentMetas.buyerate = parseFloat(document.getElementById('input-meta-buyerate').value) || 0;
  
  // Atualiza as metas de volta para o estado global
  conversaoRows.forEach(row => {
    row.metrics.forEach(m => {
      if (m.key && currentMetas.hasOwnProperty(m.key)) {
        m.meta = currentMetas[m.key];
      }
    });
  });

  closeMetasModal();
  updateConversaoMetrics();
  showToast("Metas de conversão atualizadas com sucesso!");
}

// LÓGICA DO CONSTRUTOR DE ESTRUTURA DILIGENTE

function openEstruturaModal(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('conv-three-point-dropdown');
  if (dropdown) dropdown.style.display = 'none';

  // Clone profundo do estado global para evitar modificação direta
  tempRows = JSON.parse(JSON.stringify(conversaoRows));
  
  // Reseta estado de edição
  tempRows.forEach(row => {
    row.metrics.forEach(m => m.isEditing = false);
  });

  renderEditRows();

  const modal = document.getElementById('estrutura-modal');
  if (modal) modal.style.display = 'flex';
}

function closeEstruturaModal() {
  const modal = document.getElementById('estrutura-modal');
  if (modal) modal.style.display = 'none';
}

// Arrastar métricas no editor de estrutura (substitui os antigos botões
// ←/→): draggedMetric guarda de onde a métrica saiu, metricDropTarget guarda
// em cima de qual chip ela está pairando agora (e de que lado), pra permitir
// reordenar dentro da mesma linha OU mover pra outra linha.
let draggedMetric = null;
let metricDropTarget = null;

function clearMetricDropIndicators() {
  document.querySelectorAll('.metric-chip-edit').forEach(el => {
    el.style.boxShadow = '';
  });
}

function handleMetricDrop(targetRowIndex) {
  if (!draggedMetric) return;

  const { rowIndex: fromRowIndex, metricIndex: fromMetricIndex } = draggedMetric;
  const sourceRow = tempRows[fromRowIndex];
  const targetRow = tempRows[targetRowIndex];

  if (targetRow !== sourceRow && targetRow.metrics.length >= 6) {
    showToast('Essa linha já está no limite de 6 métricas.');
    draggedMetric = null;
    metricDropTarget = null;
    clearMetricDropIndicators();
    return;
  }

  // Calcula o índice de destino com base nos índices ANTES de remover a
  // métrica de origem, ajustando depois — evita off-by-one quando a solta é
  // dentro da própria linha.
  let insertIndex = (metricDropTarget && metricDropTarget.rowIndex === targetRowIndex)
    ? metricDropTarget.metricIndex + (metricDropTarget.isAfter ? 1 : 0)
    : targetRow.metrics.length;

  const [movedMetric] = sourceRow.metrics.splice(fromMetricIndex, 1);

  if (sourceRow === targetRow && fromMetricIndex < insertIndex) {
    insertIndex -= 1;
  }

  targetRow.metrics.splice(insertIndex, 0, movedMetric);

  draggedMetric = null;
  metricDropTarget = null;
  renderEditRows();
}

function renderEditRows() {
  const container = document.getElementById('edit-rows-container');
  if (!container) return;
  container.innerHTML = '';

  tempRows.forEach((row, rowIndex) => {
    const card = document.createElement('div');
    card.className = 'row-edit-card';

    // Cabeçalho da Linha de Edição
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '10px';
    left.style.flexGrow = '1';

    const rowLabel = document.createElement('label');
    rowLabel.style.fontSize = '10px';
    rowLabel.style.fontWeight = '700';
    rowLabel.style.color = 'var(--text-secondary)';
    rowLabel.innerText = 'NOME DA LINHA:';

    const rowInput = document.createElement('input');
    rowInput.type = 'text';
    rowInput.value = row.name;
    rowInput.className = 'filter-select';
    rowInput.style.fontSize = '11px';
    rowInput.style.height = '28px';
    rowInput.style.width = '240px';
    rowInput.style.padding = '0 8px';
    rowInput.style.backgroundColor = 'var(--bg-app)';
    rowInput.oninput = (e) => {
      row.name = e.target.value;
    };

    left.appendChild(rowLabel);
    left.appendChild(rowInput);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'colab-btn-suspend';
    deleteBtn.style.height = '28px';
    deleteBtn.style.padding = '0 12px';
    deleteBtn.style.fontSize = '10px';
    deleteBtn.innerText = 'Remover Linha';
    deleteBtn.onclick = () => {
      tempRows.splice(rowIndex, 1);
      renderEditRows();
    };

    header.appendChild(left);
    header.appendChild(deleteBtn);
    card.appendChild(header);

    // Listagem de Métricas
    const metricsWrapper = document.createElement('div');
    metricsWrapper.style.display = 'flex';
    metricsWrapper.style.flexWrap = 'wrap';
    metricsWrapper.style.gap = '8px';
    metricsWrapper.style.marginTop = '12px';
    metricsWrapper.style.alignItems = 'center';

    // Solta a métrica arrastada nesta linha (espaço vazio entre/depois dos
    // chips, ou a própria linha se ela ainda não tiver nenhuma métrica).
    metricsWrapper.ondragover = (e) => {
      if (!draggedMetric) return;
      e.preventDefault();
      metricDropTarget = null;
      clearMetricDropIndicators();
    };
    metricsWrapper.ondrop = (e) => {
      e.preventDefault();
      handleMetricDrop(rowIndex);
    };

    row.metrics.forEach((metric, metricIndex) => {
      const chip = document.createElement('div');
      chip.className = 'metric-chip-edit';
      chip.draggable = true;
      chip.style.cursor = 'grab';
      if (metric.isEditing) {
        chip.style.borderColor = '#8b5cf6';
        chip.style.backgroundColor = 'rgba(139, 92, 246, 0.05)';
      }

      chip.ondragstart = (e) => {
        e.stopPropagation();
        draggedMetric = { rowIndex, metricIndex };
        e.dataTransfer.effectAllowed = 'move';
        chip.classList.add('dragging');
      };
      chip.ondragend = () => {
        chip.classList.remove('dragging');
        draggedMetric = null;
        metricDropTarget = null;
        clearMetricDropIndicators();
      };
      chip.ondragover = (e) => {
        if (!draggedMetric) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = chip.getBoundingClientRect();
        const isAfter = (e.clientX - rect.left) > rect.width / 2;
        metricDropTarget = { rowIndex, metricIndex, isAfter };
        clearMetricDropIndicators();
        chip.style.boxShadow = isAfter ? 'inset -3px 0 0 0 #8b5cf6' : 'inset 3px 0 0 0 #8b5cf6';
      };
      chip.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleMetricDrop(rowIndex);
      };

      const dragHandle = document.createElement('span');
      dragHandle.innerText = '⠿';
      dragHandle.title = 'Arraste para reordenar ou mover para outra linha';
      dragHandle.style.color = 'var(--text-muted)';
      dragHandle.style.fontSize = '12px';
      dragHandle.style.marginRight = '2px';
      chip.appendChild(dragHandle);

      const nameSpan = document.createElement('span');
      nameSpan.innerText = metric.name;
      nameSpan.style.fontSize = '11px';
      nameSpan.style.fontWeight = '600';
      nameSpan.style.color = 'var(--text-primary)';
      chip.appendChild(nameSpan);

      // Ações rápidas da métrica
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '4px';

      // Editar Detalhes
      const editBtn = document.createElement('button');
      editBtn.className = 'colab-btn-edit';
      editBtn.style.padding = '2px 8px';
      editBtn.style.fontSize = '9px';
      editBtn.innerText = '⚙️';
      editBtn.title = 'Editar Detalhes';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        // Toggle editing this metric
        const prevEditingState = metric.isEditing;
        // Close other metric forms in this row
        row.metrics.forEach(m => m.isEditing = false);
        metric.isEditing = !prevEditingState;
        renderEditRows();
      };

      // Remover Métrica
      const removeBtn = document.createElement('button');
      removeBtn.className = 'colab-btn-suspend';
      removeBtn.style.padding = '2px 6px';
      removeBtn.style.fontSize = '9px';
      removeBtn.innerText = '×';
      removeBtn.title = 'Remover Métrica';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        row.metrics.splice(metricIndex, 1);
        renderEditRows();
      };

      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);
      chip.appendChild(actions);

      metricsWrapper.appendChild(chip);
    });

    // Botão Adicionar Métrica na Linha
    if (row.metrics.length < 6) {
      const addMetricBtn = document.createElement('button');
      addMetricBtn.className = 'colab-btn-edit';
      addMetricBtn.style.padding = '8px 12px';
      addMetricBtn.style.fontSize = '11px';
      addMetricBtn.style.borderStyle = 'dashed';
      addMetricBtn.innerText = '+ Adicionar Métrica';
      addMetricBtn.onclick = () => {
        openCatalogoModalFor(rowIndex);
      };
      metricsWrapper.appendChild(addMetricBtn);
    } else {
      const limitLabel = document.createElement('span');
      limitLabel.style.fontSize = '9px';
      limitLabel.style.color = 'var(--text-muted)';
      limitLabel.style.marginLeft = '8px';
      limitLabel.innerText = 'Máximo de 6 alcançado';
      metricsWrapper.appendChild(limitLabel);
    }

    card.appendChild(metricsWrapper);

    // Formulário de Edição da Métrica (Renderizado se isEditing for true)
    row.metrics.forEach((metric, metricIndex) => {
      if (metric.isEditing) {
        const form = document.createElement('div');
        form.style.marginTop = '12px';
        form.style.padding = '14px';
        form.style.backgroundColor = 'var(--bg-app)';
        form.style.border = '1px solid var(--border-color)';
        form.style.borderRadius = 'var(--border-radius-sm)';
        form.style.display = 'grid';
        form.style.gridTemplateColumns = '1fr 1fr';
        form.style.gap = '12px';
        form.style.textAlign = 'left';

        // Linha 1: Nome e Valor
        const nameGroup = document.createElement('div');
        nameGroup.style.display = 'flex';
        nameGroup.style.flexDirection = 'column';
        nameGroup.style.gap = '4px';
        nameGroup.innerHTML = `<label style="font-size: 10px; color: var(--text-secondary);">Nome da métrica</label>`;
        const nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.className = 'filter-select';
        nameIn.style.fontSize = '11px';
        nameIn.style.height = '28px';
        nameIn.value = metric.name;
        nameIn.oninput = (e) => { metric.name = e.target.value; renderEditRows(); };
        nameGroup.appendChild(nameIn);

        const valGroup = document.createElement('div');
        valGroup.style.display = 'flex';
        valGroup.style.flexDirection = 'column';
        valGroup.style.gap = '4px';
        valGroup.innerHTML = `<label style="font-size: 10px; color: var(--text-secondary);">Valor customizado (opcional)</label>`;
        const valIn = document.createElement('input');
        valIn.type = 'text';
        valIn.className = 'filter-select';
        valIn.style.fontSize = '11px';
        valIn.style.height = '28px';
        valIn.placeholder = 'Deixe em branco para auto-calcular';
        valIn.value = metric.value || '';
        valIn.oninput = (e) => { metric.value = e.target.value; };
        valGroup.appendChild(valIn);

        // Linha 2: Descrição e Meta
        const descGroup = document.createElement('div');
        descGroup.style.display = 'flex';
        descGroup.style.flexDirection = 'column';
        descGroup.style.gap = '4px';
        descGroup.innerHTML = `<label style="font-size: 10px; color: var(--text-secondary);">Descrição curta</label>`;
        const descIn = document.createElement('input');
        descIn.type = 'text';
        descIn.className = 'filter-select';
        descIn.style.fontSize = '11px';
        descIn.style.height = '28px';
        descIn.value = metric.desc || '';
        descIn.oninput = (e) => { metric.desc = e.target.value; };
        descGroup.appendChild(descIn);

        const metaGroup = document.createElement('div');
        metaGroup.style.display = 'flex';
        metaGroup.style.flexDirection = 'column';
        metaGroup.style.gap = '4px';
        metaGroup.innerHTML = `<label style="font-size: 10px; color: var(--text-secondary);">Meta</label>`;
        const metaIn = document.createElement('input');
        metaIn.type = 'text';
        metaIn.className = 'filter-select';
        metaIn.style.fontSize = '11px';
        metaIn.style.height = '28px';
        metaIn.value = metric.meta || '';
        metaIn.oninput = (e) => { metric.meta = e.target.value; };
        metaGroup.appendChild(metaIn);

        // Linha 3: Formato e Comportamento
        const formatGroup = document.createElement('div');
        formatGroup.style.display = 'flex';
        formatGroup.style.flexDirection = 'column';
        formatGroup.style.gap = '4px';
        formatGroup.innerHTML = `<label style="font-size: 10px; color: var(--text-secondary);">Formato</label>`;
        const formatSel = document.createElement('select');
        formatSel.className = 'filter-select';
        formatSel.style.fontSize = '11px';
        formatSel.style.height = '28px';
        ['Número', 'Moeda', 'Percentual', 'Texto'].forEach(opt => {
          const option = document.createElement('option');
          option.value = opt;
          option.innerText = opt;
          option.selected = metric.format === opt;
          formatSel.appendChild(option);
        });
        formatSel.onchange = (e) => { metric.format = e.target.value; };
        formatGroup.appendChild(formatSel);

        const ruleGroup = document.createElement('div');
        ruleGroup.style.display = 'flex';
        ruleGroup.style.flexDirection = 'column';
        ruleGroup.style.gap = '4px';
        ruleGroup.innerHTML = `<label style="font-size: 10px; color: var(--text-secondary);">Comportamento da meta</label>`;
        const ruleSel = document.createElement('select');
        ruleSel.className = 'filter-select';
        ruleSel.style.fontSize = '11px';
        ruleSel.style.height = '28px';
        ['Maior é melhor', 'Menor é melhor', 'Igual ou próximo é melhor', 'Apenas referência'].forEach(opt => {
          const option = document.createElement('option');
          option.value = opt;
          option.innerText = opt;
          option.selected = metric.rule === opt;
          ruleSel.appendChild(option);
        });
        ruleSel.onchange = (e) => { metric.rule = e.target.value; };
        ruleGroup.appendChild(ruleSel);

        form.appendChild(nameGroup);
        form.appendChild(valGroup);
        form.appendChild(descGroup);
        form.appendChild(metaGroup);
        form.appendChild(formatGroup);
        form.appendChild(ruleGroup);
        card.appendChild(form);
      }
    });

    container.appendChild(card);
  });
}

function addNewRowToEdit() {
  tempRows.push({
    name: "Nova linha",
    metrics: []
  });
  renderEditRows();
}

function saveEstruturaChanges() {
  // Salva no estado global
  conversaoRows = JSON.parse(JSON.stringify(tempRows));
  closeEstruturaModal();
  updateConversaoMetrics();
  saveMatrixStructure(clientSlugFromName(currentClient), currentAnalysisId, conversaoRows);
  showToast("Estrutura da análise atualizada!");
}

// LÓGICA DO CATÁLOGO DE MÉTRICAS

function openCatalogoModalFor(rowIndex) {
  activeCatalogRowIndex = rowIndex;
  document.getElementById('catalogo-search-input').value = '';
  renderCatalogoList();
  
  const modal = document.getElementById('catalogo-modal');
  if (modal) modal.style.display = 'flex';
}

function closeCatalogoModal() {
  const modal = document.getElementById('catalogo-modal');
  if (modal) modal.style.display = 'none';
}

const catalogMetricsByCategory = {
  "Mídia / Performance": [
    { name: "Investimento", key: "invest", format: "Moeda", rule: "Menor é melhor", desc: "total no período", defaultMeta: 30000 },
    { name: "Impressões", key: "impress", format: "Número", rule: "Maior é melhor", desc: "exibições totais", defaultMeta: 900000 },
    { name: "Alcance", key: "impress", format: "Número", rule: "Maior é melhor", desc: "pessoas únicas alcançadas", defaultMeta: 500000 },
    { name: "Frequência", key: "", format: "Número", rule: "Apenas referência", desc: "repetição média", defaultMeta: 2.5, defaultValue: "1.8" },
    { name: "Cliques", key: "clicks", format: "Número", rule: "Maior é melhor", desc: "no anúncio", defaultMeta: 6000 },
    { name: "Cliques no link", key: "clicks", format: "Número", rule: "Maior é melhor", desc: "cliques de destino", defaultMeta: 5500 },
    { name: "CTR", key: "ctr", format: "Percentual", rule: "Maior é melhor", desc: "cliques / impressões", defaultMeta: 1.2 },
    { name: "CPC", key: "cpc", format: "Moeda", rule: "Menor é melhor", desc: "custo por clique", defaultMeta: 5.00 },
    { name: "CPM", key: "cpm", format: "Moeda", rule: "Menor é melhor", desc: "custo por mil impressões", defaultMeta: 30.00 },
    { name: "Leads", key: "convs", format: "Número", rule: "Maior é melhor", desc: "leads gerados", defaultMeta: 400 },
    { name: "CPL", key: "cpa", format: "Moeda", rule: "Menor é melhor", desc: "custo por lead", defaultMeta: 80.00 },
    { name: "Conversões", key: "convs", format: "Número", rule: "Maior é melhor", desc: "ações realizadas", defaultMeta: 400 },
    { name: "CPA", key: "cpa", format: "Moeda", rule: "Menor é melhor", desc: "CPA de conversão", defaultMeta: 80.00 },
    { name: "Custo por conversão", key: "cpa", format: "Moeda", rule: "Menor é melhor", desc: "CPA de conversão", defaultMeta: 80.00 },
    { name: "Page View", key: "views", format: "Número", rule: "Maior é melhor", desc: "visualizações de página", defaultMeta: 4800 },
    { name: "Custo por Page View", key: "cppv", format: "Moeda", rule: "Menor é melhor", desc: "custo por visualização", defaultMeta: 6.00 },
    { name: "Taxa de Page View", key: "pvrate", format: "Percentual", rule: "Maior é melhor", desc: "page views / cliques", defaultMeta: 80.0 },
    { name: "Taxa de Conversão", key: "convrate", format: "Percentual", rule: "Maior é melhor", desc: "conversões / page views", defaultMeta: 8.0 },
    { name: "Taxa de Compra", key: "buyerate", format: "Percentual", rule: "Maior é melhor", desc: "conversões / leads", defaultMeta: 3.0 },
    { name: "Compras", key: "sales", format: "Número", rule: "Maior é melhor", desc: "compras concluídas", defaultMeta: 100 },
    { name: "Custo por compra", key: "", format: "Moeda", rule: "Menor é melhor", desc: "investimento / compras", defaultMeta: 250, defaultValue: "R$280,00" },
    { name: "ROAS", key: "", format: "Texto", rule: "Maior é melhor", desc: "retorno sobre investimento", defaultMeta: 4.0, defaultValue: "3.5x" },
    { name: "ROI", key: "", format: "Percentual", rule: "Maior é melhor", desc: "retorno de investimento", defaultMeta: 350, defaultValue: "350%" }
  ],
  "WhatsApp": [
    { name: "Cliques para WhatsApp", key: "", format: "Número", rule: "Maior é melhor", desc: "cliques de conversão", defaultMeta: 1000, defaultValue: "850" },
    { name: "Mensagens iniciadas", key: "", format: "Número", rule: "Maior é melhor", desc: "mensagens enviadas", defaultMeta: 800, defaultValue: "640" },
    { name: "Custo por mensagem", key: "", format: "Moeda", rule: "Menor é melhor", desc: "investimento / mensagens", defaultMeta: 12.00, defaultValue: "R$15,30" },
    { name: "Taxa de mensagem iniciada", key: "", format: "Percentual", rule: "Maior é melhor", desc: "mensagens / cliques", defaultMeta: 80.0, defaultValue: "75.3%" },
    { name: "Conversas iniciadas", key: "", format: "Número", rule: "Maior é melhor", desc: "conversas de chat", defaultMeta: 700, defaultValue: "550" },
    { name: "Custo por conversa", key: "", format: "Moeda", rule: "Menor é melhor", desc: "investimento / conversas", defaultMeta: 15.00, defaultValue: "R$18,20" }
  ],
  "Lead Forms / Facebook Leads": [
    { name: "Formulários enviados", key: "", format: "Número", rule: "Maior é melhor", desc: "respostas totais", defaultMeta: 500, defaultValue: "420" },
    { name: "Leads via formulário", key: "", format: "Número", rule: "Maior é melhor", desc: "leads qualificados", defaultMeta: 450, defaultValue: "380" },
    { name: "Custo por lead form", key: "", format: "Moeda", rule: "Menor é melhor", desc: "investimento / forms", defaultMeta: 40.00, defaultValue: "R$42,10" },
    { name: "Taxa de cadastro", key: "", format: "Percentual", rule: "Maior é melhor", desc: "respostas / impressões", defaultMeta: 1.5, defaultValue: "1.2%" },
    { name: "Cadastros iniciados", key: "", format: "Número", rule: "Maior é melhor", desc: "aberturas de form", defaultMeta: 1000, defaultValue: "920" },
    { name: "Cadastros concluídos", key: "", format: "Número", rule: "Maior é melhor", desc: "conclusões de form", defaultMeta: 500, defaultValue: "420" }
  ],
  "Vídeo": [
    { name: "Visualizações de 3 segundos", key: "", format: "Número", rule: "Maior é melhor", desc: "reproduções de vídeo", defaultMeta: 20000, defaultValue: "18.240" },
    { name: "Custo por visualização de 3 segundos", key: "", format: "Moeda", rule: "Menor é melhor", desc: "custo por view", defaultMeta: 0.15, defaultValue: "R$0,12" },
    { name: "ThruPlay", key: "", format: "Número", rule: "Maior é melhor", desc: "views completas ou 15s", defaultMeta: 8000, defaultValue: "6.300" },
    { name: "Custo por ThruPlay", key: "", format: "Moeda", rule: "Menor é melhor", desc: "custo por ThruPlay", defaultMeta: 0.80, defaultValue: "R$0,95" },
    { name: "Visualização 25%", key: "", format: "Número", rule: "Maior é melhor", desc: "retenção a 25%", defaultMeta: 15000, defaultValue: "13.400" },
    { name: "Visualização 50%", key: "", format: "Número", rule: "Maior é melhor", desc: "retenção a 50%", defaultMeta: 10000, defaultValue: "8.900" },
    { name: "Visualização 75%", key: "", format: "Número", rule: "Maior é melhor", desc: "retenção a 75%", defaultMeta: 6000, defaultValue: "4.850" },
    { name: "Visualização 100%", key: "", format: "Número", rule: "Maior é melhor", desc: "retenção completa", defaultMeta: 3000, defaultValue: "2.100" },
    { name: "Taxa de gancho", key: "", format: "Percentual", rule: "Maior é melhor", desc: "views 3s / impressões", defaultMeta: 35.0, defaultValue: "32.4%" },
    { name: "Taxa de retenção", key: "", format: "Percentual", rule: "Maior é melhor", desc: "views 100% / iniciadas", defaultMeta: 15.0, defaultValue: "11.5%" },
    { name: "CPV", key: "", format: "Moeda", rule: "Menor é melhor", desc: "custo por visualização", defaultMeta: 0.10, defaultValue: "R$0,08" }
  ],
  "Google / Pesquisa": [
    { name: "Impressões de pesquisa", key: "", format: "Número", rule: "Maior é melhor", desc: "exibições na busca", defaultMeta: 100000, defaultValue: "85.000" },
    { name: "Cliques de pesquisa", key: "", format: "Número", rule: "Maior é melhor", desc: "cliques de busca", defaultMeta: 8000, defaultValue: "7.100" },
    { name: "CTR de pesquisa", key: "", format: "Percentual", rule: "Maior é melhor", desc: "CTR na busca", defaultMeta: 8.0, defaultValue: "8.3%" },
    { name: "CPC de pesquisa", key: "", format: "Moeda", rule: "Menor é melhor", desc: "CPC médio na busca", defaultMeta: 4.50, defaultValue: "R$4.20" },
    { name: "Conversões de pesquisa", key: "", format: "Número", rule: "Maior é melhor", desc: "conversões de busca", defaultMeta: 300, defaultValue: "245" },
    { name: "CPA de pesquisa", key: "", format: "Moeda", rule: "Menor é melhor", desc: "CPA na busca", defaultMeta: 120.00, defaultValue: "R$135,00" },
    { name: "Parcela de impressão", key: "", format: "Percentual", rule: "Maior é melhor", desc: "share de impressões", defaultMeta: 80.0, defaultValue: "72.4%" },
    { name: "Taxa de conversão de pesquisa", key: "", format: "Percentual", rule: "Maior é melhor", desc: "CVR na busca", defaultMeta: 3.5, defaultValue: "3.1%" }
  ],
  "Comercial / CRM": [
    { name: "Leads recebidos", key: "", format: "Número", rule: "Maior é melhor", desc: "entradas no CRM", defaultMeta: 500, defaultValue: "420" },
    { name: "Leads atendidos", key: "", format: "Número", rule: "Maior é melhor", desc: "atendimentos iniciados", defaultMeta: 480, defaultValue: "410" },
    { name: "Leads qualificados", key: "", format: "Número", rule: "Maior é melhor", desc: "leads válidos", defaultMeta: 200, defaultValue: "168" },
    { name: "Leads descartados", key: "", format: "Número", rule: "Menor é melhor", desc: "leads perdidos/inválidos", defaultMeta: 100, defaultValue: "85" },
    { name: "Propostas", key: "", format: "Número", rule: "Maior é melhor", desc: "propostas enviadas", defaultMeta: 80, defaultValue: "62" },
    { name: "Vendas", key: "sales", format: "Número", rule: "Maior é melhor", desc: "fechamentos", defaultMeta: 30 },
    { name: "Taxa de qualificação", key: "", format: "Percentual", rule: "Maior é melhor", desc: "qualificados / total", defaultMeta: 45.0, defaultValue: "40.0%" },
    { name: "Taxa de proposta", key: "", format: "Percentual", rule: "Maior é melhor", desc: "propostas / qualificados", defaultMeta: 35.0, defaultValue: "36.9%" },
    { name: "Taxa de fechamento", key: "", format: "Percentual", rule: "Maior é melhor", desc: "vendas / propostas", defaultMeta: 25.0, defaultValue: "28.5%" },
    { name: "Motivos de perda", key: "", format: "Texto", rule: "Apenas referência", desc: "motivos cadastrados", defaultMeta: "", defaultValue: "Preço" },
    { name: "Oportunidades", key: "", format: "Número", rule: "Maior é melhor", desc: "negócios abertos", defaultMeta: 150, defaultValue: "112" },
    { name: "Receita", key: "", format: "Moeda", rule: "Maior é melhor", desc: "faturamento total", defaultMeta: 500000, defaultValue: "R$520k" },
    { name: "Receita potencial", key: "", format: "Moeda", rule: "Maior é melhor", desc: "faturamento em aberto", defaultMeta: 1000000, defaultValue: "R$850k" },
    { name: "Receita perdida", key: "", format: "Moeda", rule: "Menor é melhor", desc: "faturamento de perdidos", defaultMeta: 200000, defaultValue: "R$180k" },
    { name: "Ticket médio", key: "", format: "Moeda", rule: "Maior é melhor", desc: "receita / vendas", defaultMeta: 15000, defaultValue: "R$13.684,00" },
    { name: "CAC", key: "", format: "Moeda", rule: "Menor é melhor", desc: "investimento / clientes", defaultMeta: 150.00, defaultValue: "R$165,00" },
    { name: "Tempo médio de atendimento", key: "", format: "Texto", rule: "Menor é melhor", desc: "first reply time", defaultMeta: "5 min", defaultValue: "8 min" },
    { name: "Tempo médio até proposta", key: "", format: "Texto", rule: "Menor é melhor", desc: "ciclo até proposta", defaultMeta: "2 dias", defaultValue: "2.4 dias" },
    { name: "Tempo médio até venda", key: "", format: "Texto", rule: "Menor é melhor", desc: "ciclo de vendas", defaultMeta: "15 dias", defaultValue: "18 dias" }
  ]
};

function renderCatalogoList() {
  const container = document.getElementById('catalogo-list-container');
  if (!container) return;
  container.innerHTML = '';

  const searchQuery = document.getElementById('catalogo-search-input').value.toLowerCase().trim();

  Object.keys(catalogMetricsByCategory).forEach(category => {
    const metricsInCategory = catalogMetricsByCategory[category].filter(m => 
      searchQuery === '' || m.name.toLowerCase().includes(searchQuery)
    );

    if (metricsInCategory.length === 0) return;

    const catBox = document.createElement('div');
    
    const catTitle = document.createElement('div');
    catTitle.className = 'catalogo-category-title';
    catTitle.innerText = category;
    catBox.appendChild(catTitle);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.style.gap = '8px';
    grid.style.marginTop = '6px';

    metricsInCategory.forEach(m => {
      const item = document.createElement('div');
      item.className = 'catalogo-metric-item';
      
      const itemTitle = document.createElement('div');
      itemTitle.style.fontWeight = '600';
      itemTitle.innerText = m.name;

      const itemDesc = document.createElement('div');
      itemDesc.style.fontSize = '9px';
      itemDesc.style.color = 'var(--text-secondary)';
      itemDesc.style.marginTop = '2px';
      itemDesc.innerText = m.desc || '';

      item.appendChild(itemTitle);
      item.appendChild(itemDesc);

      item.onclick = () => {
        addMetricToActiveRow(m);
      };

      grid.appendChild(item);
    });

    catBox.appendChild(grid);
    container.appendChild(catBox);
  });
}

function filterCatalogoList() {
  renderCatalogoList();
}

function addMetricToActiveRow(catalogItem) {
  const activeRow = tempRows[activeCatalogRowIndex];
  if (!activeRow) return;

  if (activeRow.metrics.length >= 6) {
    showToast("Limite de 6 métricas por linha.");
    return;
  }

  // Adiciona métrica clonada
  activeRow.metrics.push({
    name: catalogItem.name,
    key: catalogItem.key,
    desc: catalogItem.desc,
    meta: catalogItem.defaultMeta,
    format: catalogItem.format,
    rule: catalogItem.rule,
    value: '',
    defaultValue: catalogItem.defaultValue || '',
    isEditing: false
  });

  closeCatalogoModal();
  renderEditRows();
  showToast(`Métrica "${catalogItem.name}" adicionada!`);
}

function createCustomMetricFromCatalog() {
  const activeRow = tempRows[activeCatalogRowIndex];
  if (!activeRow) return;

  if (activeRow.metrics.length >= 6) {
    showToast("Limite de 6 métricas por linha.");
    return;
  }

  const customMetric = {
    name: "Métrica Personalizada",
    key: "",
    desc: "descrição curta",
    meta: "",
    format: "Número",
    rule: "Apenas referência",
    value: "100",
    isEditing: true
  };

  activeRow.metrics.push(customMetric);
  closeCatalogoModal();
  renderEditRows();
  showToast("Métrica personalizada criada! Configure os campos abaixo.");
}

function addNewConvRow(event) {
  if (event) {
    event.stopPropagation();
    // Fecha dropdown se necessário
    const dropdown = document.getElementById('conv-three-point-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }

  // Cria direto no conversaoRows global ou tempRows dependendo se o modal está aberto
  const newRow = {
    name: "Nova linha",
    metrics: [
      { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 400, format: "Número", rule: "Maior é melhor", value: "" }
    ]
  };

  if (document.getElementById('estrutura-modal').style.display === 'flex') {
    tempRows.push({
      name: "Nova linha",
      metrics: [
        { name: "Conversões", key: "convs", desc: "ações realizadas", meta: 400, format: "Número", rule: "Maior é melhor", value: "" }
      ]
    });
    renderEditRows();
  } else {
    conversaoRows.push(newRow);
    updateConversaoMetrics();
    // E abre o modal para que o usuário possa customizar imediatamente
    openEstruturaModal();
  }

  showToast("Nova linha de métricas adicionada!");
}

// RENDERIZAÇÃO DINÂMICA DO PAINEL PRINCIPAL

function renderConversaoMatrix(dynamicValues) {
  const container = document.getElementById('conversao-matrix-container');
  if (!container) return;
  container.innerHTML = '';

  conversaoRows.forEach((row, rowIndex) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'matrix-row';
    rowDiv.style.display = 'flex';
    rowDiv.style.borderBottom = '1px solid var(--divider-color)';
    rowDiv.style.minHeight = '90px';
    rowDiv.style.alignItems = 'stretch';
    rowDiv.style.position = 'relative';

    // Diamond Separator between rows
    if (rowIndex > 0) {
      const diamond = document.createElement('div');
      diamond.style.position = 'absolute';
      diamond.style.left = '50%';
      diamond.style.top = '-4px';
      diamond.style.transform = 'translateX(-50%) rotate(45deg)';
      diamond.style.width = '6px';
      diamond.style.height = '6px';
      diamond.style.backgroundColor = 'var(--divider-color)';
      diamond.style.border = '1px solid var(--border-color)';
      diamond.style.zIndex = '2';
      rowDiv.appendChild(diamond);
    }

    // Label Lateral
    const labelCell = document.createElement('div');
    labelCell.className = 'matrix-row-label-cell';
    labelCell.style.width = '140px';
    labelCell.style.display = 'flex';
    labelCell.style.alignItems = 'center';
    labelCell.style.justifyContent = 'center';
    labelCell.style.backgroundColor = 'rgba(255,255,255,0.01)';
    labelCell.style.borderRight = '1px solid var(--divider-color)';
    labelCell.style.flexShrink = '0';

    const labelSpan = document.createElement('span');
    labelSpan.style.fontFamily = 'var(--font-family-title)';
    labelSpan.style.fontSize = '10px';
    labelSpan.style.fontWeight = '700';
    labelSpan.style.letterSpacing = '1px';
    labelSpan.style.color = 'var(--text-muted)';
    labelSpan.style.textTransform = 'uppercase';
    labelSpan.innerText = row.name;
    labelCell.appendChild(labelSpan);
    rowDiv.appendChild(labelCell);

    // Células de Métricas
    const cellsWrapper = document.createElement('div');
    cellsWrapper.className = 'matrix-cells-wrapper';
    cellsWrapper.style.display = 'flex';
    cellsWrapper.style.flexGrow = '1';
    cellsWrapper.style.alignItems = 'center';
    cellsWrapper.style.justifyContent = 'space-around';
    cellsWrapper.style.padding = '12px 0';

    if (row.metrics.length === 0) {
      const emptySpan = document.createElement('span');
      emptySpan.style.fontSize = '11px';
      emptySpan.style.color = 'var(--text-muted)';
      emptySpan.innerText = 'Sem métricas. Edite a estrutura para adicionar.';
      cellsWrapper.appendChild(emptySpan);
    } else {
      row.metrics.forEach((metric, metricIndex) => {
        const cell = document.createElement('div');
        cell.className = 'matrix-metric-cell';
        cell.style.textAlign = 'center';
        cell.style.flexGrow = '1';
        cell.style.flexBasis = '0';

        // Title
        const titleSpan = document.createElement('span');
        titleSpan.className = 'card-title';
        titleSpan.style.fontSize = '9px';
        titleSpan.style.display = 'block';
        titleSpan.style.marginBottom = '4px';
        titleSpan.innerText = metric.name;
        cell.appendChild(titleSpan);

        // Get value
        let valNumeric = 0;
        let valFormatted = '—';

        if (metric.value !== undefined && metric.value.toString().trim() !== '') {
          valFormatted = metric.value.toString().trim();
          valNumeric = parseFloat(valFormatted.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
        } else if (metric.key && dynamicValues.hasOwnProperty(metric.key)) {
          const rawVal = dynamicValues[metric.key];
          valNumeric = rawVal;

          if (metric.format === 'Moeda') {
            if (metric.key === 'invest') {
              valFormatted = rawVal >= 1000 ? `R$${Math.round(rawVal/1000)}k` : `R$${Math.round(rawVal)}`;
            } else {
              valFormatted = rawVal > 0 ? `R$${rawVal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '—';
            }
          } else if (metric.format === 'Percentual') {
            valFormatted = `${rawVal.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 2})}%`;
          } else if (metric.format === 'Número') {
            valFormatted = Math.round(rawVal).toLocaleString('pt-BR');
          } else {
            valFormatted = rawVal.toString();
          }
        } else if (metric.defaultValue) {
          valFormatted = metric.defaultValue;
          valNumeric = parseFloat(valFormatted.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
        }

        // Value Container
        const valDiv = document.createElement('div');
        valDiv.className = 'card-value';
        valDiv.style.fontSize = '18px';
        valDiv.style.fontWeight = '700';
        valDiv.innerText = valFormatted;
        cell.appendChild(valDiv);

        // Description
        const descSpan = document.createElement('span');
        descSpan.className = 'card-period-label';
        descSpan.style.fontSize = '9px';
        descSpan.style.display = 'block';
        descSpan.style.color = 'var(--text-muted)';
        descSpan.innerText = metric.desc || ' ';
        cell.appendChild(descSpan);

        // Meta (Target)
        const metaSpan = document.createElement('span');
        metaSpan.className = 'card-meta-target-label';
        metaSpan.style.fontSize = '9px';
        metaSpan.style.display = 'block';
        metaSpan.style.marginTop = '2px';

        let metaValNumeric = parseFloat(metric.meta) || 0;
        let formattedMeta = '';

        if (metric.meta !== undefined && metric.meta !== null && metric.meta.toString().trim() !== '') {
          if (metric.format === 'Moeda') {
            if (metric.key === 'invest' || metaValNumeric >= 1000) {
              formattedMeta = `até R$${Math.round(metaValNumeric/1000)}k`;
            } else {
              formattedMeta = `até R$${metaValNumeric.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            }
          } else if (metric.format === 'Percentual') {
            formattedMeta = `${metaValNumeric.toLocaleString('pt-BR')}%`;
          } else if (metric.format === 'Número') {
            formattedMeta = Math.round(metaValNumeric).toLocaleString('pt-BR');
          } else {
            formattedMeta = metric.meta.toString();
          }
          metaSpan.innerText = `Meta: ${formattedMeta}`;
          
          // Apply rule of comparison colors
          let color = 'var(--text-muted)';
          if (metric.rule === 'Maior é melhor') {
            if (valNumeric >= metaValNumeric) {
              color = '#10b981'; // Green
              valDiv.style.color = '#10b981';
            } else if (valNumeric >= metaValNumeric * 0.9) {
              color = '#f59e0b'; // Yellow
              valDiv.style.color = 'var(--text-primary)';
            } else {
              color = '#ef4444'; // Red
              valDiv.style.color = 'var(--text-primary)';
            }
          } else if (metric.rule === 'Menor é melhor') {
            if (valNumeric <= metaValNumeric) {
              color = '#10b981';
              valDiv.style.color = '#10b981';
            } else if (valNumeric <= metaValNumeric * 1.1) {
              color = '#f59e0b';
              valDiv.style.color = 'var(--text-primary)';
            } else {
              color = '#ef4444';
              valDiv.style.color = 'var(--text-primary)';
            }
          } else if (metric.rule === 'Igual ou próximo é melhor') {
            const diffPct = Math.abs(valNumeric - metaValNumeric) / metaValNumeric;
            if (diffPct <= 0.05) {
              color = '#10b981';
              valDiv.style.color = '#10b981';
            } else if (diffPct <= 0.10) {
              color = '#f59e0b';
              valDiv.style.color = 'var(--text-primary)';
            } else {
              color = '#ef4444';
              valDiv.style.color = 'var(--text-primary)';
            }
          } else {
            color = 'var(--text-muted)';
            valDiv.style.color = 'var(--text-primary)';
          }
          metaSpan.style.color = color;
        } else {
          metaSpan.innerText = 'Sem meta';
          metaSpan.style.color = 'var(--text-muted)';
          valDiv.style.color = 'var(--text-primary)';
        }
        cell.appendChild(metaSpan);

        // Ações por métrica: ⋮ sempre visível (editar meta / comentário) —
        // o 💬 só aparece quando essa métrica já tem comentário salvo.
        cell.style.position = 'relative';
        const actionsBtn = document.createElement('button');
        actionsBtn.type = 'button';
        actionsBtn.className = 'metric-actions-icon';
        actionsBtn.title = 'Editar meta ou comentário desta métrica';
        actionsBtn.innerText = '⋮';
        actionsBtn.style.cssText = `position:absolute; top:-8px; right:${metric.comment ? '16px' : '2px'}; background:none; border:none; cursor:pointer; font-size:12px; line-height:1; padding:2px 4px; color:var(--text-secondary); opacity:0.5;`;
        actionsBtn.onclick = (e) => openMetricActionsMenu(e, rowIndex, metricIndex);
        cell.appendChild(actionsBtn);

        if (metric.comment) {
          const commentBadge = document.createElement('button');
          commentBadge.type = 'button';
          commentBadge.className = 'metric-comment-icon';
          commentBadge.title = 'Ver/editar comentário do analista';
          commentBadge.innerText = '💬';
          commentBadge.style.cssText = 'position:absolute; top:-8px; right:2px; background:none; border:none; cursor:pointer; font-size:11px; line-height:1; padding:2px;';
          commentBadge.onclick = (e) => openMetricCommentPopoverDirect(e, rowIndex, metricIndex);
          cell.appendChild(commentBadge);
        }

        cellsWrapper.appendChild(cell);

        // Chevron Separator
        if (metricIndex < row.metrics.length - 1) {
          const chevron = document.createElement('div');
          chevron.className = 'matrix-chevron-separator';
          chevron.style.color = 'var(--divider-color)';
          chevron.style.fontWeight = '300';
          chevron.style.fontSize = '12px';
          chevron.innerText = '>';
          cellsWrapper.appendChild(chevron);
        }
      });
    }

    rowDiv.appendChild(cellsWrapper);

    // Célula de exclusão da linha
    const deleteCell = document.createElement('div');
    deleteCell.style.display = 'flex';
    deleteCell.style.alignItems = 'center';
    deleteCell.style.justifyContent = 'center';
    deleteCell.style.width = '40px';
    deleteCell.style.flexShrink = '0';
    deleteCell.style.borderLeft = '1px solid var(--divider-color)';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'matrix-row-delete-btn';
    deleteBtn.title = 'Excluir esta linha';
    deleteBtn.innerText = '🗑️';
    deleteBtn.onclick = () => deleteConversaoRow(rowIndex);
    deleteCell.appendChild(deleteBtn);

    rowDiv.appendChild(deleteCell);
    container.appendChild(rowDiv);
  });
}

function deleteConversaoRow(rowIndex) {
  const row = conversaoRows[rowIndex];
  if (!row) return;
  if (!confirm(`Tem certeza que deseja excluir a linha "${row.name}"?`)) return;

  conversaoRows.splice(rowIndex, 1);
  updateConversaoMetrics();
  saveMatrixStructure(clientSlugFromName(currentClient), currentAnalysisId, conversaoRows);
  showToast('Linha removida.');
}

// ==========================================================================
// COMPARAÇÃO MÊS A MÊS (dentro de cada análise do Dashboard Filho)
// ==========================================================================
// loadConversaoCampaignsForClient já soma tudo num total único por campanha
// (sem manter a data de cada linha), então não dá pra separar por mês a
// partir de conversaoCampaigns — por isso busca campaign_metrics de novo
// aqui, com o mesmo filtro de objetivo/análise, mas agrupando por mês.
let monthlyCampaignSeries = {}; // { 'YYYY-MM': [{id,name,platform,invest,impress,clicks,views,convs,sales}] }
let monthlyCampaignSeriesCacheKey = null;
let conversaoComparisonState = null; // { main: 'YYYY-MM', compare: 'YYYY-MM' } ou null quando inativo
let comparisonSortState = { key: null, dir: 1 };
let campaignsSortState = { key: null, dir: 1 };

const MONTH_NAMES_PT_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function formatMonthLabel(monthKey) {
  if (!monthKey) return '—';
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES_PT_FULL[m - 1]}/${y}`;
}

function previousMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

async function loadMonthlyComparisonSeries(clientName, analysisName) {
  const slug = clientSlugFromName(clientName) || slugify(clientName);
  const cacheKey = `${slug}|${analysisName}`;
  if (monthlyCampaignSeriesCacheKey === cacheKey) return;

  const { data, error } = await supabaseClient.from('campaign_metrics').select('*').eq('client_slug', slug);
  monthlyCampaignSeries = {};
  monthlyCampaignSeriesCacheKey = cacheKey;
  if (error || !data) return;

  let rows = data;
  const known = matchKnownMatrixTemplate(analysisName);
  if (known && analysisName !== 'Conversão') {
    const filtered = rows.filter(r => matchKnownMatrixTemplate(r.objective) === known);
    if (filtered.length > 0) rows = filtered;
  }

  rows.forEach(r => {
    if (!r.date) return;
    const month = r.date.slice(0, 7);
    if (!monthlyCampaignSeries[month]) monthlyCampaignSeries[month] = [];
    const key = `${r.campaign_name}||${r.platform}`;
    let entry = monthlyCampaignSeries[month].find(e => e.id === key);
    if (!entry) {
      entry = { id: key, name: r.campaign_name, platform: r.platform, invest: 0, impress: 0, clicks: 0, views: 0, convs: 0, sales: 0 };
      monthlyCampaignSeries[month].push(entry);
    }
    entry.invest += Number(r.invest) || 0;
    entry.impress += Number(r.impressions) || 0;
    entry.clicks += Number(r.clicks) || 0;
    entry.views += Number(r.page_views) || 0;
    entry.convs += Number(r.conversions) || 0;
    entry.sales += Number(r.purchases) || 0;
  });
}

function getAvailableMonthsDesc() {
  return Object.keys(monthlyCampaignSeries).sort().reverse();
}

// Totais de um mês já filtrados por Plataforma e pelas campanhas marcadas no
// filtro "Campanhas" (mesma seleção que already vale pra matriz da análise)
// — é isso que garante que a comparação respeita os filtros ativos.
function computeMonthTotals(month) {
  const entries = monthlyCampaignSeries[month] || [];
  const platformEl = document.getElementById('conv-filter-platform');
  const platformFilter = platformEl ? platformEl.value : 'Todas';
  const checkedIds = new Set(conversaoCampaigns.filter(c => c.checked).map(c => c.id));

  let totalInvest = 0, totalImpress = 0, totalClicks = 0, totalViews = 0, totalConvs = 0, totalSales = 0;
  let hasAny = false;
  entries.forEach(e => {
    if (platformFilter !== 'Todas' && e.platform !== platformFilter) return;
    if (!checkedIds.has(e.id)) return;
    hasAny = true;
    totalInvest += e.invest;
    totalImpress += e.impress;
    totalClicks += e.clicks;
    totalViews += e.views;
    totalConvs += e.convs;
    totalSales += e.sales;
  });

  return {
    hasData: hasAny,
    invest: totalInvest, impress: totalImpress, clicks: totalClicks, views: totalViews, convs: totalConvs, sales: totalSales,
    cpm: totalImpress > 0 ? (totalInvest / totalImpress) * 1000 : 0,
    cpc: totalClicks > 0 ? totalInvest / totalClicks : 0,
    cppv: totalViews > 0 ? totalInvest / totalViews : 0,
    cpa: totalConvs > 0 ? totalInvest / totalConvs : 0,
    ctr: totalImpress > 0 ? (totalClicks / totalImpress) * 100 : 0,
    pvrate: totalClicks > 0 ? (totalViews / totalClicks) * 100 : 0,
    convrate: totalViews > 0 ? (totalConvs / totalViews) * 100 : 0,
    buyerate: totalConvs > 0 ? (totalSales / totalConvs) * 100 : 0
  };
}

async function toggleCompareMonthDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('conv-compare-dropdown');
  if (!dropdown) return;

  const willOpen = dropdown.style.display === 'none' || !dropdown.style.display;

  const periodDropdown = document.getElementById('conv-period-dropdown');
  if (periodDropdown) periodDropdown.style.display = 'none';
  const campaignsDropdown = document.getElementById('conv-campaigns-dropdown');
  if (campaignsDropdown) campaignsDropdown.style.display = 'none';

  if (!willOpen) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.style.display = 'flex';
  document.getElementById('conv-compare-loading').style.display = 'block';
  document.getElementById('conv-compare-fields').style.display = 'none';

  await loadMonthlyComparisonSeries(currentClient, currentAnalysis);
  populateCompareMonthSelects();

  document.getElementById('conv-compare-loading').style.display = 'none';
  document.getElementById('conv-compare-fields').style.display = 'flex';
}

function populateCompareMonthSelects() {
  const months = getAvailableMonthsDesc();
  const mainSelect = document.getElementById('conv-compare-main-month');
  const withSelect = document.getElementById('conv-compare-with-month');
  const hint = document.getElementById('conv-compare-empty-hint');

  if (!months.length) {
    mainSelect.innerHTML = '<option value="">Sem dados</option>';
    withSelect.innerHTML = '<option value="">Sem dados</option>';
    hint.style.display = 'block';
    hint.innerText = 'Nenhum mês com dados disponível pra essa análise ainda.';
    return;
  }
  hint.style.display = 'none';

  const optionsHtml = months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
  mainSelect.innerHTML = optionsHtml;
  withSelect.innerHTML = optionsHtml;

  // Padrão: mês mais recente com dados (não o mês atual do calendário) vs
  // o mês anterior a ele — mesmo que esse anterior não tenha dados ainda
  // (o estado vazio avisa isso ao aplicar).
  const defaultMain = (conversaoComparisonState && months.includes(conversaoComparisonState.main)) ? conversaoComparisonState.main : months[0];
  const defaultCompare = (conversaoComparisonState && conversaoComparisonState.compare) || previousMonthKey(defaultMain);

  mainSelect.value = defaultMain;
  if ([...withSelect.options].some(o => o.value === defaultCompare)) {
    withSelect.value = defaultCompare;
  } else {
    const opt = document.createElement('option');
    opt.value = defaultCompare;
    opt.innerText = `${formatMonthLabel(defaultCompare)} (sem dados)`;
    withSelect.appendChild(opt);
    withSelect.value = defaultCompare;
  }
}

function applyMonthComparison(event) {
  if (event) event.stopPropagation();
  const main = document.getElementById('conv-compare-main-month').value;
  const compare = document.getElementById('conv-compare-with-month').value;
  if (!main || !compare) return;

  conversaoComparisonState = { main, compare };
  comparisonSortState = { key: null, dir: 1 };
  document.getElementById('conv-compare-dropdown').style.display = 'none';
  renderMonthComparison();
}

function clearMonthComparison() {
  conversaoComparisonState = null;
  const dropdown = document.getElementById('conv-compare-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  renderMonthComparison();
}

function formatPercentPt(value, decimals) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

function formatMetricValueByFormat(value, format) {
  if (format === 'Moeda') return formatCurrency(value);
  if (format === 'Percentual') return formatPercentPt(value, 2);
  return formatNumber(value);
}

function formatDiffByFormat(diff, format) {
  const sign = diff > 0 ? '+' : (diff < 0 ? '-' : '');
  const abs = Math.abs(diff);
  if (format === 'Moeda') return `${sign}${formatCurrency(abs)}`;
  if (format === 'Percentual') return `${sign}${abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`;
  return `${sign}${formatNumber(abs)}`;
}

// Diferença absoluta, variação % e status (melhorou/piorou/estável) de uma
// métrica entre os dois meses — a regra "maior/menor é melhor" vem direto
// do template da análise (metric.rule), a mesma que já define os badges de
// meta batida/não batida na matriz principal.
function computeComparisonRow(metric, mainTotals, compareTotals) {
  const mainVal = mainTotals[metric.key];
  const compVal = compareTotals[metric.key];
  const diff = mainVal - compVal;

  let variation = null;
  let varLabel;
  if (compVal === 0) {
    if (mainVal === 0) { variation = 0; varLabel = 'sem variação'; }
    else { varLabel = 'novo dado'; }
  } else {
    variation = (diff / compVal) * 100;
  }
  if (variation !== null && varLabel === undefined) {
    varLabel = `${variation >= 0 ? '+' : ''}${variation.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  const isBetterMore = metric.rule !== 'Menor é melhor';
  let status;
  if (variation === null) {
    status = mainVal > 0 ? 'novo' : 'sem-dado';
  } else {
    const roundedVar = Math.round(variation * 10) / 10;
    if (Math.abs(roundedVar) < 0.1) {
      status = 'estavel';
    } else {
      const increased = diff > 0;
      status = (isBetterMore ? increased : !increased) ? 'melhorou' : 'piorou';
    }
  }

  return { metric, mainVal, compVal, diff, variation, varLabel, status, isBetterMore };
}

const COMPARISON_STATUS_LABELS = { melhorou: '↑ Melhorou', piorou: '↓ Piorou', estavel: '→ Estável', novo: 'Novo dado', 'sem-dado': '—' };
const COMPARISON_STATUS_COLORS = { melhorou: 'healthy', piorou: 'critical', estavel: '', novo: 'attention', 'sem-dado': '' };

function sortComparisonRows(rows, key, dir) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (key === 'name') return dir * a.metric.name.localeCompare(b.metric.name);
    let av, bv;
    if (key === 'mainVal') { av = a.mainVal; bv = b.mainVal; }
    else if (key === 'compVal') { av = a.compVal; bv = b.compVal; }
    else if (key === 'diff') { av = a.diff; bv = b.diff; }
    else { av = a.variation === null ? -Infinity : a.variation; bv = b.variation === null ? -Infinity : b.variation; }
    return dir * (av - bv);
  });
  return sorted;
}

function sortComparisonTable(key) {
  if (comparisonSortState.key === key) {
    comparisonSortState.dir *= -1;
  } else {
    comparisonSortState.key = key;
    comparisonSortState.dir = key === 'name' ? 1 : -1;
  }
  renderMonthComparison();
}

function sortCampaignsTable(key) {
  if (campaignsSortState.key === key) {
    campaignsSortState.dir *= -1;
  } else {
    campaignsSortState.key = key;
    campaignsSortState.dir = (key === 'name' || key === 'platform') ? 1 : -1;
  }
  clientCampaigns.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === 'string') return campaignsSortState.dir * av.localeCompare(bv);
    return campaignsSortState.dir * ((Number(av) || 0) - (Number(bv) || 0));
  });
  renderCampaignsTable();
  Object.keys({ name: 1, platform: 1, invest: 1, impress: 1, clicks: 1, ctr: 1, cpc: 1, convs: 1, cpa: 1 }).forEach(k => {
    const el = document.getElementById(`camp-sort-icon-${k}`);
    if (el) el.innerText = k === campaignsSortState.key ? (campaignsSortState.dir === 1 ? '↑' : '↓') : '';
  });
}

// Cards de resumo: maior melhora, ponto de atenção, investimento, resultado
// (conversões/vendas/leads conforme a análise) e eficiência (CPA/CAC/CPL).
function renderComparisonSummaryCards(rows, hasCompareData) {
  const cardsEl = document.getElementById('conv-comparison-cards');
  if (!cardsEl) return;
  if (!hasCompareData) { cardsEl.innerHTML = ''; return; }

  const rankByImprovement = (r) => r.isBetterMore ? r.variation : -r.variation;
  const improved = rows.filter(r => r.status === 'melhorou');
  const worsened = rows.filter(r => r.status === 'piorou');

  const biggestImprovement = improved.length ? improved.reduce((a, b) => rankByImprovement(b) > rankByImprovement(a) ? b : a) : null;
  const biggestDrop = worsened.length ? worsened.reduce((a, b) => rankByImprovement(b) < rankByImprovement(a) ? b : a) : null;

  const investRow = rows.find(r => r.metric.key === 'invest');
  const convsRow = rows.find(r => r.metric.key === 'convs');
  const cpaRow = rows.find(r => r.metric.key === 'cpa');

  const colorFor = (status) => status === 'melhorou' ? 'var(--color-green)' : (status === 'piorou' ? 'var(--color-red)' : 'var(--text-secondary)');

  const cards = [];
  if (biggestImprovement) cards.push({ label: 'Maior melhora', value: biggestImprovement.metric.name, sub: biggestImprovement.varLabel, color: 'var(--color-green)' });
  if (biggestDrop) cards.push({ label: 'Ponto de atenção', value: biggestDrop.metric.name, sub: biggestDrop.varLabel, color: 'var(--color-red)' });
  if (investRow) cards.push({ label: 'Investimento', value: formatDiffByFormat(investRow.diff, 'Moeda'), sub: investRow.varLabel, color: colorFor(investRow.status) });
  if (convsRow) cards.push({ label: `Resultado (${convsRow.metric.name})`, value: formatDiffByFormat(convsRow.diff, 'Número'), sub: convsRow.varLabel, color: colorFor(convsRow.status) });
  if (cpaRow) cards.push({ label: `Eficiência (${cpaRow.metric.name})`, value: cpaRow.varLabel || '—', sub: COMPARISON_STATUS_LABELS[cpaRow.status], color: colorFor(cpaRow.status) });

  cardsEl.innerHTML = cards.slice(0, 5).map(c => `
    <div style="background: var(--bg-card); padding: 14px 16px;">
      <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 6px;">${escapeHtml(c.label)}</div>
      <div style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${escapeHtml(String(c.value))}</div>
      ${c.sub ? `<div style="font-size: 10px; margin-top: 2px; color: ${c.color};">${escapeHtml(c.sub)}</div>` : ''}
    </div>
  `).join('');
}

function renderMonthComparison() {
  const section = document.getElementById('conv-comparison-section');
  const badge = document.getElementById('conv-comparison-badge');
  if (!section || !badge) return;

  if (!conversaoComparisonState) {
    section.style.display = 'none';
    badge.style.display = 'none';
    return;
  }

  const { main, compare } = conversaoComparisonState;
  const mainLabel = formatMonthLabel(main);
  const compareLabel = formatMonthLabel(compare);

  badge.style.display = 'flex';
  document.getElementById('conv-comparison-badge-text').innerText = `Comparando: ${mainLabel} vs ${compareLabel}`;
  document.getElementById('conv-comparison-subtitle').innerText = `${mainLabel} vs ${compareLabel}`;

  const mainTotals = computeMonthTotals(main);
  const compareTotals = computeMonthTotals(compare);

  const cardsEl = document.getElementById('conv-comparison-cards');
  const theadRow = document.getElementById('conv-comparison-thead-row');
  const tbody = document.getElementById('conv-comparison-tbody');

  section.style.display = 'block';

  if (!mainTotals.hasData && !compareTotals.hasData) {
    cardsEl.innerHTML = '';
    theadRow.innerHTML = '';
    tbody.innerHTML = `<tr><td style="text-align:center; padding:24px; color:var(--text-muted); font-size:12px;">Não há dados suficientes para comparar esses meses (considerando os filtros de plataforma/campanhas atuais).</td></tr>`;
    return;
  }

  theadRow.innerHTML = `
    <th style="cursor:pointer; user-select:none;" onclick="sortComparisonTable('name')">Métrica <span class="sort-icon" id="comp-sort-icon-name"></span></th>
    <th style="cursor:pointer; user-select:none;" onclick="sortComparisonTable('mainVal')">${escapeHtml(mainLabel)} <span class="sort-icon" id="comp-sort-icon-mainVal"></span></th>
    <th style="cursor:pointer; user-select:none;" onclick="sortComparisonTable('compVal')">${escapeHtml(compareLabel)} <span class="sort-icon" id="comp-sort-icon-compVal"></span></th>
    <th style="cursor:pointer; user-select:none;" onclick="sortComparisonTable('diff')">Diferença <span class="sort-icon" id="comp-sort-icon-diff"></span></th>
    <th style="cursor:pointer; user-select:none;" onclick="sortComparisonTable('variation')">Variação <span class="sort-icon" id="comp-sort-icon-variation"></span></th>
  `;
  if (comparisonSortState.key) {
    const iconEl = document.getElementById(`comp-sort-icon-${comparisonSortState.key}`);
    if (iconEl) iconEl.innerText = comparisonSortState.dir === 1 ? '↑' : '↓';
  }

  const metricRows = (conversaoRows || []).flatMap(r => r.metrics).filter(m => m.key && mainTotals.hasOwnProperty(m.key));
  let rows = metricRows.map(m => computeComparisonRow(m, mainTotals, compareTotals));
  if (comparisonSortState.key) rows = sortComparisonRows(rows, comparisonSortState.key, comparisonSortState.dir);

  tbody.innerHTML = '';
  if (!compareTotals.hasData) {
    const warnTr = document.createElement('tr');
    warnTr.innerHTML = `<td colspan="5" style="padding:10px 12px; font-size:11px; color: var(--color-orange); background: rgba(245,158,11,0.06);">${escapeHtml(compareLabel)} não possui dados para os filtros selecionados — mostrando só ${escapeHtml(mainLabel)}, sem base de comparação anterior.</td>`;
    tbody.appendChild(warnTr);
  } else if (!mainTotals.hasData) {
    const warnTr = document.createElement('tr');
    warnTr.innerHTML = `<td colspan="5" style="padding:10px 12px; font-size:11px; color: var(--color-orange); background: rgba(245,158,11,0.06);">${escapeHtml(mainLabel)} não possui dados para os filtros selecionados.</td>`;
    tbody.appendChild(warnTr);
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const mainStr = formatMetricValueByFormat(row.mainVal, row.metric.format);
    const compStr = compareTotals.hasData ? formatMetricValueByFormat(row.compVal, row.metric.format) : '—';
    const diffStr = compareTotals.hasData ? formatDiffByFormat(row.diff, row.metric.format) : '—';
    const varStr = compareTotals.hasData ? (row.varLabel || '—') : '—';
    const badgeHtml = compareTotals.hasData
      ? `<span class="table-badge ${COMPARISON_STATUS_COLORS[row.status] || ''}" style="font-size:9px;">${COMPARISON_STATUS_LABELS[row.status]}</span>`
      : '';

    tr.innerHTML = `
      <td style="font-weight:500;">${escapeHtml(row.metric.name)}</td>
      <td>${mainStr}</td>
      <td>${compStr}</td>
      <td>${diffStr}</td>
      <td><div style="display:flex; align-items:center; gap:6px;">${escapeHtml(varStr)} ${badgeHtml}</div></td>
    `;
    tbody.appendChild(tr);
  });

  renderComparisonSummaryCards(rows, compareTotals.hasData);
}

function updateConversaoMetrics() {
  let totalInvest = 0;
  let totalImpress = 0;
  let totalClicks = 0;
  let totalViews = 0;
  let totalConvs = 0;
  let totalSales = 0;
  
  // Calculate period factor
  const state = calendarStates['conv'];
  const diffTime = Math.abs(state.endDate - state.startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const periodFactor = Math.min(1.0, diffDays / 31);

  // Com dados reais importados, usa os números tal como estão (sem escala
  // artificial). Sem import, mantém a variação fictícia por aba/período.
  const factor = usingRealCampaignData ? 1 : (periodFactor * getAnalysisFactor(currentAnalysis));

  conversaoCampaigns.forEach(camp => {
    if (camp.checked) {
      totalInvest += camp.invest * factor;
      totalImpress += camp.impress * factor;
      totalClicks += camp.clicks * factor;
      totalViews += camp.views * factor;
      totalConvs += camp.convs * factor;
      totalSales += camp.sales * factor;
    }
  });
  
  const cpm = totalImpress > 0 ? (totalInvest / totalImpress) * 1000 : 0;
  const cpc = totalClicks > 0 ? totalInvest / totalClicks : 0;
  const cppv = totalViews > 0 ? totalInvest / totalViews : 0;
  const cpa = totalConvs > 0 ? totalInvest / totalConvs : 0;
  
  const ctr = totalImpress > 0 ? (totalClicks / totalImpress) * 100 : 0;
  const pvrate = totalClicks > 0 ? (totalViews / totalClicks) * 100 : 0;
  const convrate = totalViews > 0 ? (totalConvs / totalViews) * 100 : 0;
  const buyerate = totalConvs > 0 ? (totalSales / totalConvs) * 100 : 0;
  
  const dynamicValues = {
    invest: totalInvest,
    impress: totalImpress,
    clicks: totalClicks,
    views: totalViews,
    convs: totalConvs,
    sales: totalSales,
    cpm: cpm,
    cpc: cpc,
    cppv: cppv,
    cpa: cpa,
    ctr: ctr,
    pvrate: pvrate,
    convrate: convrate,
    buyerate: buyerate
  };

  renderConversaoMatrix(dynamicValues);

  // Se houver comparação de mês ativa, mantém ela em sincronia com
  // qualquer mudança de filtro (plataforma/campanhas) que passou por aqui.
  if (typeof conversaoComparisonState !== 'undefined' && conversaoComparisonState) {
    renderMonthComparison();
  }
}

// Abre o Dashboard Filho de um Cliente Específico
async function selectClient(clientName) {
  currentClient = clientName;

  await refreshClientDetailedDataIfReal(clientName);

  // Obtém os dados detalhados do cliente
  const data = clientDetailedData[clientName];
  if (!data) {
    showToast(`${clientName} ainda não tem dados de campanhas cadastrados.`);
    return;
  }

  // Ajusta visibilidade dos blocos
  document.getElementById('view-dashboard-pai').style.display = 'none';
  document.getElementById('view-dashboard-filho').style.display = 'block';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  const viewColab2 = document.getElementById('view-colaboradores');
  if (viewColab2) viewColab2.style.display = 'none';
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  const viewConfig = document.getElementById('view-configuracoes');
  if (viewConfig) viewConfig.style.display = 'none';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();

  // Atualiza classes ativas na sidebar
  document.getElementById('menu-dashboard-link').classList.remove('active');
  const menuColab2 = document.getElementById('menu-colaboradores-link');
  if (menuColab2) menuColab2.classList.remove('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  const menuConfig = document.getElementById('menu-configuracoes-link');
  if (menuConfig) menuConfig.classList.remove('active');

  // Sincroniza sub-menus da sidebar
  const clientKey = clientSlugFromName(clientName);

  const allMenus = document.querySelectorAll('.analysis-menu');
  allMenus.forEach(m => m.style.display = 'none');
  
  const allContainers = document.querySelectorAll('.client-container');
  allContainers.forEach(c => c.classList.remove('expanded'));
  
  if (clientKey) {
    const activeContainer = document.getElementById(`container-client-${clientKey}`);
    if (activeContainer) activeContainer.classList.add('expanded');
    
    const activeMenu = document.getElementById(`analysis-menu-${clientKey}`);
    if (activeMenu) activeMenu.style.display = 'flex';

    // Highlight the active analysis item dynamically
    const list = clientAnalyses[clientKey] || [];
    const item = list.find(a => a.name === currentAnalysis);
    const activeAnalysisId = item ? item.id : 'visao';

    const allAnalysisItems = document.querySelectorAll('.analysis-item');
    allAnalysisItems.forEach(item => item.classList.remove('active'));
    
    const activeItem = document.getElementById(`analysis-${clientKey}-${activeAnalysisId}`);
    if (activeItem) activeItem.classList.add('active');
  }

  const clientItems = document.querySelectorAll('.client-item');
  clientItems.forEach(item => {
    const textSpan = item.querySelector('span:not(.status-dot)');
    if (textSpan && textSpan.innerText === clientName) {
      item.classList.add('active');
      item.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
    } else {
      item.classList.remove('active');
      item.style.backgroundColor = 'transparent';
    }
  });

  // Atualiza seletor de clientes do header do Dashboard Pai se estiver aberto
  const filterSelect = document.getElementById('client-filter');
  if (filterSelect) {
    let optionExists = false;
    for (let i = 0; i < filterSelect.options.length; i++) {
      if (filterSelect.options[i].value === clientName) {
        optionExists = true;
        break;
      }
    }
    if (!optionExists) {
      const opt = document.createElement('option');
      opt.value = clientName;
      opt.text = clientName;
      filterSelect.add(opt);
    }
    filterSelect.value = clientName;
  }

  // --------------------------------------------------
  // Preenchimento Dinâmico dos Dados do Cliente (Filho)
  // --------------------------------------------------
  
  // Header do Cliente
  document.getElementById('c-welcome').innerText = clientName;
  document.getElementById('c-meta').innerText = `${data.segment} · ${data.period}`;
  document.getElementById('c-owner').innerText = data.owner;
  document.getElementById('c-last-updated').innerText = data.updated;
  
  // Filtro de Período do Cliente: pra cliente com dado real, sempre reabre
  // em "Todo período" (cobrindo do primeiro ao último registro real desse
  // cliente) — o intervalo fixo de demonstração (Maio/2025) não faz sentido
  // pra dados reais, que podem estar em qualquer data.
  if (data.raw) {
    calendarStates['filho'].startDate = data.earliestDate || new Date();
    calendarStates['filho'].endDate = data.latestDate || new Date();
  }
  const state = calendarStates['filho'];
  const filhoPeriodText = document.getElementById('filho-period-btn-text');
  if (filhoPeriodText) filhoPeriodText.innerText = `${formatDate(state.startDate)} - ${formatDate(state.endDate)}`;
  const filhoStartInput = document.getElementById('filho-period-start');
  if (filhoStartInput) filhoStartInput.value = formatDate(state.startDate);
  const filhoEndInput = document.getElementById('filho-period-end');
  if (filhoEndInput) filhoEndInput.value = formatDate(state.endDate);

  // Recalcula todas as métricas dinamicamente para o período selecionado
  updateDashboardFilhoForCustomPeriod(state.startDate, state.endDate);

  // Tabela: Atualização de Dados
  const updatesTbody = document.getElementById('c-table-updates');
  updatesTbody.innerHTML = '';
  data.updates.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="table-client-cell">
        <span class="status-dot ${row.statusClass}"></span>
        <span>${row.source}</span>
      </td>
      <td class="${row.statusClass === 'attention' ? 'table-date-cell attention-date' : ''}">${row.time}</td>
      <td><span class="table-badge ${row.statusClass}">${row.status}</span></td>
      <td class="table-problem-cell">${row.obs}</td>
    `;
    updatesTbody.appendChild(tr);
  });

  // Insights de IA
  renderClientInsights(clientName);

  // Funil do Cliente
  let funnelVals = [...data.funnel];
  let funnelPcts = [...data.funnelPct];
  
  if (currentAnalysis && currentAnalysis !== 'Visão geral') {
    let hash = 0;
    for (let i = 0; i < currentAnalysis.length; i++) {
      hash += currentAnalysis.charCodeAt(i);
    }
    
    if (currentAnalysis.includes('Video') || currentAnalysis.includes('video')) {
      funnelVals = [
        formatNumber(Math.round(parseFloat(data.funnel[0].replace('.', '').replace(',', '')) * 1.5)),
        formatNumber(Math.round(parseFloat(data.funnel[1].replace('.', '').replace(',', '')) * 0.8)),
        formatNumber(Math.round(parseFloat(data.funnel[2].replace('.', '').replace(',', '')) * 0.4)),
        formatNumber(Math.round(parseFloat(data.funnel[3].replace('.', '').replace(',', '')) * 0.3))
      ];
      funnelPcts = ["20%", "15%", "20%", "0.5% final"];
    } else if (currentAnalysis.includes('WhatsApp') || currentAnalysis.includes('whats') || currentAnalysis.includes('Whats')) {
      funnelVals = [
        formatNumber(Math.round(parseFloat(data.funnel[0].replace('.', '').replace(',', '')) * 0.7)),
        formatNumber(Math.round(parseFloat(data.funnel[1].replace('.', '').replace(',', '')) * 0.9)),
        formatNumber(Math.round(parseFloat(data.funnel[2].replace('.', '').replace(',', '')) * 1.2)),
        formatNumber(Math.round(parseFloat(data.funnel[3].replace('.', '').replace(',', '')) * 1.4))
      ];
      funnelPcts = ["50%", "40%", "30%", "6.2% final"];
    } else {
      const factor = 0.5 + (hash % 10) / 10;
      funnelVals = data.funnel.map(v => formatNumber(Math.round(parseFloat(v.replace('.', '').replace(',', '')) * factor)));
      funnelPcts = [
        data.funnelPct[0],
        data.funnelPct[1],
        data.funnelPct[2],
        ((parseFloat(data.funnelPct[3].replace(',', '.')) * factor).toFixed(1) + '% final').replace('.', ',')
      ];
    }
  }

  document.getElementById('c-funnel-val-1').innerText = funnelVals[0];
  document.getElementById('c-funnel-val-2').innerText = funnelVals[1];
  document.getElementById('c-funnel-val-3').innerText = funnelVals[2];
  document.getElementById('c-funnel-val-4').innerText = funnelVals[3];
  
  document.getElementById('c-funnel-pct-1').innerText = funnelPcts[0];
  document.getElementById('c-funnel-pct-2').innerText = funnelPcts[1];
  document.getElementById('c-funnel-pct-3').innerText = funnelPcts[2];
  document.getElementById('c-funnel-pct-final').innerText = funnelPcts[3];

  // Origem de Leads
  const sourceUl = document.getElementById('c-leads-source-list');
  sourceUl.innerHTML = '';
  data.leadsSource.forEach(item => {
    const li = document.createElement('li');
    li.className = 'progress-item';
    li.innerHTML = `
      <div class="progress-header">
        <span class="progress-name">${item.name}</span>
        <span class="progress-value">${item.pct}% (${item.value})</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${item.pct}%; background-color: ${item.color};"></div>
      </div>
    `;
    sourceUl.appendChild(li);
  });

  // Motivos de Perda
  const lossUl = document.getElementById('c-leads-loss-list');
  lossUl.innerHTML = '';
  data.lossReasons.forEach(item => {
    const li = document.createElement('li');
    li.className = 'progress-item';
    li.innerHTML = `
      <div class="progress-header">
        <span class="progress-name">${item.name}</span>
        <span class="progress-value">${item.pct}%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${item.pct}%; background-color: ${item.color};"></div>
      </div>
    `;
    lossUl.appendChild(li);
  });

  // Motivos de Desqualificação de Leads (campo personalizado mapeado)
  renderDisqualificationReasons(data);

  // Evolução Comercial (Estilo cards em 4 colunas)
  const evolutionDiv = document.getElementById('c-evolution-list');
  evolutionDiv.innerHTML = '';
  data.evolution.forEach(item => {
    const col = document.createElement('div');
    col.className = 'evolution-item';
    col.innerHTML = `
      <span class="evolution-label">${item.label}</span>
      <span class="evolution-value">${item.val}</span>
      <span class="evolution-trend-indicator ${item.trendClass}">${item.trend}</span>
    `;
    evolutionDiv.appendChild(col);
  });

  // --------------------------------------------------
  // 3. Inicialização e Carga da seção Performance Ads
  // --------------------------------------------------
  adsActivePlatform = "Todas";

  // Reseta filtros de busca e selects de campanhas
  document.getElementById('search-campaign').value = '';
  document.getElementById('filter-camp-objective').value = 'Todos';
  document.getElementById('filter-camp-status').value = 'Todos';
  document.getElementById('c-campaign-select-all').checked = true;

  // Clona a lista de campanhas para manipular na memória
  clientCampaigns = data.campaigns.map(c => ({...c, checked: true}));

  // Atualiza rótulo de período dos Ads
  document.getElementById('c-ads-period-label').innerText = data.adsKpis.period;

  // Monta as abas/opções de plataforma a partir das campanhas reais deste
  // cliente (Google/Meta sempre; LinkedIn Ads e outras só se existirem)
  renderAdsPlatformFilters();

  // Renderiza tabela e calcula métricas iniciais
  renderCampaignsTable();
  recalculateAdsMetrics();
  renderAdsChart(data.chartData);
}

// --------------------------------------------------
// 2. Filtros e Ajustes Globais do Dashboard Pai
// --------------------------------------------------

function changePeriod(period, element) {
  currentPeriod = period;
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => btn.classList.remove('remove'));
  element.classList.add('active');
  document.getElementById('current-period-text').innerText = period;
  updateDashboardPaiValues(agencyPeriodData[period]);
}

function updateDashboardPaiValues(data) {
  document.getElementById('val-investimento').innerText = data.investimento;
  document.getElementById('val-receita').innerText = data.receita;
  document.getElementById('val-roi').innerText = data.roi;
  document.getElementById('val-conversao').innerText = data.conversao;
  document.getElementById('val-cpl').innerText = data.cpl;
  document.getElementById('val-cpa').innerText = data.cpa;

  const receitaBadge = document.getElementById('val-receita-source-badge');
  if (receitaBadge) {
    if (data.revenueSourceLabel && data.revenueSourceLabel.key !== 'none' && data.revenueSourceLabel.key !== 'media') {
      receitaBadge.innerText = `Carteira — ${data.revenueSourceLabel.text.replace('Fonte: ', '')}`;
      receitaBadge.style.display = 'block';
    } else {
      receitaBadge.style.display = 'none';
    }
  }
  const vendasBadge = document.getElementById('funnel-vendas-source-badge');
  if (vendasBadge) {
    if (data.salesSourceLabel && data.salesSourceLabel.key !== 'none' && data.salesSourceLabel.key !== 'media') {
      vendasBadge.innerText = `Carteira — ${data.salesSourceLabel.text.replace('Fonte: ', '')}`;
      vendasBadge.style.display = 'block';
    } else {
      vendasBadge.style.display = 'none';
    }
  }

  document.getElementById('trend-investimento').innerText = data.trendInvestimento;
  document.getElementById('trend-receita').innerText = data.trendReceita;
  document.getElementById('trend-roi').innerText = data.trendRoi;
  document.getElementById('trend-cpl').innerText = data.trendCpl;
  
  document.getElementById('funnel-val-1').innerText = data.funnel[0];
  document.getElementById('funnel-val-2').innerText = data.funnel[1];
  document.getElementById('funnel-val-3').innerText = data.funnel[2];
  document.getElementById('funnel-val-4').innerText = data.funnel[3];
  
  document.getElementById('funnel-pct-1').innerText = data.funnelPct[0];
  document.getElementById('funnel-pct-2').innerText = data.funnelPct[1];
  document.getElementById('funnel-pct-3').innerText = data.funnelPct[2];
  document.getElementById('funnel-pct-final').innerText = data.funnelPct[3];
}

// --------------------------------------------------
// 3. Lógica do Módulo Performance Ads (Cliente/Filho)
// --------------------------------------------------

// Filtro rápido das abas de canais de Mídia (Todas, Google Ads, Meta Ads)
function filterAdsPlatform(platform, element) {
  adsActivePlatform = platform;
  
  // Atualiza classes ativas nas abas de Ads
  const buttons = document.querySelectorAll('#c-performance-ads-section .filters-container button');
  buttons.forEach(btn => btn.classList.remove('active'));
  element.classList.add('active');

  // Sincroniza o select da tabela
  document.getElementById('filter-camp-platform').value = platform === 'Todas' ? 'Todas' : platform;

  // Filtra as campanhas na tabela
  filterCampaigns();
}

// Renderiza as campanhas na tabela
function renderCampaignsTable() {
  const tbody = document.getElementById('c-table-campaigns');
  tbody.innerHTML = '';

  if (clientCampaigns.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-muted);">Nenhuma campanha encontrada com os filtros selecionados.</td></tr>`;
    return;
  }

  // Título da Tabela com Contador
  document.getElementById('c-campaigns-title').innerText = `Campanhas (${clientCampaigns.length})`;

  clientCampaigns.forEach((camp, campIndex) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    // O id de campanhas reais é uma string composta ("Nome||Plataforma"),
    // com espaços e "|" — nunca embutir esse valor cru dentro de um atributo
    // onclick/onchange (vira JS inválido). Guarda em data-id (atributo HTML
    // normal, sem esse problema) e lê de volta via this/dataset nos handlers.
    tr.dataset.id = camp.id;

    const dotColor = getPlatformColor(camp.platform, campIndex);

    // Cria a linha
    tr.innerHTML = `
      <td style="padding: 12px 10px;" onclick="event.stopPropagation();">
        <input type="checkbox" class="campaign-row-checkbox" ${camp.checked ? 'checked' : ''} onchange="toggleCampaignSelection(this.closest('tr').dataset.id, this.checked)">
      </td>
      <td class="table-client-cell">
        <span class="status-dot" style="background-color: ${dotColor}; box-shadow: 0 0 6px ${dotColor};"></span>
        <span style="font-weight: 500;">${escapeHtml(camp.name)}</span>
      </td>
      <td>${escapeHtml(camp.platform)}</td>
      <td style="font-weight: 600;">R$ ${camp.invest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      <td>${camp.impress.toLocaleString('pt-BR')}</td>
      <td>${camp.clicks.toLocaleString('pt-BR')}</td>
      <td>${camp.ctr}%</td>
      <td>R$ ${camp.cpc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      <td>${camp.convs}</td>
      <td>${camp.convs > 0 ? 'R$ ' + camp.cpa.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : '—'}</td>
    `;
    tr.onclick = (e) => {
      if (e.target.closest('.campaign-row-checkbox')) return;
      toggleCampaignRow(tr.dataset.id);
    };
    tbody.appendChild(tr);
  });
}

// Filtra as campanhas com base na pesquisa e selects
function filterCampaigns() {
  const searchQuery = document.getElementById('search-campaign').value.toLowerCase().trim();
  const platformFilter = document.getElementById('filter-camp-platform').value;
  const objectiveFilter = document.getElementById('filter-camp-objective').value;
  const statusFilter = document.getElementById('filter-camp-status').value;

  // Busca os dados mestre do cliente ativo
  const activeClientData = clientDetailedData[currentClient];
  if (!activeClientData) return;

  // Filtra
  const filtered = activeClientData.campaigns.filter(camp => {
    const matchSearch = camp.name.toLowerCase().includes(searchQuery);
    const matchPlatform = platformFilter === 'Todas' || camp.platform === platformFilter;
    const matchObjective = objectiveFilter === 'Todos' || camp.objective === objectiveFilter;
    const matchStatus = statusFilter === 'Todos' || camp.status === statusFilter;
    return matchSearch && matchPlatform && matchObjective && matchStatus;
  });

  // Atualiza as campanhas ativas em memória
  clientCampaigns = filtered.map(c => ({...c, checked: true}));

  // Sincroniza a aba rápida de Ads se mudar a plataforma no select
  if (platformFilter !== 'Todas') {
    adsActivePlatform = platformFilter;
    const buttons = document.querySelectorAll('#c-performance-ads-section .filters-container button');
    buttons.forEach(btn => {
      if (btn.innerText === platformFilter) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  } else if (adsActivePlatform !== 'Todas' && platformFilter === 'Todas') {
    adsActivePlatform = 'Todas';
    document.getElementById('c-ads-tab-todas').classList.add('active');
    const buttons = document.querySelectorAll('#c-performance-ads-section .filters-container button');
    buttons.forEach(btn => {
      if (btn.id !== 'c-ads-tab-todas') btn.classList.remove('active');
    });
  }

  // Reseta checkbox do cabeçalho
  document.getElementById('c-campaign-select-all').checked = true;

  renderCampaignsTable();
  recalculateAdsMetrics();
}

// Seleção de Checkbox individual na tabela. Compara por toString() porque o
// id vem sempre como string do dataset (HTML), mas em campanhas de mock
// antigas camp.id ainda é numérico.
function toggleCampaignSelection(id, checked) {
  const camp = clientCampaigns.find(c => c.id.toString() === id.toString());
  if (camp) {
    camp.checked = checked;
  }

  // Atualiza checkbox mestre do cabeçalho
  const allChecked = clientCampaigns.length > 0 && clientCampaigns.every(c => c.checked);
  document.getElementById('c-campaign-select-all').checked = allChecked;

  recalculateAdsMetrics();
}

// Clique na linha inteira da tabela
function toggleCampaignRow(id) {
  const row = document.querySelector(`#c-table-campaigns tr[data-id="${CSS.escape(id.toString())}"]`);
  const checkbox = row ? row.querySelector('.campaign-row-checkbox') : null;
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
    toggleCampaignSelection(id, checkbox.checked);
  }
}

// Selecionar / Deselecionar tudo
function toggleSelectAllCampaigns(checked) {
  clientCampaigns.forEach(c => c.checked = checked);
  
  const checkboxes = document.querySelectorAll('.campaign-row-checkbox');
  checkboxes.forEach(cb => cb.checked = checked);

  recalculateAdsMetrics();
}

// Recalcula KPIs e cards de plataforma com base nas campanhas selecionadas.
// Os cards de plataforma são gerados dinamicamente: uma plataforma só ganha
// card se existir pelo menos uma campanha dela pra esse cliente (Google Ads
// e Meta Ads sempre existiam fixos no HTML; agora LinkedIn Ads ou qualquer
// outra plataforma importada aparece do mesmo jeito, sem precisar mexer no
// código de novo).
function recalculateAdsMetrics() {
  let totalInvest = 0;
  let totalClicks = 0;
  let totalConvs = 0;
  let totalImpress = 0;

  const byPlatform = {};
  const platformOrder = [];

  clientCampaigns.forEach(c => {
    if (!byPlatform[c.platform]) {
      byPlatform[c.platform] = { invest: 0, clicks: 0, convs: 0 };
      platformOrder.push(c.platform);
    }
    if (c.checked) {
      totalInvest += c.invest;
      totalClicks += c.clicks;
      totalConvs += c.convs;
      totalImpress += c.impress;

      byPlatform[c.platform].invest += c.invest;
      byPlatform[c.platform].clicks += c.clicks;
      byPlatform[c.platform].convs += c.convs;
    }
  });

  // Cálculos gerais
  const cpa = totalConvs > 0 ? totalInvest / totalConvs : 0;
  const ctr = totalImpress > 0 ? (totalClicks / totalImpress) * 100 : 0;

  // Formata e joga na tela
  document.getElementById('c-ads-investimento').innerText = `R$ ${totalInvest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
  document.getElementById('c-ads-cliques').innerText = totalClicks.toLocaleString('pt-BR');
  document.getElementById('c-ads-conversoes').innerText = totalConvs.toLocaleString('pt-BR');
  document.getElementById('c-ads-cpa').innerText = cpa > 0 ? `R$ ${cpa.toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : '—';
  document.getElementById('c-ads-ctr').innerText = `${ctr.toFixed(2)}%`;

  renderAdsPlatformCards(byPlatform, platformOrder);

  const labelEl = document.getElementById('c-ads-platforms-label');
  if (labelEl) labelEl.innerText = platformOrder.length ? platformOrder.join(' & ') : 'Nenhuma plataforma';
}

// Constrói um card por plataforma detectada nas campanhas do cliente.
function renderAdsPlatformCards(byPlatform, platformOrder) {
  const grid = document.getElementById('c-ads-platforms-grid');
  if (!grid) return;
  grid.innerHTML = '';

  platformOrder.forEach((platform, i) => {
    const stats = byPlatform[platform];
    const platCpa = stats.convs > 0 ? stats.invest / stats.convs : 0;
    const color = getPlatformColor(platform, i);

    const card = document.createElement('div');
    card.className = 'metric-card';
    card.style.borderLeft = `3px solid ${color}`;
    card.style.gap = '10px';
    card.innerHTML = `
      <span class="card-title" style="display: flex; align-items: center; gap: 6px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${color};"></span>
        ${escapeHtml(platform)}
      </span>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px;">
        <div>
          <span class="card-title" style="font-size: 9px;">Investimento</span>
          <div class="card-value" style="font-size: 16px; margin-top: 2px;">R$ ${stats.invest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
        </div>
        <div>
          <span class="card-title" style="font-size: 9px;">Cliques</span>
          <div class="card-value" style="font-size: 16px; margin-top: 2px;">${stats.clicks.toLocaleString('pt-BR')}</div>
        </div>
        <div>
          <span class="card-title" style="font-size: 9px;">Conversões</span>
          <div class="card-value highlight-green" style="font-size: 16px; margin-top: 2px;">${stats.convs.toLocaleString('pt-BR')}</div>
        </div>
        <div>
          <span class="card-title" style="font-size: 9px;">CPA</span>
          <div class="card-value" style="font-size: 16px; margin-top: 2px;">${platCpa > 0 ? 'R$ ' + platCpa.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : '—'}</div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Monta as abas rápidas (Todas + uma por plataforma) e as opções do select
// de plataforma da tabela, a partir das campanhas reais do cliente.
function renderAdsPlatformFilters() {
  const platforms = [...new Set(clientCampaigns.map(c => c.platform))];

  const tabsContainer = document.getElementById('c-ads-platform-tabs');
  if (tabsContainer) {
    tabsContainer.innerHTML = `<button class="filter-btn active" id="c-ads-tab-todas" onclick="filterAdsPlatform('Todas', this)">Todas</button>`;
    platforms.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.innerText = p;
      btn.onclick = () => filterAdsPlatform(p, btn);
      tabsContainer.appendChild(btn);
    });
  }

  const select = document.getElementById('filter-camp-platform');
  if (select) {
    const current = select.value;
    select.innerHTML = `<option value="Todas">Plataforma (Todas)</option>`;
    platforms.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      select.appendChild(opt);
    });
    select.value = platforms.includes(current) ? current : 'Todas';
  }
}

// Renderiza o gráfico SVG de evolução diária Investimento x Conversão
function renderAdsChart(chartData) {
  const container = document.getElementById('c-ads-chart-container');
  container.innerHTML = '';

  // Cria ou reutiliza o tooltip flutuante
  let tooltip = document.getElementById('chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.className = 'chart-tooltip';
    document.body.appendChild(tooltip);
  }

  const w = container.clientWidth || 800;
  const h = 185;
  const paddingLeft = 45;
  const paddingRight = 45;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartW = w - paddingLeft - paddingRight;
  const chartH = h - paddingTop - paddingBottom;

  // Acha limites dos dados
  const maxInvest = Math.max(...chartData.investimento);
  const maxConvs = Math.max(...chartData.conversoes);

  // Fator de escala Y
  const scaleYInvest = maxInvest > 0 ? chartH / (maxInvest * 1.1) : 0;
  const scaleYConvs = maxConvs > 0 ? chartH / (maxConvs * 1.1) : 0;

  // Número de pontos
  const n = chartData.dates.length;
  if (n === 0) return; // sem dados suficientes pra desenhar o gráfico
  const stepX = n > 1 ? chartW / (n - 1) : 0;

  // Constrói SVG
  let svgContent = `<svg width="${w}" height="${h}" style="overflow: visible;">`;

  // Desenha Linhas horizontais de grade (Grid Lines)
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = paddingTop + (chartH / steps) * i;
    svgContent += `<line x1="${paddingLeft}" y1="${y}" x2="${w - paddingRight}" y2="${y}" class="chart-grid-line" />`;
    
    // Rótulos do eixo Y Esquerdo (Investimento)
    const investLabel = Math.round(maxInvest * 1.1 - (maxInvest * 1.1 / steps) * i);
    svgContent += `<text x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end" class="chart-axis-text">${investLabel}</text>`;

    // Rótulos do eixo Y Direito (Conversões)
    const convsLabel = Math.round(maxConvs * 1.1 - (maxConvs * 1.1 / steps) * i);
    svgContent += `<text x="${w - paddingRight + 8}" y="${y + 3}" text-anchor="start" class="chart-axis-text">${convsLabel}</text>`;
  }

  // Desenha Barras de Investimento
  const barW = Math.min(Math.max(stepX * 0.65, 5), 24);
  for (let i = 0; i < n; i++) {
    const x = paddingLeft + stepX * i;
    const val = chartData.investimento[i];
    const barH = val * scaleYInvest;
    const y = paddingTop + chartH - barH;

    svgContent += `<rect x="${x - barW / 2}" y="${y}" width="${barW}" height="${barH}" rx="2" class="chart-bar-invest" data-date="${chartData.dates[i]}" data-value="${val}" data-type="invest"></rect>`;

    // Rótulos do eixo X (Datas) — sempre mostra o primeiro e o último ponto,
    // e a cada 2 no meio; quando n é par isso fazia o penúltimo rótulo
    // (i === n-2) cair colado no último (i === n-1), sobrepondo o texto —
    // por isso o `i < n - 2` no meio, pra nunca mostrar dois rótulos adjacentes.
    if (n <= 7 || i === 0 || i === n - 1 || (i % 2 === 0 && i < n - 2)) {
      svgContent += `<text x="${x}" y="${h - paddingBottom + 16}" text-anchor="middle" class="chart-axis-text">${chartData.dates[i]}</text>`;
    }
  }

  // Desenha Linha de Conversões (Green Line) e Marcadores (Circles)
  let linePoints = '';
  let circles = '';
  for (let i = 0; i < n; i++) {
    const x = paddingLeft + stepX * i;
    const val = chartData.conversoes[i];
    const y = paddingTop + chartH - val * scaleYConvs;

    linePoints += `${x},${y} `;
    circles += `<circle cx="${x}" cy="${y}" r="10" class="chart-dot-hitarea" data-date="${chartData.dates[i]}" data-value="${val}" data-type="conv"></circle>`;
    circles += `<circle cx="${x}" cy="${y}" r="4" class="chart-dot-conv" data-date="${chartData.dates[i]}" data-value="${val}" data-type="conv"></circle>`;
  }

  svgContent += `<polyline points="${linePoints.trim()}" class="chart-line-conv" />`;
  svgContent += circles;

  svgContent += `</svg>`;
  container.innerHTML = svgContent;

  // Anexa event listeners para tooltip interativo
  const allElements = container.querySelectorAll('.chart-bar-invest, .chart-dot-conv, .chart-dot-hitarea');
  allElements.forEach(el => {
    el.addEventListener('mouseenter', function(e) {
      const date = this.getAttribute('data-date');
      const value = this.getAttribute('data-value');
      const type = this.getAttribute('data-type');

      if (type === 'invest') {
        tooltip.innerHTML = `<span class="tooltip-label">${date}</span><span class="tooltip-value">Investimento: R$ ${parseFloat(value).toLocaleString('pt-BR')}</span>`;
      } else {
        tooltip.innerHTML = `<span class="tooltip-label">${date}</span><span class="tooltip-value">Conversões: ${value}</span>`;
      }
      tooltip.style.display = 'flex';
    });

    el.addEventListener('mousemove', function(e) {
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY - 44) + 'px';
    });

    el.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
    });
  });
}

// Redesenha o gráfico ao redimensionar a tela
window.onresize = function() {
  const activeClientData = clientDetailedData[currentClient];
  if (activeClientData) {
    renderAdsChart(activeClientData.chartData);
  }
};

// --------------------------------------------------
// 4. Gerenciamento de Colaboradores
// --------------------------------------------------

let collaboratorsList = [];

async function fetchCollaboratorsFromDB() {
  const { data, error } = await supabaseClient.from('collaborators').select('*').order('name');
  if (error) { console.error('Erro ao carregar colaboradores', error); return []; }
  return data.map(c => ({
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    status: c.status,
    statusClass: c.status === 'Ativo' ? 'active' : 'suspended'
  }));
}

async function showColaboradores() {
  currentClient = "";
  // Ajusta visibilidade dos blocos
  document.getElementById('view-dashboard-pai').style.display = 'none';
  document.getElementById('view-dashboard-filho').style.display = 'none';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  document.getElementById('view-colaboradores').style.display = 'block';
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  const viewConfig = document.getElementById('view-configuracoes');
  if (viewConfig) viewConfig.style.display = 'none';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();

  // Atualiza classes ativas da sidebar
  document.getElementById('menu-dashboard-link').classList.remove('active');
  document.getElementById('menu-colaboradores-link').classList.add('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  const menuConfig = document.getElementById('menu-configuracoes-link');
  if (menuConfig) menuConfig.classList.remove('active');

  const clientItems = document.querySelectorAll('.client-item');
  clientItems.forEach(item => {
    item.classList.remove('active');
    item.style.backgroundColor = 'transparent';
  });

  // Limpa busca
  document.getElementById('search-colaborador').value = '';
  
  // Renderiza a lista de colaboradores
  collaboratorsList = await fetchCollaboratorsFromDB();
  renderColaboradores(collaboratorsList);
}

function renderColaboradores(list) {
  const grid = document.getElementById('colaboradores-cards-grid');
  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px;">Nenhum colaborador encontrado.</div>`;
    return;
  }

  list.forEach(colab => {
    const card = document.createElement('div');
    card.className = 'colab-card';
    
    // Status visual
    const statusDotClass = colab.statusClass === 'active' ? 'healthy' : 'critical';
    const statusTextClass = colab.statusClass === 'active' ? 'active' : 'suspended';
    const suspendBtnText = colab.statusClass === 'active' ? 'Suspender' : 'Reativar';
    const suspendBtnClass = colab.statusClass === 'active' ? 'colab-btn-suspend' : 'colab-btn-unsuspend';

    card.innerHTML = `
      <div>
        <div class="colab-card-name">${colab.name}</div>
        <div class="colab-card-role">${colab.role}</div>
        <div class="colab-card-email">${colab.email}</div>
      </div>
      <div class="colab-card-footer">
        <div class="colab-card-status ${statusTextClass}">
          <span class="status-dot ${statusDotClass}"></span>
          <span>${colab.status}</span>
        </div>
        <div class="colab-card-actions">
          <button class="colab-btn-edit" onclick="openColaboradorModal('${colab.id}')">Editar</button>
          <button class="${suspendBtnClass}" onclick="toggleSuspend('${colab.id}')">${suspendBtnText}</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openColaboradorModal(id) {
  const modal = document.getElementById('colaborador-modal');
  modal.style.display = 'flex';
  const passwordGroup = document.getElementById('colab-password-group');
  const passwordInput = document.getElementById('colab-password');

  if (id) {
    // Editar Colaborador — não mexe em senha/login por aqui
    const colab = collaboratorsList.find(c => c.id === id);
    if (!colab) return;

    document.getElementById('modal-title-text').innerText = "Editar Colaborador";
    document.getElementById('colab-id').value = colab.id;
    document.getElementById('colab-name').value = colab.name;
    document.getElementById('colab-role').value = colab.role;
    document.getElementById('colab-email').value = colab.email;
    if (passwordGroup) passwordGroup.style.display = 'none';
    if (passwordInput) passwordInput.required = false;
  } else {
    // Novo Colaborador — precisa definir e-mail e senha de acesso
    document.getElementById('modal-title-text').innerText = "Novo Colaborador";
    document.getElementById('colaborador-form').reset();
    document.getElementById('colab-id').value = '';
    if (passwordGroup) passwordGroup.style.display = 'block';
    if (passwordInput) passwordInput.required = true;
  }
}

function closeColaboradorModal() {
  document.getElementById('colaborador-modal').style.display = 'none';
}

async function saveColaborador(event) {
  event.preventDefault();

  const idVal = document.getElementById('colab-id').value;
  const name = document.getElementById('colab-name').value;
  const role = document.getElementById('colab-role').value;
  const email = document.getElementById('colab-email').value;

  if (idVal) {
    // Atualiza existente (sem mexer em senha/login por aqui)
    const colab = collaboratorsList.find(c => c.id === idVal);
    if (colab) {
      colab.name = name;
      colab.role = role;
      colab.email = email;
    }
    await supabaseClient.from('collaborators').update({ name, role, email }).eq('id', idVal);
    closeColaboradorModal();
    renderColaboradores(collaboratorsList);
    return;
  }

  // Cria novo colaborador COM acesso de login ao PRATA (e-mail + senha) —
  // precisa passar pelo servidor porque criar um usuário no Supabase Auth
  // exige a service_role key, que nunca pode ir pro navegador.
  const password = document.getElementById('colab-password').value;
  if (!password || password.length < 6) {
    showToast('Defina uma senha de acesso com pelo menos 6 caracteres.');
    return;
  }

  const submitBtn = document.querySelector('#colaborador-form .form-btn-primary');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = 'Criando...'; }

  try {
    const response = await fetch('/api/create-collaborator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, email, password })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Erro ao criar colaborador', data);
      showToast(data.error || 'Não foi possível criar o colaborador.');
      return;
    }

    const created = data.collaborator;
    collaboratorsList.push({
      id: created.id,
      name: created.name,
      role: created.role,
      email: created.email,
      status: created.status,
      statusClass: "active"
    });

    closeColaboradorModal();
    renderColaboradores(collaboratorsList);
    showToast(`${name} já pode entrar no PRATA com o e-mail e senha cadastrados! 🔐`);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Salvar'; }
  }
}

async function toggleSuspend(id) {
  const colab = collaboratorsList.find(c => c.id === id);
  if (colab) {
    if (colab.statusClass === 'active') {
      colab.status = "Suspenso";
      colab.statusClass = "suspended";
    } else {
      colab.status = "Ativo";
      colab.statusClass = "active";
    }
    renderColaboradores(collaboratorsList);
    await supabaseClient.from('collaborators').update({ status: colab.status }).eq('id', id);
  }
}

function filterColaboradores(query) {
  const q = query.toLowerCase().trim();
  if (q === '') {
    renderColaboradores(collaboratorsList);
    return;
  }
  
  const filtered = collaboratorsList.filter(c => 
    c.name.toLowerCase().includes(q) || 
    c.role.toLowerCase().includes(q) || 
    c.email.toLowerCase().includes(q)
  );
  
  renderColaboradores(filtered);
}

// --------------------------------------------------
// Campos Personalizados / "Solicitar dados" (por cliente)
// --------------------------------------------------
// Estrutura flexível (EAV): custom_fields define o campo (nome, tipo,
// frequência...), custom_field_values guarda os valores preenchidos — nunca
// cria coluna física nova no banco por campo. O mesmo par de tabelas
// alimenta o portal-cliente.html/js (Dashboard Filho separado).

const CUSTOM_FIELD_TYPE_LABELS = {
  number: 'Número',
  currency: 'Moeda',
  percentage: 'Percentual',
  text_short: 'Texto curto',
  text_long: 'Texto longo',
  date: 'Data',
  boolean: 'Sim/Não',
  single_select: 'Seleção única',
  multi_select: 'Seleção múltipla'
};

const CUSTOM_FIELD_FREQUENCY_LABELS = {
  daily: 'Diário',
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  on_demand: 'Sob demanda'
};

let activeCustomFields = [];
let activeCustomFieldValues = [];
let customFieldFormOptions = [];

async function openCustomFieldsModal() {
  if (!currentClient) return;
  document.getElementById('custom-fields-client-label').innerText = `Defina quais informações ${currentClient} precisa preencher`;
  document.getElementById('custom-fields-modal').style.display = 'flex';
  await loadCustomFieldsForClient(currentClient);
  populateClientSegmentPicker();
}

function closeCustomFieldsModal() {
  document.getElementById('custom-fields-modal').style.display = 'none';
}

// Abre o portal do cliente (Dashboard Filho standalone) numa nova aba, já
// filtrado pelo cliente que está aberto no Dashboard Pai.
function openClientPortal() {
  if (!currentClient) return;
  const slug = clientSlugFromName(currentClient) || slugify(currentClient);
  window.open(`portal-cliente.html?client=${encodeURIComponent(slug)}`, '_blank', 'noopener');
}

async function loadCustomFieldsForClient(clientName) {
  const slug = clientSlugFromName(clientName) || slugify(clientName);
  const list = document.getElementById('custom-fields-list');
  list.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 20px;">Carregando...</div>';

  const [{ data: fields, error: fieldsError }, { data: values, error: valuesError }] = await Promise.all([
    supabaseClient.from('custom_fields').select('*').eq('client_slug', slug).order('position').order('created_at'),
    supabaseClient.from('custom_field_values').select('*').eq('client_slug', slug).order('submitted_at', { ascending: false })
  ]);

  if (fieldsError) console.error('Erro ao carregar campos personalizados', fieldsError);
  if (valuesError) console.error('Erro ao carregar valores de campos personalizados', valuesError);

  activeCustomFields = fields || [];
  activeCustomFieldValues = values || [];

  renderCustomFieldsList();
}

function getLatestValueForField(fieldId) {
  return activeCustomFieldValues.find(v => v.field_id === fieldId) || null;
}

function formatCustomFieldValue(field, value) {
  if (!value) return null;
  if (field.field_type === 'currency' && value.value_number !== null) {
    return `R$ ${Number(value.value_number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }
  if (field.field_type === 'percentage' && value.value_number !== null) {
    return `${Number(value.value_number).toLocaleString('pt-BR')}%`;
  }
  if (field.field_type === 'number' && value.value_number !== null) {
    return Number(value.value_number).toLocaleString('pt-BR');
  }
  if (field.field_type === 'boolean') {
    return value.value_boolean ? 'Sim' : 'Não';
  }
  if (field.field_type === 'date' && value.value_date) {
    return formatDate(new Date(value.value_date + 'T00:00:00'));
  }
  if (field.field_type === 'multi_select' && value.value_options) {
    return (value.value_options || []).join(', ');
  }
  return value.value_text || '—';
}

function renderCustomFieldsList() {
  const list = document.getElementById('custom-fields-list');
  list.innerHTML = '';

  if (activeCustomFields.length === 0) {
    list.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 24px; border: 1px dashed var(--border-color); border-radius: var(--border-radius-sm);">Nenhum campo personalizado ainda. Clique em "+ Novo campo" pra pedir o primeiro dado a este cliente.</div>`;
    return;
  }

  activeCustomFields.forEach(field => {
    const lastValue = getLatestValueForField(field.id);
    const lastValueText = lastValue ? formatCustomFieldValue(field, lastValue) : null;
    const todayStatus = field.active ? getCustomFieldStatusToday(field) : null;

    const row = document.createElement('div');
    row.style.cssText = 'border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); padding: 12px 14px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; background: rgba(255,255,255,0.01);';

    row.innerHTML = `
      <div style="min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${escapeHtml(field.name)}</span>
          <span class="table-badge healthy" style="font-size: 9px;">${CUSTOM_FIELD_TYPE_LABELS[field.field_type] || field.field_type}</span>
          <span style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${CUSTOM_FIELD_FREQUENCY_LABELS[field.frequency] || field.frequency}</span>
          ${field.required ? '<span style="font-size: 9px; color: var(--color-red);">Obrigatório</span>' : ''}
          ${todayStatus ? `<span class="table-badge ${todayStatus.filled ? 'healthy' : 'attention'}" style="font-size: 9px;">${todayStatus.filled ? 'Preenchido' : 'Pendente'} (${todayStatus.periodLabel})</span>` : ''}
        </div>
        ${field.description ? `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(field.description)}</div>` : ''}
        <div style="font-size: 9px; color: var(--text-muted); margin-top: 4px;">${lastValueText ? `Último preenchimento: ${escapeHtml(lastValueText)} (${formatDate(new Date(lastValue.submitted_at))})` : 'Ainda sem preenchimentos'}</div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
        <span class="table-badge ${field.active ? 'healthy' : 'critical'}" style="cursor: pointer;" title="Clique para ${field.active ? 'desativar' : 'ativar'}" onclick="toggleCustomFieldActive('${field.id}', ${!field.active})">${field.active ? 'Ativo' : 'Inativo'}</span>
        <button class="colab-btn-edit" onclick="openCustomFieldForm('${field.id}')">Editar</button>
      </div>
    `;
    list.appendChild(row);
  });
}

// Status "hoje" de um campo periódico: preenchido = já existe valor pro
// bucket de período atual (mesma regra usada no portal pra decidir
// pendência); "sob demanda" nunca gera pendência automática (MVP).
function getCustomFieldStatusToday(field) {
  const periodLabels = { daily: 'hoje', weekly: 'esta semana', biweekly: 'esta quinzena', monthly: 'este mês', on_demand: 'sob demanda' };
  if (field.frequency === 'on_demand') {
    const has = activeCustomFieldValues.some(v => v.field_id === field.id);
    return { filled: has, periodLabel: periodLabels.on_demand };
  }
  const periodIso = formatDateISO(computePeriodDateForFrequency(field.frequency, new Date()));
  const match = activeCustomFieldValues.find(v => v.field_id === field.id && v.period_date === periodIso);
  return { filled: !!match, periodLabel: periodLabels[field.frequency] || field.frequency };
}

async function toggleCustomFieldActive(id, newActive) {
  const { error } = await supabaseClient.from('custom_fields').update({ active: newActive }).eq('id', id);
  if (error) {
    console.error('Erro ao atualizar campo', error);
    showToast('Não foi possível atualizar o campo.');
    return;
  }
  const field = activeCustomFields.find(f => f.id === id);
  if (field) field.active = newActive;
  renderCustomFieldsList();
}

function openCustomFieldForm(fieldId) {
  document.getElementById('custom-field-form').reset();
  customFieldFormOptions = [];

  if (fieldId) {
    const field = activeCustomFields.find(f => f.id === fieldId);
    if (!field) return;
    document.getElementById('custom-field-form-title').innerText = 'Editar campo personalizado';
    document.getElementById('cf-id').value = field.id;
    document.getElementById('cf-name').value = field.name;
    document.getElementById('cf-description').value = field.description || '';
    document.getElementById('cf-type').value = field.field_type;
    document.getElementById('cf-frequency').value = field.frequency;
    document.getElementById('cf-category').value = field.category || '';
    document.getElementById('cf-unit').value = field.unit || '';
    document.getElementById('cf-required').value = field.required ? 'true' : 'false';
    document.getElementById('cf-active').value = field.active ? 'true' : 'false';
    document.getElementById('cf-metric-mapping').value = field.metric_mapping || 'none';
    customFieldFormOptions = Array.isArray(field.options) ? [...field.options] : [];
  } else {
    document.getElementById('custom-field-form-title').innerText = 'Novo campo personalizado';
    document.getElementById('cf-id').value = '';
    document.getElementById('cf-required').value = 'true';
    document.getElementById('cf-active').value = 'true';
  }

  handleCustomFieldTypeChange();
  handleCustomFieldFrequencyChange();
  handleCustomFieldMappingChange();
  renderCustomFieldOptionsList();
  document.getElementById('custom-field-form-modal').style.display = 'flex';
}

function closeCustomFieldForm() {
  document.getElementById('custom-field-form-modal').style.display = 'none';
}

function handleCustomFieldTypeChange() {
  const type = document.getElementById('cf-type').value;
  const group = document.getElementById('cf-options-group');
  group.style.display = (type === 'single_select' || type === 'multi_select') ? 'block' : 'none';
}

const CUSTOM_FIELD_FREQUENCY_HINTS = {
  daily: 'Campos diários geram uma pendência automática todos os dias às 8h no Dashboard Filho (portal do cliente).',
  weekly: 'Campos semanais geram uma pendência no início da semana (segunda-feira) às 8h.',
  biweekly: 'Campos quinzenais geram uma pendência no início de cada quinzena (dia 1 e dia 16) às 8h.',
  monthly: 'Campos mensais geram uma pendência no primeiro dia do mês às 8h.',
  on_demand: 'Campos sob demanda não geram pendência automática — ficam disponíveis pro cliente preencher quando quiser.'
};

function handleCustomFieldFrequencyChange() {
  const freq = document.getElementById('cf-frequency').value;
  const hint = document.getElementById('cf-frequency-hint');
  if (hint) hint.innerText = CUSTOM_FIELD_FREQUENCY_HINTS[freq] || '';
}

// Quando a agência mapeia o campo pra Vendas ou Receita, avisa se esse
// cliente já tem histórico importado (leads_sales) pra essa métrica. Esse
// histórico já aparece no Dashboard independente do campo existir — o
// campo NÃO é uma chave pra "desbloquear" o dado importado, ele só passa a
// alimentar a mesma métrica com os preenchimentos novos feitos no portal
// dali pra frente. Por isso o aviso é só informativo/de continuidade.
async function handleCustomFieldMappingChange() {
  const mapping = document.getElementById('cf-metric-mapping').value;
  const banner = document.getElementById('cf-history-match-banner');
  if (!banner) return;

  if ((mapping !== 'sales' && mapping !== 'revenue') || !currentClient) {
    banner.style.display = 'none';
    return;
  }

  const slug = clientSlugFromName(currentClient) || slugify(currentClient);
  const { data: leadsRows } = await supabaseClient.from('leads_sales').select('date, sale_value, revenue').eq('client_slug', slug);

  // Se o usuário já trocou o mapeamento de novo (ou fechou o form) enquanto
  // a consulta estava em andamento, não mostra um aviso desatualizado.
  if (document.getElementById('cf-metric-mapping').value !== mapping) return;

  const rows = (leadsRows || []).filter(l => mapping === 'sales' ? (Number(l.sale_value) || 0) > 0 : (Number(l.revenue) || Number(l.sale_value) || 0) > 0);
  if (!rows.length) {
    banner.style.display = 'none';
    return;
  }

  const label = mapping === 'sales' ? 'Vendas' : 'Receita';
  const countText = mapping === 'sales'
    ? `${rows.length} venda(s)`
    : formatCurrency(rows.reduce((s, l) => s + (Number(l.revenue) || Number(l.sale_value) || 0), 0));
  banner.innerText = `📊 Encontramos ${countText} em ${label.toLowerCase()} histórica importada pra ${currentClient} — já visível no Dashboard, com ou sem este campo. Este campo será usado só pra continuar alimentando essa mesma métrica pelo portal, a partir de agora.`;
  banner.style.display = 'block';
}

// --------------------------------------------------
// Configuração inteligente de campos solicitados: a agência escolhe o
// segmento do cliente (picklist, pra nunca depender de bater texto livre) e
// o PRATA sugere um pacote pronto de campos pra aquele tipo de negócio —
// "Adicionar selecionados" cria todos de uma vez, com tipo/frequência/
// mapeamento já configurados. É só um ponto de partida: a agência pode
// editar ou apagar qualquer um deles depois, igual um campo criado manual.
const SEGMENT_FIELD_TEMPLATES = {
  'Clínico/Saúde': [
    { name: 'Agendamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'agendamentos' },
    { name: 'Comparecimentos', field_type: 'number', frequency: 'daily', metric_mapping: 'service', unit: 'comparecimentos' },
    { name: 'Procedimentos fechados', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'procedimentos' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Cancelamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' }
  ],
  'Odontologia': [
    { name: 'Agendamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'agendamentos' },
    { name: 'Comparecimentos', field_type: 'number', frequency: 'daily', metric_mapping: 'service', unit: 'comparecimentos' },
    { name: 'Orçamentos fechados', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'orçamentos' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Cancelamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' }
  ],
  'Estética/Fitness': [
    { name: 'Agendamentos/Aulas experimentais', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'agendamentos' },
    { name: 'Matrículas/Planos fechados', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'matrículas' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Cancelamentos/Trancamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' },
    { name: 'Renovações', field_type: 'number', frequency: 'monthly', metric_mapping: 'custom_metric', unit: 'renovações' }
  ],
  'Imobiliário': [
    { name: 'Visitas agendadas', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'visitas' },
    { name: 'Propostas', field_type: 'number', frequency: 'daily', metric_mapping: 'proposals', unit: 'propostas' },
    { name: 'Vendas/Locações fechadas', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'negócios' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Motivo de desqualificação de leads', field_type: 'single_select', frequency: 'on_demand', metric_mapping: 'disqualification_reason', required: false, options: ['Fora do perfil', 'Sem orçamento', 'Não é decisor', 'Sem resposta'] }
  ],
  'Advocacia': [
    { name: 'Consultas agendadas', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'consultas' },
    { name: 'Contratos fechados', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'contratos' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Cancelamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' },
    { name: 'Motivo de desqualificação de leads', field_type: 'single_select', frequency: 'on_demand', metric_mapping: 'disqualification_reason', required: false, options: ['Sem orçamento', 'Fora da área de atuação', 'Não é decisor', 'Desistiu'] }
  ],
  'Educação': [
    { name: 'Matrículas fechadas', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'matrículas' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Aulas experimentais realizadas', field_type: 'number', frequency: 'daily', metric_mapping: 'service', unit: 'aulas' },
    { name: 'Cancelamentos/Evasão', field_type: 'number', frequency: 'monthly', metric_mapping: 'cancellations', unit: 'cancelamentos' }
  ],
  'E-commerce/Varejo': [
    { name: 'Vendas', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'vendas' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Pedidos cancelados/devolvidos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'pedidos' }
  ],
  'Alimentação/Restaurantes': [
    { name: 'Reservas', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'reservas' },
    { name: 'Comparecimentos', field_type: 'number', frequency: 'daily', metric_mapping: 'service', unit: 'comparecimentos' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Cancelamentos/No-show', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' }
  ],
  'Automotivo': [
    { name: 'Test-drives agendados', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'test-drives' },
    { name: 'Vendas fechadas', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'vendas' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Motivo de desqualificação de leads', field_type: 'single_select', frequency: 'on_demand', metric_mapping: 'disqualification_reason', required: false, options: ['Sem orçamento', 'Já comprou em outro lugar', 'Não é decisor', 'Sem resposta'] }
  ],
  'Tecnologia/SaaS B2B': [
    { name: 'Reuniões agendadas', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'reuniões' },
    { name: 'Propostas enviadas', field_type: 'number', frequency: 'daily', metric_mapping: 'proposals', unit: 'propostas' },
    { name: 'Contratos fechados', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'contratos' },
    { name: 'Faturamento/MRR', field_type: 'currency', frequency: 'monthly', metric_mapping: 'revenue' },
    { name: 'Motivo de desqualificação de leads', field_type: 'single_select', frequency: 'on_demand', metric_mapping: 'disqualification_reason', required: false, options: ['Sem orçamento', 'Não é decisor', 'Fit ruim', 'Concorrente', 'Sem resposta'] }
  ],
  'Agronegócio': [
    { name: 'Propostas', field_type: 'number', frequency: 'daily', metric_mapping: 'proposals', unit: 'propostas' },
    { name: 'Vendas fechadas', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'vendas' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Cancelamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' }
  ],
  'Outro': [
    { name: 'Vendas', field_type: 'number', frequency: 'daily', metric_mapping: 'sales', unit: 'vendas' },
    { name: 'Faturamento', field_type: 'currency', frequency: 'daily', metric_mapping: 'revenue' },
    { name: 'Agendamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'appointments', unit: 'agendamentos' },
    { name: 'Cancelamentos', field_type: 'number', frequency: 'daily', metric_mapping: 'cancellations', unit: 'cancelamentos' },
    { name: 'Motivo de desqualificação de leads', field_type: 'single_select', frequency: 'on_demand', metric_mapping: 'disqualification_reason', required: false, options: ['Sem orçamento', 'Não é decisor', 'Sem resposta', 'Outro'] }
  ]
};

// Preenche o select de segmento com o valor atual do cliente (allClients já
// tem `segment`, carregado direto de clients.segment) e mostra as sugestões
// pra esse segmento, se houver.
function populateClientSegmentPicker() {
  const select = document.getElementById('cf-client-segment-select');
  if (!select || !currentClient) return;

  const segments = Object.keys(SEGMENT_FIELD_TEMPLATES);
  select.innerHTML = '<option value="">Selecione o segmento...</option>' + segments.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  const client = allClients.find(c => c.name === currentClient);
  select.value = (client && segments.includes(client.segment)) ? client.segment : '';

  renderSegmentSuggestions();
}

// Ao trocar o segmento no picklist, salva direto em clients.segment — não é
// só um filtro visual, vira o dado real do cliente (mesmo campo que a
// importação de planilha já usa).
async function handleClientSegmentChange() {
  const select = document.getElementById('cf-client-segment-select');
  const newSegment = select.value;
  const slug = clientSlugFromName(currentClient) || slugify(currentClient);

  const { error } = await supabaseClient.from('clients').update({ segment: newSegment || null }).eq('slug', slug);
  if (error) {
    console.error('Erro ao salvar segmento do cliente', error);
  } else {
    const client = allClients.find(c => c.name === currentClient);
    if (client) client.segment = newSegment;
  }

  renderSegmentSuggestions();
}

function renderSegmentSuggestions() {
  const select = document.getElementById('cf-client-segment-select');
  const suggestionsWrap = document.getElementById('cf-segment-suggestions');
  const emptyEl = document.getElementById('cf-segment-no-suggestions');
  const listEl = document.getElementById('cf-segment-suggestions-list');
  if (!select || !suggestionsWrap || !emptyEl || !listEl) return;

  const segment = select.value;
  const templates = SEGMENT_FIELD_TEMPLATES[segment];

  if (!segment) {
    suggestionsWrap.style.display = 'none';
    emptyEl.style.display = 'none';
    return;
  }
  if (!templates) {
    suggestionsWrap.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerText = 'Sem sugestões prontas pra esse segmento ainda.';
    return;
  }

  // Não sugere de novo um campo que já existe pra esse cliente (por nome).
  const existingNames = new Set(activeCustomFields.map(f => f.name.trim().toLowerCase()));
  const newOnes = templates.filter(t => !existingNames.has(t.name.trim().toLowerCase()));

  if (!newOnes.length) {
    suggestionsWrap.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerText = 'Esse cliente já tem todos os campos recomendados pra esse segmento.';
    return;
  }

  emptyEl.style.display = 'none';
  suggestionsWrap.style.display = 'block';
  listEl.innerHTML = newOnes.map(t => `
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; padding:3px 0; cursor:pointer;">
      <input type="checkbox" checked data-suggestion-name="${escapeHtml(t.name)}">
      <span>${escapeHtml(t.name)} <span style="color:var(--text-muted); font-size:10px;">(${CUSTOM_FIELD_FREQUENCY_LABELS[t.frequency] || t.frequency})</span></span>
    </label>
  `).join('');
}

// "Adicionar selecionados": cria de uma vez todos os campos marcados,
// aproveitando o mesmo formato de payload que o formulário manual já salva
// (saveCustomField) — nada de especial na tabela, é o mesmo custom_fields.
async function addRecommendedFields() {
  const select = document.getElementById('cf-client-segment-select');
  const segment = select ? select.value : '';
  const templates = SEGMENT_FIELD_TEMPLATES[segment] || [];
  if (!templates.length || !currentClient) return;

  const checkedNames = new Set([...document.querySelectorAll('#cf-segment-suggestions-list input[type=checkbox]:checked')].map(cb => cb.dataset.suggestionName));
  const toAdd = templates.filter(t => checkedNames.has(t.name));
  if (!toAdd.length) {
    showToast('Selecione ao menos um campo pra adicionar.');
    return;
  }

  const slug = clientSlugFromName(currentClient) || slugify(currentClient);
  const { data: userData } = await supabaseClient.auth.getUser();
  const createdBy = userData && userData.user ? userData.user.email : null;
  const basePosition = activeCustomFields.length;

  const payloads = toAdd.map((t, i) => ({
    client_slug: slug,
    name: t.name,
    description: t.description || null,
    field_type: t.field_type,
    options: t.options || null,
    frequency: t.frequency,
    required: t.required !== undefined ? t.required : true,
    category: t.category || null,
    unit: t.unit || null,
    metric_mapping: t.metric_mapping || 'none',
    active: true,
    position: basePosition + i,
    created_by: createdBy
  }));

  const { error } = await supabaseClient.from('custom_fields').insert(payloads);
  if (error) {
    console.error('Erro ao adicionar campos recomendados', error);
    showToast('Não foi possível adicionar os campos recomendados.');
    return;
  }

  showToast(`${toAdd.length} campo(s) adicionado(s) com sucesso!`);
  await loadCustomFieldsForClient(currentClient);
  renderSegmentSuggestions();
}

function addCustomFieldOption() {
  customFieldFormOptions.push('');
  renderCustomFieldOptionsList();
}

function updateCustomFieldOption(index, value) {
  customFieldFormOptions[index] = value;
}

function removeCustomFieldOption(index) {
  customFieldFormOptions.splice(index, 1);
  renderCustomFieldOptionsList();
}

function renderCustomFieldOptionsList() {
  const container = document.getElementById('cf-options-list');
  container.innerHTML = '';
  customFieldFormOptions.forEach((opt, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 6px; align-items: center;';
    row.innerHTML = `
      <input type="text" class="form-input" value="${escapeHtml(opt)}" placeholder="Opção ${i + 1}" style="flex-grow: 1;" oninput="updateCustomFieldOption(${i}, this.value)">
      <span onclick="removeCustomFieldOption(${i})" style="cursor: pointer; color: var(--text-muted); font-size: 14px; padding: 0 4px;">&times;</span>
    `;
    container.appendChild(row);
  });
}

async function saveCustomField(event) {
  event.preventDefault();
  if (!currentClient) return;

  const slug = clientSlugFromName(currentClient) || slugify(currentClient);
  const idVal = document.getElementById('cf-id').value;
  const type = document.getElementById('cf-type').value;
  const isSelect = type === 'single_select' || type === 'multi_select';
  const options = isSelect ? customFieldFormOptions.map(o => o.trim()).filter(Boolean) : null;

  if (isSelect && (!options || options.length < 2)) {
    showToast('Adicione pelo menos 2 opções para esse tipo de campo.');
    return;
  }

  const payload = {
    client_slug: slug,
    name: document.getElementById('cf-name').value.trim(),
    description: document.getElementById('cf-description').value.trim() || null,
    field_type: type,
    options: options,
    frequency: document.getElementById('cf-frequency').value,
    required: document.getElementById('cf-required').value === 'true',
    category: document.getElementById('cf-category').value.trim() || null,
    unit: document.getElementById('cf-unit').value.trim() || null,
    metric_mapping: document.getElementById('cf-metric-mapping').value,
    active: document.getElementById('cf-active').value === 'true'
  };

  let error;
  if (idVal) {
    ({ error } = await supabaseClient.from('custom_fields').update(payload).eq('id', idVal));
  } else {
    payload.position = activeCustomFields.length;
    const { data: userData } = await supabaseClient.auth.getUser();
    payload.created_by = userData && userData.user ? userData.user.email : null;
    ({ error } = await supabaseClient.from('custom_fields').insert(payload));
  }

  if (error) {
    console.error('Erro ao salvar campo personalizado', error);
    showToast('Não foi possível salvar o campo.');
    return;
  }

  closeCustomFieldForm();
  showToast(idVal ? 'Campo atualizado!' : 'Campo criado! Já aparece no portal do cliente.');
  await loadCustomFieldsForClient(currentClient);
}

// Adiciona os novos clientes mockados à base de dados para garantir que funcionem ao serem selecionados
clientDetailedData["Nexa Edu"] = {
  segment: "Tecnologia/Educação",
  period: "Maio 2025",
  owner: "Lucas M.",
  updated: "Hoje às 11:00",
  status: "Saudável",
  statusClass: "healthy",
  metrics: { investimento: "R$25k", receita: "R$180k", conversao: "3,5%", cpl: "R$35", cpa: "R$150", roi: "720%" },
  updates: [
    { source: "Google Ads", time: "Hoje às 11:00", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente" },
    { source: "CRM (leads)", time: "Ontem", status: "Atualizado", statusClass: "healthy", obs: "Integração RD Station" }
  ],
  funnel: ["900", "450", "135", "31"],
  funnelPct: ["50%", "30%", "23%", "3,5% final"],
  leadsSource: [
    { name: "Google Ads", pct: 60, value: "540 leads", color: "#3b82f6" },
    { name: "Orgânico", pct: 40, value: "360 leads", color: "#10b981" }
  ],
  lossReasons: [
    { name: "Sem budget", pct: 50, color: "#ef4444" },
    { name: "Sem resposta", pct: 50, color: "#f59e0b" }
  ],
  evolution: [
    { label: "Semana 1", val: "R$40k", trend: "▲ +10%", trendClass: "up" },
    { label: "Semana 2", val: "R$45k", trend: "▲ +12%", trendClass: "up" },
    { label: "Semana 3", val: "R$42k", trend: "▼ -6%", trendClass: "down" },
    { label: "Semana 4", val: "R$53k", trend: "▲ +26%", trendClass: "up" }
  ],
  insights: [
    "O custo por lead em educação profissionalizante reduziu 8% este mês.",
    "A taxa de conversão do funil de vendas (RD Station) é de 3,5%."
  ],
  adsKpis: { period: "12/05 a 22/06", investimento: 15400.00, cliques: 7800, conversoes: 273, cpa: 56.41, ctr: 1.62 },
  campaigns: [
    { id: 1, name: "[G] SEARCH | B2B | NEXA CURSOS", platform: "Google Ads", labelColor: "#3b82f6", invest: 8500.00, impress: 120000, clicks: 4200, ctr: 3.5, cpc: 2.02, convs: 165, cpa: 51.51, status: "Ativo", objective: "Leads" },
    { id: 2, name: "[M] CONVERSAO | BRASIL | Nexa", platform: "Meta Ads", labelColor: "#ec4899", invest: 6900.00, impress: 85000, clicks: 3600, ctr: 4.23, cpc: 1.91, convs: 108, cpa: 63.88, status: "Ativo", objective: "Conversão" }
  ],
  chartData: {
    dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
    investimento: [1200, 2200, 3100, 3500, 2800, 4200, 2400],
    conversoes: [10, 24, 30, 32, 25, 41, 23]
  }
};

clientDetailedData["AgroVale"] = {
  segment: "Agronegócio",
  period: "Maio 2025",
  owner: "Felippe G.",
  updated: "Ontem às 17:30",
  status: "Atenção",
  statusClass: "attention",
  metrics: { investimento: "R$80k", receita: "R$340k", conversao: "1,9%", cpl: "R$120", cpa: "R$850", roi: "425%" },
  updates: [
    { source: "Google Ads", time: "Ontem às 17:30", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente" },
    { source: "CRM (leads)", time: "Há 2 dias", status: "Atenção", statusClass: "attention", obs: "Sincronização offline lenta" }
  ],
  funnel: ["1.500", "450", "90", "28"],
  funnelPct: ["30%", "20%", "31%", "1,9% final"],
  leadsSource: [
    { name: "Google Ads", pct: 70, value: "1.050 leads", color: "#3b82f6" },
    { name: "Meta Ads", pct: 30, value: "450 leads", color: "#ec4899" }
  ],
  lossReasons: [
    { name: "Sem resposta", pct: 60, color: "#ef4444" },
    { name: "Região sem cobertura", pct: 40, color: "#6b7280" }
  ],
  evolution: [
    { label: "Semana 1", val: "R$75k", trend: "▲ +2%", trendClass: "up" },
    { label: "Semana 2", val: "R$82k", trend: "▲ +9%", trendClass: "up" },
    { label: "Semana 3", val: "R$68k", trend: "▼ -17%", trendClass: "down" },
    { label: "Semana 4", val: "R$115k", trend: "▲ +69%", trendClass: "up" }
  ],
  insights: [
    "Atenção: A taxa de resposta dos leads agrícolas reduziu na última semana.",
    "O canal Google Ads gera leads mais qualificados para grandes produtores."
  ],
  adsKpis: { period: "12/05 a 22/06", investimento: 55000.00, cliques: 11200, conversoes: 220, cpa: 250.00, ctr: 1.05 },
  campaigns: [
    { id: 1, name: "[G] SEARCH | B2B | TRATORES & IMPLEMENTOS", platform: "Google Ads", labelColor: "#3b82f6", invest: 35000.00, impress: 180000, clicks: 6800, ctr: 3.77, cpc: 5.14, convs: 145, cpa: 241.37, status: "Ativo", objective: "Leads" },
    { id: 2, name: "[M] CONVERSAO | AGRO DE PRODUTORES", platform: "Meta Ads", labelColor: "#ec4899", invest: 20000.00, impress: 110000, clicks: 4400, ctr: 4.00, cpc: 4.54, convs: 75, cpa: 266.66, status: "Ativo", objective: "Conversão" }
  ],
  chartData: {
    dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
    investimento: [3500, 6800, 8100, 8900, 7200, 11000, 9500],
    conversoes: [8, 18, 22, 28, 20, 31, 25]
  }
};

clientDetailedData["RetailMax"] = {
  segment: "Varejo/E-commerce",
  period: "Maio 2025",
  owner: "Lucas M.",
  updated: "Hoje às 10:00",
  status: "Atenção",
  statusClass: "attention",
  metrics: { investimento: "R$110k", receita: "R$580k", conversao: "2,5%", cpl: "R$18", cpa: "R$95", roi: "527%" },
  updates: [
    { source: "Google Ads", time: "Hoje às 10:00", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente" },
    { source: "Meta Ads", time: "Hoje às 10:15", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente" }
  ],
  funnel: ["8.500", "3.400", "850", "212"],
  funnelPct: ["40%", "25%", "25%", "2,5% final"],
  leadsSource: [
    { name: "Meta Ads", pct: 75, value: "6.375 leads", color: "#ec4899" },
    { name: "Google Ads", pct: 25, value: "2.125 leads", color: "#3b82f6" }
  ],
  lossReasons: [
    { name: "Preço / Frete caro", pct: 55, color: "#ef4444" },
    { name: "Abandono de carrinho", pct: 35, color: "#f59e0b" },
    { name: "Outros", pct: 10, color: "#6b7280" }
  ],
  evolution: [
    { label: "Semana 1", val: "R$120k", trend: "▼ -4%", trendClass: "down" },
    { label: "Semana 2", val: "R$145k", trend: "▲ +20%", trendClass: "up" },
    { label: "Semana 3", val: "R$138k", trend: "▼ -5%", trendClass: "down" },
    { label: "Semana 4", val: "R$177k", trend: "▲ +28%", trendClass: "up" }
  ],
  insights: [
    "Campanhas de Meta Ads estão com custo por conversão em R$ 85.",
    "Frete grátis reduziu o abandono de carrinhos em 12% na última semana."
  ],
  adsKpis: { period: "12/05 a 22/06", investimento: 82000.00, cliques: 41000, conversoes: 920, cpa: 89.13, ctr: 2.12 },
  campaigns: [
    { id: 1, name: "[M] CATALOGO | VENDAS DIRETA | BRASIL", platform: "Meta Ads", labelColor: "#ec4899", invest: 50000.00, impress: 1200000, clicks: 28000, ctr: 2.33, cpc: 1.78, convs: 610, cpa: 81.96, status: "Ativo", objective: "Vendas" },
    { id: 2, name: "[G] SHOPPING | PERFORMANCE MAX", platform: "Google Ads", labelColor: "#3b82f6", invest: 32000.00, impress: 850000, clicks: 13000, ctr: 1.52, cpc: 2.46, convs: 310, cpa: 103.22, status: "Ativo", objective: "PMAX" }
  ],
  chartData: {
    dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
    investimento: [12000, 18000, 21000, 22000, 19000, 25000, 15000],
    conversoes: [110, 165, 205, 220, 180, 240, 140]
  }
};

clientDetailedData["Real Estate Pro"] = {
  segment: "Imobiliário B2B",
  period: "Maio 2025",
  owner: "Felippe G.",
  updated: "Ontem às 16:00",
  status: "Saudável",
  statusClass: "healthy",
  metrics: { investimento: "R$45k", receita: "R$290k", conversao: "2,7%", cpl: "R$55", cpa: "R$280", roi: "644%" },
  updates: [
    { source: "Google Ads", time: "Ontem às 16:00", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado automaticamente" },
    { source: "CRM (leads)", time: "Ontem às 16:30", status: "Atualizado", statusClass: "healthy", obs: "Integração Salesforce" }
  ],
  funnel: ["1.000", "400", "120", "27"],
  funnelPct: ["40%", "30%", "22.5%", "2,7% final"],
  leadsSource: [
    { name: "Google Ads", pct: 65, value: "650 leads", color: "#3b82f6" },
    { name: "Meta Ads", pct: 35, value: "350 leads", color: "#ec4899" }
  ],
  lossReasons: [
    { name: "Sem verba imediata", pct: 45, color: "#ef4444" },
    { name: "Preço do software B2B", pct: 35, color: "#f59e0b" },
    { name: "Outros", pct: 20, color: "#6b7280" }
  ],
  evolution: [
    { label: "Semana 1", val: "R$55k", trend: "▲ +8%", trendClass: "up" },
    { label: "Semana 2", val: "R$68k", trend: "▲ +23%", trendClass: "up" },
    { label: "Semana 3", val: "R$62k", trend: "▼ -8%", trendClass: "down" },
    { label: "Semana 4", val: "R$75k", trend: "▲ +20%", trendClass: "up" }
  ],
  insights: [
    "A qualificação via formulários LinkedIn e Google Ads está com aprovação de 40%.",
    "Foco em tomadores de decisão (Diretoria e C-Level) reduziu em 15% CPL geral."
  ],
  adsKpis: { period: "12/05 a 22/06", investimento: 32000.00, cliques: 6400, conversoes: 172, cpa: 186.04, ctr: 1.35 },
  campaigns: [
    { id: 1, name: "[G] SEARCH | B2B | SOFTWARE IMOBILIARIO", platform: "Google Ads", labelColor: "#3b82f6", invest: 20000.00, impress: 110000, clicks: 4200, ctr: 3.81, cpc: 4.76, convs: 112, cpa: 178.57, status: "Ativo", objective: "Leads" },
    { id: 2, name: "[M] CONVERSAO | BRASIL | Lead Forms", platform: "Meta Ads", labelColor: "#ec4899", invest: 12000.00, impress: 68000, clicks: 2200, ctr: 3.23, cpc: 5.45, convs: 60, cpa: 200.00, status: "Ativo", objective: "Conversão" }
  ],
  chartData: {
    dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
    investimento: [2200, 4800, 6100, 6500, 5200, 7800, 5400],
    conversoes: [12, 26, 31, 35, 27, 42, 29]
  }
};

// Fallbacks para Clínica Prime e Studio Fit que também aparecem na tabela principal
clientDetailedData["Clínica Prime"] = {
  segment: "Clínico/Saúde",
  period: "Maio 2025",
  owner: "Lucas M.",
  updated: "Ontem às 18:00",
  status: "Saudável",
  statusClass: "healthy",
  metrics: { investimento: "R$20k", receita: "R$95k", conversao: "2.1%", cpl: "R$22", cpa: "R$115", roi: "475%" },
  updates: [
    { source: "Google Ads", time: "Ontem às 18:00", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado via API" }
  ],
  funnel: ["600", "200", "80", "15"],
  funnelPct: ["33%", "40%", "18%", "2.1% final"],
  leadsSource: [
    { name: "Google Ads", pct: 80, value: "480 leads", color: "#3b82f6" },
    { name: "Orgânico", pct: 20, value: "120 leads", color: "#10b981" }
  ],
  lossReasons: [
    { name: "Falta de horários", pct: 60, color: "#ef4444" },
    { name: "Preço dos exames", pct: 40, color: "#f59e0b" }
  ],
  evolution: [
    { label: "Semana 1", val: "R$18k", trend: "▲ +2%", trendClass: "up" },
    { label: "Semana 2", val: "R$22k", trend: "▲ +22%", trendClass: "up" },
    { label: "Semana 3", val: "R$20k", trend: "▼ -9%", trendClass: "down" },
    { label: "Semana 4", val: "R$24k", trend: "▲ +20%", trendClass: "up" }
  ],
  insights: [
    "O canal Google Ads gera excelente retorno para agendamento de consultas diretas.",
    "A taxa de ocupação das salas aumentou para 85%."
  ],
  adsKpis: { period: "12/05 a 22/06", investimento: 18000.00, cliques: 3200, conversoes: 92, cpa: 195.65, ctr: 1.15 },
  campaigns: [
    { id: 1, name: "[G] SEARCH | CLINICA | AGENDAMENTO", platform: "Google Ads", labelColor: "#3b82f6", invest: 18000.00, impress: 85000, clicks: 3200, ctr: 3.76, cpc: 5.62, convs: 92, cpa: 195.65, status: "Ativo", objective: "Leads" }
  ],
  chartData: {
    dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
    investimento: [1500, 2500, 3100, 3500, 2800, 4200, 2400],
    conversoes: [5, 12, 16, 18, 14, 21, 12]
  }
};

clientDetailedData["Studio Fit"] = {
  segment: "Fitness/Estética",
  period: "Maio 2025",
  owner: "Felippe G.",
  updated: "Ontem às 19:15",
  status: "Atenção",
  statusClass: "attention",
  metrics: { investimento: "R$15k", receita: "R$52k", conversao: "1.8%", cpl: "R$15", cpa: "R$85", roi: "346%" },
  updates: [
    { source: "Meta Ads", time: "Ontem às 19:15", status: "Atualizado", statusClass: "healthy", obs: "Sincronizado via API" }
  ],
  funnel: ["800", "240", "60", "12"],
  funnelPct: ["30%", "25%", "20%", "1.8% final"],
  leadsSource: [
    { name: "Meta Ads", pct: 90, value: "720 leads", color: "#ec4899" },
    { name: "Outros", pct: 10, value: "80 leads", color: "#6b7280" }
  ],
  lossReasons: [
    { name: "Distância geográfica", pct: 70, color: "#ef4444" },
    { name: "Horário de pico lotado", pct: 30, color: "#f59e0b" }
  ],
  evolution: [
    { label: "Semana 1", val: "R$10k", trend: "▼ -5%", trendClass: "down" },
    { label: "Semana 2", val: "R$12k", trend: "▲ +20%", trendClass: "up" },
    { label: "Semana 3", val: "R$11k", trend: "▼ -8%", trendClass: "down" },
    { label: "Semana 4", val: "R$14k", trend: "▲ +27%", trendClass: "up" }
  ],
  insights: [
    "Instagram Ads (Meta) é a fonte de 90% das captações.",
    "Ação de cupom de primeira aula grátis reduziu CPL local em 18%."
  ],
  adsKpis: { period: "12/05 a 22/06", investimento: 12000.00, cliques: 8400, conversoes: 140, cpa: 85.71, ctr: 1.66 },
  campaigns: [
    { id: 1, name: "[M] LEADS | INSTAGRAM | LOCAL", platform: "Meta Ads", labelColor: "#ec4899", invest: 12000.00, impress: 110000, clicks: 8400, ctr: 7.63, cpc: 1.42, convs: 140, cpa: 85.71, status: "Ativo", objective: "Leads" }
  ],
  chartData: {
    dates: ["13/05", "20/05", "27/05", "03/06", "10/06", "17/06", "22/06"],
    investimento: [1000, 1800, 2100, 2200, 1900, 2500, 1500],
    conversoes: [8, 15, 21, 24, 18, 28, 16]
  }
};

// ==========================================================================
// SISTEMA DE TOASTS
// ==========================================================================
function showToast(message) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '99999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.innerHTML = `<span>✨</span> <span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 10);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// ==========================================================================
// MODO CLARO / MOTO ESCURO
// ==========================================================================
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  
  // Persiste no LocalStorage
  localStorage.setItem('prata-theme', isLight ? 'light' : 'dark');
  
  // Atualiza botões e textos
  updateThemeUI(isLight);
  showToast(isLight ? 'Modo claro ativado!' : 'Modo escuro ativado!');
}

function updateThemeUI(isLight) {
  const toggleText = document.getElementById('theme-toggle-text');
  const toggleLink = document.getElementById('theme-toggle-link');
  if (toggleText && toggleLink) {
    const iconSpan = toggleLink.querySelector('.menu-icon');
    if (isLight) {
      toggleText.innerText = 'Modo escuro';
      if (iconSpan) iconSpan.innerText = '🌙';
    } else {
      toggleText.innerText = 'Modo claro';
      if (iconSpan) iconSpan.innerText = '☀';
    }
  }
}

function syncThemeOnLoad() {
  const savedTheme = localStorage.getItem('prata-theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light');
    updateThemeUI(true);
  } else {
    document.body.classList.remove('light');
    updateThemeUI(false);
  }
}

// ==========================================================================
// ASSISTENTE PRATA (Painel Lateral de IA)
// ==========================================================================
function toggleAssist(forceState) {
  const panel = document.getElementById('assist-panel');
  const btns = document.querySelectorAll('.assist-toggle-btn');
  
  let show = panel.classList.contains('open') === false;
  if (typeof forceState === 'boolean') {
    show = forceState;
  }
  
  if (show) {
    panel.classList.add('open');
    btns.forEach(btn => btn.classList.add('active'));
    setTimeout(() => {
      document.getElementById('assist-textarea').focus();
    }, 300);
  } else {
    panel.classList.remove('open');
    btns.forEach(btn => btn.classList.remove('active'));
  }
}

function toggleAssistExpand() {
  const panel = document.getElementById('assist-panel');
  const expandBtn = document.getElementById('assist-expand-btn');
  
  const isExpanded = panel.classList.toggle('expanded');
  expandBtn.innerText = isExpanded ? '⤝' : '⤢';
  expandBtn.title = isExpanded ? 'Reduzir largura' : 'Expandir largura';
}

function handleAssistInput(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight) + 'px';
  
  const sendBtn = document.getElementById('assist-send-btn');
  if (textarea.value.trim().length > 0) {
    sendBtn.removeAttribute('disabled');
    sendBtn.classList.add('active');
  } else {
    sendBtn.setAttribute('disabled', 'true');
    sendBtn.classList.remove('active');
  }
}

// Configura evento de tecla Enter no textarea
setTimeout(() => {
  const textarea = document.getElementById('assist-textarea');
  if (textarea) {
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAssistMessage();
      }
    });
  }
}, 500);

function sendAssistMessage() {
  const textarea = document.getElementById('assist-textarea');
  const text = textarea.value.trim();
  if (text.length === 0) return;
  
  appendMessage(text, 'user');
  textarea.value = '';
  handleAssistInput(textarea);
  
  simulateAIResponse(text);
}

function escapeHtml(str) {
  return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Formatação leve: escapa HTML (segurança) e converte **negrito**/quebras de
// linha em tags simples, sem precisar de uma lib de markdown.
function formatAssistantText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function appendMessage(text, sender) {
  const container = document.getElementById('assist-messages-container');
  const wrapper = document.createElement('div');
  wrapper.className = `assist-message ${sender}`;
  wrapper.innerHTML = `<div class="message-bubble">${formatAssistantText(text)}</div>`;
  container.appendChild(wrapper);

  container.scrollTop = container.scrollHeight;
}

function handleSuggestion(suggestionText) {
  appendMessage(suggestionText, 'user');
  simulateAIResponse(suggestionText);
}

// Descobre qual tela o usuário está vendo agora (Dashboard Pai, Dashboard
// Filho, uma Análise específica, Relatórios, Comercial, Colaboradores) e,
// quando for uma tela de matriz de métricas (Análise de Conversão etc.),
// lê os valores exatamente como estão renderizados na tela — assim a IA
// comenta sobre o que o usuário está realmente vendo, e não só o resumo
// genérico do cliente.
function getCurrentScreenContext() {
  const isVisible = (id) => {
    const el = document.getElementById(id);
    return !!el && el.style.display !== 'none';
  };

  if (isVisible('view-dashboard-conversao')) {
    const matrixLines = [];
    const container = document.getElementById('conversao-matrix-container');
    if (container) {
      container.querySelectorAll('.matrix-row').forEach(rowEl => {
        const rowLabel = rowEl.querySelector('.matrix-row-label-cell span');
        const cellTexts = [];
        rowEl.querySelectorAll('.matrix-metric-cell').forEach(cell => {
          const title = cell.querySelector('.card-title');
          const value = cell.querySelector('.card-value');
          const meta = cell.querySelector('.card-meta-target-label');
          if (title && value) {
            const metaText = meta && meta.innerText.trim() ? ` (${meta.innerText.trim()})` : '';
            cellTexts.push(`${title.innerText}: ${value.innerText}${metaText}`);
          }
        });
        if (rowLabel && cellTexts.length) {
          matrixLines.push(`${rowLabel.innerText} — ${cellTexts.join('; ')}`);
        }
      });
    }
    return {
      label: `Análise "${currentAnalysis}" do cliente ${currentClient}`,
      detail: matrixLines.length ? `Valores exibidos nessa tela agora:\n${matrixLines.join('\n')}` : ''
    };
  }

  if (isVisible('view-dashboard-filho')) {
    return { label: `Dashboard do cliente ${currentClient} (visão geral)`, detail: '' };
  }

  if (isVisible('view-relatorios')) {
    return { label: 'Relatórios', detail: '' };
  }

  if (isVisible('view-colaboradores')) {
    return { label: 'Colaboradores', detail: '' };
  }

  if (isVisible('view-configuracoes')) {
    return { label: 'Configurações (perfil e workspace)', detail: '' };
  }

  const comercialVisivel = ['view-comercial-radar', 'view-comercial-pipeline', 'view-comercial-contatos']
    .some(id => isVisible(id));
  if (comercialVisivel) {
    return { label: 'Comercial (funil de vendas / pipeline)', detail: '' };
  }

  return { label: 'Dashboard Pai (visão geral da agência, todos os clientes)', detail: '' };
}

// Monta um resumo compacto dos dados reais atuais (tela atual em detalhe,
// clientes por status, totais da agência, e o cliente em foco se houver)
// pra IA responder com base no que está realmente importado e no que o
// usuário está vendo na tela, sem inventar números.
function buildAssistantContext() {
  const lines = [];

  const screen = getCurrentScreenContext();
  lines.push(`Tela em que o usuário está agora: ${screen.label}.`);
  if (screen.detail) lines.push(screen.detail);

  lines.push(`Total de clientes cadastrados: ${allClients.length}.`);

  if (allClients.length > 0) {
    const byStatus = { healthy: [], attention: [], critical: [] };
    allClients.forEach(c => { if (byStatus[c.status]) byStatus[c.status].push(c.name); });
    if (byStatus.critical.length) lines.push(`Clientes em status CRÍTICO: ${byStatus.critical.join(', ')}.`);
    if (byStatus.attention.length) lines.push(`Clientes em status ATENÇÃO: ${byStatus.attention.join(', ')}.`);
    if (byStatus.healthy.length) lines.push(`Clientes em status SAUDÁVEL: ${byStatus.healthy.join(', ')}.`);

    // Score de Saúde (0-100) de cada cliente — mesma fonte que calcula o
    // status acima, só que como número, pra IA responder "qual a saúde do
    // cliente X" ou comparar vários de uma vez.
    const withScore = allClients.filter(c => typeof c.healthScore === 'number');
    if (withScore.length) {
      lines.push(`Score de Saúde (0-100) por cliente: ${withScore.map(c => `${c.name}: ${c.healthScore}/100`).join('; ')}.`);
    }

    // Motivos específicos de cada cliente em atenção/crítico (calculados a
    // partir dos dados reais: ROI, ausência de conversão, metas não
    // batidas, tendência mês a mês, atualização de dados, campos pendentes)
    // — pra IA saber explicar exatamente por que quando perguntado.
    allClients.forEach(c => {
      const reasonTexts = (Array.isArray(c.statusReasons) ? c.statusReasons : []).map(r => (r && typeof r === 'object') ? r.text : r);
      if ((c.status === 'attention' || c.status === 'critical') && reasonTexts.length) {
        lines.push(`Por que ${c.name} está em ${c.status === 'critical' ? 'CRÍTICO' : 'ATENÇÃO'} (score ${c.healthScore}/100): ${reasonTexts.join(' ')}`);
      }
    });
  }

  const agency = agencyPeriodData[currentPeriod];
  if (agency) {
    lines.push(`Totais da agência no período "${currentPeriod}": Investimento ${agency.investimento}, Receita ${agency.receita}, Vendas ${agency.vendas || '—'}${agency.hasManualSales ? ' (soma inclui vendas reais informadas manualmente por clientes no portal)' : ''}, Taxa de conversão ${agency.conversao}, CPL ${agency.cpl}, CPA ${agency.cpa}, ROI ${agency.roi}.`);
  }

  if (currentClient && clientDetailedData[currentClient]) {
    const d = clientDetailedData[currentClient];
    lines.push(`Totais gerais (dashboard do cliente, todo o período) de ${currentClient}: Investimento ${d.metrics.investimento}, Receita ${d.metrics.receita}, Conversão de mídia (cliques → conversões rastreadas pelos anúncios) ${d.metrics.conversao}, CPL ${d.metrics.cpl}, CPA ${d.metrics.cpa}, ROI ${d.metrics.roi}. (Se a tela atual for uma Análise específica com filtro de campanhas/período, use os valores da seção "Valores exibidos nessa tela agora" acima, que são mais precisos para o que o usuário está vendo.)`);

    // Métricas comerciais informadas manualmente pelo cliente no portal
    // (vendas, receita, propostas, etc.) — quando existir campo mapeado,
    // esse é o dado OFICIAL, não o proxy de conversões de mídia acima.
    // Deixamos isso bem explícito pra IA nunca confundir os dois conceitos.
    if (d.commercial && Object.keys(d.commercial).length) {
      const commercialLines = Object.keys(COMMERCIAL_METRIC_LABELS)
        .filter(t => d.commercial[t])
        .map(t => {
          const label = COMMERCIAL_METRIC_LABELS[t];
          const val = t === 'revenue' ? formatCurrency(d.commercial[t].value) : Math.round(d.commercial[t].value).toLocaleString('pt-BR');
          const source = (t === 'sales' || t === 'revenue') && d.commercial[t].bySource ? ` [${describeSourceLabel(d.commercial[t].bySource).text}]` : ' [Fonte: Informado pelo cliente]';
          return `${label}: ${val}${source}`;
        });
      lines.push(`DADO OFICIAL (comercial real) de ${currentClient} — não é conversão de mídia: ${commercialLines.join('; ')}.`);
    }
    if (d.salesResolved !== null && d.salesResolved !== undefined) {
      lines.push(`IMPORTANTE: quando perguntarem "quantas vendas" de ${currentClient}, a resposta é ${Math.round(d.salesResolved).toLocaleString('pt-BR')} (vendas reais — importadas e/ou informadas pelo cliente, ver fonte acima) — NÃO confundir com "Conversão"/CPA acima, que são métricas de mídia (rastreadas pelo anúncio, não são vendas confirmadas).`);
    }
    if (d.commercialStats) {
      const s = d.commercialStats;
      const statParts = [];
      if (s.custoPorVenda !== null && s.custoPorVenda !== undefined) statParts.push(`Custo por venda: ${formatCurrency(s.custoPorVenda)}`);
      if (s.taxaLeadVenda !== null && s.taxaLeadVenda !== undefined) statParts.push(`Taxa lead → venda: ${s.taxaLeadVenda.toFixed(1)}%`);
      if (s.ticketMedio !== null && s.ticketMedio !== undefined) statParts.push(`Ticket médio: ${formatCurrency(s.ticketMedio)}`);
      if (s.roas !== null && s.roas !== undefined) statParts.push(`ROAS: ${s.roas.toFixed(1)}x`);
      if (statParts.length) lines.push(`Métricas comerciais derivadas de ${currentClient}: ${statParts.join(', ')}.`);
    }
    if (Array.isArray(d.customMetrics) && d.customMetrics.length) {
      lines.push(`Métricas personalizadas (definidas pela agência) de ${currentClient}: ${d.customMetrics.map(m => `${m.name}: ${Math.round(m.value).toLocaleString('pt-BR')}${m.unit ? ' ' + m.unit : ''}`).join(', ')}.`);
    }

    // Histórico dia a dia de Vendas/Receita já vem UNIFICADO (histórico
    // importado de leads_sales + preenchimentos do portal, sem duplicar) em
    // d.commercial.sales/revenue.records — cada ponto marcado com a origem.
    ['sales', 'revenue'].forEach(type => {
      if (!d.commercial || !d.commercial[type] || !Array.isArray(d.commercial[type].records)) return;
      const entries = d.commercial[type].records.slice(-60);
      if (!entries.length) return;
      const label = COMMERCIAL_METRIC_LABELS[type];
      const points = entries.map(r => `${r.date}: ${r.value}${r.source === 'import' ? ' (importação)' : ' (portal)'}`).join('; ');
      lines.push(`Histórico por dia de "${label}" de ${currentClient} (importação + portal, sem duplicar): ${points}.`);
    });

    // Histórico dia a dia (ou por semana/quinzena/mês, conforme a
    // frequência do campo) das demais métricas comerciais mapeadas
    // (propostas, agendamentos etc.) — essas só vêm do portal, sem
    // histórico importado equivalente ainda.
    if (Array.isArray(d.customFieldsDefs) && d.customFieldsDefs.length && Array.isArray(d.customFieldValuesAll)) {
      const mappedFields = d.customFieldsDefs.filter(f => f.metric_mapping && f.metric_mapping !== 'none' && f.metric_mapping !== 'sales' && f.metric_mapping !== 'revenue');
      mappedFields.forEach(field => {
        const entries = d.customFieldValuesAll
          .filter(v => v.field_id === field.id)
          .sort((a, b) => (a.period_date < b.period_date ? 1 : -1))
          .slice(0, 60);
        if (!entries.length) return;
        const label = field.metric_mapping === 'custom_metric' ? field.name : (COMMERCIAL_METRIC_LABELS[field.metric_mapping] || field.name);
        const points = entries.map(v => `${v.period_date}: ${v.value_number !== null && v.value_number !== undefined ? v.value_number : (v.value_text || '—')}`).join('; ');
        lines.push(`Histórico por período informado pelo cliente para "${label}" (campo "${field.name}", frequência ${CUSTOM_FIELD_FREQUENCY_LABELS[field.frequency] || field.frequency}): ${points}.`);
      });
    }
    if ((d.commercial && (d.commercial.sales || d.commercial.revenue)) || (d.customFieldsDefs && d.customFieldsDefs.some(f => f.metric_mapping && f.metric_mapping !== 'none'))) {
      lines.push(`Quando perguntarem sobre um dia/semana/mês específico de ${currentClient} (ex: "e no dia 10?", "e essa semana?"), procure a(s) data(s) correspondente(s) no histórico acima — não responda só com o total geral.`);
    }

    if (Array.isArray(d.insights) && d.insights.length) {
      lines.push(`Insights já calculados para ${currentClient}: ${d.insights.join(' ')}`);
    }
    if (Array.isArray(d.lossReasons) && d.lossReasons.length) {
      lines.push(`Motivos de perda de ${currentClient}: ${d.lossReasons.map(r => `${r.name} (${r.pct}%)`).join(', ')}.`);
    }
  }

  return lines.join('\n');
}

async function simulateAIResponse(query) {
  const container = document.getElementById('assist-messages-container');
  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'assist-message assistant loading-bubble';
  loadingWrapper.innerHTML = `<div class="message-bubble">Digitando...</div>`;
  container.appendChild(loadingWrapper);
  container.scrollTop = container.scrollHeight;

  try {
    const context = buildAssistantContext();
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query, context })
    });

    const data = await response.json().catch(() => ({}));
    loadingWrapper.remove();

    if (!response.ok) {
      appendMessage(data.error || 'Não consegui responder agora. Tente novamente em instantes.', 'assistant');
      return;
    }

    appendMessage(data.reply || 'Não consegui gerar uma resposta.', 'assistant');
  } catch (err) {
    console.error('Erro ao chamar o Assistente PRATA', err);
    loadingWrapper.remove();
    appendMessage('Não consegui me conectar ao servidor agora. Verifique sua internet e tente de novo.', 'assistant');
  }
}

// ==========================================================================
// DROPDOWN DE CLIENTES
// ==========================================================================
function statusLabel(status) {
  return status === 'healthy' ? 'Saudável' : status === 'attention' ? 'Atenção' : 'Crítico';
}

function renderClientesDropdownList(list = allClients) {
  const container = document.getElementById('clientes-dropdown-list');
  container.innerHTML = '';

  list.forEach(c => {
    const item = document.createElement('div');
    item.className = 'dropdown-client-item';
    item.onclick = () => {
      toggleClientesDropdown(null, false);
      selectClient(c.name);
    };
    item.innerHTML = `
      <div class="dropdown-client-left">
        <span class="status-dot ${c.status}"></span>
        <span>${c.name}</span>
        ${typeof c.healthScore === 'number' ? `<span class="sidebar-health-score">${c.healthScore}</span>` : ''}
      </div>
      <span class="dropdown-status-badge ${c.status}">${statusLabel(c.status)}</span>
    `;
    container.appendChild(item);
  });

  document.getElementById('clientes-counter').innerText = `${list.length} de ${allClients.length} clientes`;
}

function filterClientes(query) {
  const q = query.toLowerCase().trim();
  if (q === '') {
    renderClientesDropdownList(allClients);
    return;
  }
  const filtered = allClients.filter(c => c.name.toLowerCase().includes(q));
  renderClientesDropdownList(filtered);
}

function renderSidebarClients() {
  const list = document.getElementById('sidebar-client-list');
  if (!list) return;

  list.innerHTML = '';

  allClients.filter(c => c.pinned).forEach(c => {
    const li = document.createElement('li');
    li.className = 'client-container';
    li.id = `container-client-${c.slug}`;
    li.innerHTML = `
      <div class="client-item" id="sidebar-client-${c.slug}" onclick="toggleClientExpand('${c.name}')">
        <div class="client-name-wrapper">
          <span class="status-dot ${c.status}"></span>
          <span>${c.name}</span>
          <span class="sidebar-health-score" id="sidebar-health-score-${c.slug}" title="Score de saúde do cliente">${typeof c.healthScore === 'number' ? c.healthScore : ''}</span>
        </div>
        <span class="client-chevron" id="chevron-${c.slug}">▼</span>
      </div>
      <ul class="analysis-menu" id="analysis-menu-${c.slug}" style="display: none;"></ul>
    `;
    list.appendChild(li);
  });
}

// Atualiza só o número do score (e a cor do pontinho de status) de cada
// cliente já renderizado na sidebar, sem recriar a lista inteira — evita
// perder o estado de expandido/colapsado dos clientes ao atualizar o score
// toda vez que o Dashboard Pai recarrega.
function updateSidebarHealthScores() {
  allClients.forEach(c => {
    const scoreEl = document.getElementById(`sidebar-health-score-${c.slug}`);
    if (scoreEl) scoreEl.innerText = typeof c.healthScore === 'number' ? c.healthScore : '';

    const item = document.getElementById(`sidebar-client-${c.slug}`);
    const dot = item ? item.querySelector('.status-dot') : null;
    if (dot) dot.className = `status-dot ${c.status}`;
  });
}

function openClienteModal() {
  const segmentSelect = document.getElementById('cliente-segment');
  if (segmentSelect) {
    const segments = Object.keys(SEGMENT_FIELD_TEMPLATES);
    segmentSelect.innerHTML = '<option value="">Selecione o segmento...</option>' + segments.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }
  document.getElementById('cliente-modal').style.display = 'flex';
}

function closeClienteModal() {
  document.getElementById('cliente-modal').style.display = 'none';
  document.getElementById('cliente-form').reset();
}

async function saveNovoCliente(event) {
  event.preventDefault();

  const name = document.getElementById('cliente-name').value.trim();
  const status = document.getElementById('cliente-status').value;
  const segment = document.getElementById('cliente-segment').value;
  if (!name) return;

  const created = await insertClient(name, status, segment);
  if (!created) {
    showToast('Não foi possível criar o cliente.');
    return;
  }

  allClients.push(created);
  closeClienteModal();
  renderClientesDropdownList(allClients);
  showToast(`Cliente "${name}" criado com sucesso!`);
}

function toggleClientesDropdown(event, forceState) {
  if (event) {
    event.stopPropagation();
  }

  const dropdown = document.getElementById('clientes-dropdown');
  const trigger = document.getElementById('client-more-link');
  
  let show = dropdown.style.display === 'none';
  if (typeof forceState === 'boolean') {
    show = forceState;
  }
  
  if (show) {
    renderClientesDropdownList();
    document.getElementById('clientes-search').value = '';
    
    dropdown.style.display = 'flex';
    const rect = trigger.getBoundingClientRect();

    const dropdownWidth = 320;
    let left = rect.left;
    if (left + dropdownWidth > window.innerWidth - 10) {
      left = window.innerWidth - dropdownWidth - 10;
    }
    dropdown.style.left = `${left}px`;
    dropdown.style.width = `${dropdownWidth}px`;

    const dropdownHeight = dropdown.offsetHeight || 320;
    let top = rect.top - dropdownHeight - 8;
    if (top < 10) {
      top = rect.bottom + 8;
    }
    // Garante que o dropdown inteiro (incluindo o rodapé) caiba na tela
    if (top + dropdownHeight > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - dropdownHeight - 10);
    }
    dropdown.style.top = `${top}px`;

    document.addEventListener('click', closeClientesDropdownOutside);
  } else {
    dropdown.style.display = 'none';
    document.removeEventListener('click', closeClientesDropdownOutside);
  }
}

function closeClientesDropdownOutside(event) {
  const dropdown = document.getElementById('clientes-dropdown');
  const trigger = document.getElementById('client-more-link');
  if (dropdown && !dropdown.contains(event.target) && event.target !== trigger) {
    toggleClientesDropdown(null, false);
  }
}

// ==========================================================================
// CONFIGURADOR DE RELATÓRIOS
// ==========================================================================
let selectedReportFormat = 'PDF';
let selectedReportType = 'Consolidado da agência';

function showRelatorios() {
  document.getElementById('view-dashboard-pai').style.display = 'none';
  document.getElementById('view-dashboard-filho').style.display = 'none';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  const viewColab = document.getElementById('view-colaboradores');
  if (viewColab) viewColab.style.display = 'none';
  const viewConfig = document.getElementById('view-configuracoes');
  if (viewConfig) viewConfig.style.display = 'none';

  document.getElementById('view-relatorios').style.display = 'block';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();

  document.querySelectorAll('.menu-link').forEach(link => link.classList.remove('active'));
  document.getElementById('menu-relatorios-link').classList.add('active');
  
  document.querySelectorAll('.analysis-menu').forEach(m => m.style.display = 'none');
  document.querySelectorAll('.client-container').forEach(c => c.classList.remove('expanded'));
  
  const clientItems = document.querySelectorAll('.client-item');
  clientItems.forEach(item => {
    item.classList.remove('active');
    item.style.backgroundColor = 'transparent';
  });
  
  populateReportCampaigns();
  updateReportPreview();
}

// --------------------------------------------------
// Configurações (Meu Perfil / Conta e Workspace)
// --------------------------------------------------

async function showConfiguracoes() {
  currentClient = "";
  document.getElementById('view-dashboard-pai').style.display = 'none';
  document.getElementById('view-dashboard-filho').style.display = 'none';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  const viewColab = document.getElementById('view-colaboradores');
  if (viewColab) viewColab.style.display = 'none';
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  document.getElementById('view-configuracoes').style.display = 'block';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();

  document.querySelectorAll('.menu-link').forEach(link => link.classList.remove('active'));
  document.getElementById('menu-configuracoes-link').classList.add('active');

  document.querySelectorAll('.analysis-menu').forEach(m => m.style.display = 'none');
  document.querySelectorAll('.client-container').forEach(c => c.classList.remove('expanded'));

  const clientItems = document.querySelectorAll('.client-item');
  clientItems.forEach(item => {
    item.classList.remove('active');
    item.style.backgroundColor = 'transparent';
  });

  await loadAppSettings();
}

// Carrega os dois registros únicos (perfil e workspace) e preenche o
// formulário. As tabelas sempre têm no máximo 1 linha (id = 'singleton'),
// já que o PRATA ainda não tem múltiplos usuários/contas.
async function loadAppSettings() {
  const [{ data: profile, error: profileErr }, { data: workspace, error: workspaceErr }] = await Promise.all([
    supabaseClient.from('app_profile').select('*').eq('id', 'singleton').maybeSingle(),
    supabaseClient.from('app_workspace').select('*').eq('id', 'singleton').maybeSingle()
  ]);

  if (profileErr) console.error('Erro ao carregar perfil', profileErr);
  if (workspaceErr) console.error('Erro ao carregar workspace', workspaceErr);

  if (profile) {
    document.getElementById('config-profile-name').value = profile.full_name || '';
    document.getElementById('config-profile-phone').value = profile.phone || '';
    document.getElementById('config-profile-role').value = profile.role || '';
    document.getElementById('config-profile-department').value = profile.department || '';
    document.getElementById('config-profile-timezone').value = profile.timezone || 'America/Sao_Paulo';
    document.getElementById('config-profile-language').value = profile.language || 'pt-BR';
  }

  if (workspace) {
    document.getElementById('config-workspace-name').value = workspace.company_name || '';
    document.getElementById('config-workspace-cnpj').value = workspace.cnpj || '';
    document.getElementById('config-workspace-segment').value = workspace.segment || '';
    document.getElementById('config-workspace-site').value = workspace.website || '';
    document.getElementById('config-workspace-phone').value = workspace.phone || '';
    document.getElementById('config-workspace-email').value = workspace.contact_email || '';
    document.getElementById('config-workspace-address').value = workspace.address || '';
    document.getElementById('config-workspace-owner').value = workspace.account_owner || '';
  }
}

async function saveProfileSettings() {
  const payload = {
    id: 'singleton',
    full_name: document.getElementById('config-profile-name').value.trim(),
    phone: document.getElementById('config-profile-phone').value.trim(),
    role: document.getElementById('config-profile-role').value.trim(),
    department: document.getElementById('config-profile-department').value.trim(),
    timezone: document.getElementById('config-profile-timezone').value,
    language: document.getElementById('config-profile-language').value,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseClient.from('app_profile').upsert(payload);
  if (error) {
    console.error('Erro ao salvar perfil', error);
    showToast('Não foi possível salvar o perfil. Tente novamente.');
    return;
  }
  showToast('Perfil atualizado com sucesso! ✅');
}

async function saveWorkspaceSettings() {
  const payload = {
    id: 'singleton',
    company_name: document.getElementById('config-workspace-name').value.trim(),
    cnpj: document.getElementById('config-workspace-cnpj').value.trim(),
    segment: document.getElementById('config-workspace-segment').value.trim(),
    website: document.getElementById('config-workspace-site').value.trim(),
    phone: document.getElementById('config-workspace-phone').value.trim(),
    contact_email: document.getElementById('config-workspace-email').value.trim(),
    address: document.getElementById('config-workspace-address').value.trim(),
    account_owner: document.getElementById('config-workspace-owner').value.trim(),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseClient.from('app_workspace').upsert(payload);
  if (error) {
    console.error('Erro ao salvar workspace', error);
    showToast('Não foi possível salvar os dados da empresa. Tente novamente.');
    return;
  }

  showToast('Dados da empresa atualizados com sucesso! ✅');
}

function selectReportFormat(format) {
  selectedReportFormat = format;
  document.querySelectorAll('.format-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`format-${format.toLowerCase()}`).classList.add('active');
  updateReportPreview();
}

function selectReportType(type) {
  selectedReportType = type;
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
  
  const idMap = {
    'Consolidado da agência': 'type-consolidado',
    'Performance Ads': 'type-perf-ads',
    'Cliente específico': 'type-cliente',
    'Campanhas': 'type-campanhas',
    'Funil comercial': 'type-funil',
    'Origem dos leads': 'type-origem',
    'Motivos de perda': 'type-perda'
  };
  
  const activeId = idMap[type];
  if (activeId) {
    document.getElementById(activeId).classList.add('active');
  }
  updateReportPreview();
}

function togglePeriodDates() {
  const period = document.getElementById('report-filter-period').value;
  const dateInputs = document.getElementById('report-date-inputs');
  if (period === 'Personalizado') {
    dateInputs.style.display = 'grid';
  } else {
    dateInputs.style.display = 'none';
  }
}

function populateReportCampaigns() {
  const clientFilterVal = document.getElementById('report-filter-client').value;
  const listContainer = document.getElementById('multiselect-list-container');
  listContainer.innerHTML = '';
  
  let campaigns = [];
  if (clientFilterVal === 'Todos os clientes') {
    for (const clientName in clientDetailedData) {
      if (clientDetailedData[clientName].campaigns) {
        campaigns = campaigns.concat(clientDetailedData[clientName].campaigns);
      }
    }
  } else {
    const data = clientDetailedData[clientFilterVal];
    if (data && data.campaigns) {
      campaigns = data.campaigns;
    }
  }
  
  const seen = new Set();
  const uniqueCampaigns = [];
  campaigns.forEach(c => {
    if (!seen.has(c.name)) {
      seen.add(c.name);
      uniqueCampaigns.push(c);
    }
  });

  if (uniqueCampaigns.length === 0) {
    listContainer.innerHTML = '<div style="padding: 12px; font-size: 11px; color: var(--text-secondary); text-align: center;">Nenhuma campanha encontrada</div>';
    document.getElementById('selected-campaigns-count').innerText = 'Todas as campanhas';
    return;
  }

  uniqueCampaigns.forEach(c => {
    const item = document.createElement('div');
    item.className = 'multiselect-item';
    item.onclick = (e) => {
      if (e.target.tagName !== 'INPUT') {
        const chk = item.querySelector('input');
        chk.checked = !chk.checked;
        updateSelectedCampaignsCount();
        updateReportPreview();
      }
    };
    
    const isGoogle = c.platform.includes('Google');
    const isMeta = c.platform.includes('Meta');
    const badgeBg = isGoogle ? '#3b82f6' : (isMeta ? '#ec4899' : '#0a66c2');
    
    item.innerHTML = `
      <input type="checkbox" value="${c.name}" class="campaign-checkbox" onchange="updateSelectedCampaignsCount(); updateReportPreview();">
      <span class="multiselect-item-name" title="${c.name}">${c.name}</span>
      <span class="multiselect-item-badge" style="background-color: ${badgeBg}">${c.platform}</span>
    `;
    listContainer.appendChild(item);
  });
  
  updateSelectedCampaignsCount();
}

function updateSelectedCampaignsCount() {
  const checkboxes = document.querySelectorAll('.campaign-checkbox');
  const checked = Array.from(checkboxes).filter(chk => chk.checked);
  const triggerText = document.getElementById('selected-campaigns-count');
  
  if (checked.length === 0) {
    triggerText.innerText = 'Todas as campanhas';
  } else if (checked.length === checkboxes.length) {
    triggerText.innerText = 'Todas as campanhas';
  } else {
    triggerText.innerText = `${checked.length} selecionada(s)`;
  }
}

function filterCampaignList(query) {
  const q = query.toLowerCase().trim();
  const items = document.querySelectorAll('.multiselect-item');
  
  items.forEach(item => {
    const name = item.querySelector('.multiselect-item-name').innerText.toLowerCase();
    if (name.includes(q)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

function toggleCampaignSelectDropdown(forceState) {
  const dropdown = document.getElementById('campaign-multiselect-dropdown');
  let show = dropdown.style.display === 'none';
  if (typeof forceState === 'boolean') {
    show = forceState;
  }
  
  if (show) {
    dropdown.style.display = 'flex';
    document.addEventListener('click', closeCampaignDropdownOutside);
  } else {
    dropdown.style.display = 'none';
    document.removeEventListener('click', closeCampaignDropdownOutside);
  }
}

function closeCampaignDropdownOutside(e) {
  const dropdown = document.getElementById('campaign-multiselect-dropdown');
  const trigger = document.getElementById('campaign-multiselect-trigger');
  if (dropdown && !dropdown.contains(e.target) && !trigger.contains(e.target)) {
    toggleCampaignSelectDropdown(false);
  }
}

function applyCampaignSelection() {
  toggleCampaignSelectDropdown(false);
  updateReportPreview();
}

function updateReportPreview() {
  document.getElementById('preview-val-format').innerText = selectedReportFormat;
  document.getElementById('preview-val-type').innerText = selectedReportType;
  
  const client = document.getElementById('report-filter-client').value;
  document.getElementById('preview-val-client').innerText = client;
  
  const period = document.getElementById('report-filter-period').value;
  let periodText = period;
  if (period === 'Personalizado') {
    const start = document.getElementById('report-start-date').value || '__/__/____';
    const end = document.getElementById('report-end-date').value || '__/__/____';
    periodText = `${start} a ${end}`;
  }
  document.getElementById('preview-val-period').innerText = periodText;
  
  const platform = document.getElementById('report-filter-platform').value;
  document.getElementById('preview-val-platform').innerText = platform;
  
  const objective = document.getElementById('report-filter-objective').value;
  document.getElementById('preview-val-objective').innerText = objective;
  
  const status = document.getElementById('report-filter-status').value;
  document.getElementById('preview-val-status').innerText = status;
  
  const checkboxes = document.querySelectorAll('.campaign-checkbox');
  const checked = Array.from(checkboxes).filter(chk => chk.checked);
  let campaignsText = 'Todas';
  if (checked.length > 0 && checked.length < checkboxes.length) {
    campaignsText = checked.map(chk => chk.value.split('|').pop().trim()).join(', ');
    if (campaignsText.length > 30) {
      campaignsText = `${checked.length} selecionadas`;
    }
  }
  document.getElementById('preview-val-campaigns').innerText = campaignsText;
  
  const msgEl = document.getElementById('preview-context-msg');
  let formatDesc = '';
  if (selectedReportFormat === 'PDF') {
    formatDesc = 'O relatório visual em PDF incluirá gráficos executivos, tabelas de distribuição de leads por canal e recomendações do assistente.';
  } else if (selectedReportFormat === 'EXCEL') {
    formatDesc = 'A base estruturada em Excel conterá abas detalhadas com dados diários de cliques, CPA, conversões e funil comercial para auditoria.';
  } else {
    formatDesc = 'O arquivo simples CSV conterá linhas tabulares com as colunas de canais, investimento e leads prontos para integração com bancos de dados.';
  }
  
  let scopeDesc = '';
  if (client === 'Todos os clientes') {
    scopeDesc = ` consolidando os dados de todas as contas ativas sob a agência no período de ${periodText}.`;
  } else {
    scopeDesc = ` focado exclusivamente na performance do cliente ${client} no período de ${periodText}.`;
  }
  
  msgEl.innerText = `${formatDesc} O escopo gerado será do tipo "${selectedReportType}"${scopeDesc}`;
}

function saveReportConfigMock() {
  showToast('Configuração de relatório salva com sucesso!');
}

// ==========================================================================
// IMPORTAÇÃO / EXPORTAÇÃO DE DADOS (planilha simples <-> Supabase)
// ==========================================================================

function parseImportNumber(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = val.toString().replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseImportDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val.toISOString().slice(0, 10);
  const s = val.toString().trim();
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  return null;
}

function mapClientStatus(val) {
  const v = (val || '').toString().toLowerCase();
  if (v.includes('atenção') || v.includes('atencao')) return 'attention';
  if (v.includes('crítico') || v.includes('critico')) return 'critical';
  return 'healthy';
}

// Resolve o slug de um cliente pelo NOME (não recria o slug a partir do texto
// se o cliente já existir com outro slug — ex: "Drex Imóveis" já existe como
// slug "drex", não "drex-imoveis"). Cacheado por nome durante a importação.
const clientNameToSlugCache = {};
async function resolveOrCreateClientSlug(name) {
  if (clientNameToSlugCache[name]) return clientNameToSlugCache[name];

  const { data: existing } = await supabaseClient.from('clients').select('slug').eq('name', name).maybeSingle();
  const slug = existing ? existing.slug : slugify(name);
  clientNameToSlugCache[name] = slug;
  return slug;
}

async function ensureClientExists(name) {
  const slug = await resolveOrCreateClientSlug(name);
  const { data } = await supabaseClient.from('clients').select('slug').eq('slug', slug).maybeSingle();
  if (!data) {
    await supabaseClient.from('clients').insert({ slug, name, status: 'healthy', pinned: true, position: 999 });
  }
  return slug;
}

function downloadTemplateSpreadsheet() {
  const wb = XLSX.utils.book_new();

  const instrucoes = [
    ['PRATA - Modelo de importação de dados'],
    [''],
    ['Como usar:'],
    ['1. Preencha as abas que fizerem sentido (Clientes, Campanhas, Leads e Vendas, Pipeline Comercial). A aba Metas é opcional.'],
    ['2. Não precisa preencher nenhum ID técnico - o PRATA identifica tudo pelo nome do cliente/campanha.'],
    ['3. Salve o arquivo e importe de volta na tela de Relatórios, botão "Importar planilha preenchida".'],
    [''],
    ['Valores aceitos:'],
    ['Status do cliente: Saudável, Atenção, Crítico'],
    ['Ativo (Clientes): Sim ou Não'],
    ['Etapa (Leads e Vendas): Novo, Em abordagem, Atendido, Qualificado, Proposta enviada, Venda, Descartado'],
    ['Etapa (Pipeline Comercial): Em abordagem, Lead qualificado, Reunião agendada, Proposta enviada, Follow-up proposta, Fechado/Ganho, Descartado/Perdido'],
    ['Regra (Metas): Maior é melhor, Menor é melhor, Igual ou próximo é melhor, Apenas referência'],
    ['Datas: formato AAAA-MM-DD (ex: 2025-05-01)'],
    ['Números (Investimento, Impressões, Cliques etc.): apenas números, sem R$ ou separador de milhar']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instrucoes), 'Instruções');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cliente', 'Segmento', 'Status', 'Responsável', 'Cidade', 'Estado', 'Ativo'],
    ['Drex Imóveis', 'Imobiliário', 'Saudável', 'Felippe', 'São Paulo', 'SP', 'Sim']
  ]), 'Clientes');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Data', 'Cliente', 'Campanha', 'Plataforma', 'Objetivo', 'Status da campanha', 'Investimento', 'Impressões', 'Alcance', 'Cliques', 'Cliques no link', 'Page Views', 'Leads', 'Conversões', 'Compras', 'Receita', 'Mensagens iniciadas', 'Formulários enviados', 'Visualizações de vídeo', 'ThruPlay'],
    ['2025-05-01', 'Drex Imóveis', 'Search | Lead | Imóvel BR', 'Google Ads', 'Conversão', 'Ativa', 2800, 89000, 75000, 537, 480, 459, 42, 38, 5, 52000, 0, 0, 0, 0]
  ]), 'Campanhas');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Data', 'Cliente', 'Nome do lead', 'Empresa', 'Telefone', 'E-mail', 'Origem', 'Campanha', 'Responsável', 'Etapa', 'Status', 'Valor da venda', 'Receita', 'Motivo de perda'],
    ['2025-05-10', 'Drex Imóveis', 'João Silva', 'Silva Investimentos', '11999999999', 'joao@email.com', 'Google Ads', 'Search | Lead | Imóvel BR', 'Mayara', 'Venda', 'Ganho', 52000, 52000, '']
  ]), 'Leads e Vendas');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Data', 'Empresa', 'Segmento', 'Telefone', 'Origem', 'Responsável', 'Etapa', 'Valor estimado', 'Próximo passo', 'Observações', 'Status'],
    ['2025-05-20', 'APDR - Auto Performance Drag Race', 'Automotivo', '11914859517', 'Radar de empresas', 'Mayara', 'Em abordagem', 0, 'Primeiro contato', 'Lead importado pelo Radar de empresas', 'Novo']
  ]), 'Pipeline Comercial');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cliente', 'Objetivo', 'Métrica', 'Meta', 'Regra'],
    ['Drex Imóveis', 'Conversão', 'Taxa de Conversão', '8%', 'Maior é melhor'],
    ['Drex Imóveis', 'Conversão', 'CPA', 'R$80', 'Menor é melhor']
  ]), 'Metas (opcional)');

  XLSX.writeFile(wb, 'PRATA_modelo_importacao.xlsx');
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('import-file-name').innerText = file.name;

  const container = document.getElementById('import-results');
  container.style.display = 'block';
  container.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">Importando...</div>';

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      await processImportWorkbook(workbook);
    } catch (err) {
      console.error('Erro ao importar planilha', err);
      showImportResults({ summary: [], errors: ['Não foi possível ler o arquivo. Confira se é um .xlsx, .xls ou .csv válido.'] });
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

async function processImportWorkbook(workbook) {
  const results = { summary: [], errors: [] };

  const findSheet = (candidates) => {
    const found = workbook.SheetNames.find(n => candidates.some(c => n.toLowerCase().trim() === c.toLowerCase()));
    return found ? workbook.Sheets[found] : null;
  };

  const clientesSheet = findSheet(['Clientes']);
  const campanhasSheet = findSheet(['Campanhas']);
  const leadsSheet = findSheet(['Leads e Vendas']);
  const pipelineSheet = findSheet(['Pipeline Comercial']);
  const metasSheet = findSheet(['Metas', 'Metas (opcional)']);

  if (clientesSheet) await importClientesSheet(clientesSheet, results);
  if (campanhasSheet) await importCampanhasSheet(campanhasSheet, results);
  if (leadsSheet) await importLeadsVendasSheet(leadsSheet, results);
  if (pipelineSheet) await importPipelineSheet(pipelineSheet, results);
  if (metasSheet) await importMetasSheet(metasSheet, results);

  if (!clientesSheet && !campanhasSheet && !leadsSheet && !pipelineSheet && !metasSheet) {
    results.errors.push('Nenhuma aba reconhecida foi encontrada. As abas devem se chamar: Clientes, Campanhas, "Leads e Vendas", "Pipeline Comercial" ou Metas.');
  }

  showImportResults(results);

  // Força reavaliação dos dados reais (dashboard agência + clientes) na próxima navegação
  realClientDataChecked.clear();
  agencyRealDataChecked = false;

  allClients = await fetchClients();
  renderSidebarClients();
  // renderSidebarClients() recria os <li> da sidebar do zero, incluindo o
  // <ul class="analysis-menu"> vazio de cada cliente fixado — precisa
  // repopular as sub-abas de análise de cada um, senão elas ficam vazias.
  allClients.filter(c => c.pinned).forEach(c => renderClientSidebar(c.slug));
  showToast('Importação concluída!');
}

async function importClientesSheet(sheet, results) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const name = (r['Cliente'] || '').toString().trim();
    if (!name) { results.errors.push(`Clientes, linha ${rowNum}: "Cliente" está vazio.`); continue; }

    const activeVal = (r['Ativo'] || '').toString().trim().toLowerCase();
    const active = activeVal === '' ? true : (activeVal === 'sim' || activeVal === 'yes' || activeVal === 'true');

    const slug = await resolveOrCreateClientSlug(name);
    const payload = {
      slug,
      name,
      status: mapClientStatus(r['Status']),
      segment: (r['Segmento'] || '').toString().trim() || null,
      owner: (r['Responsável'] || '').toString().trim() || null,
      city: (r['Cidade'] || '').toString().trim() || null,
      state: (r['Estado'] || '').toString().trim() || null,
      active,
      pinned: true
    };

    const { error } = await supabaseClient.from('clients').upsert(payload, { onConflict: 'slug' });
    if (error) results.errors.push(`Clientes, linha ${rowNum}: erro ao salvar (${error.message}).`);
    else ok++;
  }
  if (ok) results.summary.push(`${ok} cliente(s) importado(s)/atualizado(s).`);
}

async function importCampanhasSheet(sheet, results) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const batch = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const clientName = (r['Cliente'] || '').toString().trim();
    const campaignName = (r['Campanha'] || '').toString().trim();
    const dateStr = parseImportDate(r['Data']);

    if (!clientName) { results.errors.push(`Campanhas, linha ${rowNum}: "Cliente" está vazio.`); continue; }
    if (!campaignName) { results.errors.push(`Campanhas, linha ${rowNum}: "Campanha" está vazia.`); continue; }
    if (!dateStr) { results.errors.push(`Campanhas, linha ${rowNum}: "Data" inválida (use AAAA-MM-DD).`); continue; }

    const clientSlug = await ensureClientExists(clientName);

    batch.push({
      client_slug: clientSlug,
      date: dateStr,
      campaign_name: campaignName,
      platform: (r['Plataforma'] || '').toString().trim() || 'Outra',
      objective: (r['Objetivo'] || '').toString().trim() || null,
      campaign_status: (r['Status da campanha'] || '').toString().trim() || null,
      invest: parseImportNumber(r['Investimento']),
      impressions: parseImportNumber(r['Impressões']),
      reach: parseImportNumber(r['Alcance']),
      clicks: parseImportNumber(r['Cliques']),
      link_clicks: parseImportNumber(r['Cliques no link']),
      page_views: parseImportNumber(r['Page Views']),
      leads: parseImportNumber(r['Leads']),
      conversions: parseImportNumber(r['Conversões']),
      purchases: parseImportNumber(r['Compras']),
      revenue: parseImportNumber(r['Receita']),
      messages_started: parseImportNumber(r['Mensagens iniciadas']),
      forms_submitted: parseImportNumber(r['Formulários enviados']),
      video_views: parseImportNumber(r['Visualizações de vídeo']),
      thruplay: parseImportNumber(r['ThruPlay'])
    });
  }

  if (batch.length) {
    const { error } = await supabaseClient.from('campaign_metrics').upsert(batch, { onConflict: 'client_slug,campaign_name,platform,date' });
    if (error) results.errors.push(`Campanhas: erro ao salvar em lote (${error.message}).`);
    else results.summary.push(`${batch.length} linha(s) de campanha importada(s).`);
  }
}

async function importLeadsVendasSheet(sheet, results) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const batch = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const clientName = (r['Cliente'] || '').toString().trim();
    const dateStr = parseImportDate(r['Data']);

    if (!clientName) { results.errors.push(`Leads e Vendas, linha ${rowNum}: "Cliente" está vazio.`); continue; }
    if (!dateStr) { results.errors.push(`Leads e Vendas, linha ${rowNum}: "Data" inválida (use AAAA-MM-DD).`); continue; }

    const clientSlug = await ensureClientExists(clientName);

    batch.push({
      client_slug: clientSlug,
      date: dateStr,
      lead_name: (r['Nome do lead'] || '').toString().trim() || `Lead linha ${rowNum}`,
      company: (r['Empresa'] || '').toString().trim() || null,
      phone: (r['Telefone'] || '').toString().trim() || null,
      email: (r['E-mail'] || '').toString().trim() || null,
      source: (r['Origem'] || '').toString().trim() || null,
      campaign_name: (r['Campanha'] || '').toString().trim() || null,
      owner: (r['Responsável'] || '').toString().trim() || null,
      stage: (r['Etapa'] || '').toString().trim() || null,
      status: (r['Status'] || '').toString().trim() || null,
      sale_value: parseImportNumber(r['Valor da venda']),
      revenue: parseImportNumber(r['Receita']),
      loss_reason: (r['Motivo de perda'] || '').toString().trim() || null
    });
  }

  if (batch.length) {
    const { error } = await supabaseClient.from('leads_sales').upsert(batch, { onConflict: 'client_slug,lead_name,date' });
    if (error) results.errors.push(`Leads e Vendas: erro ao salvar em lote (${error.message}).`);
    else results.summary.push(`${batch.length} lead(s)/venda(s) importado(s).`);
  }
}

async function importPipelineSheet(sheet, results) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const empresa = (r['Empresa'] || '').toString().trim();
    if (!empresa) { results.errors.push(`Pipeline Comercial, linha ${rowNum}: "Empresa" está vazia.`); continue; }

    const etapaNome = (r['Etapa'] || '').toString().trim() || 'Em abordagem';
    let stage = commercialStages.find(s => s.name.toLowerCase() === etapaNome.toLowerCase());
    if (!stage) {
      stage = { id: 'stage_' + Date.now() + '_' + i, name: etapaNome, color: STAGE_PRESET_COLORS[commercialStages.length % STAGE_PRESET_COLORS.length] };
      commercialStages.push(stage);
    }

    const dateStr = parseImportDate(r['Data']);
    commercialLeads.push({
      id: crypto.randomUUID(),
      name: empresa,
      stageId: stage.id,
      tag: (r['Segmento'] || '').toString().trim() || 'Geral',
      phone: (r['Telefone'] || '').toString().trim() || '',
      email: '',
      role: '',
      bu: (r['Segmento'] || '').toString().trim() || 'Geral',
      potentialValue: parseImportNumber(r['Valor estimado']),
      negotiation: '-',
      lossReason: '-',
      firstContactDate: dateStr ? formatDateDDMMYYYY(new Date(dateStr + 'T00:00:00')) : formatDateDDMMYYYY(new Date()),
      owner: (r['Responsável'] || '').toString().trim() || 'felippe.alves',
      source: (r['Origem'] || '').toString().trim() || 'Importação de planilha',
      nextAction: (r['Próximo passo'] || '').toString().trim() || '-'
    });
    ok++;
  }
  if (ok) {
    await saveCommercialState();
    results.summary.push(`${ok} card(s) de pipeline comercial importado(s).`);
  }
}

async function importMetasSheet(sheet, results) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const batch = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const clientName = (r['Cliente'] || '').toString().trim();
    const objetivo = (r['Objetivo'] || '').toString().trim();
    const metrica = (r['Métrica'] || '').toString().trim();
    if (!clientName || !objetivo || !metrica) {
      results.errors.push(`Metas, linha ${rowNum}: Cliente, Objetivo e Métrica são obrigatórios.`);
      continue;
    }

    const clientSlug = await ensureClientExists(clientName);

    const metaRaw = (r['Meta'] || '').toString();
    const format = metaRaw.includes('%') ? 'Percentual' : (metaRaw.includes('R$') ? 'Moeda' : 'Número');

    batch.push({
      client_slug: clientSlug,
      objective: objetivo,
      metric_name: metrica,
      target_value: parseImportNumber(metaRaw),
      target_format: format,
      rule: (r['Regra'] || '').toString().trim() || 'Apenas referência'
    });
  }

  if (batch.length) {
    const { error } = await supabaseClient.from('targets').upsert(batch, { onConflict: 'client_slug,objective,metric_name' });
    if (error) results.errors.push(`Metas: erro ao salvar em lote (${error.message}).`);
    else results.summary.push(`${batch.length} meta(s) importada(s).`);
  }
}

function showImportResults(results) {
  const container = document.getElementById('import-results');
  container.style.display = 'block';
  let html = '';
  if (results.summary.length) {
    html += `<div style="color: var(--color-green); font-size: 12px; margin-bottom: 8px;">✓ ${results.summary.join(' ')}</div>`;
  }
  if (results.errors.length) {
    html += `<div style="color: var(--color-red); font-size: 11px;"><strong>${results.errors.length} aviso(s):</strong><ul style="margin: 6px 0 0 18px; padding: 0;">`;
    results.errors.slice(0, 30).forEach(e => { html += `<li>${e}</li>`; });
    if (results.errors.length > 30) html += `<li>... e mais ${results.errors.length - 30}.</li>`;
    html += `</ul></div>`;
  }
  container.innerHTML = html || '<div style="color: var(--text-secondary); font-size: 12px;">Nenhum dado processado.</div>';
}

// --------------------------------------------------
// Geração real de relatórios (export)
// --------------------------------------------------

async function fetchReportCampaignRows() {
  const clientFilter = document.getElementById('report-filter-client').value;
  let query = supabaseClient.from('campaign_metrics').select('*').order('date');
  if (clientFilter && clientFilter !== 'Todos os clientes') {
    query = query.eq('client_slug', clientSlugFromName(clientFilter));
  }
  const platform = document.getElementById('report-filter-platform').value;
  if (platform && platform !== 'Todas') {
    query = query.eq('platform', platform);
  }
  const { data, error } = await query;
  if (error) { console.error('Erro ao buscar campanhas para relatório', error); return []; }
  return data || [];
}

function reportRowsToAOA(rows) {
  const header = ['Data', 'Cliente', 'Campanha', 'Plataforma', 'Objetivo', 'Investimento', 'Impressões', 'Cliques', 'Page Views', 'Leads', 'Conversões', 'Receita', 'CTR (%)', 'CPC', 'CPA', 'ROI (%)'];
  const lines = rows.map(r => {
    const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
    const cpc = r.clicks > 0 ? r.invest / r.clicks : 0;
    const cpa = r.conversions > 0 ? r.invest / r.conversions : 0;
    const roi = r.invest > 0 ? ((r.revenue - r.invest) / r.invest) * 100 : 0;
    return [
      r.date, clientNameFromSlug(r.client_slug) || r.client_slug, r.campaign_name, r.platform, r.objective || '',
      r.invest, r.impressions, r.clicks, r.page_views, r.leads, r.conversions, r.revenue,
      ctr.toFixed(2), cpc.toFixed(2), cpa.toFixed(2), roi.toFixed(2)
    ];
  });
  return [header, ...lines];
}

async function generateReport() {
  const rows = await fetchReportCampaignRows();

  if (rows.length === 0) {
    showToast('Nenhum dado de campanha importado ainda para gerar o relatório. Importe uma planilha primeiro.');
    return;
  }

  const aoa = reportRowsToAOA(rows);
  const fileBase = `PRATA_relatorio_${selectedReportType.replace(/\s+/g, '_')}`;

  if (selectedReportFormat === 'CSV') {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${fileBase}.csv`);
  } else if (selectedReportFormat === 'EXCEL') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Relatório');
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
  } else {
    // PDF simplificado: abre uma janela de impressão com a tabela pronta pra "Salvar como PDF"
    printReportAsPDF(aoa, fileBase);
  }

  showToast(`Relatório ${selectedReportFormat} ("${selectedReportType}") gerado com sucesso!`);
}

function printReportAsPDF(aoa, title) {
  const win = window.open('', '_blank');
  const [header, ...lines] = aoa;
  const rowsHtml = lines.map(line => `<tr>${line.map(v => `<td style="padding:4px 8px;border:1px solid #ccc;font-size:11px;">${v}</td>`).join('')}</tr>`).join('');
  const headHtml = `<tr>${header.map(h => `<th style="padding:4px 8px;border:1px solid #ccc;background:#eee;font-size:11px;text-align:left;">${h}</th>`).join('')}</tr>`;
  win.document.write(`
    <html><head><title>${title}</title></head>
    <body style="font-family: sans-serif;">
      <h2>PRATA - ${title}</h2>
      <table style="border-collapse: collapse;">${headHtml}${rowsHtml}</table>
      <script>window.onload = () => window.print();</script>
    </body></html>
  `);
  win.document.close();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function clearReportFilters() {
  document.getElementById('report-filter-client').value = 'Todos os clientes';
  document.getElementById('report-filter-period').value = 'Mês atual';
  document.getElementById('report-filter-platform').value = 'Todas';
  document.getElementById('report-filter-objective').value = 'Todos';
  document.getElementById('report-filter-status').value = 'Todos';
  
  togglePeriodDates();
  
  document.querySelectorAll('.campaign-checkbox').forEach(chk => chk.checked = false);
  updateSelectedCampaignsCount();
  
  selectReportFormat('PDF');
  selectReportType('Consolidado da agência');
  
  updateReportPreview();
  showToast('Filtros limpos!');
}

// --------------------------------------------------
// Comercial Module: State & Logic
// --------------------------------------------------

let commercialStages = [];
let commercialLeads = [];
let radarCompanies = [];

const DEFAULT_STAGES = [
  { id: 'abordagem', name: 'Em abordagem', color: '#3b82f6' },
  { id: 'qualificado', name: 'Lead qualificado', color: '#10b981' },
  { id: 'reuniao', name: 'Reunião agendada', color: '#8b5cf6' },
  { id: 'proposta', name: 'Proposta enviada', color: '#f97316' },
  { id: 'followup', name: 'Follow-up proposta', color: '#f59e0b' },
  { id: 'fechado', name: 'Fechado/Ganho', color: '#10b981' },
  { id: 'descartado', name: 'Descartado/Perdido', color: '#ef4444' }
];

const DEFAULT_LEADS = [
  {
    id: 1,
    name: "OralGold Clínica Odontológica",
    stageId: "abordagem",
    tag: "Saúde",
    phone: "+55 11 2441-8833",
    email: "contato@oralgold.com.br",
    role: "Diretor Clínico",
    bu: "Clínicas Privadas",
    potentialValue: 0,
    negotiation: "-",
    lossReason: "-",
    firstContactDate: "26/06/2026",
    owner: "Mayara Cristina Da Silva",
    source: "Radar de empresas",
    nextAction: "Primeiro contato"
  },
  {
    id: 2,
    name: "Startup TechX",
    stageId: "qualificado",
    tag: "Tecnologia",
    phone: "+55 11 98877-6655",
    email: "ceo@techx.co",
    role: "Co-Founder & CTO",
    bu: "SaaS Enterprise",
    potentialValue: 8000,
    negotiation: "-",
    lossReason: "-",
    firstContactDate: "26/06/2026",
    owner: "Mayara Cristina Da Silva",
    source: "LinkedIn",
    nextAction: "Apresentar case"
  },
  {
    id: 3,
    name: "Crosst-it GRU",
    stageId: "reuniao",
    tag: "Academia",
    phone: "+55 11 97823-4411",
    email: "contato@crossitgru.com.br",
    role: "Sócio Administrador",
    bu: "Crossfit Box",
    potentialValue: 2400,
    negotiation: "-",
    lossReason: "-",
    firstContactDate: "26/06/2026",
    owner: "Caio Breno Carvalho de Freitas",
    source: "Radar de empresas",
    nextAction: "Reunião marcada para sexta"
  },
  {
    id: 4,
    name: "Drex Imóveis",
    stageId: "proposta",
    tag: "Imobiliário",
    phone: "+55 11 91485-9517",
    email: "diretoria@dreximoveis.com.br",
    role: "Diretor Comercial",
    bu: "Vendas Internas",
    potentialValue: 4800,
    negotiation: "Em negociação",
    lossReason: "-",
    firstContactDate: "26/06/2026",
    owner: "felippe.alves",
    source: "Indicação",
    nextAction: "Enviar proposta"
  },
  {
    id: 5,
    name: "Sushi Hiroshi",
    stageId: "followup",
    tag: "Alimentação",
    phone: "+55 11 3285-7788",
    email: "hiroshi@sushihiroshi.com.br",
    role: "Proprietário",
    bu: "Restaurantes",
    potentialValue: 3200,
    negotiation: "Aguardando retorno",
    lossReason: "-",
    firstContactDate: "26/06/2026",
    owner: "felippe.alves",
    source: "Evento",
    nextAction: "Follow-up amanhã"
  }
];

const DEFAULT_RADAR_COMPANIES = [
  { id: 1, name: "Mundial Alimentos", segment: "Alimentos", employees: "150-200", revenue: "R$ 12M - 15M", decisionMaker: "Roberto Souza (Diretor)", mapped: false },
  { id: 2, name: "TechCore Solutions", segment: "Tecnologia", employees: "50-100", revenue: "R$ 8M - 10M", decisionMaker: "Clara Mendes (Head de Vendas)", mapped: false },
  { id: 3, name: "Vortex Logística", segment: "Logística", employees: "200+", revenue: "R$ 20M+", decisionMaker: "Joaquim Costa (COO)", mapped: false },
  { id: 4, name: "Clínica Sorella", segment: "Saúde", employees: "20-50", revenue: "R$ 3M - 5M", decisionMaker: "Dr. André Lima (Proprietário)", mapped: false },
  { id: 5, name: "AgroVale S/A", segment: "Agronegócio", employees: "100-150", revenue: "R$ 15M - 20M", decisionMaker: "Mariana Alves (Diretora)", mapped: false }
];

const STAGE_PRESET_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];

async function saveCommercialState() {
  const stageRows = commercialStages.map((s, i) => ({ id: s.id, name: s.name, color: s.color, position: i }));
  const leadRows = commercialLeads.map(l => ({
    id: l.id,
    name: l.name,
    stage_id: l.stageId,
    tag: l.tag,
    phone: l.phone,
    email: l.email,
    role: l.role,
    bu: l.bu,
    potential_value: l.potentialValue || 0,
    negotiation: l.negotiation,
    loss_reason: l.lossReason,
    first_contact_date: l.firstContactDate,
    owner: l.owner,
    source: l.source,
    next_action: l.nextAction
  }));
  const radarRows = radarCompanies.map(r => ({
    id: r.id,
    name: r.name,
    segment: r.segment,
    employees: r.employees,
    revenue: r.revenue,
    decision_maker: r.decisionMaker,
    mapped: r.mapped,
    place_id: r.placeId || null,
    address: r.address || null,
    phone: r.phone || null,
    website: r.website || null,
    rating: r.rating || null,
    rating_count: r.ratingCount || null,
    business_status: r.businessStatus || null,
    open_now: typeof r.openNow === 'boolean' ? r.openNow : null,
    lat: r.lat || null,
    lng: r.lng || null,
    google_maps_url: r.googleMapsUrl || null
  }));

  // Sincroniza por completo (mesmo padrão do localStorage: sobrescreve tudo a cada mudança)
  await supabaseClient.from('commercial_leads').delete().not('id', 'is', null);
  await supabaseClient.from('commercial_stages').delete().not('id', 'is', null);
  await supabaseClient.from('radar_companies').delete().not('id', 'is', null);

  if (stageRows.length) await supabaseClient.from('commercial_stages').insert(stageRows);
  if (leadRows.length) await supabaseClient.from('commercial_leads').insert(leadRows);
  if (radarRows.length) await supabaseClient.from('radar_companies').insert(radarRows);
}

async function loadCommercialState() {
  const [stagesRes, leadsRes, radarRes] = await Promise.all([
    supabaseClient.from('commercial_stages').select('*').order('position'),
    supabaseClient.from('commercial_leads').select('*').order('created_at'),
    supabaseClient.from('radar_companies').select('*').order('created_at')
  ]);

  if (stagesRes.error || leadsRes.error || radarRes.error) {
    console.error('Erro ao carregar dados comerciais', stagesRes.error, leadsRes.error, radarRes.error);
  }

  commercialStages = stagesRes.data && stagesRes.data.length
    ? stagesRes.data.map(s => ({ id: s.id, name: s.name, color: s.color }))
    : [...DEFAULT_STAGES];

  commercialLeads = leadsRes.data
    ? leadsRes.data.map(l => ({
        id: l.id,
        name: l.name,
        stageId: l.stage_id,
        tag: l.tag,
        phone: l.phone,
        email: l.email,
        role: l.role,
        bu: l.bu,
        potentialValue: Number(l.potential_value) || 0,
        negotiation: l.negotiation,
        lossReason: l.loss_reason,
        firstContactDate: l.first_contact_date,
        owner: l.owner,
        source: l.source,
        nextAction: l.next_action
      }))
    : [...DEFAULT_LEADS];

  radarCompanies = radarRes.data
    ? radarRes.data.map(r => ({
        id: r.id,
        name: r.name,
        segment: r.segment,
        employees: r.employees,
        revenue: r.revenue,
        decisionMaker: r.decision_maker,
        mapped: r.mapped,
        placeId: r.place_id || null,
        address: r.address || null,
        phone: r.phone || null,
        website: r.website || null,
        rating: r.rating || null,
        ratingCount: r.rating_count || null,
        businessStatus: r.business_status || null,
        openNow: r.open_now,
        lat: r.lat || null,
        lng: r.lng || null,
        googleMapsUrl: r.google_maps_url || null
      }))
    : [...DEFAULT_RADAR_COMPANIES];
}

// Collapsible Menu Expansion
function toggleComercialExpand() {
  const container = document.getElementById('container-comercial');
  const submenu = document.getElementById('analysis-menu-comercial');
  const isExpanded = container.classList.toggle('expanded');
  
  if (isExpanded) {
    submenu.style.display = 'flex';
  } else {
    submenu.style.display = 'none';
  }
}

// Select Commercial tabs
function selectComercialTab(tab) {
  currentClient = "";
  
  // Hide all screens
  document.getElementById('view-dashboard-pai').style.display = 'none';
  document.getElementById('view-dashboard-filho').style.display = 'none';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  const viewColab = document.getElementById('view-colaboradores');
  if (viewColab) viewColab.style.display = 'none';
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  const viewConfig = document.getElementById('view-configuracoes');
  if (viewConfig) viewConfig.style.display = 'none';

  document.getElementById('view-comercial-radar').style.display = 'none';
  document.getElementById('view-comercial-pipeline').style.display = 'none';
  const comContatos = document.getElementById('view-comercial-contatos');
  if (comContatos) comContatos.style.display = 'none';
  
  // Show selected screen
  if (tab === 'radar') {
    document.getElementById('view-comercial-radar').style.display = 'block';
    // Clear search results and show empty state by default
    document.getElementById('radar-search-query').value = '';
    document.getElementById('radar-empty-state').style.display = 'flex';
    document.getElementById('radar-loading-state').style.display = 'none';
    document.getElementById('radar-results-card').style.display = 'none';
  } else if (tab === 'pipeline') {
    document.getElementById('view-comercial-pipeline').style.display = 'block';
    renderPipelineKanban();
    updatePipelineGlobalMetrics();
  } else if (tab === 'contatos') {
    if (comContatos) comContatos.style.display = 'block';
    renderPipelineContactsTable();
    populateContactsFilterStage();
  }
  
  // Update sidebar active highlights
  document.getElementById('menu-dashboard-link').classList.remove('active');
  const menuColab = document.getElementById('menu-colaboradores-link');
  if (menuColab) menuColab.classList.remove('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  const menuConfig = document.getElementById('menu-configuracoes-link');
  if (menuConfig) menuConfig.classList.remove('active');

  // Remove active from all clients
  const clientItems = document.querySelectorAll('.client-item');
  clientItems.forEach(item => {
    item.classList.remove('active');
    item.style.backgroundColor = 'transparent';
  });
  
  const allAnalysisItems = document.querySelectorAll('.analysis-item');
  allAnalysisItems.forEach(item => item.classList.remove('active'));
  
  // Highlight Comercial
  const comHeader = document.getElementById('sidebar-comercial-header');
  if (comHeader) {
    comHeader.classList.add('active');
    comHeader.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
  }
  
  const activeSubitem = document.getElementById(`analysis-comercial-${tab}`);
  if (activeSubitem) activeSubitem.classList.add('active');
}

// --------------------------------------------------
// Kanban Render & Logic
// --------------------------------------------------

function renderPipelineKanban() {
  const board = document.getElementById('pipeline-kanban-board');
  if (!board) return;
  board.innerHTML = '';
  
  commercialStages.forEach(stage => {
    const stageLeads = commercialLeads.filter(l => l.stageId === stage.id);
    const sumValue = stageLeads.reduce((acc, curr) => acc + (curr.potentialValue || 0), 0);
    
    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.draggable = true;
    col.setAttribute('data-stage-id', stage.id);
    col.style.borderTop = `3px solid ${stage.color || 'var(--border-color)'}`;
    
    // Column Drag events
    col.ondragstart = (e) => handleColumnDragStart(e, stage.id);
    col.ondragover = (e) => handleColumnDragOver(e);
    col.ondrop = (e) => {
      if (draggedCardId) {
        handleCardDrop(e, stage.id);
      } else {
        handleColumnDrop(e, stage.id);
      }
    };
    col.ondragend = (e) => handleColumnDragEnd(e);
    
    const header = document.createElement('div');
    header.className = 'kanban-column-header';
    header.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="column-drag-handle" style="cursor: grab; color: var(--text-muted); font-size: 14px; user-select: none;">⋮⋮</span>
          <span class="column-title-text" style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-primary); font-family: var(--font-family-title); letter-spacing: 0.5px;">${stage.name}</span>
        </div>
        <span class="column-actions-trigger" onclick="openStageSettings('${stage.id}', event)" style="cursor: pointer; color: var(--text-secondary); padding: 2px 4px; font-size: 14px;">⋮</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 10px; color: var(--text-secondary);">
        <span class="column-summary-count">${stageLeads.length} op${stageLeads.length !== 1 ? 's' : ''}</span>
        <span class="column-summary-value">${formatCurrencyBRL(sumValue)}</span>
      </div>
    `;
    
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'kanban-cards-container';
    cardsContainer.setAttribute('data-stage-id', stage.id);
    cardsContainer.style.flexGrow = '1';
    cardsContainer.style.minHeight = '150px';
    cardsContainer.style.overflowY = 'auto';
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.gap = '10px';
    
    cardsContainer.ondragenter = (e) => cardsContainer.classList.add('drag-over');
    cardsContainer.ondragleave = (e) => cardsContainer.classList.remove('drag-over');
    
    // Populate cards
    stageLeads.forEach(lead => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = true;
      card.setAttribute('data-lead-id', lead.id);
      
      card.ondragstart = (e) => handleCardDragStart(e, lead.id);
      card.ondragend = (e) => handleCardDragEnd(e);
      
      card.onclick = (e) => openLeadDetails(lead.id, e);
      
      const ownerName = getOwnerName(lead.owner);
      const ownerInitials = getInitials(ownerName);
      
      const radarBadge = lead.radar ? `<span style="display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; background: linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%); color: #1e293b; padding: 1px 4px; border-radius: 3px; margin-left: 6px; vertical-align: middle; line-height: 1;" title="Importado do Radar">PRATA</span>` : '';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <span class="card-lead-name" style="font-weight: 600; font-size: 12px; color: var(--text-primary); word-break: break-word;">${lead.name}${radarBadge}</span>
          <span class="card-menu-trigger" onclick="event.stopPropagation(); deleteLeadQuick('${lead.id}')" title="Excluir Lead" style="cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 0 4px; line-height: 1;">&times;</span>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          <span class="card-tag" style="background-color: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: 4px; font-size: 9px; padding: 2px 6px; color: var(--text-secondary); font-weight: 500;">${lead.tag || 'Sem tag'}</span>
        </div>
        <div style="font-size: 10px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 3px;">
          <div class="card-info-item"><span>${lead.phone || '-'}</span></div>
          <div class="card-info-item" style="color: var(--text-muted);"><span>${lead.source || '-'}</span></div>
          <div class="card-info-item" style="font-weight: 500; color: var(--text-primary);"><span>${lead.nextAction || '-'}</span></div>
        </div>
        <div style="height: 1px; background-color: var(--divider-color); margin: 2px 0;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="card-owner-avatar" style="width: 18px; height: 18px; border-radius: 50%; background-color: var(--color-purple); color: var(--text-white); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; text-transform: uppercase;">
              ${ownerInitials}
            </div>
            <span style="font-size: 9px; color: var(--text-secondary); max-width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ownerName.split(' ')[0]}</span>
          </div>
          <span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">${formatCurrencyBRL(lead.potentialValue)}</span>
        </div>
      `;
      cardsContainer.appendChild(card);
    });
    
    const addCardBtn = document.createElement('button');
    addCardBtn.className = 'kanban-add-card-btn';
    addCardBtn.onclick = () => openAddLeadDrawer(stage.id);
    addCardBtn.innerHTML = `<span>+ Adicionar</span>`;
    
    col.appendChild(header);
    col.appendChild(cardsContainer);
    col.appendChild(addCardBtn);
    
    board.appendChild(col);
  });
  
  const addStageCol = document.createElement('div');
  addStageCol.className = 'kanban-add-stage-column';
  addStageCol.onclick = () => promptAddStage();
  addStageCol.innerHTML = `<span>+ Adicionar etapa</span>`;
  board.appendChild(addStageCol);
}

// --------------------------------------------------
// Drag & Drop Column and Card Handlers
// --------------------------------------------------

let draggedColumnId = null;
let draggedCardId = null;

function handleColumnDragStart(e, stageId) {
  if (!e.target.closest('.column-drag-handle')) {
    e.preventDefault();
    return;
  }
  draggedColumnId = stageId;
  e.dataTransfer.effectAllowed = 'move';
  const columnEl = e.target.closest('.kanban-column');
  if (columnEl) {
    columnEl.style.opacity = '0.4';
  }
}

function handleColumnDragOver(e) {
  e.preventDefault();
  const columnEl = e.target.closest('.kanban-column');
  if (columnEl && draggedColumnId && draggedColumnId !== columnEl.getAttribute('data-stage-id')) {
    columnEl.classList.add('drag-over');
  }
}

function handleColumnDrop(e, targetStageId) {
  e.preventDefault();
  const columnEl = e.target.closest('.kanban-column');
  if (columnEl) {
    columnEl.classList.remove('drag-over');
  }
  
  if (draggedColumnId && draggedColumnId !== targetStageId) {
    const fromIdx = commercialStages.findIndex(s => s.id === draggedColumnId);
    const toIdx = commercialStages.findIndex(s => s.id === targetStageId);
    if (fromIdx !== -1 && toIdx !== -1) {
      const [moved] = commercialStages.splice(fromIdx, 1);
      commercialStages.splice(toIdx, 0, moved);
      saveCommercialState();
      renderPipelineKanban();
      populateContactsFilterStage();
    }
  }
}

function handleColumnDragEnd(e) {
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.style.opacity = '1';
    col.classList.remove('drag-over');
  });
  draggedColumnId = null;
}

function handleCardDragStart(e, leadId) {
  // Sem isso, o dragstart do card sobe (bubble) até a coluna, que também tem
  // seu próprio ondragstart (pro drag-handle ⋮⋮ de reordenar colunas). Como o
  // alvo não é o drag-handle, esse handler chama preventDefault() no
  // dragstart e cancela o drag inteiro do card antes mesmo de começar.
  e.stopPropagation();
  draggedCardId = leadId;
  e.dataTransfer.setData('text/plain', leadId);
  e.target.classList.add('dragging');
}

function handleCardDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.kanban-cards-container').forEach(c => {
    c.classList.remove('drag-over');
  });
  draggedCardId = null;
}

function handleCardDrop(e, targetStageId) {
  e.preventDefault();
  const leadId = e.dataTransfer.getData('text/plain') || draggedCardId;
  if (leadId) {
    const lead = commercialLeads.find(l => l.id.toString() === leadId.toString());
    if (lead && lead.stageId !== targetStageId) {
      lead.stageId = targetStageId;
      saveCommercialState();
      renderPipelineKanban();
      renderPipelineContactsTable();
      updatePipelineGlobalMetrics();
      showToast(`Lead "${lead.name}" movido.`);
    }
  }
}

// --------------------------------------------------
// Contacts Table Render & Filters
// --------------------------------------------------

function renderPipelineContactsTable(filteredLeads = null) {
  const tbody = document.getElementById('contacts-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const list = filteredLeads || commercialLeads;
  
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">Nenhum lead encontrado.</td></tr>`;
    return;
  }
  
  list.forEach(lead => {
    const stage = commercialStages.find(s => s.id === lead.stageId);
    const stageName = stage ? stage.name : lead.stageId;
    const stageColor = stage ? stage.color : '#64748b';
    const ownerName = getOwnerName(lead.owner);
    
    const radarBadge = lead.radar ? `<span style="display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; background: linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%); color: #1e293b; padding: 1px 4px; border-radius: 3px; margin-left: 6px; vertical-align: middle; line-height: 1;" title="Importado do Radar">PRATA</span>` : '';
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = (e) => openLeadDetails(lead.id, e);
    
    tr.innerHTML = `
      <td><strong style="color: var(--text-primary); font-weight: 600;">${lead.name}${radarBadge}</strong></td>
      <td>
        <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: bold; text-transform: uppercase; color: ${stageColor}; background-color: rgba(255,255,255,0.02); border: 1px solid ${stageColor}40; padding: 2px 8px; border-radius: 4px;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background-color: ${stageColor};"></span>
          ${stageName}
        </span>
      </td>
      <td>${lead.phone || '-'}</td>
      <td style="color: var(--text-secondary); font-family: monospace;">${lead.email || '-'}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 16px; height: 16px; border-radius: 50%; background-color: var(--color-purple); color: var(--text-white); font-size: 8px; font-weight: bold; display: flex; align-items: center; justify-content: center;">
            ${getInitials(ownerName)}
          </div>
          <span>${ownerName.split(' ')[0]}</span>
        </div>
      </td>
      <td>${lead.role || '-'}</td>
      <td>${lead.bu || '-'}</td>
      <td style="text-align: right; font-weight: 600; color: var(--text-primary);">${formatCurrencyBRL(lead.potentialValue)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateContactsFilterStage() {
  const filter = document.getElementById('contacts-filter-stage');
  if (!filter) return;
  
  filter.innerHTML = `<option value="Todos">Todos os status</option>`;
  commercialStages.forEach(stg => {
    const opt = document.createElement('option');
    opt.value = stg.id;
    opt.innerText = stg.name;
    filter.appendChild(opt);
  });
}

function filterContactsList(searchQuery) {
  const stageFilter = document.getElementById('contacts-filter-stage').value;
  const query = searchQuery.toLowerCase().trim();
  
  const filtered = commercialLeads.filter(lead => {
    const ownerName = getOwnerName(lead.owner).toLowerCase();
    const stage = commercialStages.find(s => s.id === lead.stageId);
    const stageName = stage ? stage.name.toLowerCase() : '';
    
    const matchesSearch = !query || 
      lead.name.toLowerCase().includes(query) ||
      (lead.email && lead.email.toLowerCase().includes(query)) ||
      (lead.phone && lead.phone.toLowerCase().includes(query)) ||
      (lead.role && lead.role.toLowerCase().includes(query)) ||
      (lead.bu && lead.bu.toLowerCase().includes(query)) ||
      ownerName.includes(query);
      
    const matchesStage = stageFilter === 'Todos' || lead.stageId === stageFilter;
    
    return matchesSearch && matchesStage;
  });
  
  renderPipelineContactsTable(filtered);
}

// --------------------------------------------------
// Radar de Empresas Logic & Render (Google Maps Rework)
// --------------------------------------------------

let radarSearchResults = [];
let radarSearchInFlight = false;
let radarLastQuery = '';
let radarNextPageToken = null;

function executeRadarSearch() {
  const queryInput = document.getElementById('radar-search-query');
  if (!queryInput) return;
  const query = queryInput.value.trim();
  if (!query) {
    showToast('Digite uma empresa, nicho ou cidade para buscar! 🔍');
    return;
  }
  if (radarSearchInFlight) return;

  radarLastQuery = query;
  radarNextPageToken = null;
  runRadarSearch(query, null, false);
}

function loadMoreRadarResults() {
  if (radarSearchInFlight || !radarNextPageToken) return;
  runRadarSearch(radarLastQuery, radarNextPageToken, true);
}

// Faz a busca real de verdade (Text Search + Place Details) via api/places-search
// (proxy no servidor — a chave do Google nunca chega no navegador). Cobre os
// 4 estados da tela: carregando, erro, sem resultado, e resultados (com
// paginação via "Carregar mais").
async function runRadarSearch(query, pageToken, append) {
  radarSearchInFlight = true;
  const searchBtn = document.getElementById('radar-search-btn');
  if (searchBtn) searchBtn.disabled = true;

  const emptyState = document.getElementById('radar-empty-state');
  const loadingState = document.getElementById('radar-loading-state');
  const errorState = document.getElementById('radar-error-state');
  const noResultsState = document.getElementById('radar-no-results-state');
  const resultsCard = document.getElementById('radar-results-card');
  const loadMoreBtn = document.getElementById('radar-load-more-btn');

  if (errorState) errorState.style.display = 'none';
  if (noResultsState) noResultsState.style.display = 'none';

  if (!append) {
    if (emptyState) emptyState.style.display = 'none';
    resultsCard.style.display = 'none';
    loadingState.style.display = 'flex';
  } else if (loadMoreBtn) {
    loadMoreBtn.innerText = 'Carregando...';
    loadMoreBtn.disabled = true;
  }

  try {
    const response = await fetch('/api/places-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pageToken ? { pageToken } : { query })
    });
    const data = await response.json().catch(() => ({}));

    loadingState.style.display = 'none';

    if (!response.ok) {
      if (!append) resultsCard.style.display = 'none';
      if (errorState) {
        errorState.style.display = 'flex';
        const msgEl = document.getElementById('radar-error-message');
        if (msgEl) msgEl.innerText = data.error || 'Erro ao consultar o Google Maps. Tente novamente.';
      }
      return;
    }

    const newResults = (data.results || []).map(placeToRadarRow);
    radarSearchResults = append ? radarSearchResults.concat(newResults) : newResults;
    radarNextPageToken = data.nextPageToken || null;

    markAlreadyAddedRadarResults();

    if (radarSearchResults.length === 0) {
      resultsCard.style.display = 'none';
      if (noResultsState) {
        noResultsState.style.display = 'flex';
        const qEl = document.getElementById('radar-no-results-query');
        if (qEl) qEl.innerText = query;
      }
    } else {
      resultsCard.style.display = 'block';
      renderRadarSearchResults();
      populateRadarAssignOwner();
    }

    if (loadMoreBtn) {
      loadMoreBtn.style.display = radarNextPageToken ? 'inline-block' : 'none';
      loadMoreBtn.innerText = 'Carregar mais';
      loadMoreBtn.disabled = false;
    }

    if (!append) showToast(`Google Maps encontrou ${radarSearchResults.length} empresa(s) para "${query}"! 📡`);
  } catch (err) {
    console.error('Erro ao buscar no Radar de Empresas', err);
    loadingState.style.display = 'none';
    if (!append) resultsCard.style.display = 'none';
    if (errorState) {
      errorState.style.display = 'flex';
      const msgEl = document.getElementById('radar-error-message');
      if (msgEl) msgEl.innerText = 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
    }
  } finally {
    radarSearchInFlight = false;
    if (searchBtn) searchBtn.disabled = false;
  }
}

// Converte um resultado do Google Places (já normalizado pelo backend) na
// linha usada pela tabela do Radar de Empresas.
function placeToRadarRow(p) {
  return {
    id: p.placeId,
    placeId: p.placeId,
    name: p.name,
    niche: p.category || 'Estabelecimento',
    phone: p.phone || 'Sem telefone',
    address: p.address || 'Endereço não informado',
    rating: typeof p.rating === 'number' ? `★ ${p.rating.toFixed(1)} (${p.ratingCount || 0})` : 'Sem avaliação',
    ratingValue: typeof p.rating === 'number' ? p.rating : null,
    ratingCount: p.ratingCount || 0,
    hasWebsite: !!p.website,
    website: p.website || null,
    hasMaps: true,
    googleMapsUrl: p.googleMapsUrl,
    businessStatus: p.businessStatus || null,
    openNow: typeof p.openNow === 'boolean' ? p.openNow : null,
    lat: p.lat,
    lng: p.lng,
    status: 'Novo',
    addedToRadar: false,
    checked: false
  };
}

// Marca cada resultado como já adicionado ao Radar (radarCompanies, em
// memória desde loadCommercialState) usando o Place ID — nunca por nome,
// que é frágil e pode dar falso positivo/negativo.
function markAlreadyAddedRadarResults() {
  radarSearchResults.forEach(res => {
    res.addedToRadar = radarCompanies.some(r => r.placeId === res.placeId);
    const isImportedToPipeline = commercialLeads.some(lead => lead.name.startsWith(res.name));
    if (isImportedToPipeline) res.status = 'Importado';
  });
}

// Salva uma empresa encontrada no Radar (tabela radar_companies), usando o
// Place ID como chave de deduplicação. Ação independente do "Importar
// lead(s)" em lote, que continua levando direto pro Pipeline comercial.
async function addRadarResultToDatabase(id) {
  const res = radarSearchResults.find(r => r.id === id);
  if (!res) return;

  if (res.addedToRadar || radarCompanies.some(r => r.placeId === res.placeId)) {
    res.addedToRadar = true;
    renderRadarSearchResults();
    showToast('Empresa já adicionada. ✅');
    return;
  }

  const newCompany = {
    id: crypto.randomUUID(),
    name: res.name,
    segment: res.niche,
    employees: null,
    revenue: null,
    decisionMaker: null,
    mapped: false,
    placeId: res.placeId,
    address: res.address === 'Endereço não informado' ? null : res.address,
    phone: res.phone === 'Sem telefone' ? null : res.phone,
    website: res.website,
    rating: res.ratingValue,
    ratingCount: res.ratingCount,
    businessStatus: res.businessStatus,
    openNow: res.openNow,
    lat: res.lat,
    lng: res.lng,
    googleMapsUrl: res.googleMapsUrl
  };

  radarCompanies.push(newCompany);
  await saveCommercialState();

  res.addedToRadar = true;
  renderRadarSearchResults();
  showToast(`${res.name} adicionada ao Radar! 📡`);
}

function renderRadarSearchResults() {
  const tbody = document.getElementById('radar-search-results-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  document.getElementById('radar-found-count').innerText = `${radarSearchResults.length} empresa(s) encontradas`;
  
  const checkAll = document.getElementById('radar-check-all');
  if (checkAll) {
    checkAll.checked = radarSearchResults.length > 0 && radarSearchResults.every(r => r.checked || r.status === 'Importado');
  }
  
  radarSearchResults.forEach(res => {
    const tr = document.createElement('tr');

    const isImported = res.status === 'Importado';
    const isNoPhone = res.status === 'Sem telefone';

    const checkboxHtml = isImported
      ? `<input type="checkbox" disabled style="opacity: 0.3; width: 14px; height: 14px;">`
      : `<input type="checkbox" ${res.checked ? 'checked' : ''} onclick="toggleRadarRowCheck('${res.id}', this.checked)" style="cursor: pointer; width: 14px; height: 14px;">`;

    const websiteLink = res.hasWebsite
      ? `<a href="${escapeHtml(res.website)}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.02); color: var(--text-secondary); text-decoration: none; font-size: 10px; font-weight: bold; margin-right: 4px;" title="Website">🌐</a>`
      : `<span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted); opacity: 0.3; font-size: 10px; font-weight: bold; margin-right: 4px;">🌐</span>`;

    const mapsLink = res.hasMaps
      ? `<a href="${escapeHtml(res.googleMapsUrl)}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.02); color: var(--text-secondary); text-decoration: none; font-size: 10px; font-weight: bold; margin-right: 4px;" title="Google Maps">📍</a>`
      : `<span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted); opacity: 0.3; font-size: 10px; font-weight: bold; margin-right: 4px;">📍</span>`;

    const addToRadarBtn = res.addedToRadar
      ? `<span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid rgba(16,185,129,0.35); background: rgba(16,185,129,0.08); color: var(--color-green); font-size: 11px; font-weight: bold;" title="Empresa já adicionada ao Radar">✓</span>`
      : `<button onclick="addRadarResultToDatabase('${res.id}')" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.02); color: var(--text-secondary); cursor: pointer; font-size: 11px; font-weight: bold;" title="Adicionar ao Radar">➕</button>`;

    let statusTag = '';
    if (isImported) {
      statusTag = `<span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-green); background-color: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.25); padding: 2px 8px; border-radius: 4px; display: inline-block;">Importado</span>`;
    } else if (isNoPhone) {
      statusTag = `<span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--text-muted); background-color: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 2px 8px; border-radius: 4px; display: inline-block; opacity: 0.6;">Sem telefone</span>`;
    } else {
      statusTag = `<span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-blue); background-color: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.25); padding: 2px 8px; border-radius: 4px; display: inline-block;">Novo</span>`;
    }

    let openNowTag = '';
    if (res.openNow === true) {
      openNowTag = `<span style="font-size: 9px; color: var(--color-green); display: block; margin-top: 2px;">● Aberto agora</span>`;
    } else if (res.openNow === false) {
      openNowTag = `<span style="font-size: 9px; color: var(--text-muted); display: block; margin-top: 2px;">● Fechado agora</span>`;
    }

    tr.innerHTML = `
      <td style="padding: 12px 16px;">${checkboxHtml}</td>
      <td>
        <strong style="color: var(--text-primary); font-weight: 600; display: block;">${escapeHtml(res.name)}</strong>
        <span style="font-size: 9px; color: var(--text-secondary); display: block; margin-top: 1px;">${escapeHtml(res.niche)}</span>
      </td>
      <td><span style="font-size: 11px; font-family: monospace; color: ${res.phone === 'Sem telefone' ? 'var(--text-muted)' : 'var(--text-secondary)'};">${escapeHtml(res.phone)}</span></td>
      <td><span style="font-size: 11px; color: var(--text-secondary); max-width: 250px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(res.address)}">${escapeHtml(res.address)}</span></td>
      <td>
        <span style="font-size: 11px; color: ${res.rating === 'Sem avaliação' ? 'var(--text-muted)' : 'var(--color-green)'};">
          ${escapeHtml(res.rating)}
        </span>
        ${openNowTag}
      </td>
      <td>
        <div style="display: flex; align-items: center;">
          ${websiteLink}
          ${mapsLink}
          ${addToRadarBtn}
        </div>
      </td>
      <td style="text-align: right; padding-right: 20px;">${statusTag}</td>
    `;
    tbody.appendChild(tr);
  });
  
  updateRadarSelectionCount();
}

function toggleRadarRowCheck(id, checked) {
  const row = radarSearchResults.find(r => r.id === id);
  if (row) {
    row.checked = checked;
    renderRadarSearchResults();
  }
}

function toggleAllRadarChecks(checked) {
  radarSearchResults.forEach(res => {
    if (res.status !== 'Importado') {
      res.checked = checked;
    }
  });
  renderRadarSearchResults();
}

function updateRadarSelectionCount() {
  const selectedCount = radarSearchResults.filter(r => r.checked && r.status !== 'Importado').length;
  const totalCount = radarSearchResults.length;
  
  const selCountEl = document.getElementById('radar-selected-count');
  if (selCountEl) selCountEl.innerText = `${selectedCount} selecionada(s) de ${totalCount} disponíveis`;
  
  const importBtn = document.getElementById('radar-import-btn');
  if (importBtn) {
    if (selectedCount > 0) {
      importBtn.style.opacity = '1';
      importBtn.style.pointerEvents = 'auto';
      importBtn.style.cursor = 'pointer';
      importBtn.style.background = '';
      importBtn.style.borderColor = '';
    } else {
      importBtn.style.opacity = '0.4';
      importBtn.style.pointerEvents = 'none';
      importBtn.style.cursor = 'default';
      importBtn.style.background = '';
      importBtn.style.borderColor = '';
    }
  }
}

function populateRadarAssignOwner() {
  const select = document.getElementById('radar-assign-owner');
  if (!select) return;
  
  select.innerHTML = `<option value="auto">Automático</option>`;
  
  const owners = [
    { id: 'felippe.alves', name: 'Felippe Alves' },
    ...collaboratorsList.map(c => ({ id: c.name, name: c.name }))
  ];
  
  owners.forEach(ow => {
    const opt = document.createElement('option');
    opt.value = ow.id;
    opt.innerText = ow.name;
    select.appendChild(opt);
  });
}

function importSelectedRadarLeads() {
  const selected = radarSearchResults.filter(r => r.checked && r.status !== 'Importado');
  if (selected.length === 0) return;
  
  const ownerVal = document.getElementById('radar-assign-owner').value;
  let defaultOwner = ownerVal;
  
  if (ownerVal === 'auto') {
    defaultOwner = 'felippe.alves';
  }
  
  selected.forEach(res => {
    res.status = 'Importado';
    res.checked = false;
    
    const alreadyExists = commercialLeads.some(l => l.name.startsWith(res.name));
    if (alreadyExists) return;
    
    const newLead = {
      id: crypto.randomUUID(),
      name: res.name,
      stageId: 'abordagem',
      tag: res.niche,
      phone: res.phone === 'Sem telefone' ? '' : res.phone,
      email: '',
      role: 'Decisor',
      bu: 'Radar',
      potentialValue: 0,
      negotiation: '-',
      lossReason: '-',
      firstContactDate: formatDateDDMMYYYY(new Date()),
      owner: defaultOwner,
      source: 'Radar de empresas',
      nextAction: 'Qualificar contato',
      radar: true
    };
    
    commercialLeads.push(newLead);
  });
  
  saveCommercialState();
  renderRadarSearchResults();
  
  showToast(`${selected.length} lead(s) importado(s) com sucesso! 🥈`);
}

// --------------------------------------------------
// Details Drawer Forms & Actions
// --------------------------------------------------

let currentEditingLeadId = null;

function openLeadDetails(leadId, event) {
  if (event && (event.target.classList.contains('card-menu-trigger') || event.target.closest('.card-menu-trigger'))) {
    return;
  }
  
  currentEditingLeadId = leadId;
  const lead = commercialLeads.find(l => l.id.toString() === leadId.toString());
  if (!lead) return;
  
  document.getElementById('lead-details-drawer').style.display = 'flex';
  
  document.getElementById('edit-lead-name').value = lead.name;
  document.getElementById('edit-lead-tag').value = lead.tag || '';
  document.getElementById('edit-lead-phone').value = lead.phone || '';
  document.getElementById('edit-lead-email').value = lead.email || '';
  document.getElementById('edit-lead-role').value = lead.role || '';
  document.getElementById('edit-lead-bu').value = lead.bu || '';
  document.getElementById('edit-lead-value').value = lead.potentialValue || 0;
  document.getElementById('edit-lead-negoc').value = lead.negotiation || '';
  document.getElementById('edit-lead-loss').value = lead.lossReason || '';
  document.getElementById('edit-lead-date').value = lead.firstContactDate || '';
  document.getElementById('edit-lead-source').value = lead.source || '';
  document.getElementById('edit-lead-next-action').value = lead.nextAction || '';
  
  const stageSelect = document.getElementById('edit-lead-stage');
  stageSelect.innerHTML = '';
  commercialStages.forEach(stg => {
    const opt = document.createElement('option');
    opt.value = stg.id;
    opt.innerText = stg.name;
    opt.selected = (stg.id === lead.stageId);
    stageSelect.appendChild(opt);
  });
  
  const ownerSelect = document.getElementById('edit-lead-owner-select');
  ownerSelect.innerHTML = '';
  
  const owners = [
    { id: 'felippe.alves', name: 'Felippe Alves' },
    ...collaboratorsList.map(c => ({ id: c.email, name: c.name }))
  ];
  
  owners.forEach(ow => {
    const opt = document.createElement('option');
    opt.value = ow.id;
    opt.innerText = ow.name;
    opt.selected = (ow.id === lead.owner || ow.name === lead.owner);
    ownerSelect.appendChild(opt);
  });
  
  updateOwnerAvatar(lead.owner || 'felippe.alves');
  loadLeadAttachments(leadId);
}

function closeLeadDetailsDrawer() {
  document.getElementById('lead-details-drawer').style.display = 'none';
  currentEditingLeadId = null;
}

// --------------------------------------------------
// Anexos do Lead (Supabase Storage + commercial_lead_attachments)
// --------------------------------------------------

const LEAD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function handleAttachmentDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('lead-attachment-dropzone');
  if (dropzone) {
    dropzone.style.borderColor = 'var(--border-color)';
    dropzone.style.backgroundColor = 'rgba(255,255,255,0.01)';
  }
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) uploadLeadAttachment(file);
}

function handleAttachmentFileInput(event) {
  const file = event.target.files && event.target.files[0];
  if (file) uploadLeadAttachment(file);
  event.target.value = '';
}

async function uploadLeadAttachment(file) {
  if (!currentEditingLeadId) return;

  if (file.size > LEAD_ATTACHMENT_MAX_BYTES) {
    showToast('Arquivo muito grande (máximo 10MB). 📎');
    return;
  }

  const leadId = currentEditingLeadId;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${leadId}/${Date.now()}-${safeName}`;

  showToast('Enviando anexo...');

  const { error: uploadError } = await supabaseClient.storage
    .from('lead-attachments')
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });

  if (uploadError) {
    console.error('Erro ao enviar anexo', uploadError);
    showToast('Não foi possível enviar o anexo. Tente novamente.');
    return;
  }

  const { error: dbError } = await supabaseClient.from('commercial_lead_attachments').insert({
    lead_id: leadId,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type || null,
    size_bytes: file.size
  });

  if (dbError) {
    console.error('Erro ao salvar metadados do anexo', dbError);
    showToast('Anexo enviado, mas houve um erro ao registrar. Tente recarregar.');
    return;
  }

  showToast(`${file.name} anexado! 📎`);
  if (currentEditingLeadId === leadId) loadLeadAttachments(leadId);
}

async function loadLeadAttachments(leadId) {
  const list = document.getElementById('lead-attachments-list');
  if (!list) return;
  list.innerHTML = '<li style="font-size: 10px; color: var(--text-muted);">Carregando anexos...</li>';

  const { data, error } = await supabaseClient
    .from('commercial_lead_attachments')
    .select('*')
    .eq('lead_id', leadId)
    .order('uploaded_at', { ascending: false });

  if (currentEditingLeadId !== leadId) return; // drawer trocou de lead enquanto carregava

  if (error) {
    console.error('Erro ao carregar anexos', error);
    list.innerHTML = '<li style="font-size: 10px; color: var(--text-muted);">Não foi possível carregar os anexos.</li>';
    return;
  }

  renderLeadAttachmentsList(data || []);
}

function formatAttachmentSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderLeadAttachmentsList(attachments) {
  const list = document.getElementById('lead-attachments-list');
  if (!list) return;

  if (attachments.length === 0) {
    list.innerHTML = '<li style="font-size: 10px; color: var(--text-muted);">Nenhum anexo ainda.</li>';
    return;
  }

  list.innerHTML = '';
  attachments.forEach(att => {
    const { data: urlData } = supabaseClient.storage.from('lead-attachments').getPublicUrl(att.storage_path);
    const publicUrl = urlData ? urlData.publicUrl : '#';

    const li = document.createElement('li');
    li.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 4px; padding: 6px 10px;';
    li.innerHTML = `
      <a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener" style="font-size: 11px; color: var(--text-primary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;" title="${escapeHtml(att.file_name)}">
        📄 ${escapeHtml(att.file_name)}
      </a>
      <span style="font-size: 9px; color: var(--text-muted); flex-shrink: 0;">${formatAttachmentSize(att.size_bytes)}</span>
      <span onclick="deleteLeadAttachment('${att.id}', '${att.storage_path}')" title="Remover anexo" style="cursor: pointer; color: var(--text-muted); font-size: 12px; flex-shrink: 0;">&times;</span>
    `;
    list.appendChild(li);
  });
}

async function deleteLeadAttachment(attachmentId, storagePath) {
  const leadId = currentEditingLeadId;

  await supabaseClient.storage.from('lead-attachments').remove([storagePath]);
  const { error } = await supabaseClient.from('commercial_lead_attachments').delete().eq('id', attachmentId);

  if (error) {
    console.error('Erro ao remover anexo', error);
    showToast('Não foi possível remover o anexo.');
    return;
  }

  showToast('Anexo removido.');
  if (currentEditingLeadId === leadId) loadLeadAttachments(leadId);
}

function saveLeadDetailField(field, value) {
  if (!currentEditingLeadId) return;
  const lead = commercialLeads.find(l => l.id.toString() === currentEditingLeadId.toString());
  if (lead) {
    lead[field] = value;
    saveCommercialState();
    renderPipelineKanban();
    renderPipelineContactsTable();
    updatePipelineGlobalMetrics();
  }
}

function changeLeadOwner(ownerId) {
  if (!currentEditingLeadId) return;
  const lead = commercialLeads.find(l => l.id.toString() === currentEditingLeadId.toString());
  if (lead) {
    lead.owner = ownerId;
    updateOwnerAvatar(ownerId);
    saveCommercialState();
    renderPipelineKanban();
    renderPipelineContactsTable();
  }
}

function updateOwnerAvatar(ownerId) {
  const ownerName = getOwnerName(ownerId);
  const initials = getInitials(ownerName);
  const avatar = document.getElementById('edit-lead-owner-avatar');
  if (avatar) {
    avatar.innerText = initials;
  }
}

function deleteLeadFromDrawer() {
  if (!currentEditingLeadId) return;
  
  if (confirm('Tem certeza que deseja excluir esta oportunidade?')) {
    commercialLeads = commercialLeads.filter(l => l.id.toString() !== currentEditingLeadId.toString());
    saveCommercialState();
    closeLeadDetailsDrawer();
    renderPipelineKanban();
    renderPipelineContactsTable();
    updatePipelineGlobalMetrics();
    showToast('Lead excluído do pipeline.');
  }
}

function deleteLeadQuick(leadId) {
  if (confirm('Tem certeza que deseja excluir esta oportunidade?')) {
    commercialLeads = commercialLeads.filter(l => l.id.toString() !== leadId.toString());
    saveCommercialState();
    renderPipelineKanban();
    renderPipelineContactsTable();
    updatePipelineGlobalMetrics();
    showToast('Lead excluído.');
  }
}

function openAddLeadDrawer(stageId) {
  const newId = crypto.randomUUID();
  const newLead = {
    id: newId,
    name: "Nova Oportunidade",
    stageId: stageId,
    tag: "Geral",
    phone: "",
    email: "",
    role: "Decisor",
    bu: "Geral",
    potentialValue: 0,
    negotiation: "-",
    lossReason: "-",
    firstContactDate: formatDateDDMMYYYY(new Date()),
    owner: "felippe.alves",
    source: "Inserção manual",
    nextAction: "Mapear necessidades"
  };
  
  commercialLeads.push(newLead);
  saveCommercialState();
  renderPipelineKanban();
  renderPipelineContactsTable();
  updatePipelineGlobalMetrics();
  
  openLeadDetails(newId);
}

// --------------------------------------------------
// Stage Configuration & Settings Popover
// --------------------------------------------------

function openStageSettings(stageId, event) {
  if (event) event.stopPropagation();
  
  const stage = commercialStages.find(s => s.id === stageId);
  if (!stage) return;
  
  document.getElementById('settings-stage-id').value = stageId;
  document.getElementById('settings-stage-name').value = stage.name;
  
  const palette = document.getElementById('settings-color-palette');
  palette.innerHTML = '';
  STAGE_PRESET_COLORS.forEach(color => {
    const colBtn = document.createElement('div');
    colBtn.style.backgroundColor = color;
    colBtn.style.height = '24px';
    colBtn.style.borderRadius = '4px';
    colBtn.style.cursor = 'pointer';
    colBtn.style.border = (stage.color === color) ? '2px solid var(--text-primary)' : '1px solid var(--border-color)';
    colBtn.onclick = () => {
      Array.from(palette.children).forEach(child => child.style.border = '1px solid var(--border-color)');
      colBtn.style.border = '2px solid var(--text-primary)';
      stage.color = color;
    };
    palette.appendChild(colBtn);
  });
  
  document.getElementById('stage-settings-modal').style.display = 'flex';
}

function closeStageSettingsModal() {
  document.getElementById('stage-settings-modal').style.display = 'none';
}

function saveStageSettings() {
  const stageId = document.getElementById('settings-stage-id').value;
  const nameInput = document.getElementById('settings-stage-name').value.trim();
  
  if (!nameInput) {
    alert('O nome da etapa não pode ser vazio.');
    return;
  }
  
  const stage = commercialStages.find(s => s.id === stageId);
  if (stage) {
    stage.name = nameInput;
    saveCommercialState();
    renderPipelineKanban();
    renderPipelineContactsTable();
    populateContactsFilterStage();
    closeStageSettingsModal();
    showToast(`Etapa "${nameInput}" atualizada!`);
  }
}

function deleteStageFromSettings() {
  const stageId = document.getElementById('settings-stage-id').value;
  const stageLeads = commercialLeads.filter(l => l.stageId === stageId);
  
  if (stageLeads.length > 0) {
    alert(`Não é possível excluir esta etapa pois ela possui ${stageLeads.length} leads ativos. Mova-os primeiro.`);
    return;
  }
  
  if (confirm('Tem certeza que deseja excluir esta etapa do Kanban?')) {
    commercialStages = commercialStages.filter(s => s.id !== stageId);
    saveCommercialState();
    renderPipelineKanban();
    renderPipelineContactsTable();
    populateContactsFilterStage();
    closeStageSettingsModal();
    showToast('Etapa removida.');
  }
}

function promptAddStage() {
  const stageName = prompt('Digite o nome da nova etapa:');
  if (!stageName || !stageName.trim()) return;
  
  const stageId = 'stage_' + Date.now();
  const randomColor = STAGE_PRESET_COLORS[Math.floor(Math.random() * STAGE_PRESET_COLORS.length)];
  
  commercialStages.push({
    id: stageId,
    name: stageName.trim(),
    color: randomColor
  });
  
  saveCommercialState();
  renderPipelineKanban();
  populateContactsFilterStage();
  showToast(`Etapa "${stageName}" adicionada!`);
}

// --------------------------------------------------
// Global Helpers
// --------------------------------------------------

function formatCurrencyBRL(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function getOwnerName(ownerId) {
  if (ownerId === 'felippe.alves') return 'Felippe Alves';
  const found = collaboratorsList.find(c => c.email === ownerId || c.name === ownerId);
  return found ? found.name : ownerId;
}

function getInitials(name) {
  if (!name) return 'EX';
  const split = name.split(' ');
  if (split.length >= 2) {
    return (split[0][0] + split[split.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function formatDateDDMMYYYY(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function updatePipelineGlobalMetrics() {
  const totalOps = commercialLeads.length;
  const totalVal = commercialLeads.reduce((acc, curr) => acc + (curr.potentialValue || 0), 0);
  
  const totalOpsEl = document.getElementById('pipeline-total-ops');
  if (totalOpsEl) totalOpsEl.innerText = `${totalOps} op${totalOps !== 1 ? 's' : ''}`;
  
  const totalValEl = document.getElementById('pipeline-total-val');
  if (totalValEl) totalValEl.innerText = formatCurrencyBRL(totalVal);
}

function exportContactsCSV() {
  let csv = '\ufeffNome,Status,Telefone,Email,Responsavel,Cargo,BU,Valor\n';
  commercialLeads.forEach(lead => {
    const stage = commercialStages.find(s => s.id === lead.stageId);
    const stageName = stage ? stage.name : lead.stageId;
    const ownerName = getOwnerName(lead.owner);
    csv += `"${lead.name}","${stageName}","${lead.phone || ''}","${lead.email || ''}","${ownerName}","${lead.role || ''}","${lead.bu || ''}","${lead.potentialValue || 0}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "contacts_pipeline.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Download do arquivo CSV iniciado! 📤');
}

function hideCommercialViews() {
  const comRadar = document.getElementById('view-comercial-radar');
  if (comRadar) comRadar.style.display = 'none';
  const comPipeline = document.getElementById('view-comercial-pipeline');
  if (comPipeline) comPipeline.style.display = 'none';
  const comContatos = document.getElementById('view-comercial-contatos');
  if (comContatos) comContatos.style.display = 'none';
  
  const comHeader = document.getElementById('sidebar-comercial-header');
  if (comHeader) {
    comHeader.classList.remove('active');
    comHeader.style.backgroundColor = 'transparent';
  }
  const comSubitemRadar = document.getElementById('analysis-comercial-radar');
  if (comSubitemRadar) comSubitemRadar.classList.remove('active');
  const comSubitemPipeline = document.getElementById('analysis-comercial-pipeline');
  if (comSubitemPipeline) comSubitemPipeline.classList.remove('active');
  const comSubitemContatos = document.getElementById('analysis-comercial-contatos');
  if (comSubitemContatos) comSubitemContatos.classList.remove('active');
  
  // Collapse menu
  collapseComercialMenu();
}

function collapseComercialMenu() {
  const container = document.getElementById('container-comercial');
  const submenu = document.getElementById('analysis-menu-comercial');
  if (container && submenu) {
    container.classList.remove('expanded');
    submenu.style.display = 'none';
    const chevron = document.getElementById('chevron-comercial');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

// ==========================================================================
// HISTÓRICO MENSAL DE MÉTRICAS (clique em qualquer card de KPI)
// ==========================================================================

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function seededRandom(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Converte um valor exibido em tela (ex: "R$482k", "2,7%", "R$43.628,62") em número + metadados de formato
function parseMetricValue(text) {
  const raw = text.trim();
  const isCurrency = raw.startsWith('R$');
  const isPercent = raw.endsWith('%');
  let body = raw.replace('R$', '').replace('%', '').trim();

  let multiplier = 1;
  let hadK = false;
  let hadM = false;
  if (/k$/i.test(body)) {
    multiplier = 1000;
    hadK = true;
    body = body.replace(/k$/i, '');
  } else if (/m$/i.test(body)) {
    multiplier = 1000000;
    hadM = true;
    body = body.replace(/m$/i, '');
  }

  let normalized;
  if (body.includes(',')) {
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = body.replace(/\./g, '');
  }

  const num = parseFloat(normalized) * multiplier;
  return { value: isNaN(num) ? 0 : num, isCurrency, isPercent, hadK, hadM };
}

// Formata um número de volta no mesmo "estilo" do valor original
function formatMetricValue(num, meta) {
  if (meta.isPercent) {
    return num.toFixed(1).replace('.', ',') + '%';
  }
  if (meta.isCurrency) {
    if (meta.hadM || num >= 1000000) {
      return 'R$' + (num / 1000000).toFixed(2).replace('.', ',') + 'M';
    }
    if (meta.hadK || num >= 1000) {
      return 'R$' + Math.round(num / 1000) + 'k';
    }
    return 'R$' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Math.round(num).toLocaleString('pt-BR');
}

// Métricas de custo: valor menor = melhor (inverte a leitura de verde/vermelho)
function isLowerBetter(label) {
  const l = label.toLowerCase();
  return l.includes('cpl') || l.includes('cpa') || l.includes('custo');
}

function getLastMonthLabels(n) {
  const monthAbbr = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const now = new Date();
  const labels = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(monthAbbr[d.getMonth()]);
  }
  return labels;
}

// Gera uma série mensal plausível terminando exatamente no valor atual exibido em tela.
// Usa uma semente (título + contexto do cliente) para o histórico ser estável entre cliques,
// já que ainda não existe uma série histórica real por trás dessas métricas.
function generateMonthlyHistory(currentValue, seedKey, months) {
  const rng = seededRandom(hashString(seedKey));
  const values = new Array(months);
  values[months - 1] = currentValue;
  let v = currentValue;
  for (let i = months - 2; i >= 0; i--) {
    const variation = (rng() - 0.5) * 0.36; // +/- 18% por mês
    v = Math.max(v / (1 + variation), 0);
    values[i] = v;
  }
  return values;
}

function renderMetricHistoryChart(container, months, values, meta, metricLabel) {
  container.innerHTML = '';
  const lowerBetter = isLowerBetter(metricLabel);
  const max = Math.max(...values) * 1.15 || 1;

  const wrap = document.createElement('div');
  wrap.className = 'history-chart-bars';

  values.forEach((v, i) => {
    let trendClass = 'neutral';
    if (i > 0) {
      const wentUp = v >= values[i - 1];
      const isGood = lowerBetter ? !wentUp : wentUp;
      trendClass = isGood ? 'good' : 'bad';
    }

    const heightPct = max > 0 ? (v / max) * 100 : 0;

    const col = document.createElement('div');
    col.className = 'history-bar-col';
    col.innerHTML = `
      <span class="history-bar-value">${formatMetricValue(v, meta)}</span>
      <div class="history-bar-track">
        <div class="history-bar-fill ${trendClass}" style="height: ${heightPct}%;"></div>
      </div>
      <span class="history-bar-label">${months[i]}</span>
    `;
    wrap.appendChild(col);
  });

  container.appendChild(wrap);
}

function openMetricHistoryModal(metricLabel, currentValueText) {
  const meta = parseMetricValue(currentValueText);
  const seedKey = `${currentClient || 'agencia'}::${metricLabel}`;
  const months = 6;
  const monthLabels = getLastMonthLabels(months);
  const values = generateMonthlyHistory(meta.value, seedKey, months);

  document.getElementById('metric-history-title').innerText = metricLabel;
  const contextLabel = currentClient ? currentClient : 'todos os clientes';
  const better = isLowerBetter(metricLabel);
  document.getElementById('metric-history-subtitle').innerText =
    `Evolução mensal · ${contextLabel} · verde = melhorou, vermelho = piorou vs. mês anterior${better ? ' (menor é melhor)' : ''}`;

  renderMetricHistoryChart(document.getElementById('metric-history-chart'), monthLabels, values, meta, metricLabel);

  document.getElementById('metric-history-modal').style.display = 'flex';
}

function closeMetricHistoryModal() {
  document.getElementById('metric-history-modal').style.display = 'none';
}

// Delegação global: qualquer .metric-card "simples" (um único valor) abre o histórico ao ser clicada.
// Cards compostos (ex: comparativo Google Ads x Meta Ads, com vários valores dentro) são ignorados.
document.addEventListener('click', function (e) {
  const card = e.target.closest('.metric-card');
  if (!card) return;

  const values = card.querySelectorAll('.card-value');
  if (values.length !== 1) return;

  const titleEl = card.querySelector('.card-title');
  if (!titleEl) return;

  openMetricHistoryModal(titleEl.innerText.trim(), values[0].innerText.trim());
});

// Inicializa a Tela na carga inicial e sincroniza o tema
// --------------------------------------------------
// Login (Supabase Auth)
// --------------------------------------------------

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.innerText = 'Entrando...';

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  submitBtn.disabled = false;
  submitBtn.innerText = 'Entrar';

  if (error) {
    console.error('Erro de login', error);
    errorEl.innerText = 'E-mail ou senha incorretos.';
    errorEl.style.display = 'block';
    return;
  }

  showAppAfterLogin();
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  window.location.reload();
}

function showAppAfterLogin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
  initApp();
}

function showLoginScreen() {
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-form').reset();
}

// Inicializa os dados e telas do PRATA — só roda depois de confirmar que
// existe uma sessão autenticada (chamada tanto no load com sessão já ativa
// quanto logo após um login bem-sucedido).
async function initApp() {
  syncThemeOnLoad();

  allClients = await fetchClients();
  renderSidebarClients();

  await Promise.all([
    loadCommercialState(),
    initClientAnalyses()
  ]);

  allClients.filter(c => c.pinned).forEach(c => renderClientSidebar(c.slug));

  showDashboardPai();
}

window.onload = async function() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showLoginScreen();
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
  await initApp();

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLoginScreen();
  });
};
