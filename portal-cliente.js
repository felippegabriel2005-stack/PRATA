/* ==========================================================================
   PRATA - Portal do Cliente (Dashboard Filho standalone)

   ATENÇÃO - SEGURANÇA (leia antes de divulgar este link publicamente):
   Este MVP identifica o cliente SÓ pelo slug na URL (?client=slug) e usa a
   mesma anon key pública do PRATA. Isso significa que:
     - Não há autenticação: qualquer pessoa que souber/adivinhar o slug de
       outro cliente consegue ver e preencher os dados dele.
     - A "proteção" por client_slug é feita nas QUERIES daqui, não no banco
       (RLS do Supabase ainda está aberto pra chave anon, igual o resto do
       PRATA hoje) — ou seja, é filtro de aplicação, não isolamento real.
   Antes de enviar este link pra um cliente de verdade, o ideal é:
     1. Gerar um token de acesso único por cliente (ex: coluna
        portal_token em clients, ou tabela client_portal_access) e exigir
        ?client=slug&token=xxxx, validando o token nas queries.
     2. Ativar RLS no Supabase restringindo custom_fields/custom_field_values
        por client_slug real (ex: via Supabase Auth com um usuário por
        cliente, ou uma função de banco que valide o token).
   Nenhuma dessas duas coisas está implementada ainda — é o próximo passo
   antes de usar isso fora de teste interno.
   ========================================================================== */

const SUPABASE_URL = 'https://ldcpwadnvuotacwnkcop.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3eLKeEjjegJgKLf1bUHQ6Q_GQPJ_5v6';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

const FIELD_TYPE_LABELS = {
  number: 'Número', currency: 'Moeda', percentage: 'Percentual',
  text_short: 'Texto curto', text_long: 'Texto longo', date: 'Data',
  boolean: 'Sim/Não', single_select: 'Seleção única', multi_select: 'Seleção múltipla'
};

const FREQUENCY_DUE_LABELS = {
  daily: 'hoje', weekly: 'esta semana', biweekly: 'esta quinzena',
  monthly: 'este mês', on_demand: 'sem prazo fixo'
};

let portalClientSlug = null;
let portalClientName = '';
let portalFields = [];
let portalValues = [];
let portalActiveField = null;

function escapeHtml(str) {
  return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateBR(date) {
  return date.toLocaleDateString('pt-BR');
}

// Calcula o "bucket" de período de um campo a partir da frequência —
// mesma lógica usada no painel da agência (script.js) pra decidir se já
// existe preenchimento pro período atual.
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

function formatDateISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function showPortalToast(message) {
  let toast = document.getElementById('portal-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'portal-toast';
    toast.style.cssText = 'position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); padding: 10px 18px; border-radius: var(--border-radius-sm); font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 20000; opacity: 0; transition: all 0.25s ease;';
    document.body.appendChild(toast);
  }
  toast.innerText = message;
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2800);
}

function togglePortalTheme() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('prata-portal-theme', isLight ? 'light' : 'dark');
  document.getElementById('portal-theme-toggle').innerText = isLight ? '🌙' : '☀';
}

function syncPortalTheme() {
  const saved = localStorage.getItem('prata-portal-theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    document.getElementById('portal-theme-toggle').innerText = '🌙';
  }
}

async function initPortal() {
  syncPortalTheme();

  const params = new URLSearchParams(window.location.search);
  portalClientSlug = params.get('client');

  if (!portalClientSlug) {
    showPortalError();
    return;
  }

  const { data: client, error: clientError } = await supabaseClient
    .from('clients')
    .select('name, slug')
    .eq('slug', portalClientSlug)
    .maybeSingle();

  if (clientError || !client) {
    console.error('Erro ao carregar cliente do portal', clientError);
    showPortalError();
    return;
  }

  portalClientName = client.name;
  document.getElementById('portal-client-name').innerText = client.name;
  document.getElementById('portal-client-meta').innerText = `Portal do cliente · ${formatDateBR(new Date())}`;

  await Promise.all([
    loadClientDashboardData(),
    loadPortalFields()
  ]);

  document.getElementById('portal-loading').style.display = 'none';
  document.getElementById('portal-content').style.display = 'block';
}

