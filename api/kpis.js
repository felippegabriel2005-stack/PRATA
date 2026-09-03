// Endpoint REST de só-leitura pra integrações externas (ex: agente de IA no
// n8n respondendo por WhatsApp) consultarem os MESMOS números que o
// dashboard do PRATA mostra — reaproveita a lógica de ./_lib/prata-core.js,
// a mesma que api/assistant.js usa pro assistente de IA embutido no PRATA.
// Isso é o que garante paridade: não é uma reimplementação em SQL solto, é
// literalmente a mesma função.
//
// Autenticação: header "Authorization: Bearer <PRATA_API_TOKEN>" — token
// fixo configurado nas env vars do Vercel, sem relação com a service_role
// key do Supabase nem com a chave da OpenAI. Métodos: GET (parâmetros na
// query string) ou POST (parâmetros no corpo JSON) — os dois funcionam,
// use o que for mais simples de configurar no n8n.
//
// Ações (parâmetro "action"):
//   list_clients                       → { clientes: [nomes...] }
//   client_kpis      (client, from?, to?) → KPIs principais + funil comercial.
//                                           Sem from/to, histórico inteiro.
//   client_campaigns (client, from?, to?) → métricas de mídia por campanha e
//                                           por plataforma (não inclui venda
//                                           real nem receita comercial).
//   client_targets   (client)             → meta x realizado por métrica
//                                           cadastrada em "Metas".
//   client_losses    (client, from?, to?) → motivos de perda agrupados.
//   custom_fields    (client, from?, to?) → campos do portal do cliente
//                                           (metadados + valores enviados).
//   agency_totals    (from?, to?)         → totais da carteira inteira.
//
// Toda resposta inclui "hoje_brasil" (data atual em America/Sao_Paulo,
// calculada no servidor) e, em client_kpis, "periodo_coberto_pelos_dados"
// (min/max das datas reais desse cliente) e "ultima_importacao" — pra quem
// perguntar "esse mês" conseguir responder "a base só vai até tal data" em
// vez de inventar "não vendeu".

const {
  sb,
  round2,
  resolveUnifiedSalesAndRevenue,
  sourceLabel,
  computeCommercialFunnelFromLeads,
  computeLossReasonsFromLeads,
  normalizeMetricNameToKey,
  findClientSlug,
  todayBR
} = require('./_lib/prata-core');

