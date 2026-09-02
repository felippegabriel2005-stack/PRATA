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
//   list_clients                     → { clientes: [nomes...] }
//   client_kpis   (client, from?, to?) → KPIs de um cliente, com período
//                                        opcional (AAAA-MM-DD). Sem from/to,
//                                        retorna o histórico inteiro.
//   agency_totals (from?, to?)       → totais da carteira inteira.
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

    if (action === 'client_kpis') {
      const clientName = (params.client || '').toString().trim();
      if (!clientName) {
        res.status(400).json({ error: 'Parâmetro "client" é obrigatório pra action=client_kpis.' });
        return;
      }
      const data = await computeClientKpisForPeriod(clientName, supabaseKey, from, to);
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

    res.status(400).json({ error: 'Parâmetro "action" inválido ou ausente. Use: list_clients, client_kpis, agency_totals.' });
  } catch (err) {
    console.error('Erro em /api/kpis:', err);
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
};