function showPortalError() {
  document.getElementById('portal-loading').style.display = 'none';
  document.getElementById('portal-error').style.display = 'block';
}

function formatCurrencyPortal(val) {
  return 'R$' + Math.round(val).toLocaleString('pt-BR');
}

function formatCurrencyThousandsPortal(val) {
  return `R$${Math.round(val / 1000)}k`;
}

// Mesma regra do painel da agência (script.js: computeClientStatusFromData) —
// duplicada aqui de propósito, já que este portal é pensado pra um dia rodar
// como projeto Vercel separado, sem depender do script.js da agência.
function computePortalClientStatus(raw, targetsRows) {
  const reasons = [];
  let severity = 0;

  if (raw.invest > 0) {
    const roi = ((raw.revenue - raw.invest) / raw.invest) * 100;
    if (roi < 0) {
      severity = Math.max(severity, 2);
    } else if (roi < 50) {
      severity = Math.max(severity, 1);
    }
    if (raw.conversions === 0) {
      severity = Math.max(severity, 2);
    }
  }

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
    if (rule.includes('Menor')) ratio = actual / target;
    else if (rule.includes('Maior')) ratio = target / actual;
    if (ratio === null) return;

    if (ratio > 1.3) severity = Math.max(severity, 2);
    else if (ratio > 1.1) severity = Math.max(severity, 1);
  });

  return severity === 2 ? 'critical' : severity === 1 ? 'attention' : 'healthy';
}

