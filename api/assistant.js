// Vercel Serverless Function — nunca roda no navegador, então a chave da
// OpenAI (OPENAI_API_KEY) e a service_role key do Supabase
// (SUPABASE_SERVICE_ROLE_KEY, configuradas nas variáveis de ambiente do
// projeto no Vercel) ficam sempre no servidor, nunca expostas no site.
//
// Antes disso, o Assistente só enxergava o que buildAssistantContext()
// (script.js, no navegador) decidia mandar de antemão — normalmente só o
// cliente que estava aberto na tela, com dados detalhados, mais um resumo
// raso (nome/status) de todo o resto da carteira. Isso causava exatamente
// o bug que o usuário reportou: ao pedir "compare Cliente A com Cliente B"
// estando na tela do Cliente A, a IA comparava os dados profundos de A com
// o resuminho superficial de B — os dois lados vinham de níveis de
// detalhe completamente diferentes.
//
// Agora o Assistente tem FERRAMENTAS (function calling da OpenAI) que
// buscam dado ao vivo direto no Supabase pra QUALQUER cliente, no mesmo
// nível de detalhe, sob demanda — não depende mais só do que o navegador
// mandou de antemão. O contexto do navegador continua sendo enviado (mais
// enxuto agora), só pra dizer "em que tela o usuário está" — pra "essa
// tela"/"aqui" continuar respondendo com o que está literalmente visível.

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

// ==========================================================================
// Lógica pura portada de script.js (mesmas fórmulas, sem DOM) — ver
// resolveUnifiedSalesAndRevenue/computeClientStatusFromData lá pro
// original comentado. Duplicada aqui de propósito: esta função roda numa
// serverless function isolada, sem acesso ao bundle do navegador.
// ==========================================================================

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

function buildPortalDailyValues(customFields, customFieldValues, mappingType) {
  const fieldIds = new Set((customFields || []).filter(f => f.active && f.metric_mapping === mappingType).map(f => f.id));
  const byDate = {};
  (customFieldValues || []).forEach(v => {
    if (!fieldIds.has(v.field_id)) return;
    byDate[v.period_date] = (byDate[v.period_date] || 0) + (Number(v.value_number) || 0);
  });
  return byDate;
}

function unifyDailySeries(importByDate, portalByDate) {
  const dates = new Set([...Object.keys(importByDate || {}), ...Object.keys(portalByDate || {})]);
  const records = [];
  dates.forEach(date => {
    if (portalByDate[date] !== undefined) records.push({ date, value: portalByDate[date], source: 'portal' });
    else records.push({ date, value: importByDate[date], source: 'import' });
  });
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

// Status simplificado (ROI + metas cadastradas) pra dar ao Assistente uma
// ideia rápida de saúde — não inclui tendência mês a mês/atualização de
// dados/campos pendentes (isso fica só no Score de Saúde visual do painel,
// que roda no navegador). Suficiente pro nível de resposta de um chat.
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
  // Tenta um match parcial (contém) se o nome exato não bateu.
  const all = await sb(`clients?select=name,slug`, key);
  const lower = clientName.toLowerCase();
  return all.find(c => c.name.toLowerCase().includes(lower)) || null;
}

// KPIs principais de UM cliente — mesmo nível de detalhe sempre, seja qual
// for o cliente pedido, pra nunca comparar "maçã com laranja" numa comparação.
async function computeClientKpis(clientName, key) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const [campaigns, leadsRows, customFields, customFieldValues, targets] = await Promise.all([
    sb(`campaign_metrics?client_slug=eq.${slug}&select=*`, key),
    sb(`leads_sales?client_slug=eq.${slug}&select=*`, key),
    sb(`custom_fields?client_slug=eq.${slug}&active=eq.true&select=*`, key),
    sb(`custom_field_values?client_slug=eq.${slug}&select=*`, key),
    sb(`targets?client_slug=eq.${slug}&select=*`, key)
  ]);

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

  const actualByMetric = {
    invest, impress, clicks, views: pageViews, convs: conversions, cpa,
    cpc: clicks > 0 ? invest / clicks : null,
    cpm: impress > 0 ? (invest / impress) * 1000 : null,
    ctr: impress > 0 ? (clicks / impress) * 100 : null,
    convrate: pageViews > 0 ? (conversions / pageViews) * 100 : null
  };
  const { status, motivos } = quickStatus(invest, revenue, conversions, targets, actualByMetric);

  return {
    cliente: client.name,
    investimento_total: round2(invest),
    receita_total: round2(revenue),
    receita_fonte: revenueSrc,
    vendas_reais: sales,
    vendas_reais_fonte: salesSrc,
    aviso_vendas: sales === null ? 'Este cliente não tem campo de Vendas mapeado — não confundir "conversões de mídia" abaixo com vendas reais.' : undefined,
    conversoes_de_midia: conversions,
    aviso_conversoes: 'Conversões de mídia são rastreadas pelo anúncio (cliques em formulário, pixel, etc.) — NÃO é o mesmo que vendas reais confirmadas.',
    leads,
    cpl_por_lead: cpl !== null ? round2(cpl) : null,
    cpa_por_conversao_de_midia: cpa !== null ? round2(cpa) : null,
    roi_percentual: roi !== null ? Math.round(roi * 10) / 10 : null,
    status_aproximado: status,
    motivos_do_status: motivos,
    linhas_de_campanha_importadas: campaigns.length
  };
}