function filterByDateInRange(rows, dateField, from, to) {
  if (!from && !to) return rows;
  return rows.filter(r => {
    const d = r[dateField];
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function coveragePeriodAndLastImport(campaignsAll, leadsAll, customFieldValuesAll) {
  const allDates = [
    ...campaignsAll.map(c => c.date),
    ...leadsAll.map(l => l.date),
    ...customFieldValuesAll.map(v => v.period_date)
  ].filter(Boolean).sort();
  const desde = allDates.length ? allDates[0] : null;
  const ate = allDates.length ? allDates[allDates.length - 1] : null;

  const importTimestamps = [...campaignsAll, ...leadsAll]
    .map(r => r.created_at)
    .filter(Boolean)
    .sort();
  const ultimaImportacao = importTimestamps.length ? importTimestamps[importTimestamps.length - 1] : null;

  return { periodo_coberto_pelos_dados: { desde, ate }, ultima_importacao: ultimaImportacao };
}

async function computeClientKpisForPeriod(clientName, key, from, to) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const [campaignsAll, leadsAll, customFields, customFieldValuesAll, targets] = await Promise.all([
    sb(`campaign_metrics?client_slug=eq.${slug}&select=*`, key),
    sb(`leads_sales?client_slug=eq.${slug}&select=*`, key),
    sb(`custom_fields?client_slug=eq.${slug}&active=eq.true&select=*`, key),
    sb(`custom_field_values?client_slug=eq.${slug}&select=*`, key),
    sb(`targets?client_slug=eq.${slug}&select=*`, key)
  ]);

  // Período coberto e última importação vêm sempre do universo INTEIRO do
  // cliente (não filtrado) — é informação sobre a base, não sobre o recorte
  // pedido; é o que permite responder "a base só vai até tal data".
  const coverage = coveragePeriodAndLastImport(campaignsAll, leadsAll, customFieldValuesAll);

  // O filtro de período (se pedido) só se aplica ao CÁLCULO dos números —
  // mesma ideia de updateDashboardFilhoForCustomPeriod (script.js): refiltra
  // de verdade pela data real de cada linha, nunca aproxima por "fator".
  const campaigns = filterByDateInRange(campaignsAll, 'date', from, to);
  const leadsRows = filterByDateInRange(leadsAll, 'date', from, to);
  const customFieldValues = filterByDateInRange(customFieldValuesAll, 'period_date', from, to);

  let invest = 0, impress = 0, clicks = 0, pageViews = 0, leads = 0, conversions = 0, mediaRevenue = 0;
  campaigns.forEach(c => {
    invest += Number(c.invest) || 0;
    impress += Number(c.impressions) || 0;
    clicks += Number(c.clicks) || 0;
    pageViews += Number(c.page_views) || 0;
    leads += Number(c.leads) || 0;
    conversions += Number(c.conversions) || 0;
    mediaRevenue += Number(c.revenue) || 0;
  });

  const unified = resolveUnifiedSalesAndRevenue(leadsRows, customFields, customFieldValues);
  const revenue = unified.revenue.records.length ? unified.revenue.total : mediaRevenue;
  const revenueSrc = unified.revenue.records.length ? sourceLabel(unified.revenue.bySource) : 'mídia (campanhas importadas)';
  const sales = unified.sales.records.length ? unified.sales.total : null;
  const salesSrc = unified.sales.records.length ? sourceLabel(unified.sales.bySource) : null;

  const cpl = leads > 0 ? invest / leads : null;
  const cpa = conversions > 0 ? invest / conversions : null;
  const roi = invest > 0 ? ((revenue - invest) / invest) * 100 : null;

  const funil = computeCommercialFunnelFromLeads(leadsRows);

  return {
    cliente: client.name,
    hoje_brasil: todayBR(),
    periodo_solicitado: { desde: from || null, ate: to || null },
    ...coverage,
    investimento_total: round2(invest),
    receita_total: round2(revenue),
    receita_fonte: revenueSrc,
    vendas_reais: sales,
    vendas_reais_fonte: salesSrc,
    aviso_vendas: sales === null
      ? 'Este cliente não tem venda real (histórico importado ou campo do portal mapeado como vendas) no período pedido — não confundir com "conversões de mídia" abaixo.'
      : undefined,
    conversoes_de_midia: conversions,
    aviso_conversoes: 'Conversões de mídia são rastreadas pelo anúncio (cliques em formulário, pixel etc.) — NÃO é o mesmo que vendas reais confirmadas.',
    leads,
    cpl_por_lead: cpl !== null ? round2(cpl) : null,
    cpa_por_conversao_de_midia: cpa !== null ? round2(cpa) : null,
    roi_percentual: roi !== null ? Math.round(roi * 10) / 10 : null,
    funil_comercial: {
      aviso: 'Pipeline real (leads_sales.stage) — pode diferir de "vendas_reais" acima, que também soma valores informados pelo cliente no portal sem lead individual associado.',
      etapas: funil.stages,
      descartados: funil.discarded,
      total_leads: funil.total
    },
    linhas_de_campanha_importadas: campaigns.length
  };
}

// Métricas de MÍDIA por campanha e por plataforma — nunca inclui venda real
// nem receita comercial (isso é client_kpis/vendas_reais), só o que vem de
// campaign_metrics. "roi_midia_percentual" usa a receita atribuída pela
// própria mídia (campaign_metrics.revenue), não a receita comercial
// unificada — são conceitos diferentes, ver aviso na resposta.
async function computeClientCampaigns(clientName, key, from, to) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const campaignsAll = await sb(`campaign_metrics?client_slug=eq.${slug}&select=*`, key);
  const campaigns = filterByDateInRange(campaignsAll, 'date', from, to);

  const byCampaign = {};
  const byPlatform = {};
  campaigns.forEach(c => {
    const platform = c.platform || 'Outra';
    const ck = `${c.campaign_name}||${platform}`;
    if (!byCampaign[ck]) byCampaign[ck] = { campanha: c.campaign_name, plataforma: platform, investimento: 0, impressoes: 0, cliques: 0, leads: 0, conversoes: 0, receita_midia: 0 };
    byCampaign[ck].investimento += Number(c.invest) || 0;
    byCampaign[ck].impressoes += Number(c.impressions) || 0;
    byCampaign[ck].cliques += Number(c.clicks) || 0;
    byCampaign[ck].leads += Number(c.leads) || 0;
    byCampaign[ck].conversoes += Number(c.conversions) || 0;
    byCampaign[ck].receita_midia += Number(c.revenue) || 0;

    if (!byPlatform[platform]) byPlatform[platform] = { plataforma: platform, investimento: 0, impressoes: 0, cliques: 0, leads: 0, conversoes: 0, receita_midia: 0 };
    byPlatform[platform].investimento += Number(c.invest) || 0;
    byPlatform[platform].impressoes += Number(c.impressions) || 0;
    byPlatform[platform].cliques += Number(c.clicks) || 0;
    byPlatform[platform].leads += Number(c.leads) || 0;
    byPlatform[platform].conversoes += Number(c.conversions) || 0;
    byPlatform[platform].receita_midia += Number(c.revenue) || 0;
  });

  const withDerived = (row) => ({
    ...row,
    investimento: round2(row.investimento),
    receita_midia: round2(row.receita_midia),
    cpl: row.leads > 0 ? round2(row.investimento / row.leads) : null,
    cpa: row.conversoes > 0 ? round2(row.investimento / row.conversoes) : null,
    roi_midia_percentual: row.investimento > 0 ? Math.round(((row.receita_midia - row.investimento) / row.investimento) * 1000) / 10 : null
  });

  return {
    cliente: client.name,
    hoje_brasil: todayBR(),
    periodo_solicitado: { desde: from || null, ate: to || null },
    aviso: 'Métricas de mídia (campaign_metrics) — receita_midia e roi_midia_percentual usam a receita atribuída pelo próprio anúncio, não a venda/receita comercial real (ver action=client_kpis pra essa).',
    por_campanha: Object.values(byCampaign).map(withDerived).sort((a, b) => b.investimento - a.investimento),
    por_plataforma: Object.values(byPlatform).map(withDerived).sort((a, b) => b.investimento - a.investimento)
  };
}

// Meta x realizado, por métrica cadastrada em "Metas" — mesma normalização
// de nome de métrica usada no Score de Saúde (computeClientStatusFromData/
// quickStatus): targets.metric_name é um rótulo em português digitado por
// humano ("CTR", "Taxa de Conversão", "Custo por conversa" etc.), não uma
// chave interna, e precisa ser traduzido antes de comparar.
async function computeClientTargets(clientName, key, from, to) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const [campaignsAll, targets] = await Promise.all([
    sb(`campaign_metrics?client_slug=eq.${slug}&select=*`, key),
    sb(`targets?client_slug=eq.${slug}&select=*`, key)
  ]);
  const campaigns = filterByDateInRange(campaignsAll, 'date', from, to);

  let invest = 0, impress = 0, clicks = 0, pageViews = 0, leads = 0, conversions = 0, mediaRevenue = 0, messagesStarted = 0;
  campaigns.forEach(c => {
    invest += Number(c.invest) || 0;
    impress += Number(c.impressions) || 0;
    clicks += Number(c.clicks) || 0;
    pageViews += Number(c.page_views) || 0;
    leads += Number(c.leads) || 0;
    conversions += Number(c.conversions) || 0;
    mediaRevenue += Number(c.revenue) || 0;
    messagesStarted += Number(c.messages_started) || 0;
  });

  const actualByMetric = {
    invest, impress, clicks, views: pageViews, leads, convs: conversions,
    cpa: conversions > 0 ? invest / conversions : null,
    cpc: clicks > 0 ? invest / clicks : null,
    cpl: leads > 0 ? invest / leads : null,
    cpm: impress > 0 ? (invest / impress) * 1000 : null,
    ctr: impress > 0 ? (clicks / impress) * 100 : null,
    convrate: pageViews > 0 ? (conversions / pageViews) * 100 : null,
    roas: invest > 0 ? mediaRevenue / invest : null,
    custoPorConversa: messagesStarted > 0 ? invest / messagesStarted : null
  };

  const metas = targets.map(t => {
    const key2 = normalizeMetricNameToKey(t.metric_name);
    const actual = actualByMetric[key2];
    const target = Number(t.target_value);
    let ratio = null;
    if (actual !== null && actual !== undefined && target) {
      if ((t.rule || '').includes('Menor')) ratio = actual / target;
      else if ((t.rule || '').includes('Maior')) ratio = target / actual;
    }
    let status = 'sem_dado_suficiente';
    if (ratio !== null) {
      status = ratio > 1.3 ? 'fora_da_meta' : ratio > 1.1 ? 'levemente_fora_da_meta' : 'dentro_da_meta';
    }
    return {
      metrica: t.metric_name,
      objetivo: t.objective,
      regra: t.rule,
      meta: target,
      realizado: actual !== null && actual !== undefined ? round2(actual) : null,
      status
    };
  });

  return {
    cliente: client.name,
    hoje_brasil: todayBR(),
    periodo_solicitado: { desde: from || null, ate: to || null },
    aviso: 'realizado calculado a partir de campaign_metrics (mídia) no período pedido — targets não têm período próprio, é sempre "realizado até agora"/"no recorte pedido" comparado contra a meta cadastrada.',
    metas
  };
}

