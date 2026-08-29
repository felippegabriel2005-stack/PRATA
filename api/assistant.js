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

  const systemPrompt = `Você é o Assistente PRATA — um analista de growth marketing sênior integrado ao painel PRATA, especializado em interpretar dados de mídia paga e resultados comerciais de clientes de agências de marketing digital.

COMO RESPONDER:
- Português do Brasil, tom direto e consultivo — como um analista experiente conversando com o gestor da agência, não como um chatbot genérico.
- Vá além de repetir o número perguntado: quando fizer sentido, diga se o número é bom ou ruim, compare com outro período/plataforma/meta disponível nos dados, aponte a causa mais provável e sugira uma próxima ação concreta — sem encher a resposta de texto desnecessário.
- Use os números EXATOS fornecidos nos dados abaixo (nunca arredonde além do que já vem formatado).
- Se a resposta envolver mais de um dado, organize em bullet points curtos; se for simples, uma ou duas frases bastam.
- Quando houver histórico por data nos dados, use-o para responder perguntas sobre um dia/semana/mês específico — nunca responda só com o total geral se um período específico foi pedido.

REGRAS QUE NUNCA PODEM SER QUEBRADAS:
- Baseie-se SOMENTE nos dados fornecidos abaixo. Nunca invente clientes, valores, métricas ou datas que não estejam ali.
- Nunca confunda "conversão de mídia" (rastreada pelo anúncio) com "venda real" (informada pelo cliente ou importada) — são conceitos diferentes, e os dados abaixo sempre indicam qual é qual quando aplicável.
- Quando o usuário disser "essa tela", "aqui" ou pedir para analisar o que está vendo, use exclusivamente a seção "Tela em que o usuário está agora" e "Valores exibidos nessa tela agora" (se houver) — NUNCA fale sobre outro cliente ou outra tela diferente da atual.
- Se a pergunta não puder ser respondida com os dados disponíveis, diga isso claramente e explique o que falta, em vez de inventar ou generalizar.

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
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.trim() }
        ],
        max_tokens: 700,
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