// Análise mais profunda de UM cliente — campanhas, funil, motivos de
// perda, insights já gerados. Só chamada quando o usuário pede algo além
// dos KPIs principais.
async function computeClientDeepDive(clientName, key) {
  const client = await findClientSlug(clientName, key);
  if (!client) return null;
  const slug = client.slug;

  const [base, campaigns, leadsRows, insightsRows] = await Promise.all([
    computeClientKpis(clientName, key),
    sb(`campaign_metrics?client_slug=eq.${slug}&select=*`, key),
    sb(`leads_sales?client_slug=eq.${slug}&select=*`, key),
    sb(`client_ai_insights?client_slug=eq.${slug}&select=insights`, key)
  ]);

  const byCampaign = {};
  campaigns.forEach(c => {
    const k = `${c.campaign_name}||${c.platform}`;
    if (!byCampaign[k]) byCampaign[k] = { nome: c.campaign_name, plataforma: c.platform, investimento: 0, cliques: 0, conversoes: 0, impressoes: 0 };
    byCampaign[k].investimento += Number(c.invest) || 0;
    byCampaign[k].cliques += Number(c.clicks) || 0;
    byCampaign[k].conversoes += Number(c.conversions) || 0;
    byCampaign[k].impressoes += Number(c.impressions) || 0;
  });
  const topCampanhas = Object.values(byCampaign)
    .map(c => ({
      ...c,
      investimento: round2(c.investimento),
      cpa: c.conversoes > 0 ? round2(c.investimento / c.conversoes) : null,
      ctr_percentual: c.impressoes > 0 ? Math.round((c.cliques / c.impressoes) * 10000) / 100 : null
    }))
    .sort((a, b) => b.investimento - a.investimento)
    .slice(0, 8);

  const lossCounts = {};
  leadsRows.forEach(l => { if (l.loss_reason) lossCounts[l.loss_reason] = (lossCounts[l.loss_reason] || 0) + 1; });
  const motivosDePerda = Object.entries(lossCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([motivo, ocorrencias]) => ({ motivo, ocorrencias }));

  const insights = (insightsRows[0] && Array.isArray(insightsRows[0].insights)) ? insightsRows[0].insights : [];

  return {
    ...base,
    top_campanhas_por_investimento: topCampanhas,
    motivos_de_perda_de_leads: motivosDePerda,
    insights_estrategicos_ja_gerados: insights
  };
}

async function listClients(key) {
  const rows = await sb('clients?select=name&order=name', key);
  return rows.map(r => r.name);
}