// Motivos de perda dos leads — qualquer linha com loss_reason preenchido,
// independente da etapa atual (não só quem está formalmente "Descartado").
async function computeClientLosses(clientName, key, from, to) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const leadsAll = await sb(`leads_sales?client_slug=eq.${slug}&select=*`, key);
  const leadsRows = filterByDateInRange(leadsAll, 'date', from, to);
  const { motivos, total_com_motivo_registrado } = computeLossReasonsFromLeads(leadsRows);

  return {
    cliente: client.name,
    hoje_brasil: todayBR(),
    periodo_solicitado: { desde: from || null, ate: to || null },
    motivos_de_perda: motivos,
    total_leads_com_motivo_registrado: total_com_motivo_registrado,
    total_leads_no_periodo: leadsRows.length
  };
}

// Campos personalizados do portal do cliente (custom_fields/custom_field_
// values) — a fonte que o SQL solto do agente não enxergava antes. Expõe
// metadado (tipo, mapeamento, frequência) e os valores enviados.
async function computeClientCustomFields(clientName, key, from, to) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const [fields, valuesAll] = await Promise.all([
    sb(`custom_fields?client_slug=eq.${slug}&select=*`, key),
    sb(`custom_field_values?client_slug=eq.${slug}&select=*`, key)
  ]);
  const values = filterByDateInRange(valuesAll, 'period_date', from, to);

  const valuesByField = {};
  values.forEach(v => { (valuesByField[v.field_id] = valuesByField[v.field_id] || []).push(v); });

  const campos = fields.map(f => ({
    nome: f.name,
    ativo: f.active,
    tipo: f.field_type,
    metric_mapping: f.metric_mapping,
    frequencia: f.frequency,
    obrigatorio: f.required,
    unidade: f.unit || null,
    valores: (valuesByField[f.id] || [])
      .sort((a, b) => (a.period_date < b.period_date ? -1 : 1))
      .map(v => ({
        data: v.period_date,
        valor_numero: v.value_number,
        valor_texto: v.value_text,
        valor_opcoes: v.value_options,
        enviado_por: v.submitted_by,
        enviado_em: v.submitted_at
      }))
  }));

  return {
    cliente: client.name,
    hoje_brasil: todayBR(),
    periodo_solicitado: { desde: from || null, ate: to || null },
    campos
  };
}

