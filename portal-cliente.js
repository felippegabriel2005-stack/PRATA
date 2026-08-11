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
async function loadClientDashboardData() {
  const [{ data: campaigns }, { data: targets }, { data: aiInsightRow }] = await Promise.all([
    supabaseClient.from('campaign_metrics').select('*').eq('client_slug', portalClientSlug),
    supabaseClient.from('targets').select('*').eq('client_slug', portalClientSlug),
    supabaseClient.from('client_ai_insights').select('insights').eq('client_slug', portalClientSlug).maybeSingle()
  ]);

  const rows = campaigns || [];
  let totalInvest = 0, totalImpress = 0, totalClicks = 0, totalPageViews = 0, totalLeads = 0, totalConvs = 0, totalRevenue = 0;
  rows.forEach(c => {
    totalInvest += Number(c.invest) || 0;
    totalImpress += Number(c.impressions) || 0;
    totalClicks += Number(c.clicks) || 0;
    totalPageViews += Number(c.page_views) || 0;
    totalLeads += Number(c.leads) || 0;
    totalConvs += Number(c.conversions) || 0;
    totalRevenue += Number(c.revenue) || 0;
  });

  const conversaoPct = totalClicks > 0 ? (totalConvs / totalClicks) * 100 : 0;
  const cpl = totalLeads > 0 ? totalInvest / totalLeads : 0;
  const cpa = totalConvs > 0 ? totalInvest / totalConvs : 0;
  const roi = totalInvest > 0 ? ((totalRevenue - totalInvest) / totalInvest) * 100 : 0;

  document.getElementById('portal-num-investimento').innerText = formatCurrencyThousandsPortal(totalInvest);
  document.getElementById('portal-num-receita').innerText = formatCurrencyThousandsPortal(totalRevenue);
  document.getElementById('portal-num-conversao').innerText = `${conversaoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  document.getElementById('portal-num-cpl').innerText = totalLeads > 0 ? formatCurrencyPortal(cpl) : '—';
  document.getElementById('portal-num-cpa').innerText = totalConvs > 0 ? formatCurrencyPortal(cpa) : '—';
  document.getElementById('portal-num-roi').innerText = `${Math.round(roi)}%`;

  const raw = { invest: totalInvest, revenue: totalRevenue, leads: totalLeads, impressions: totalImpress, clicks: totalClicks, pageViews: totalPageViews, conversions: totalConvs };
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
      `Investimento total de ${formatCurrencyPortal(totalInvest)} gerou receita de ${formatCurrencyPortal(totalRevenue)} (ROI de ${Math.round(roi)}%).`,
      `Taxa de conversão geral (cliques → conversões): ${conversaoPct.toFixed(1)}%.`,
      `Custo por lead médio de ${totalLeads > 0 ? formatCurrencyPortal(cpl) : '—'} e custo por conversão de ${totalConvs > 0 ? formatCurrencyPortal(cpa) : '—'}.`
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
    document.getElementById('portal-funnel-val-1').innerText = Math.round(totalImpress).toLocaleString('pt-BR');
    document.getElementById('portal-funnel-val-2').innerText = Math.round(totalClicks).toLocaleString('pt-BR');
    document.getElementById('portal-funnel-val-3').innerText = Math.round(totalPageViews).toLocaleString('pt-BR');
    document.getElementById('portal-funnel-val-4').innerText = Math.round(totalConvs).toLocaleString('pt-BR');

    document.getElementById('portal-funnel-pct-1').innerText = '100%';
    document.getElementById('portal-funnel-pct-2').innerText = totalImpress > 0 ? `${((totalClicks / totalImpress) * 100).toFixed(0)}%` : '0%';
    document.getElementById('portal-funnel-pct-3').innerText = totalClicks > 0 ? `${((totalPageViews / totalClicks) * 100).toFixed(0)}%` : '0%';
    document.getElementById('portal-funnel-pct-final').innerText = `${conversaoPct.toFixed(1)}% final`;
  } else {
    funnelSection.style.display = 'none';
  }
}

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