async function computeAgencyTotals(period, key) {
  const clients = await sb('clients?select=name,slug', key);
  const [allCampaigns, allLeads, allFields, allValues] = await Promise.all([
    sb('campaign_metrics?select=*', key),
    sb('leads_sales?select=*', key),
    sb('custom_fields?active=eq.true&select=*', key),
    sb('custom_field_values?select=*', key)
  ]);

  const now = new Date();
  let cutoffISO = null;
  if (period === 'month') cutoffISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  else if (period === 'quarter') cutoffISO = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);

  const campaigns = cutoffISO ? allCampaigns.filter(c => c.date && c.date >= cutoffISO) : allCampaigns;
  const leads = cutoffISO ? allLeads.filter(l => l.date && l.date >= cutoffISO) : allLeads;
  const values = cutoffISO ? allValues.filter(v => v.period_date && v.period_date >= cutoffISO) : allValues;

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
  allFields.forEach(f => { (fieldsBySlug[f.client_slug] = fieldsBySlug[f.client_slug] || []).push(f); });
  values.forEach(v => { (valuesBySlug[v.client_slug] = valuesBySlug[v.client_slug] || []).push(v); });
  leads.forEach(l => { (leadsBySlug[l.client_slug] = leadsBySlug[l.client_slug] || []).push(l); });

  let revenue = 0, salesReais = 0;
  clients.forEach(c => {
    const unified = resolveUnifiedSalesAndRevenue(leadsBySlug[c.slug] || [], fieldsBySlug[c.slug] || [], valuesBySlug[c.slug] || []);
    revenue += unified.revenue.records.length ? unified.revenue.total : (mediaRevenueBySlug[c.slug] || 0);
    salesReais += unified.sales.records.length ? unified.sales.total : 0;
  });

  return {
    periodo: period,
    total_clientes: clients.length,
    investimento_total: round2(invest),
    receita_total: round2(revenue),
    vendas_reais_totais: salesReais,
    aviso_vendas: 'vendas_reais_totais soma só clientes com campo de Vendas mapeado — não é o total de conversões de mídia.',
    leads_total: leadsCount,
    conversoes_de_midia_total: conversions,
    roi_percentual: invest > 0 ? Math.round(((revenue - invest) / invest) * 1000) / 10 : null
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_client_kpis',
      description: 'Busca os KPIs principais e atualizados (ao vivo) de UM cliente do PRATA: investimento, receita real, vendas reais, ROI, CPL, CPA, status. Use sempre que o usuário perguntar sobre um cliente específico que não seja exatamente o que já está descrito na tela atual, ou ao comparar dois ou mais clientes — chame esta função UMA VEZ PARA CADA cliente mencionado, pra ter dados equivalentes de todos antes de comparar.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nome do cliente, como aparece no PRATA (aceita nome parcial).' } },
        required: ['client_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_client_deep_dive',
      description: 'Busca uma análise mais profunda de UM cliente: campanhas principais, motivos de perda de leads e insights estratégicos já gerados, além dos KPIs principais. Use quando o usuário pedir uma análise mais aprofundada/detalhada, não só os números principais.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string' } },
        required: ['client_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_clients',
      description: 'Lista os nomes de todos os clientes cadastrados no PRATA. Use quando não tiver certeza do nome exato de um cliente mencionado pelo usuário, antes de dizer que não encontrou.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_agency_totals',
      description: 'Busca os totais consolidados (ao vivo) de TODA a carteira de clientes da agência. Use quando a pergunta for sobre a agência/carteira inteira, não um cliente específico.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['all', 'month', 'quarter'], description: 'all = todo o período (padrão), month = mês atual, quarter = trimestre atual.' }
        }
      }
    }
  }
];