async function listClients(key) {
  const rows = await sb('clients?select=name&order=name', key);
  return rows.map(r => r.name);
}

async function computeAgencyTotalsForPeriod(key, from, to) {
  const clients = await sb('clients?select=name,slug', key);
  const [campaignsAll, leadsAll, fieldsAll, valuesAll] = await Promise.all([
    sb('campaign_metrics?select=*', key),
    sb('leads_sales?select=*', key),
    sb('custom_fields?active=eq.true&select=*', key),
    sb('custom_field_values?select=*', key)
  ]);

  const campaigns = filterByDateInRange(campaignsAll, 'date', from, to);
  const leads = filterByDateInRange(leadsAll, 'date', from, to);
  const values = filterByDateInRange(valuesAll, 'period_date', from, to);

  let invest = 0, clicks = 0, conversions = 0, leadsCount = 0;
  const mediaRevenueBySlug = {};
  campaigns.forEach(c => {
    invest += Number(c.invest) || 0;
    clicks += Number(c.clicks) || 0;
    conversions += Number(c.conversions) || 0;
    leadsCount += Number(c.leads) || 0;
    mediaRevenueBySlug[c.client_slug] = (mediaRevenueBySlug[c.client_slug] || 0) + (Number(c.revenue) || 0);
  });

  const fieldsBySlug = {}, valuesBySlug = {}, leadsBySlug = {};
  fieldsAll.forEach(f => { (fieldsBySlug[f.client_slug] = fieldsBySlug[f.client_slug] || []).push(f); });
  values.forEach(v => { (valuesBySlug[v.client_slug] = valuesBySlug[v.client_slug] || []).push(v); });
  leads.forEach(l => { (leadsBySlug[l.client_slug] = leadsBySlug[l.client_slug] || []).push(l); });

  let revenue = 0, salesReais = 0;
  clients.forEach(c => {
    const unified = resolveUnifiedSalesAndRevenue(leadsBySlug[c.slug] || [], fieldsBySlug[c.slug] || [], valuesBySlug[c.slug] || []);
    revenue += unified.revenue.records.length ? unified.revenue.total : (mediaRevenueBySlug[c.slug] || 0);
    salesReais += unified.sales.records.length ? unified.sales.total : 0;
  });

  return {
    hoje_brasil: todayBR(),
    periodo_solicitado: { desde: from || null, ate: to || null },
    total_clientes: clients.length,
    investimento_total: round2(invest),
    receita_total: round2(revenue),
    vendas_reais_totais: salesReais,
    aviso_vendas: 'vendas_reais_totais soma só clientes com venda real (histórico importado ou campo de portal mapeado) — não é o total de conversões de mídia.',
    conversoes_de_midia: conversions,
    leads: leadsCount,
    cpa_medio: conversions > 0 ? round2(invest / conversions) : null
  };
}

