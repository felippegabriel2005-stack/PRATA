// Alvo do Vercel Cron — dispara os Resumos Automáticos cuja vez chegou.
// NÃO fica agendado sozinho: só roda quando o Vercel invoca esta rota (via
// entrada "crons" em vercel.json), e essa entrada só é adicionada depois
// que RESEND_API_KEY/RESEND_FROM_EMAIL estiverem configurados e um envio de
// teste manual já tiver funcionado (ver seção 29 do pedido) — antes disso,
// esta função existe mas nunca é chamada automaticamente.
//
// Autenticação: Vercel injeta "Authorization: Bearer <CRON_SECRET>" nas
// chamadas que ele mesmo faz pros crons do projeto, quando a env var
// CRON_SECRET está configurada — comparamos exatamente esse valor, então
// ninguém de fora consegue disparar isso batendo na URL na mão.
//
// Idempotência: cada config só é processada se next_send_at <= agora; a
// primeira coisa que fazemos após decidir enviar é recalcular e já gravar o
// PRÓXIMO next_send_at (antes mesmo do e-mail sair) — se o cron rodar de
// novo por qualquer motivo antes do horário seguinte, a config não vai mais
// aparecer como "vencida" e não é reprocessada.

const { sb } = require('./_lib/prata-core');
const { sendDigestForConfig, computeNextSendAt } = require('./_lib/send-digest-core');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' });
    return;
  }

  const env = {
    SUPABASE_SERVICE_ROLE_KEY: supabaseKey,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    WHATSAPP_AI_URL: process.env.WHATSAPP_AI_URL,
    PRATA_DASHBOARD_URL: process.env.PRATA_DASHBOARD_URL
  };

  const nowIso = new Date().toISOString();
  const dueConfigs = await sb(`email_digest_configs?active=eq.true&next_send_at=lte.${encodeURIComponent(nowIso)}&select=*`, supabaseKey);

  const results = [];
  for (const config of dueConfigs) {
    const now = new Date();
    const nextSendAt = computeNextSendAt(config, now);

    // Grava o próximo horário ANTES de enviar — garante que um segundo
    // disparo do cron (ex: retry da própria Vercel) não reprocesse esta
    // config enquanto o envio de agora ainda está em andamento.
    await sb(`email_digest_configs?id=eq.${config.id}`, supabaseKey, {
      method: 'PATCH',
      body: { next_send_at: nextSendAt.toISOString(), updated_at: now.toISOString() }
    }).catch(err => console.error('Falha ao atualizar next_send_at antes do envio:', err));

    const result = await sendDigestForConfig(config, env, { isTest: false });

    await sb('email_digest_logs', supabaseKey, {
      method: 'POST',
      body: {
        config_id: config.id,
        workspace_id: config.workspace_id,
        status: result.status,
        recipient: result.recipient,
        subject: result.subject,
        error_message: result.error || null,
        metadata: { trigger: 'cron' }
      }
    }).catch(err => console.error('Falha ao gravar log:', err));

    if (result.status === 'sent') {
      await sb(`email_digest_configs?id=eq.${config.id}`, supabaseKey, {
        method: 'PATCH',
        body: { last_sent_at: now.toISOString() }
      }).catch(() => {});
    }

    results.push({ config_id: config.id, name: config.name, status: result.status, error: result.error || null });
  }

  res.status(200).json({ ok: true, processed: results.length, results });
};
