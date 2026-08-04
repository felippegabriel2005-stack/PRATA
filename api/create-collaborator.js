// Vercel Serverless Function — cria um novo colaborador COM acesso de login
// ao PRATA (usuário no Supabase Auth + linha na tabela collaborators).
// Precisa rodar no servidor porque criar um usuário no Supabase Auth exige a
// service_role key, que nunca pode ser exposta no navegador (diferente da
// anon key, feita pra ser pública).

const SUPABASE_URL = 'https://ldcpwadnvuotacwnkcop.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { name, role, email, password } = body || {};

  if (!name || !role || !email || !password) {
    res.status(400).json({ error: 'Preencha nome, cargo, e-mail e senha.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
    return;
  }

  try {
    const createUserResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name }
      })
    });

    const userData = await createUserResp.json();

    if (!createUserResp.ok) {
      console.error('Erro ao criar usuário no Supabase Auth:', createUserResp.status, JSON.stringify(userData));
      const msg = userData.msg || userData.message || userData.error_description || 'Erro ao criar usuário de acesso.';
      const isDuplicate = createUserResp.status === 422 || /already.*registered|already exists/i.test(msg);
      res.status(isDuplicate ? 409 : 502).json({ error: isDuplicate ? 'Já existe um usuário com esse e-mail.' : msg });
      return;
    }

    const authUserId = userData.id;

    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/collaborators`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ name, role, email, status: 'Ativo', auth_user_id: authUserId })
    });

    const collabData = await insertResp.json();

    if (!insertResp.ok) {
      console.error('Erro ao inserir collaborators:', insertResp.status, JSON.stringify(collabData));
      res.status(502).json({ error: 'Usuário de acesso criado, mas houve um erro ao registrar o colaborador. Recarregue a página.' });
      return;
    }

    res.status(200).json({ collaborator: Array.isArray(collabData) ? collabData[0] : collabData });
  } catch (err) {
    console.error('Erro ao criar colaborador:', err);
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
};
