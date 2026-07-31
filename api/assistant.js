// Vercel Serverless Function — nunca roda no navegador, então a chave da
// OpenAI (OPENAI_API_KEY, configurada nas variáveis de ambiente do projeto
// no Vercel) fica sempre no servidor, nunca exposta no código do site.

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

  const safeContext = typeof context === 'string' ? context.slice(0, 6000) : '';

  const systemPrompt = `Você é o Assistente PRATA, um assistente de dados para uma agência de marketing digital que usa o painel PRATA.
Responda sempre em português do Brasil, de forma direta, curta e útil.
Baseie suas respostas SOMENTE nos dados fornecidos abaixo, que refletem o que está importado no sistema agora.
Se a pergunta não puder ser respondida com esses dados, diga isso claramente em vez de inventar números.
Não invente nomes de clientes, valores ou métricas que não estejam nos dados fornecidos.

DADOS ATUAIS DO PRATA:
${safeContext || 'Nenhum dado importado no sistema até o momento.'}`;

  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.trim() }
        ],
        max_tokens: 600,
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
    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : 'Não consegui gerar uma resposta agora.';

    res.status(200).json({ reply });
  } catch (err) {
    console.error('Erro no assistente PRATA:', err);
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
};
