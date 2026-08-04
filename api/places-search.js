// Vercel Serverless Function — proxy seguro pra Places API (New) do Google.
// Roda só no servidor pra manter a GOOGLE_MAPS_API_KEY fora do navegador,
// igual ao padrão já usado em api/assistant.js e api/insights.js.
//
// Usa exclusivamente Places API (New) — Text Search
// (POST https://places.googleapis.com/v1/places:searchText). A API legada
// (GET .../maps/api/place/textsearch/json) foi removida por instrução
// explícita: retornava sempre REQUEST_DENIED nesse projeto do Google Cloud.
//
// Vantagem prática: o Text Search (New) já devolve telefone, site e link do
// Google Maps na mesma chamada — não precisa de uma segunda requisição de
// Place Details por resultado (mais barato e mais rápido).

const MAX_RESULTS_PER_PAGE = 20;

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.primaryTypeDisplayName',
  'nextPageToken'
].join(',');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY não configurada no servidor.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { query, pageToken } = body || {};

  if (!pageToken && (!query || typeof query !== 'string' || query.trim().length < 3)) {
    res.status(400).json({ error: 'Digite ao menos 3 caracteres para buscar.' });
    return;
  }

  const requestBody = pageToken
    ? { pageToken, languageCode: 'pt-BR', regionCode: 'BR' }
    : { textQuery: query.trim(), languageCode: 'pt-BR', regionCode: 'BR' };

  try {
    const searchResp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK
      },
      body: JSON.stringify(requestBody)
    });

    const data = await searchResp.json();

    if (!searchResp.ok) {
      console.error('Erro Google Places (New Text Search):', searchResp.status, JSON.stringify(data));
      const message = (data.error && data.error.message) || `Erro ao consultar o Google Maps (HTTP ${searchResp.status}).`;
      res.status(502).json({ error: message });
      return;
    }

    const places = (data.places || []).slice(0, MAX_RESULTS_PER_PAGE);
    const results = places.map(p => ({
      placeId: p.id,
      name: p.displayName ? p.displayName.text : '',
      address: p.formattedAddress || null,
      category: p.primaryTypeDisplayName ? p.primaryTypeDisplayName.text : 'Estabelecimento',
      rating: typeof p.rating === 'number' ? p.rating : null,
      ratingCount: p.userRatingCount || 0,
      businessStatus: null,
      openNow: null,
      weekdayText: null,
      phone: p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      googleMapsUrl: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${p.id}`,
      lat: p.location ? p.location.latitude : null,
      lng: p.location ? p.location.longitude : null
    }));

    res.status(200).json({
      results,
      nextPageToken: data.nextPageToken || null
    });
  } catch (err) {
    console.error('Erro na integração com Google Places (New):', err);
    res.status(500).json({ error: 'Erro interno ao consultar o Google Maps.' });
  }
};
