// Disparo manual de UM Resumo Automático — usado pelo botão "Enviar e-mail
// de teste" e por "Enviar agora" na tela de Envios automáticos.
//
// Autenticação: exige o token de sessão do usuário logado no PRATA
// (Authorization: Bearer <access_token>, o mesmo token que supabaseClient.
// auth.getSession() já dá no navegador) — validado contra o Supabase Auth
// via GET /auth/v1/user. Não usa nenhum segredo novo exposto ao navegador;
// a service_role key e a chave do Resend continuam só no servidor.

const { sb, SUPABASE_URL } = require('./_lib/prata-core');
const { sendDigestForConfig } = require('./_lib/send-digest-core');

async function getAuthenticatedUser(accessToken, anonKey) {
  if (!accessToken) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido. Use POST.' });
    return;
  }

  const authHeader = req.headers['authorization'] || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const user = anonKey ? await getAuthenticatedUser(accessToken, anonKey) : null;
  if (!user) {
    res.status(401).json({ error: 'Sessão inválida. Faça login no PRATA e tente novamente.' });
    return;
  }

  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { config_id, is_test } = body || {};
  if (!config_id) {
    res.status(400).json({ error: 'Parâmetro "config_id" é obrigatório.' });
    return;
  }

  const rows = await sb(`email_digest_configs?id=eq.${config_id}&select=*`, supabaseKey);
  const config = rows[0];
  if (!config) {
    res.status(404).json({ error: 'Configuração de envio não encontrada.' });
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

  const result = await sendDigestForConfig(config, env, { isTest: !!is_test });

  // Log — sempre gravado pelo backend (service_role), independente do
  // resultado, pra manter o histórico completo (inclusive falhas/bloqueios).
  await sb('email_digest_logs', supabaseKey, {
    method: 'POST',
    body: {
      config_id: config.id,
      workspace_id: config.workspace_id,
      status: result.status,
      recipient: result.recipient,
      subject: result.subject,
      error_message: result.error || null,
      metadata: { is_test: !!is_test }
    }
  }).catch(() => {});

  if (!is_test && result.status === 'sent') {
    const { computeNextSendAt } = require('./_lib/send-digest-core');
    const nextSendAt = computeNextSendAt(config, new Date());
    await sb(`email_digest_configs?id=eq.${config.id}`, supabaseKey, {
      method: 'PATCH',
      body: { last_sent_at: new Date().toISOString(), next_send_at: nextSendAt.toISOString(), updated_at: new Date().toISOString() }
    }).catch(() => {});
  }

  if (result.status === 'sent') {
    res.status(200).json({ ok: true, message: is_test ? 'E-mail de teste enviado.' : 'E-mail enviado.', recipient: result.recipient, subject: result.subject });
  } else {
    res.status(502).json({ ok: false, error: result.error || 'Não foi possível enviar o e-mail. Verifique a configuração.' });
  }
};