// Mesma matriz que a agência vê no Dashboard Filho: KPIs, Insights de IA
// (reaproveita o cache já gerado em client_ai_insights — não chama a IA de
// novo daqui) e Funil do cliente, calculados a partir do campaign_metrics
// real desse cliente.
const PLATFORM_COLORS_PORTAL = { 'Google Ads': '#3b82f6', 'Meta Ads': '#8b5cf6', 'LinkedIn Ads': '#0a66c2' };
const PLATFORM_COLOR_FALLBACKS_PORTAL = ['#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];
function getPlatformColorPortal(platform, index) {
  if (PLATFORM_COLORS_PORTAL[platform]) return PLATFORM_COLORS_PORTAL[platform];
  return PLATFORM_COLOR_FALLBACKS_PORTAL[(index || 0) % PLATFORM_COLOR_FALLBACKS_PORTAL.length];
}

let portalCampaignsAll = [];
let portalChartData = null;

async function loadClientDashboardData() {
  const [{ data: campaigns }, { data: targets }, { data: leadsRows }, { data: aiInsightRow }] = await Promise.all([
    supabaseClient.from('campaign_metrics').select('*').eq('client_slug', portalClientSlug),
    supabaseClient.from('targets').select('*').eq('client_slug', portalClientSlug),
    supabaseClient.from('leads_sales').select('*').eq('client_slug', portalClientSlug),
    supabaseClient.from('client_ai_insights').select('insights').eq('client_slug', portalClientSlug).maybeSingle()
  ]);

  const rows = campaigns || [];
  const built = buildPortalClientData(rows, leadsRows || []);
  const { raw, conversaoPct, cpl, cpa, roi } = built;

  document.getElementById('portal-num-investimento').innerText = formatCurrencyThousandsPortal(raw.invest);
  document.getElementById('portal-num-receita').innerText = formatCurrencyThousandsPortal(raw.revenue);
  document.getElementById('portal-num-conversao').innerText = `${conversaoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  document.getElementById('portal-num-cpl').innerText = raw.leads > 0 ? formatCurrencyPortal(cpl) : '—';
  document.getElementById('portal-num-cpa').innerText = raw.conversions > 0 ? formatCurrencyPortal(cpa) : '—';
  document.getElementById('portal-num-roi').innerText = `${Math.round(roi)}%`;

  const status = computePortalClientStatus(raw, targets || []);
  const statusLabels = { healthy: 'Saudável', attention: 'Atenção', critical: 'Crítico' };
  const badge = document.getElementById('portal-status-badge');
  badge.innerText = statusLabels[status];
  badge.className = `table-badge ${status}`;

  // Insights de IA — usa o cache já gerado pro painel da agência; se ainda
  // não existir, cai num resumo simples calculado na hora (sem chamar IA).
  const insightsSection = document.getElementById('portal-insights-section');
  const insightsList = document.getElementById('portal-insights-list');
  let insights = (aiInsightRow && Array.isArray(aiInsightRow.insights) && aiInsightRow.insights.length) ? aiInsightRow.insights : null;
  if (!insights && rows.length > 0) {
    insights = [
      `Investimento total de ${formatCurrencyPortal(raw.invest)} gerou receita de ${formatCurrencyPortal(raw.revenue)} (ROI de ${Math.round(roi)}%).`,
      `Taxa de conversão geral (cliques → conversões): ${conversaoPct.toFixed(1)}%.`,
      `Custo por lead médio de ${raw.leads > 0 ? formatCurrencyPortal(cpl) : '—'} e custo por conversão de ${raw.conversions > 0 ? formatCurrencyPortal(cpa) : '—'}.`
    ];
  }
  if (insights && insights.length) {
    insightsSection.style.display = 'flex';
    insightsList.innerHTML = '';
    insights.forEach(text => {
      const li = document.createElement('li');
      li.innerText = text;
      insightsList.appendChild(li);
    });
  } else {
    insightsSection.style.display = 'none';
  }

  // Funil do cliente
  const funnelSection = document.getElementById('portal-funnel-section');
  if (rows.length > 0) {
    funnelSection.style.display = 'block';
    document.getElementById('portal-funnel-val-1').innerText = Math.round(raw.impressions).toLocaleString('pt-BR');
    document.getElementById('portal-funnel-val-2').innerText = Math.round(raw.clicks).toLocaleString('pt-BR');
    document.getElementById('portal-funnel-val-3').innerText = Math.round(raw.pageViews).toLocaleString('pt-BR');
    document.getElementById('portal-funnel-val-4').innerText = Math.round(raw.conversions).toLocaleString('pt-BR');

    document.getElementById('portal-funnel-pct-1').innerText = '100%';
    document.getElementById('portal-funnel-pct-2').innerText = raw.impressions > 0 ? `${((raw.clicks / raw.impressions) * 100).toFixed(0)}%` : '0%';
    document.getElementById('portal-funnel-pct-3').innerText = raw.clicks > 0 ? `${((raw.pageViews / raw.clicks) * 100).toFixed(0)}%` : '0%';
    document.getElementById('portal-funnel-pct-final').innerText = `${conversaoPct.toFixed(1)}% final`;
  } else {
    funnelSection.style.display = 'none';
  }

  renderPortalUpdates(rows.length, (leadsRows || []).length);
  renderPortalSourceLoss(built.leadsSource, built.lossReasons);
  renderPortalEvolution(built.evolution);
  renderPortalAdsSection(built);
}

// Mesmo cálculo de buildClientDetailedDataFromReal (script.js) — duplicado
// aqui de propósito, já que este portal é pensado pra virar um deploy
// separado no futuro, sem depender do script.js da agência.
function buildPortalClientData(campaigns, leadsRows) {
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

  const conversaoPct = totalClicks > 0 ? (totalConvs / totalClicks) * 100 : 0;
  const cpl = totalLeads > 0 ? totalInvest / totalLeads : 0;
  const cpa = totalConvs > 0 ? totalInvest / totalConvs : 0;
  const roi = totalInvest > 0 ? ((totalRevenue - totalInvest) / totalInvest) * 100 : 0;

  const platformList = Object.keys(byPlatform);
  const sourceBasis = platformList.reduce((s, p) => s + (byPlatform[p].leads || byPlatform[p].clicks), 0) || 1;
  const leadsSource = platformList.map((p, i) => {
    const val = byPlatform[p].leads || byPlatform[p].clicks;
    return {
      name: p,
      pct: Math.round((val / sourceBasis) * 100),
      value: `${Math.round(val).toLocaleString('pt-BR')} leads`,
      color: getPlatformColorPortal(p, i)
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
      val: formatCurrencyPortal(val),
      trend: `${trendPct >= 0 ? '▲' : '▼'} ${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(0)}%`,
      trendClass: trendPct >= 0 ? 'up' : 'down'
    };
  });

  const chartDates = dateKeys.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
  });

  const campaignGroups = {};
  campaigns.forEach(c => {
    const key = `${c.campaign_name}||${c.platform}`;
    if (!campaignGroups[key]) {
      campaignGroups[key] = {
        id: key, name: c.campaign_name, platform: c.platform,
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

  return {
    raw: {
      invest: totalInvest, revenue: totalRevenue, leads: totalLeads,
      impressions: totalImpress, clicks: totalClicks, pageViews: totalPageViews, conversions: totalConvs
    },
    conversaoPct, cpl, cpa, roi,
    leadsSource, lossReasons, evolution,
    chartData: { dates: chartDates, investimento: dateKeys.map(d => byDate[d].invest), conversoes: dateKeys.map(d => byDate[d].convs) },
    campaigns: campaignsList
  };
}

function renderPortalUpdates(campaignsCount, leadsCount) {
  const section = document.getElementById('portal-updates-section');
  const tbody = document.getElementById('portal-table-updates');
  if (campaignsCount === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const now = new Date().toLocaleString('pt-BR');
  tbody.innerHTML = `
    <tr>
      <td class="table-client-cell"><span class="status-dot healthy"></span><span>Planilha importada</span></td>
      <td>${now}</td>
      <td><span class="table-badge healthy">Atualizado</span></td>
      <td class="table-problem-cell">${campaignsCount} linha(s) de campanha, ${leadsCount} lead(s)/venda(s) importados.</td>
    </tr>
  `;
}

function renderPortalSourceLoss(leadsSource, lossReasons) {
  const sourceSection = document.getElementById('portal-source-section');
  const sourceUl = document.getElementById('portal-leads-source-list');
  sourceUl.innerHTML = '';
  if (leadsSource.length) {
    sourceSection.style.display = 'block';
    leadsSource.forEach(item => {
      const li = document.createElement('li');
      li.className = 'progress-item';
      li.innerHTML = `
        <div class="progress-header">
          <span class="progress-name">${escapeHtml(item.name)}</span>
          <span class="progress-value">${item.pct}% (${escapeHtml(item.value)})</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${item.pct}%; background-color: ${item.color};"></div>
        </div>
      `;
      sourceUl.appendChild(li);
    });
  } else {
    sourceSection.style.display = 'none';
  }

  const lossSection = document.getElementById('portal-loss-section');
  const lossUl = document.getElementById('portal-leads-loss-list');
  lossUl.innerHTML = '';
  if (lossReasons.length) {
    lossSection.style.display = 'block';
    lossReasons.forEach(item => {
      const li = document.createElement('li');
      li.className = 'progress-item';
      li.innerHTML = `
        <div class="progress-header">
          <span class="progress-name">${escapeHtml(item.name)}</span>
          <span class="progress-value">${item.pct}%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${item.pct}%; background-color: ${item.color};"></div>
        </div>
      `;
      lossUl.appendChild(li);
    });
  } else {
    lossSection.style.display = 'none';
  }
}

function renderPortalEvolution(evolution) {
  const section = document.getElementById('portal-evolution-section');
  const list = document.getElementById('portal-evolution-list');
  list.innerHTML = '';
  if (!evolution.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  evolution.forEach(item => {
    const col = document.createElement('div');
    col.className = 'evolution-item';
    col.innerHTML = `
      <span class="evolution-label">${item.label}</span>
      <span class="evolution-value">${item.val}</span>
      <span class="evolution-trend-indicator ${item.trendClass}">${item.trend}</span>
    `;
    list.appendChild(col);
  });
}

function renderPortalAdsSection(built) {
  const section = document.getElementById('portal-ads-section');
  const campaigns = built.campaigns;
  if (!campaigns.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  portalCampaignsAll = campaigns;
  portalChartData = built.chartData;

  const platforms = [...new Set(campaigns.map(c => c.platform))];
  document.getElementById('portal-ads-platforms-label').innerText = platforms.join(' & ');

  const select = document.getElementById('portal-filter-camp-platform');
  select.innerHTML = `<option value="Todas">Plataforma (Todas)</option>`;
  platforms.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.innerText = p;
    select.appendChild(opt);
  });
  document.getElementById('portal-search-campaign').value = '';
  document.getElementById('portal-filter-camp-status').value = 'Todos';

  recalcPortalAdsMetrics(campaigns);
  renderPortalAdsChart(portalChartData);
  renderPortalCampaignsTable(campaigns);
}

function recalcPortalAdsMetrics(campaigns) {
  let totalInvest = 0, totalClicks = 0, totalConvs = 0, totalImpress = 0;
  const byPlatform = {};
  const platformOrder = [];

  campaigns.forEach(c => {
    totalInvest += c.invest;
    totalClicks += c.clicks;
    totalConvs += c.convs;
    totalImpress += c.impress;
    if (!byPlatform[c.platform]) {
      byPlatform[c.platform] = { invest: 0, clicks: 0, convs: 0 };
      platformOrder.push(c.platform);
    }
    byPlatform[c.platform].invest += c.invest;
    byPlatform[c.platform].clicks += c.clicks;
    byPlatform[c.platform].convs += c.convs;
  });

  const cpa = totalConvs > 0 ? totalInvest / totalConvs : 0;
  const ctr = totalImpress > 0 ? (totalClicks / totalImpress) * 100 : 0;

  document.getElementById('portal-ads-investimento').innerText = `R$ ${totalInvest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  document.getElementById('portal-ads-cliques').innerText = totalClicks.toLocaleString('pt-BR');
  document.getElementById('portal-ads-conversoes').innerText = totalConvs.toLocaleString('pt-BR');
  document.getElementById('portal-ads-cpa').innerText = cpa > 0 ? `R$ ${cpa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
  document.getElementById('portal-ads-ctr').innerText = `${ctr.toFixed(2)}%`;

  const grid = document.getElementById('portal-ads-platforms-grid');
  grid.innerHTML = '';
  platformOrder.forEach((platform, i) => {
    const stats = byPlatform[platform];
    const platCpa = stats.convs > 0 ? stats.invest / stats.convs : 0;
    const color = getPlatformColorPortal(platform, i);
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
        <div><span class="card-title" style="font-size: 9px;">Investimento</span><div class="card-value" style="font-size: 16px; margin-top: 2px;">R$ ${stats.invest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
        <div><span class="card-title" style="font-size: 9px;">Cliques</span><div class="card-value" style="font-size: 16px; margin-top: 2px;">${stats.clicks.toLocaleString('pt-BR')}</div></div>
        <div><span class="card-title" style="font-size: 9px;">Conversões</span><div class="card-value highlight-green" style="font-size: 16px; margin-top: 2px;">${stats.convs.toLocaleString('pt-BR')}</div></div>
        <div><span class="card-title" style="font-size: 9px;">CPA</span><div class="card-value" style="font-size: 16px; margin-top: 2px;">${platCpa > 0 ? 'R$ ' + platCpa.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</div></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderPortalCampaignsTable(campaigns) {
  const tbody = document.getElementById('portal-table-campaigns');
  tbody.innerHTML = '';
  document.getElementById('portal-campaigns-title').innerText = `Campanhas (${campaigns.length})`;

  if (campaigns.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhuma campanha encontrada com os filtros selecionados.</td></tr>`;
    return;
  }

  campaigns.forEach((camp, i) => {
    const color = getPlatformColorPortal(camp.platform, i);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="table-client-cell">
        <span class="status-dot" style="background-color: ${color}; box-shadow: 0 0 6px ${color};"></span>
        <span style="font-weight: 500;">${escapeHtml(camp.name)}</span>
      </td>
      <td>${escapeHtml(camp.platform)}</td>
      <td style="font-weight: 600;">R$ ${camp.invest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      <td>${camp.impress.toLocaleString('pt-BR')}</td>
      <td>${camp.clicks.toLocaleString('pt-BR')}</td>
      <td>${camp.ctr}%</td>
      <td>R$ ${camp.cpc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      <td>${camp.convs}</td>
      <td>${camp.convs > 0 ? 'R$ ' + camp.cpa.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function filterPortalCampaigns() {
  const q = document.getElementById('portal-search-campaign').value.toLowerCase().trim();
  const platform = document.getElementById('portal-filter-camp-platform').value;
  const status = document.getElementById('portal-filter-camp-status').value;

  const filtered = portalCampaignsAll.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(q);
    const matchPlatform = platform === 'Todas' || c.platform === platform;
    const matchStatus = status === 'Todos' || c.status === status;
    return matchSearch && matchPlatform && matchStatus;
  });

  renderPortalCampaignsTable(filtered);
}

// Mesmo gráfico SVG do Dashboard Filho principal (script.js: renderAdsChart),
// portado pra cá com IDs próprios.
function renderPortalAdsChart(chartData) {
  const container = document.getElementById('portal-ads-chart-container');
  if (!container || !chartData) return;
  container.innerHTML = '';

  let tooltip = document.getElementById('portal-chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'portal-chart-tooltip';
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

  const maxInvest = Math.max(...chartData.investimento, 0);
  const maxConvs = Math.max(...chartData.conversoes, 0);

  const scaleYInvest = maxInvest > 0 ? chartH / (maxInvest * 1.1) : 0;
  const scaleYConvs = maxConvs > 0 ? chartH / (maxConvs * 1.1) : 0;

  const n = chartData.dates.length;
  if (n === 0) return;
  const stepX = n > 1 ? chartW / (n - 1) : 0;

  let svgContent = `<svg width="${w}" height="${h}" style="overflow: visible;">`;

  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = paddingTop + (chartH / steps) * i;
    svgContent += `<line x1="${paddingLeft}" y1="${y}" x2="${w - paddingRight}" y2="${y}" class="chart-grid-line" />`;
    const investLabel = Math.round(maxInvest * 1.1 - (maxInvest * 1.1 / steps) * i);
    svgContent += `<text x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end" class="chart-axis-text">${investLabel}</text>`;
    const convsLabel = Math.round(maxConvs * 1.1 - (maxConvs * 1.1 / steps) * i);
    svgContent += `<text x="${w - paddingRight + 8}" y="${y + 3}" text-anchor="start" class="chart-axis-text">${convsLabel}</text>`;
  }

  const barW = Math.min(Math.max(stepX * 0.65, 5), 24);
  for (let i = 0; i < n; i++) {
    const x = paddingLeft + stepX * i;
    const val = chartData.investimento[i];
    const barH = val * scaleYInvest;
    const y = paddingTop + chartH - barH;
    svgContent += `<rect x="${x - barW / 2}" y="${y}" width="${barW}" height="${barH}" rx="2" class="chart-bar-invest" data-date="${chartData.dates[i]}" data-value="${val}" data-type="invest"></rect>`;
    // Evita o penúltimo rótulo (i === n-2) colar no último quando n é par.
    if (n <= 7 || i === 0 || i === n - 1 || (i % 2 === 0 && i < n - 2)) {
      svgContent += `<text x="${x}" y="${h - paddingBottom + 16}" text-anchor="middle" class="chart-axis-text">${chartData.dates[i]}</text>`;
    }
  }

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

  const allElements = container.querySelectorAll('.chart-bar-invest, .chart-dot-conv, .chart-dot-hitarea');
  allElements.forEach(el => {
    el.addEventListener('mouseenter', function () {
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
    el.addEventListener('mousemove', function (e) {
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY - 44) + 'px';
    });
    el.addEventListener('mouseleave', function () {
      tooltip.style.display = 'none';
    });
  });
}

window.addEventListener('resize', () => {
  if (portalChartData) renderPortalAdsChart(portalChartData);
});

async function loadPortalFields() {
  const [{ data: fields, error: fieldsError }, { data: values, error: valuesError }] = await Promise.all([
    supabaseClient.from('custom_fields').select('*').eq('client_slug', portalClientSlug).eq('active', true).order('position'),
    supabaseClient.from('custom_field_values').select('*').eq('client_slug', portalClientSlug).order('submitted_at', { ascending: false })
  ]);

  if (fieldsError) console.error('Erro ao carregar campos', fieldsError);
  if (valuesError) console.error('Erro ao carregar valores', valuesError);

  portalFields = fields || [];
  portalValues = values || [];

  renderPortalFields();
}

// Pra campos periódicos, "preenchido" = existe valor pro bucket de período
// atual. Pra "sob demanda", basta ter algum valor (não expira).
function getCurrentValueForField(field) {
  if (field.frequency === 'on_demand') {
    return portalValues.find(v => v.field_id === field.id) || null;
  }
  const periodIso = formatDateISO(computePeriodDateForFrequency(field.frequency, new Date()));
  return portalValues.find(v => v.field_id === field.id && v.period_date === periodIso) || null;
}

function formatPortalValue(field, value) {
  if (!value) return '—';
  if ((field.field_type === 'currency') && value.value_number !== null) {
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
    return formatDateBR(new Date(value.value_date + 'T00:00:00'));
  }
  if (field.field_type === 'multi_select' && value.value_options) {
    return (value.value_options || []).join(', ');
  }
  return value.value_text || '—';
}

function renderPortalFields() {
  const pendingList = document.getElementById('portal-pending-list');
  const filledList = document.getElementById('portal-filled-list');
  const pendingSection = document.getElementById('portal-pending-section');
  const filledSection = document.getElementById('portal-filled-section');
  const emptyState = document.getElementById('portal-empty-state');

  pendingList.innerHTML = '';
  filledList.innerHTML = '';

  if (portalFields.length === 0) {
    pendingSection.style.display = 'none';
    filledSection.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  const pending = [];
  const filled = [];

  portalFields.forEach(field => {
    const value = getCurrentValueForField(field);
    if (value) filled.push({ field, value });
    else pending.push(field);
  });

  pendingSection.style.display = pending.length ? 'block' : 'none';
  filledSection.style.display = filled.length ? 'block' : 'none';

  pending.forEach(field => {
    const item = document.createElement('div');
    item.className = 'portal-field-item';
    item.onclick = () => openPortalFillModal(field);
    item.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${escapeHtml(field.name)}</div>
        <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(FREQUENCY_DUE_LABELS[field.frequency] || '')}${field.required ? ' · obrigatório' : ''}</div>
      </div>
      <span class="table-badge attention" style="font-size: 9px;">Pendente</span>
    `;
    pendingList.appendChild(item);
  });

  filled.forEach(({ field, value }) => {
    const item = document.createElement('div');
    item.className = 'portal-field-item filled';
    item.onclick = () => openPortalFillModal(field);
    const submittedAt = new Date(value.submitted_at);
    item.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${escapeHtml(field.name)}</div>
        <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(formatPortalValue(field, value))} · preenchido em ${formatDateBR(submittedAt)}</div>
      </div>
      <span class="table-badge healthy" style="font-size: 9px;">Preenchido</span>
    `;
    filledList.appendChild(item);
  });
}

function openPortalFillModal(field) {
  portalActiveField = field;
  const existing = getCurrentValueForField(field);
  const periodDate = computePeriodDateForFrequency(field.frequency, new Date());

  document.getElementById('portal-fill-title').innerText = field.name;
  document.getElementById('portal-fill-description').innerText = field.description || '';
  document.getElementById('portal-fill-period').innerText = field.frequency === 'on_demand'
    ? 'Sem período fixo'
    : formatDateBR(periodDate);

  const container = document.getElementById('portal-fill-input-container');
  container.innerHTML = buildPortalFieldInput(field, existing);

  document.getElementById('portal-fill-modal').style.display = 'flex';
}

function closePortalFillModal() {
  document.getElementById('portal-fill-modal').style.display = 'none';
  portalActiveField = null;
}

function buildPortalFieldInput(field, existing) {
  const base = 'width: 100%; font-size: 13px; padding: 10px 12px; background: var(--bg-app); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--border-radius-sm); font-family: var(--font-family-body);';

  if (field.field_type === 'text_long') {
    return `<textarea id="portal-fill-input" rows="4" style="${base}">${existing ? escapeHtml(existing.value_text || '') : ''}</textarea>`;
  }
  if (field.field_type === 'text_short') {
    return `<input type="text" id="portal-fill-input" style="${base}" value="${existing ? escapeHtml(existing.value_text || '') : ''}">`;
  }
  if (field.field_type === 'number' || field.field_type === 'currency' || field.field_type === 'percentage') {
    const prefix = field.field_type === 'currency' ? 'R$ ' : '';
    const suffix = field.field_type === 'percentage' ? '%' : (field.unit ? ` ${escapeHtml(field.unit)}` : '');
    return `
      <div style="display: flex; align-items: center; gap: 6px;">
        ${prefix ? `<span style="font-size: 12px; color: var(--text-secondary);">${prefix}</span>` : ''}
        <input type="number" step="any" id="portal-fill-input" style="${base}" value="${existing && existing.value_number !== null ? existing.value_number : ''}">
        ${suffix ? `<span style="font-size: 12px; color: var(--text-secondary);">${suffix}</span>` : ''}
      </div>
    `;
  }
  if (field.field_type === 'date') {
    return `<input type="date" id="portal-fill-input" style="${base}" value="${existing ? (existing.value_date || '') : ''}">`;
  }
  if (field.field_type === 'boolean') {
    const current = existing ? existing.value_boolean : null;
    return `
      <select id="portal-fill-input" style="${base}">
        <option value="true" ${current === true ? 'selected' : ''}>Sim</option>
        <option value="false" ${current === false ? 'selected' : ''}>Não</option>
      </select>
    `;
  }
  if (field.field_type === 'single_select') {
    const current = existing ? existing.value_text : null;
    const opts = (field.options || []).map(o => `<option value="${escapeHtml(o)}" ${current === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
    return `<select id="portal-fill-input" style="${base}">${opts}</select>`;
  }
  if (field.field_type === 'multi_select') {
    const current = existing && existing.value_options ? existing.value_options : [];
    const opts = (field.options || []).map((o, i) => `
      <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-primary); padding: 6px 0;">
        <input type="checkbox" class="portal-multi-option" value="${escapeHtml(o)}" ${current.includes(o) ? 'checked' : ''}>
        ${escapeHtml(o)}
      </label>
    `).join('');
    return `<div id="portal-fill-input">${opts}</div>`;
  }
  return `<input type="text" id="portal-fill-input" style="${base}">`;
}

async function submitPortalFieldValue(event) {
  event.preventDefault();
  const field = portalActiveField;
  if (!field) return;

  const periodDate = field.frequency === 'on_demand'
    ? formatDateISO(new Date())
    : formatDateISO(computePeriodDateForFrequency(field.frequency, new Date()));

  const payload = {
    field_id: field.id,
    client_slug: portalClientSlug,
    period_date: periodDate,
    value_text: null,
    value_number: null,
    value_date: null,
    value_boolean: null,
    value_options: null,
    submitted_by: 'cliente',
    submitted_at: new Date().toISOString(),
    status: 'submitted'
  };

  if (field.field_type === 'text_short' || field.field_type === 'text_long' || field.field_type === 'single_select') {
    payload.value_text = document.getElementById('portal-fill-input').value.trim();
    if (field.required && !payload.value_text) { showPortalToast('Esse campo é obrigatório.'); return; }
  } else if (field.field_type === 'number' || field.field_type === 'currency' || field.field_type === 'percentage') {
    const raw = document.getElementById('portal-fill-input').value;
    if (field.required && raw === '') { showPortalToast('Esse campo é obrigatório.'); return; }
    payload.value_number = raw === '' ? null : Number(raw);
  } else if (field.field_type === 'date') {
    payload.value_date = document.getElementById('portal-fill-input').value || null;
    if (field.required && !payload.value_date) { showPortalToast('Esse campo é obrigatório.'); return; }
  } else if (field.field_type === 'boolean') {
    payload.value_boolean = document.getElementById('portal-fill-input').value === 'true';
  } else if (field.field_type === 'multi_select') {
    const checked = Array.from(document.querySelectorAll('.portal-multi-option:checked')).map(el => el.value);
    if (field.required && checked.length === 0) { showPortalToast('Selecione ao menos uma opção.'); return; }
    payload.value_options = checked;
  }

  const { error } = await supabaseClient
    .from('custom_field_values')
    .upsert(payload, { onConflict: 'field_id,period_date' });

  if (error) {
    console.error('Erro ao salvar preenchimento', error);
    showPortalToast('Não foi possível salvar. Tente novamente.');
    return;
  }

  closePortalFillModal();
  showPortalToast('Informação salva! ✅');
  await loadPortalFields();
}

window.onload = initPortal;
