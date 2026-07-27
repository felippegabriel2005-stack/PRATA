/* ==========================================================================
   PRATA - Script de Controle de Arquitetura de Telas (Pai & Filho)
   ========================================================================== */

// ==========================================================================
// SUPABASE - Cliente e camada de acesso a dados
// ==========================================================================
const SUPABASE_URL = 'https://ldcpwadnvuotacwnkcop.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3eLKeEjjegJgKLf1bUHQ6Q_GQPJ_5v6';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function insertClient(name, status) {
  const slug = slugify(name);
  const position = allClients.length;
  const { data, error } = await supabaseClient
    .from('clients')
    .insert({ slug, name, status, pinned: false, position })
    .select()
    .single();
  if (error) { console.error('Erro ao criar cliente', error); return null; }
  return data;
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
function showDashboardPai() {
  currentClient = "";
  // Ajusta visibilidade dos blocos
  document.getElementById('view-dashboard-pai').style.display = 'block';
  document.getElementById('view-dashboard-filho').style.display = 'none';
  document.getElementById('view-dashboard-conversao').style.display = 'none';
  const viewColab = document.getElementById('view-colaboradores');
  if (viewColab) viewColab.style.display = 'none';
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
  if (typeof hideCommercialViews === 'function') hideCommercialViews();
  
  // Atualiza classes ativas da sidebar
  document.getElementById('menu-dashboard-link').classList.add('active');
  const menuColab = document.getElementById('menu-colaboradores-link');
  if (menuColab) menuColab.classList.remove('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  
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

  // Atualiza valores do Dashboard Pai com base no período atual
  updateDashboardPaiValues(agencyPeriodData[currentPeriod]);
}

// Alias to bridge english formatNumber with existing formatarNumero
function formatNumber(valor) {
  return formatarNumero(valor);
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

async function saveClientAnalyses() {
  const slugs = Object.keys(clientAnalyses);
  if (!slugs.length) return;

  await supabaseClient.from('client_analyses').delete().in('client_slug', slugs);

  const rows = [];
  slugs.forEach(slug => {
    (clientAnalyses[slug] || []).forEach((a, i) => {
      rows.push({ client_slug: slug, analysis_id: a.id, name: a.name, position: i });
    });
  });

  if (rows.length) await supabaseClient.from('client_analyses').insert(rows);
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
    addNewAnalysisPrompt(clientKey);
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
        saveClientAnalyses();

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
    saveClientAnalyses();

    const clientName = clientNameFromSlug(clientKey);

    if (currentClient === clientName && currentAnalysis === deleted.name) {
      selectAnalysis(clientName, 'Visão geral', 'visao');
    } else {
      renderClientSidebar(clientKey);
    }
  }
}

function addNewAnalysisPrompt(clientKey) {
  const name = prompt("Digite o nome da nova análise:");
  if (name && name.trim()) {
    const cleanName = name.trim();
    const id = 'ana_' + Date.now();
    
    if (!clientAnalyses[clientKey]) {
      clientAnalyses[clientKey] = [];
    }
    clientAnalyses[clientKey].push({ id, name: cleanName });
    saveClientAnalyses();
    renderClientSidebar(clientKey);

    const clientName = clientNameFromSlug(clientKey);
    selectAnalysis(clientName, cleanName, id);
  }
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

function loadConversaoCampaignsForClient(clientName) {
  conversaoCampaigns.length = 0; // Clear the array
  
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
    // Collapse goes back to parent dashboard or stays on general
    showDashboardPai();
  }
}

function selectAnalysis(clientName, analysisName, analysisId) {
  currentClient = clientName;
  currentAnalysis = analysisName;
  const clientKey = clientSlugFromName(clientName);

  if (!analysisId) {
    const list = clientAnalyses[clientKey] || [];
    const item = list.find(a => a.name === analysisName);
    analysisId = item ? item.id : 'visao';
  }

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
  const viewReports = document.getElementById('view-relatorios');
  if (viewReports) viewReports.style.display = 'none';
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

    // Aplica o template de métricas específico desta aba (estrutura + rótulos)
    const matrixTemplate = getAnalysisMatrixTemplate(analysisName);
    conversaoRows = JSON.parse(JSON.stringify(matrixTemplate.rows));
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
    loadConversaoCampaignsForClient(clientName);
    
    // Initial checked campaigns: Select first two by default
    conversaoCampaigns.forEach((c, idx) => {
      c.checked = (idx < 2);
    });
    
    renderConvCampaignsDropdown();
    updateConvCampaignsCountText();
    updateConversaoMetrics();
    renderCalendarDaysGrid('conv');
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
  
  dropdown.style.display = isHidden ? 'flex' : 'none';
  
  if (isHidden) {
    renderCalendarDaysGrid(prefix);
  }
}

// Event listener global para fechar dropdowns ao clicar fora
document.addEventListener('click', function(event) {
  const path = event.composedPath();
  
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
  const endDate = new Date(2025, 4, 31); // Maio 31, 2025 (data base de fechamento)
  let startDate;
  
  if (preset === 'all') {
    startDate = new Date(2025, 4, 1);
  } else {
    const days = parseInt(preset);
    startDate = new Date(2025, 4, 31);
    startDate.setDate(startDate.getDate() - (days - 1));
  }
  
  state.startDate = startDate;
  state.endDate = endDate;
  state.currentYear = 2025;
  state.currentMonth = 4; // Maio
  
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

function updateDashboardFilhoForCustomPeriod(startDate, endDate) {
  if (!startDate || !endDate) return;
  const diffTime = Math.abs(endDate - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const factor = Math.min(1.0, diffDays / 31);
  
  const formattedPeriod = `${formatDate(startDate)} - ${formatDate(endDate)}`;
  
  const metaEl = document.getElementById('c-meta');
  if (metaEl) {
    const segment = metaEl.innerText.split('·')[0].trim();
    metaEl.innerText = `${segment} · ${formattedPeriod}`;
  }
  
  const clientData = clientDetailedData[currentClient];
  if (!clientData) return;
  
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

  // Recalcular CPL, CPA e ROI/ROAS
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
  
  dropdown.style.display = isHidden ? 'flex' : 'none';
}

document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('conv-campaigns-dropdown');
  const btn = document.getElementById('conv-filter-campaigns-btn');
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

function getAnalysisMatrixTemplate(analysisName) {
  // Correspondência exata primeiro (cobre os nomes padrão das abas)
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

  return ANALYSIS_MATRIX_TEMPLATES['Conversão'];
}

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

    row.metrics.forEach((metric, metricIndex) => {
      const chip = document.createElement('div');
      chip.className = 'metric-chip-edit';
      if (metric.isEditing) {
        chip.style.borderColor = '#8b5cf6';
        chip.style.backgroundColor = 'rgba(139, 92, 246, 0.05)';
      }

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

      // Reordenar para Esquerda
      const moveLeftBtn = document.createElement('button');
      moveLeftBtn.className = 'colab-btn-edit';
      moveLeftBtn.style.padding = '2px 6px';
      moveLeftBtn.style.fontSize = '9px';
      moveLeftBtn.innerText = '←';
      moveLeftBtn.disabled = metricIndex === 0;
      moveLeftBtn.onclick = (e) => {
        e.stopPropagation();
        const tmp = row.metrics[metricIndex];
        row.metrics[metricIndex] = row.metrics[metricIndex - 1];
        row.metrics[metricIndex - 1] = tmp;
        renderEditRows();
      };

      // Reordenar para Direita
      const moveRightBtn = document.createElement('button');
      moveRightBtn.className = 'colab-btn-edit';
      moveRightBtn.style.padding = '2px 6px';
      moveRightBtn.style.fontSize = '9px';
      moveRightBtn.innerText = '→';
      moveRightBtn.disabled = metricIndex === row.metrics.length - 1;
      moveRightBtn.onclick = (e) => {
        e.stopPropagation();
        const tmp = row.metrics[metricIndex];
        row.metrics[metricIndex] = row.metrics[metricIndex + 1];
        row.metrics[metricIndex + 1] = tmp;
        renderEditRows();
      };

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

      actions.appendChild(moveLeftBtn);
      actions.appendChild(moveRightBtn);
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
  showToast("Estrutura da análise de conversão atualizada!");
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
  showToast('Linha removida.');
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

  // Cada aba de análise representa uma fatia diferente e estável do tráfego do cliente
  const factor = periodFactor * getAnalysisFactor(currentAnalysis);

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
}

// Abre o Dashboard Filho de um Cliente Específico
function selectClient(clientName) {
  currentClient = clientName;
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
  if (typeof hideCommercialViews === 'function') hideCommercialViews();
  
  // Atualiza classes ativas na sidebar
  document.getElementById('menu-dashboard-link').classList.remove('active');
  const menuColab2 = document.getElementById('menu-colaboradores-link');
  if (menuColab2) menuColab2.classList.remove('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  
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
  
  // Badge de Status do Cliente
  const badge = document.getElementById('c-status-badge');
  badge.innerText = data.status;
  badge.className = `table-badge ${data.statusClass}`;
  
  // Filtro de Período do Cliente (Mantém o estado atual selecionado para consistência)
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
  const insightsUl = document.getElementById('c-insights-list');
  insightsUl.innerHTML = '';
  const activeInsights = (currentAnalysis && currentAnalysis !== 'Visão geral') ?
                          getAnalysisInsights(clientName, currentAnalysis) :
                          data.insights;
                          
  activeInsights.forEach(insight => {
    const li = document.createElement('li');
    li.innerText = insight;
    insightsUl.appendChild(li);
  });

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
  
  // Reseta estado dos botões de plataforma de Ads
  document.getElementById('c-ads-tab-todas').classList.add('active');
  const adsButtons = document.querySelectorAll('#c-performance-ads-section .filters-container button');
  adsButtons.forEach(btn => {
    if (btn.id !== 'c-ads-tab-todas') btn.classList.remove('active');
  });

  // Reseta filtros de busca e selects de campanhas
  document.getElementById('search-campaign').value = '';
  document.getElementById('filter-camp-platform').value = 'Todas';
  document.getElementById('filter-camp-objective').value = 'Todos';
  document.getElementById('filter-camp-status').value = 'Todos';
  document.getElementById('c-campaign-select-all').checked = true;

  // Clona a lista de campanhas para manipular na memória
  clientCampaigns = data.campaigns.map(c => ({...c, checked: true}));

  // Atualiza rótulo de período dos Ads
  document.getElementById('c-ads-period-label').innerText = data.adsKpis.period;

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

  clientCampaigns.forEach(camp => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    
    // Define a classe da bolinha de status da plataforma
    const dotColor = camp.platform === 'Google Ads' ? '#3b82f6' : '#8b5cf6';

    // Cria a linha
    tr.innerHTML = `
      <td style="padding: 12px 10px;" onclick="event.stopPropagation();">
        <input type="checkbox" class="campaign-row-checkbox" data-id="${camp.id}" ${camp.checked ? 'checked' : ''} onchange="toggleCampaignSelection(${camp.id}, this.checked)">
      </td>
      <td class="table-client-cell" onclick="toggleCampaignRow(${camp.id})">
        <span class="status-dot" style="background-color: ${dotColor}; box-shadow: 0 0 6px ${dotColor};"></span>
        <span style="font-weight: 500;">${camp.name}</span>
      </td>
      <td onclick="toggleCampaignRow(${camp.id})">${camp.platform}</td>
      <td onclick="toggleCampaignRow(${camp.id})" style="font-weight: 600;">R$ ${camp.invest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      <td onclick="toggleCampaignRow(${camp.id})">${camp.impress.toLocaleString('pt-BR')}</td>
      <td onclick="toggleCampaignRow(${camp.id})">${camp.clicks.toLocaleString('pt-BR')}</td>
      <td onclick="toggleCampaignRow(${camp.id})">${camp.ctr}%</td>
      <td onclick="toggleCampaignRow(${camp.id})">R$ ${camp.cpc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      <td onclick="toggleCampaignRow(${camp.id})">${camp.convs}</td>
      <td onclick="toggleCampaignRow(${camp.id})">${camp.convs > 0 ? 'R$ ' + camp.cpa.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : '—'}</td>
    `;
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

// Seleção de Checkbox individual na tabela
function toggleCampaignSelection(id, checked) {
  const camp = clientCampaigns.find(c => c.id === id);
  if (camp) {
    camp.checked = checked;
  }
  
  // Atualiza checkbox mestre do cabeçalho
  const allChecked = clientCampaigns.every(c => c.checked);
  document.getElementById('c-campaign-select-all').checked = allChecked;

  recalculateAdsMetrics();
}

// Clique na linha inteira da tabela
function toggleCampaignRow(id) {
  const checkbox = document.querySelector(`.campaign-row-checkbox[data-id="${id}"]`);
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

// Recalcula KPIs e cards de plataforma com base nas campanhas selecionadas
function recalculateAdsMetrics() {
  let totalInvest = 0;
  let totalClicks = 0;
  let totalConvs = 0;
  let totalImpress = 0;

  // KPIs individuais por canal
  let gInvest = 0; let gClicks = 0; let gConvs = 0;
  let mInvest = 0; let mClicks = 0; let mConvs = 0;

  clientCampaigns.forEach(c => {
    if (c.checked) {
      totalInvest += c.invest;
      totalClicks += c.clicks;
      totalConvs += c.convs;
      totalImpress += c.impress;

      if (c.platform === 'Google Ads') {
        gInvest += c.invest;
        gClicks += c.clicks;
        gConvs += c.convs;
      } else if (c.platform === 'Meta Ads') {
        mInvest += c.invest;
        mClicks += c.clicks;
        mConvs += c.convs;
      }
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

  // Cálculos Google Ads
  const gCpa = gConvs > 0 ? gInvest / gConvs : 0;
  document.getElementById('c-gads-investimento').innerText = `R$ ${gInvest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
  document.getElementById('c-gads-cliques').innerText = gClicks.toLocaleString('pt-BR');
  document.getElementById('c-gads-conversoes').innerText = gConvs.toLocaleString('pt-BR');
  document.getElementById('c-gads-cpa').innerText = gCpa > 0 ? `R$ ${gCpa.toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : '—';

  // Cálculos Meta Ads
  const mCpa = mConvs > 0 ? mInvest / mConvs : 0;
  document.getElementById('c-mads-investimento').innerText = `R$ ${mInvest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
  document.getElementById('c-mads-cliques').innerText = mClicks.toLocaleString('pt-BR');
  document.getElementById('c-mads-conversoes').innerText = mConvs.toLocaleString('pt-BR');
  document.getElementById('c-mads-cpa').innerText = mCpa > 0 ? `R$ ${mCpa.toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : '—';
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
  const scaleYInvest = chartH / (maxInvest * 1.1);
  const scaleYConvs = chartH / (maxConvs * 1.1);

  // Número de pontos
  const n = chartData.dates.length;
  const stepX = chartW / (n - 1);

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

    // Rótulos do eixo X (Datas)
    if (n <= 7 || i % 2 === 0 || i === n - 1) {
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
  if (typeof hideCommercialViews === 'function') hideCommercialViews();
  
  // Atualiza classes ativas da sidebar
  document.getElementById('menu-dashboard-link').classList.remove('active');
  document.getElementById('menu-colaboradores-link').classList.add('active');
  const menuReports = document.getElementById('menu-relatorios-link');
  if (menuReports) menuReports.classList.remove('active');
  
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
  
  if (id) {
    // Editar Colaborador
    const colab = collaboratorsList.find(c => c.id === id);
    if (!colab) return;

    document.getElementById('modal-title-text').innerText = "Editar Colaborador";
    document.getElementById('colab-id').value = colab.id;
    document.getElementById('colab-name').value = colab.name;
    document.getElementById('colab-role').value = colab.role;
    document.getElementById('colab-email').value = colab.email;
  } else {
    // Novo Colaborador
    document.getElementById('modal-title-text').innerText = "Novo Colaborador";
    document.getElementById('colaborador-form').reset();
    document.getElementById('colab-id').value = '';
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
    // Atualiza existente
    const colab = collaboratorsList.find(c => c.id === idVal);
    if (colab) {
      colab.name = name;
      colab.role = role;
      colab.email = email;
    }
    await supabaseClient.from('collaborators').update({ name, role, email }).eq('id', idVal);
  } else {
    // Cria novo
    const { data, error } = await supabaseClient
      .from('collaborators')
      .insert({ name, role, email, status: 'Ativo' })
      .select()
      .single();
    if (error) {
      console.error('Erro ao criar colaborador', error);
    } else {
      collaboratorsList.push({
        id: data.id,
        name: data.name,
        role: data.role,
        email: data.email,
        status: data.status,
        statusClass: "active"
      });
    }
  }

  closeColaboradorModal();
  renderColaboradores(collaboratorsList);
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

function appendMessage(text, sender) {
  const container = document.getElementById('assist-messages-container');
  const wrapper = document.createElement('div');
  wrapper.className = `assist-message ${sender}`;
  wrapper.innerHTML = `<div class="message-bubble">${text}</div>`;
  container.appendChild(wrapper);
  
  container.scrollTop = container.scrollHeight;
}

function handleSuggestion(suggestionText) {
  appendMessage(suggestionText, 'user');
  simulateAIResponse(suggestionText);
}

function simulateAIResponse(query) {
  const container = document.getElementById('assist-messages-container');
  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'assist-message assistant loading-bubble';
  loadingWrapper.innerHTML = `<div class="message-bubble">Digitando...</div>`;
  container.appendChild(loadingWrapper);
  container.scrollTop = container.scrollHeight;
  
  const responses = {
    'resumir um cliente': 'Claro! Qual cliente você gostaria de resumir? Atualmente, os clientes que merecem mais atenção são o **Volks B2B** (Crítico - CTR caiu 22% no Google Ads) e o **Lumera Saúde** (Atenção - CPL subiu 15%). O **Drex Imóveis** e o **Orion Tech** estão saudáveis e superando as metas de conversão.',
    'mostrar principais alertas': 'Aqui estão os principais alertas do momento:\n\n1. 🔴 **Volks B2B**: CTR caiu 22% nas campanhas de conversão do Google Ads. Investimento de R$ 12k com baixo retorno.\n2. 🟡 **Lumera Saúde**: CPL aumentou 15% na campanha de WhatsApp. Foco na revisão de criativos.\n3. 🟡 **AgroVale**: Queda sutil de leads no Meta Ads. Monitorar nos próximos 3 dias.',
    'gerar resumo para o cliente': 'Gerando resumo de performance executiva...\n\n**Drex Imóveis (Maio 2025)**:\n- Investimento total: R$ 52.000 (Dentro do planejado)\n- Conversões geradas: 320 leads (+12% vs mês anterior)\n- CPA Médio: R$ 162,50\n- ROI Estimado: 4.2x\n\n*Recomendação:* Redirecionar 10% da verba de branding para campanhas de captação no WhatsApp.',
    'comparar canais': 'Análise comparativa de canais consolidada:\n\n- **Google Ads**: Responsável por 58% das conversões. Canal com menor CPA (médio de R$ 45) e melhor taxa de conversão direta.\n- **Meta Ads (Facebook/Instagram)**: Responsável por 32% das conversões. Excelente para atração inicial e leads de WhatsApp, mas com custo por lead mais instável.\n- **LinkedIn Ads**: Excelente qualidade de lead (B2B), porém o CPA é 3x maior que o Google Ads. Recomendado apenas para nichos específicos de alta receita.',
    'explicar uma métrica': 'Qual métrica você gostaria que eu explicasse? Aqui estão as principais:\n\n- **CPA (Custo por Aquisição)**: O custo total gasto dividido pelo número de conversões.\n- **CTR (Click-Through Rate)**: Porcentagem de cliques em relação às impressões.\n- **LTV (Lifetime Value)**: O valor total que um cliente gera durante seu ciclo de vida comercial.',
    'o que merece atenção?': 'Recomendo focar no **Volks B2B** imediatamente. Houve uma perda acentuada de eficiência nas campanhas de pesquisa. Sugiro verificar a concorrência de lances de palavras-chave e a qualidade dos anúncios.'
  };
  
  const normQuery = query.toLowerCase().trim();
  let aiText = 'Entendi sua pergunta sobre os dados do PRATA. Atualmente, os relatórios indicam estabilidade geral nas contas. Caso queira um aprofundamento em um cliente específico, recomendo filtrar as campanhas ou gerar o Relatório Consolidado.';
  
  for (const key in responses) {
    if (normQuery.includes(key)) {
      aiText = responses[key];
      break;
    }
  }
  
  setTimeout(() => {
    loadingWrapper.remove();
    appendMessage(aiText, 'assistant');
  }, 1000);
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
        </div>
        <span class="client-chevron" id="chevron-${c.slug}">▼</span>
      </div>
      <ul class="analysis-menu" id="analysis-menu-${c.slug}" style="display: none;"></ul>
    `;
    list.appendChild(li);
  });
}

function openClienteModal() {
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
  if (!name) return;

  const created = await insertClient(name, status);
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

function generateReportMock() {
  showToast(`Relatório ${selectedReportFormat} ("${selectedReportType}") gerado com sucesso!`);
}

function saveReportConfigMock() {
  showToast('Configuração de relatório salva com sucesso!');
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
    mapped: r.mapped
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
        mapped: r.mapped
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

function executeRadarSearch() {
  const queryInput = document.getElementById('radar-search-query');
  if (!queryInput) return;
  const query = queryInput.value.trim();
  if (!query) {
    showToast('Digite uma empresa, nicho ou cidade para buscar! 🔍');
    return;
  }
  
  const emptyState = document.getElementById('radar-empty-state');
  const loadingState = document.getElementById('radar-loading-state');
  const resultsCard = document.getElementById('radar-results-card');
  
  emptyState.style.display = 'none';
  resultsCard.style.display = 'none';
  loadingState.style.display = 'flex';
  
  setTimeout(() => {
    loadingState.style.display = 'none';
    resultsCard.style.display = 'block';
    
    const qLower = query.toLowerCase();
    
    if (qLower.includes('apdr') || qLower.includes('drag') || qLower.includes('race') || qLower.includes('pista') || qLower.includes('corrida')) {
      radarSearchResults = [
        {
          id: 'radar-1',
          name: 'APDR - Auto Performance Drag Race',
          niche: 'Pista de corrida',
          phone: '+55 11 91485-9517',
          address: 'Av. Higienópolis, 371 - Jardim Frizzo, Guarulhos - SP',
          rating: '★ 4.9 (83)',
          hasWebsite: true,
          hasMaps: true,
          status: 'Novo',
          checked: false
        },
        {
          id: 'radar-2',
          name: 'Speed Race Club',
          niche: 'Eventos automotivos',
          phone: '+55 11 97834-2211',
          address: 'Rodovia Anhanguera, km 18, Guarulhos - SP',
          rating: '★ 4.7 (41)',
          hasWebsite: true,
          hasMaps: true,
          status: 'Novo',
          checked: false
        },
        {
          id: 'radar-3',
          name: 'DragRace Brasil',
          niche: 'Associação esportiva',
          phone: 'Sem telefone',
          address: 'Guarulhos - SP',
          rating: 'Sem avaliação',
          hasWebsite: false,
          hasMaps: true,
          status: 'Sem telefone',
          checked: false
        }
      ];
    } else if (qLower.includes('imobili') || qLower.includes('casa') || qLower.includes('campinas')) {
      radarSearchResults = [
        {
          id: 'radar-4',
          name: 'Campinas Imóveis Premium',
          niche: 'Imobiliária',
          phone: '+55 19 3299-1100',
          address: 'Av. José de Souza Campos (Norte-Sul), 850 - Cambuí, Campinas - SP',
          rating: '★ 4.9 (95)',
          hasWebsite: true,
          hasMaps: true,
          status: 'Novo',
          checked: false
        },
        {
          id: 'radar-5',
          name: 'Vanguarda Imobiliária',
          niche: 'Imobiliária',
          phone: '+55 19 3744-8800',
          address: 'Rua Barão de Jaguara, 1030 - Centro, Campinas - SP',
          rating: '★ 4.6 (54)',
          hasWebsite: true,
          hasMaps: true,
          status: 'Novo',
          checked: false
        },
        {
          id: 'radar-6',
          name: 'Golden Lar Negócios',
          niche: 'Corretora de Imóveis',
          phone: 'Sem telefone',
          address: 'Av. Francisco Glicério, 1420, Campinas - SP',
          rating: '★ 4.2 (18)',
          hasWebsite: false,
          hasMaps: true,
          status: 'Sem telefone',
          checked: false
        }
      ];
    } else {
      const category = qLower.includes('clinica') || qLower.includes('dentista') || qLower.includes('medico') || qLower.includes('saude') ? 'Saúde' : 'Tecnologia';
      radarSearchResults = [
        {
          id: 'radar-gen-1',
          name: query.charAt(0).toUpperCase() + query.slice(1) + ' Matriz',
          niche: category,
          phone: '+55 11 99999-1234',
          address: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP',
          rating: '★ 4.8 (115)',
          hasWebsite: true,
          hasMaps: true,
          status: 'Novo',
          checked: false
        },
        {
          id: 'radar-gen-2',
          name: query.charAt(0).toUpperCase() + query.slice(1) + ' Distribuidora',
          niche: category,
          phone: '+55 11 98888-5678',
          address: 'Rua das Figueiras, 450 - Bairro Jardim, Santo André - SP',
          rating: '★ 4.5 (34)',
          hasWebsite: true,
          hasMaps: true,
          status: 'Novo',
          checked: false
        },
        {
          id: 'radar-gen-3',
          name: query.charAt(0).toUpperCase() + query.slice(1) + ' Local',
          niche: category,
          phone: 'Sem telefone',
          address: 'Rua Marechal Deodoro, 120, Guarulhos - SP',
          rating: 'Sem avaliação',
          hasWebsite: false,
          hasMaps: true,
          status: 'Sem telefone',
          checked: false
        }
      ];
    }
    
    // Check which ones are already imported
    radarSearchResults.forEach(res => {
      const isImported = commercialLeads.some(lead => lead.name.startsWith(res.name));
      if (isImported) {
        res.status = 'Importado';
      }
    });
    
    renderRadarSearchResults();
    populateRadarAssignOwner();
    showToast(`Google Maps concluiu busca para "${query}"! 📡`);
  }, 800);
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
      ? `<a href="#" onclick="event.preventDefault(); alert('Abrindo website de ${res.name}');" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.02); color: var(--text-secondary); text-decoration: none; font-size: 10px; font-weight: bold; margin-right: 4px;" title="Website">🌐</a>`
      : `<span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted); opacity: 0.3; font-size: 10px; font-weight: bold; margin-right: 4px;">🌐</span>`;
      
    const mapsLink = res.hasMaps 
      ? `<a href="#" onclick="event.preventDefault(); alert('Abrindo localização de ${res.name} no Google Maps');" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.02); color: var(--text-secondary); text-decoration: none; font-size: 10px; font-weight: bold;" title="Google Maps">📍</a>`
      : `<span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted); opacity: 0.3; font-size: 10px; font-weight: bold;">📍</span>`;

    let statusTag = '';
    if (isImported) {
      statusTag = `<span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-green); background-color: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.25); padding: 2px 8px; border-radius: 4px; display: inline-block;">Importado</span>`;
    } else if (isNoPhone) {
      statusTag = `<span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--text-muted); background-color: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 2px 8px; border-radius: 4px; display: inline-block; opacity: 0.6;">Sem telefone</span>`;
    } else {
      statusTag = `<span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-blue); background-color: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.25); padding: 2px 8px; border-radius: 4px; display: inline-block;">Novo</span>`;
    }

    tr.innerHTML = `
      <td style="padding: 12px 16px;">${checkboxHtml}</td>
      <td>
        <strong style="color: var(--text-primary); font-weight: 600; display: block;">${res.name}</strong>
        <span style="font-size: 9px; color: var(--text-secondary); display: block; margin-top: 1px;">${res.niche}</span>
      </td>
      <td><span style="font-size: 11px; font-family: monospace; color: ${res.phone === 'Sem telefone' ? 'var(--text-muted)' : 'var(--text-secondary)'};">${res.phone}</span></td>
      <td><span style="font-size: 11px; color: var(--text-secondary); max-width: 250px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${res.address}">${res.address}</span></td>
      <td>
        <span style="font-size: 11px; color: ${res.rating === 'Sem avaliação' ? 'var(--text-muted)' : 'var(--color-green)'};">
          ${res.rating}
        </span>
      </td>
      <td>
        <div style="display: flex; align-items: center;">
          ${websiteLink}
          ${mapsLink}
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
}

function closeLeadDetailsDrawer() {
  document.getElementById('lead-details-drawer').style.display = 'none';
  currentEditingLeadId = null;
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
window.onload = async function() {
  syncThemeOnLoad();

  allClients = await fetchClients();
  renderSidebarClients();

  await Promise.all([
    loadCommercialState(),
    initClientAnalyses()
  ]);

  allClients.filter(c => c.pinned).forEach(c => renderClientSidebar(c.slug));

  showDashboardPai();
};
