// Utilitário TEMPORÁRIO — envia o Resumo Automático com dados FICTÍCIOS
// (não toca no banco real) pra usar em apresentação, já que a base de
// demonstração real está com o mês corrente zerado. Protegido pelo mesmo
// CRON_SECRET (não é um endpoint público, só quem já tem acesso ao
// agendamento consegue chamar). Seguro de remover depois de usar — não é
// referenciado por nenhuma tela do PRATA.

const { buildDigestEmailHtml, buildEmailSubject } = require('./_lib/email-template');
const { ALLOWED_EMAIL_RECIPIENTS } = require('./_lib/send-digest-core');

const MOCK_DATA = {
  period: { from: '2026-08-01', to: '2026-08-31', type: 'current_month' },
  comparison: {
    range: { from: '2026-07-01', to: '2026-07-31' },
    invest: 8.2, revenue: 11.4, sales: 6.5, conversaoPct: 0.4, cpl: -7.1, cpa: -4.8, roas: 6.4
  },
  executive: {
    invest: 184320, revenue: 638400, sales: 147, conversoes: 512, leads: 3860,
    conversaoPct: 4.8, cpl: 42.30, cpa: 186, roas: 3.46
  },
  healthCounts: { healthy: 8, attention: 3, critical: 1 },
  priorityClients: [
    { name: 'TechFlow B2B', status: 'critical', statusReasons: [{ severity: 'critical', text: 'CPA 94% acima da meta definida em "Conversão".' }], raw: { invest: 28400, revenue: 31200 } },
    { name: 'Vitta Odonto', status: 'attention', statusReasons: [{ severity: 'attention', text: 'CPA 12% acima da meta.' }], raw: { invest: 19800, revenue: 54600 } },
    { name: 'NovaHaus Imóveis', status: 'attention', statusReasons: [{ severity: 'attention', text: 'Dados comerciais pendentes há 2 dias.' }], raw: { invest: 22100, revenue: 61300 } },
    { name: 'Aurora Educação', status: 'attention', statusReasons: [{ severity: 'attention', text: 'Receita caiu 9% em relação ao mês anterior.' }], raw: { invest: 15600, revenue: 38900 } },
    { name: 'BellaFit Studio', status: 'healthy', statusReasons: [], raw: { invest: 12300, revenue: 61500 } }
  ],
  attentionToday: [
    { clientName: 'Vitta Odonto', severity: 'attention', messages: ['CPA está 12% acima da meta definida em "Conversão".', 'Taxa de conversão caiu 8% em relação ao mês anterior.'] },
    { clientName: 'NovaHaus Imóveis', severity: 'attention', messages: ['Dados comerciais pendentes.', 'Última atualização de vendas há 2 dias.'] },
    { clientName: 'TechFlow B2B', severity: 'critical', messages: ['R$ 8.400 investidos no período.', 'Nenhuma venda informada.'] }
  ],
  clientTable: [
    { name: 'BellaFit Studio', status: 'healthy', invest: 12300, revenue: 61500, roas: 5.0 },
    { name: 'NovaHaus Imóveis', status: 'attention', invest: 22100, revenue: 61300, roas: 2.77 },
    { name: 'Vitta Odonto', status: 'attention', invest: 19800, revenue: 54600, roas: 2.76 },
    { name: 'Aurora Educação', status: 'attention', invest: 15600, revenue: 38900, roas: 2.49 },
    { name: 'TechFlow B2B', status: 'critical', invest: 28400, revenue: 31200, roas: 1.10 },
    { name: 'Studio Prime Yoga', status: 'healthy', invest: 18900, revenue: 88200, roas: 4.67 },
    { name: 'Grupo Vetor Contábil', status: 'healthy', invest: 24100, revenue: 121300, roas: 5.03 },
    { name: 'Casa Verde Arquitetura', status: 'healthy', invest: 9800, revenue: 44700, roas: 4.56 }
  ],
  pendencies: {
    upToDateCount: 9, pendingCount: 2, staleCount: 1,
    items: [
      { clientName: 'NovaHaus Imóveis', fieldName: 'Vendas', status: 'stale', lastFilledDate: '2026-08-29' },
      { clientName: 'Grupo Vetor Contábil', fieldName: 'Propostas enviadas', status: 'pending', lastFilledDate: null },
      { clientName: 'Casa Verde Arquitetura', fieldName: 'Receita', status: 'pending', lastFilledDate: '2026-08-20' }
    ]
  },
  pipeline: {
    stages: [
      { name: 'Em abordagem', count: 8, value: 96000 },
      { name: 'Lead qualificado', count: 5, value: 74000 },
      { name: 'Reunião agendada', count: 4, value: 68000 },
      { name: 'Proposta enviada', count: 3, value: 51000 },
      { name: 'Follow-up proposta', count: 2, value: 30000 },
      { name: 'Fechado/Ganho', count: 6, value: 142000 },
      { name: 'Descartado/Perdido', count: 2, value: 18000 }
    ],
    openValue: 319000, openCount: 22
  },
  generatedAtIso: '2026-09-15'
};

const MOCK_INSIGHT = 'A carteira apresenta crescimento sólido no período: receita de R$ 638.400 (+11,4%) sobre um investimento de R$ 184.320 (+8,2%), com ROAS subindo pra 3,46x. Dois pontos merecem atenção — o CPA da TechFlow B2B segue bem acima da meta e a NovaHaus Imóveis está com dados comerciais pendentes há 2 dias. O maior crescimento de receita veio de BellaFit Studio e Grupo Vetor Contábil, enquanto TechFlow B2B foi o único cliente em estado crítico no período.';

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendKey || !fromEmail) {
    res.status(500).json({ error: 'RESEND_API_KEY/RESEND_FROM_EMAIL não configuradas.' });
    return;
  }

  const config = { sections: { executive_summary: true, attention_today: true, portfolio_health: true, client_performance: true, commercial_pipeline: true, data_pending: true, ai_insights: true } };
  const dashboardUrl = process.env.PRATA_DASHBOARD_URL || 'https://prata-felippe-workspace.vercel.app/';
  const html = buildDigestEmailHtml(MOCK_DATA, config, { dashboardUrl, whatsappAiUrl: process.env.WHATSAPP_AI_URL || null, insightText: MOCK_INSIGHT });
  const subject = buildEmailSubject(config, MOCK_DATA) + ' (exemplo)';

  const recipient = ALLOWED_EMAIL_RECIPIENTS[0];
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [recipient], subject, html })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(502).json({ ok: false, error: `Resend retornou ${resp.status}: ${errText.slice(0, 300)}` });
      return;
    }
    res.status(200).json({ ok: true, recipient, subject });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