async function executeTool(name, args, key) {
  if (!key) return { erro: 'Busca de dados ao vivo indisponível no momento (configuração do servidor).' };
  let result;
  if (name === 'get_client_kpis') result = await computeClientKpis(args.client_name, key);
  else if (name === 'get_client_deep_dive') result = await computeClientDeepDive(args.client_name, key);
  else if (name === 'list_clients') result = await listClients(key);
  else if (name === 'get_agency_totals') result = await computeAgencyTotals(args.period || 'all', key);
  else return { erro: 'Ferramenta desconhecida.' };

  if (result === null) return { erro: `Cliente "${args.client_name}" não encontrado. Use list_clients pra conferir o nome exato.` };
  return result;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor.' });
    return;
  }
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { message, context } = body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'Mensagem vazia.' });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: 'Mensagem muito longa (máximo 2000 caracteres).' });
    return;
  }

  const safeContext = typeof context === 'string' ? context.slice(0, 4000) : '';

  const systemPrompt = `Você é o Assistente PRATA — um analista de growth marketing sênior integrado ao painel PRATA, especializado em interpretar dados de mídia paga e resultados comerciais de clientes de agências de marketing digital.

COMO RESPONDER:
- Português do Brasil, tom direto e consultivo — como um analista experiente conversando com o gestor da agência, não como um chatbot genérico.
- Vá além de repetir o número perguntado: quando fizer sentido, diga se o número é bom ou ruim, compare com outro período/plataforma/meta/cliente disponível, aponte a causa mais provável e sugira uma próxima ação concreta — sem encher a resposta de texto desnecessário.
- Se a resposta envolver mais de um dado ou cliente, organize em bullet points curtos ou tabela; se for simples, uma ou duas frases bastam.

FERRAMENTAS DISPONÍVEIS — use sempre que precisar de um dado que não está explícito no contexto da tela abaixo:
- get_client_kpis(client_name): KPIs principais e atualizados de UM cliente.
- get_client_deep_dive(client_name): análise mais profunda de UM cliente (campanhas, motivos de perda, insights).
- list_clients(): lista todos os clientes cadastrados.
- get_agency_totals(period): totais de toda a carteira.

REGRA CRÍTICA PARA COMPARAÇÕES ENTRE CLIENTES: ao comparar dois ou mais clientes, chame get_client_kpis (ou get_client_deep_dive, se o usuário pedir análise profunda) UMA VEZ PARA CADA cliente mencionado — nunca compare o cliente que está aberto na tela agora (dados detalhados) com outro cliente usando só menção superficial. Os dois lados de qualquer comparação precisam vir do MESMO nível de detalhe, buscado pela mesma ferramenta.

REGRAS QUE NUNCA PODEM SER QUEBRADAS:
- Baseie-se SOMENTE nos dados fornecidos (contexto da tela ou resultado das ferramentas). Nunca invente clientes, valores, métricas ou datas.
- Nunca confunda "conversão de mídia" (rastreada pelo anúncio) com "venda real" (informada pelo cliente ou importada de um histórico de vendas) — são conceitos diferentes; os dados sempre indicam qual é qual.
- Quando o usuário disser "essa tela", "aqui" ou pedir para analisar o que está vendo, priorize a seção "Tela em que o usuário está agora" abaixo — mas se a pergunta pedir mais profundidade ou outro cliente, use as ferramentas mesmo assim.
- Se um cliente mencionado não for encontrado, chame list_clients pra conferir o nome certo antes de dizer que não existe.
- Se a pergunta não puder ser respondida mesmo com as ferramentas, diga isso claramente em vez de inventar ou generalizar.

TELA ATUAL DO USUÁRIO NO PRATA (contexto enviado pelo navegador):
${safeContext || 'Nenhum contexto de tela disponível.'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message.trim() }
  ];

  try {
    let finalReply = null;

    for (let round = 0; round < 4 && finalReply === null; round++) {
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages,
          ...(supabaseKey ? { tools: TOOLS, tool_choice: 'auto' } : {}),
          max_tokens: 900,
          temperature: 0.4
        })
      });

      if (!openaiResponse.ok) {
        const errText = await openaiResponse.text();
        console.error('Erro da OpenAI:', openaiResponse.status, errText);
        res.status(502).json({ error: 'Erro ao consultar a IA. Tente novamente em instantes.' });
        return;
      }

      const data = await openaiResponse.json();
      const choice = data.choices && data.choices[0];
      const msg = choice && choice.message;

      if (!msg) {
        finalReply = 'Não consegui gerar uma resposta agora.';
        break;
      }

      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push(msg);
        // Roda todas as chamadas de ferramenta dessa rodada em paralelo (ex:
        // comparar 2 clientes = 2 chamadas de get_client_kpis de uma vez) —
        // não uma de cada vez, pra não somar latência à toa.
        const toolResults = await Promise.all(msg.tool_calls.map(async call => {
          try {
            const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            return await executeTool(call.function.name, args, supabaseKey);
          } catch (e) {
            console.error('Erro ao executar ferramenta', call.function.name, e);
            return { erro: 'Não foi possível buscar esse dado agora.' };
          }
        }));
        msg.tool_calls.forEach((call, i) => {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResults[i]) });
        });
        continue;
      }

      finalReply = msg.content || 'Não consegui gerar uma resposta agora.';
    }

    res.status(200).json({ reply: finalReply || 'Essa pergunta exigiu consultas demais pra responder de uma vez — tenta reformular de um jeito mais específico?' });
  } catch (err) {
    console.error('Erro no assistente PRATA:', err);
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
};