module.exports = async (req, res) => {
  const token = process.env.PRATA_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'PRATA_API_TOKEN não configurado no servidor.' });
    return;
  }
  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (provided !== token) {
    res.status(401).json({ error: 'Não autorizado. Envie "Authorization: Bearer <token>".' });
    return;
  }

  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' });
    return;
  }

  let params = {};
  if (req.method === 'GET') {
    params = req.query || {};
  } else if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    params = body || {};
  } else {
    res.status(405).json({ error: 'Método não permitido. Use GET ou POST.' });
    return;
  }

  const action = (params.action || '').toString();
  const from = params.from ? String(params.from) : null;
  const to = params.to ? String(params.to) : null;

  try {
    if (action === 'list_clients') {
      const clientes = await listClients(supabaseKey);
      res.status(200).json({ hoje_brasil: todayBR(), clientes });
      return;
    }

    const CLIENT_SCOPED_ACTIONS = {
      client_kpis: computeClientKpisForPeriod,
      client_campaigns: computeClientCampaigns,
      client_targets: computeClientTargets,
      client_losses: computeClientLosses,
      custom_fields: computeClientCustomFields
    };

    if (CLIENT_SCOPED_ACTIONS[action]) {
      const clientName = (params.client || '').toString().trim();
      if (!clientName) {
        res.status(400).json({ error: `Parâmetro "client" é obrigatório pra action=${action}.` });
        return;
      }
      const data = await CLIENT_SCOPED_ACTIONS[action](clientName, supabaseKey, from, to);
      if (!data) {
        const clientes = await listClients(supabaseKey);
        res.status(404).json({ error: `Cliente "${clientName}" não encontrado.`, clientes_disponiveis: clientes });
        return;
      }
      res.status(200).json(data);
      return;
    }

    if (action === 'agency_totals') {
      const data = await computeAgencyTotalsForPeriod(supabaseKey, from, to);
      res.status(200).json(data);
      return;
    }

    res.status(400).json({ error: 'Parâmetro "action" inválido ou ausente. Use: list_clients, client_kpis, client_campaigns, client_targets, client_losses, custom_fields, agency_totals.' });
  } catch (err) {
    console.error('Erro em /api/kpis:', err);
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
};
