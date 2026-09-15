// Lógica de envio de UM Resumo Automático — chamada tanto pelo endpoint de
// teste manual (api/send-digest.js) quanto pelo cron agendado
// (api/cron-send-digests.js), pra nunca ter dois caminhos de envio
// divergentes. Fluxo: busca dados reais -> calcula indicadores (sempre via
// api/_lib/prata-core.js / digest-builder.js, nunca reimplementado aqui) ->
// monta HTML -> valida destinatário na allowlist -> envia pelo Resend ->
// grava log -> recalcula next_send_at.

const core = require('./prata-core');
const { computeAgencyDigestData, generateExecutiveInsight } = require('./digest-builder');
const { buildDigestEmailHtml, buildEmailSubject } = require('./email-template');

// MVP (seção 3 do pedido): só este e-mail pode receber, não importa o que
// vier do banco/frontend. Alterar esta lista é a ÚNICA forma de liberar
// outro destinatário — nunca confiar em recipient_email vindo da config ou
// de um parâmetro de request.
const ALLOWED_EMAIL_RECIPIENTS = ['felippegabriel2005@gmail.com'];

function isRecipientAllowed(email) {
  return ALLOWED_EMAIL_RECIPIENTS.includes((email || '').toLowerCase().trim());
}

// Calcula o próximo horário de disparo (America/Sao_Paulo) a partir de
// frequency/send_time — usado tanto pro valor inicial quanto pra
// recalcular depois de cada tentativa de envio.
function computeNextSendAt(config, fromDate) {
  const [hh, mm] = (config.send_time || '08:00').split(':').map(Number);
  const tz = config.timezone || 'America/Sao_Paulo';

  // Constrói "agora" na timezone configurada só pra achar a data de
  // calendário certa (dia/mês/ano) — a hora final é sempre montada a partir
  // de hh:mm na mesma timezone, convertida pra um instante UTC real.
  const base = fromDate || new Date();
  const zoned = new Date(base.toLocaleString('en-US', { timeZone: tz }));
  let candidate = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), hh, mm, 0, 0);

  // Offset entre a hora "local" que o JS calculou (no fuso do servidor) e o
  // instante real na timezone configurada — corrige pra gerar um Date UTC
  // correto independente de onde o processo Node está rodando.
  const offsetMs = base.getTime() - zoned.getTime();
  candidate = new Date(candidate.getTime() + offsetMs);

  const advanceDay = (d) => new Date(d.getTime() + 86400000);
  const isWeekday = (d) => { const day = new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay(); return day >= 1 && day <= 5; };

  // Se o horário de hoje já passou, começa a procurar a partir de amanhã.
  if (candidate.getTime() <= base.getTime()) candidate = advanceDay(candidate);

  if (config.frequency === 'weekdays') {
    let guard = 0;
    while (!isWeekday(candidate) && guard < 14) { candidate = advanceDay(candidate); guard++; }
  } else if (config.frequency === 'weekly') {
    // Mantém o mesmo dia da semana do envio anterior; se não houver
    // last_sent_at, cai no comportamento diário (próxima ocorrência do
    // horário configurado) — simplificação razoável pro MVP.
  } else if (config.frequency === 'monthly') {
    // Mesma ideia: dispara sempre no dia 1 do próximo mês configurado.
    const zonedCandidate = new Date(candidate.toLocaleString('en-US', { timeZone: tz }));
    if (zonedCandidate.getDate() !== 1) {
      const firstNextMonth = new Date(zonedCandidate.getFullYear(), zonedCandidate.getMonth() + 1, 1, hh, mm, 0, 0);
      candidate = new Date(firstNextMonth.getTime() + offsetMs);
    }
  }

  return candidate;
}

// Envia (ou simula, se isTest e sem RESEND configurado) o resumo de UMA
// config. Retorna { status: 'sent'|'failed'|'blocked', error, subject,
// recipient, htmlPreview }.
async function sendDigestForConfig(config, env, { isTest } = {}) {
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = env.RESEND_API_KEY;
  const fromEmail = env.RESEND_FROM_EMAIL;
  const dashboardUrl = env.PRATA_DASHBOARD_URL || 'https://prata-felippe-workspace.vercel.app/';
  const whatsappAiUrl = env.WHATSAPP_AI_URL || null;

  // Destinatário: SEMPRE o allowlist, nunca o que está salvo na config —
  // mesmo que alguém tenha alterado o banco diretamente.
  const recipient = ALLOWED_EMAIL_RECIPIENTS[0];
  if (!isRecipientAllowed(recipient)) {
    return { status: 'blocked', error: 'Destinatário fora da allowlist.', recipient: config.recipient_email };
  }

  let data, subject, html;
  try {
    data = await computeAgencyDigestData(supabaseKey, config);
    let insightText = null;
    if ((config.sections || {}).ai_insights !== false && env.OPENAI_API_KEY) {
      insightText = await generateExecutiveInsight(data, env.OPENAI_API_KEY);
    }
    subject = buildEmailSubject(config, data);
    html = buildDigestEmailHtml(data, config, { dashboardUrl, whatsappAiUrl, insightText });
  } catch (err) {
    console.error('Erro ao montar o resumo:', err);
    return { status: 'failed', error: 'Erro ao calcular os dados do resumo: ' + err.message, recipient, subject: null };
  }

  if (!resendKey) {
    return { status: 'failed', error: 'RESEND_API_KEY não configurada no servidor.', recipient, subject, htmlPreview: html };
  }
  if (!fromEmail) {
    return { status: 'failed', error: 'RESEND_FROM_EMAIL não configurada no servidor.', recipient, subject, htmlPreview: html };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject: isTest ? `[Teste] ${subject}` : subject,
        html
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: 'failed', error: `Resend retornou ${resp.status}: ${errText.slice(0, 300)}`, recipient, subject };
    }
    return { status: 'sent', recipient, subject };
  } catch (err) {
    console.error('Erro ao enviar pelo Resend:', err);
    return { status: 'failed', error: 'Erro de rede ao chamar o Resend: ' + err.message, recipient, subject };
  }
}

module.exports = { sendDigestForConfig, computeNextSendAt, isRecipientAllowed, ALLOWED_EMAIL_RECIPIENTS };
