// Vercel Serverless Function — gera os "Insights de IA" estratégicos de um
// cliente. Roda no servidor (nunca no navegador) para manter a OPENAI_API_KEY
// fora do código público, igual ao api/assistant.js.

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
  const { clientName, context } = body || {};

  if (!clientName || typeof clientName !== 'string') {
    res.status(400).json({ error: 'Nome do cliente ausente.' });
    return;
  }

  const safeContext = typeof context === 'string' ? context.slice(0, 8000) : '';

  const systemPrompt = `Você é um analista de marketing digital sênior de uma agência.
Analise os dados reais do cliente "${clientName}" abaixo e gere de 4 a 5 insights ESTRATÉGICOS — não apenas repita os números já dados, identifique oportunidades de otimização, riscos, gargalos do funil, comparações entre plataformas/campanhas e recomendações de ação concretas.
Responda em português do Brasil, direto e objetivo.
Cada insight deve ser UMA frase em UMA linha, sem numeração, sem marcadores (-, *, •) e sem markdown.
Baseie-se SOMENTE nos dados fornecidos abaixo; nunca invente números ou nomes.

DADOS REAIS DO CLIENTE:
${safeContext || 'Sem dados suficientes para análise.'}`;

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
          { role: 'user', content: 'Gere os insights estratégicos para este cliente.' }
        ],
        max_tokens: 700,
        temperature: 0.5
      })
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error('Erro da OpenAI (insights):', openaiResponse.status, errText);
      res.status(502).json({ error: 'Erro ao consultar a IA. Tente novamente em instantes.' });
      return;
    }

    const data = await openaiResponse.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';

    const insights = raw
      .split('\n')
      .map(line => line.replace(/^[\s\-*•\d.)]+/, '').trim())
      .filter(line => line.length > 0)
      .slice(0, 5);

    res.status(200).json({ insights });
  } catch (err) {
    console.error('Erro ao gerar insights estratégicos:', err);
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
};
