// Template HTML do e-mail de Resumo Automático — precisa funcionar em
// clientes de e-mail com CSS limitado (Gmail à frente): layout em
// <table>, tudo inline, sem JS/CSS externo/grid/fontes obrigatórias.
// Visual claro (fundo branco, combina melhor com o tema padrão do Gmail
// que o dark premium do app) — cards em cinza bem claro, texto grafite,
// verde/amarelo/vermelho só pra status.

const COLORS = {
  bg: '#ffffff',
  card: '#f7f7f8',
  cardBorder: '#e4e4e7',
  divider: '#e4e4e7',
  textPrimary: '#18181b',
  textSecondary: '#52525b',
  textMuted: '#8b8b93',
  green: '#0e9f6e',
  yellow: '#c27803',
  red: '#dc2626',
  accent: '#2563eb'
};

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtCurrency(v) {
  if (v === null || v === undefined) return '—';
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
}
function fmtNumber(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toLocaleString('pt-BR');
}
function fmtPct(v, digits) {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits || 1, maximumFractionDigits: digits || 1 }) + '%';
}
function fmtDateBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function trendBadge(pct, unit, invert) {
  if (pct === null || pct === undefined || isNaN(pct)) return '';
  const good = invert ? pct <= 0 : pct >= 0;
  const color = pct === 0 ? COLORS.textMuted : (good ? COLORS.green : COLORS.red);
  const arrow = pct === 0 ? '→' : (pct > 0 ? '▲' : '▼');
  const val = unit === 'pp'
    ? `${Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`
    : `${Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return `<span style="color:${color};font-size:12px;font-weight:600;">${arrow} ${val}</span>`;
}

function statusLabel(status) {
  if (status === 'critical') return { text: 'Crítico', color: COLORS.red };
  if (status === 'attention') return { text: 'Atenção', color: COLORS.yellow };
  return { text: 'Saudável', color: COLORS.green };
}

function kpiCard(label, value, trendHtml) {
  return `
    <td valign="top" style="padding:6px;width:25%;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-radius:10px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:10px;letter-spacing:.4px;text-transform:uppercase;color:${COLORS.textSecondary};font-family:Arial,Helvetica,sans-serif;">${esc(label)}</div>
          <div style="font-size:20px;font-weight:700;color:${COLORS.textPrimary};font-family:Arial,Helvetica,sans-serif;margin-top:4px;">${value}</div>
          <div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;">${trendHtml || '&nbsp;'}</div>
        </td></tr>
      </table>
    </td>`;
}

function sectionTitle(text, emoji) {
  return `
    <tr><td style="padding:28px 24px 12px 24px;">
      <div style="font-size:15px;font-weight:700;color:${COLORS.textPrimary};font-family:Arial,Helvetica,sans-serif;">${emoji ? emoji + ' ' : ''}${esc(text)}</div>
    </td></tr>`;
}

function buildExecutiveSummary(data) {
  const e = data.executive;
  const c = data.comparison;
  const rows = [
    kpiCard('Investimento', fmtCurrency(e.invest), c ? trendBadge(c.invest) : ''),
    kpiCard('Receita', fmtCurrency(e.revenue), c ? trendBadge(c.revenue) : ''),
    kpiCard('Vendas', fmtNumber(e.sales), c ? trendBadge(c.sales) : ''),
    kpiCard('Conversão', fmtPct(e.conversaoPct), c ? trendBadge(c.conversaoPct, 'pp') : ''),
    kpiCard('CPL médio', fmtCurrency(e.cpl), c ? trendBadge(c.cpl, '%', true) : ''),
    kpiCard('CPA médio', fmtCurrency(e.cpa), c ? trendBadge(c.cpa, '%', true) : ''),
    kpiCard('ROAS', e.roas !== null ? e.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'x' : '—', c ? trendBadge(c.roas) : '')
  ];
  let html = sectionTitle('Resumo executivo', '📊');
  for (let i = 0; i < rows.length; i += 4) {
    const slice = rows.slice(i, i + 4);
    while (slice.length < 4) slice.push('<td style="width:25%;">&nbsp;</td>');
    html += `<tr><td style="padding:0 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${slice.join('')}</tr></table></td></tr>`;
  }
  return html;
}

function buildPortfolioHealth(data) {
  const h = data.healthCounts;
  const total = (h.healthy || 0) + (h.attention || 0) + (h.critical || 0);
  let html = sectionTitle('Saúde da carteira', '💚');
  html += `<tr><td style="padding:0 24px;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-size:13px;color:${COLORS.textSecondary};margin-bottom:10px;">${total} cliente(s) ativo(s) — <span style="color:${COLORS.green};">${h.healthy || 0} Saudáveis</span> · <span style="color:${COLORS.yellow};">${h.attention || 0} Atenção</span> · <span style="color:${COLORS.red};">${h.critical || 0} Crítico</span></div>
  </td></tr>`;

  data.priorityClients.forEach(c => {
    const s = statusLabel(c.status);
    const raw = c.raw || {};
    const roas = raw.invest > 0 ? (raw.revenue / raw.invest) : null;
    html += `
      <tr><td style="padding:8px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-left:3px solid ${s.color};border-radius:8px;">
          <tr><td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:13px;font-weight:700;color:${COLORS.textPrimary};">${esc(c.name)}</td>
              <td align="right" style="font-size:10px;font-weight:700;color:${s.color};text-transform:uppercase;">${s.text}</td>
            </tr></table>
            <div style="font-size:11px;color:${COLORS.textSecondary};margin-top:6px;">
              Investimento: ${fmtCurrency(raw.invest)} &nbsp;·&nbsp; Receita: ${fmtCurrency(raw.revenue)} &nbsp;·&nbsp; ROAS: ${roas !== null ? roas.toFixed(2) + 'x' : '—'}
            </div>
          </td></tr>
        </table>
      </td></tr>`;
  });
  return html;
}

function buildAttentionToday(data) {
  if (!data.attentionToday.length) {
    return sectionTitle('O que precisa da sua atenção hoje', '🎯') +
      `<tr><td style="padding:0 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.textSecondary};">Tudo certo por aqui — nenhum ponto de atenção identificado no momento. ✓</td></tr>`;
  }
  // Compacto de propósito: no máximo 2 motivos por cliente (o mais
  // importante geralmente já está entre os dois primeiros, já que
  // computeAgencyHealthAndAlerts lista ROI/meta antes de mês-a-mês/
  // pendência) + no máximo 5 clientes, senão o e-mail fica comprido demais.
  let html = sectionTitle('O que precisa da sua atenção hoje', '🎯');
  data.attentionToday.slice(0, 5).forEach(item => {
    const s = statusLabel(item.severity);
    const shown = item.messages.slice(0, 2);
    const extra = item.messages.length - shown.length;
    html += `
      <tr><td style="padding:5px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-left:3px solid ${s.color};border-radius:6px;">
          <tr><td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;font-weight:700;color:${s.color};text-transform:uppercase;letter-spacing:.3px;">${esc(item.clientName)}</div>
            ${shown.map(m => `<div style="font-size:11px;color:${COLORS.textSecondary};margin-top:3px;line-height:1.4;">• ${esc(m)}</div>`).join('')}
            ${extra > 0 ? `<div style="font-size:10px;color:${COLORS.textMuted};margin-top:3px;">+ ${extra} outro(s) ponto(s)</div>` : ''}
          </td></tr>
        </table>
      </td></tr>`;
  });
  return html;
}

function buildClientTable(data) {
  const rows = data.clientTable.slice(0, 10);
  if (!rows.length) return '';
  let html = sectionTitle('Desempenho dos clientes', '📋');
  html += `<tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
      <tr style="border-bottom:1px solid ${COLORS.divider};">
        <td style="padding:8px 6px;font-size:10px;color:${COLORS.textMuted};text-transform:uppercase;">Cliente</td>
        <td style="padding:8px 6px;font-size:10px;color:${COLORS.textMuted};text-transform:uppercase;" align="right">Invest.</td>
        <td style="padding:8px 6px;font-size:10px;color:${COLORS.textMuted};text-transform:uppercase;" align="right">Receita</td>
        <td style="padding:8px 6px;font-size:10px;color:${COLORS.textMuted};text-transform:uppercase;" align="right">ROAS</td>
      </tr>`;
  rows.forEach(c => {
    const s = statusLabel(c.status);
    const roas = c.roas !== null ? c.roas.toFixed(2) + 'x' : '—';
    html += `<tr style="border-bottom:1px solid ${COLORS.divider};">
      <td style="padding:8px 6px;font-size:12px;color:${COLORS.textPrimary};"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${s.color};margin-right:6px;"></span>${esc(c.name)}</td>
      <td style="padding:8px 6px;font-size:12px;color:${COLORS.textPrimary};" align="right">${fmtCurrency(c.invest)}</td>
      <td style="padding:8px 6px;font-size:12px;color:${COLORS.textPrimary};" align="right">${fmtCurrency(c.revenue)}</td>
      <td style="padding:8px 6px;font-size:12px;color:${COLORS.textPrimary};" align="right">${roas}</td>
    </tr>`;
  });
  html += `</table></td></tr>`;
  if (data.clientTable.length > 10) {
    html += `<tr><td style="padding:10px 24px 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;">
      <a href="${'{{DASHBOARD_URL}}'}" style="color:${COLORS.accent};text-decoration:none;">Ver carteira completa no PRATA →</a>
    </td></tr>`;
  }
  return html;
}

function buildCommercialPipeline(data) {
  const p = data.pipeline;
  if (!p.stages || !p.stages.length) return '';
  let html = sectionTitle('Pipeline comercial', '💼');
  html += `<tr><td style="padding:0 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.textSecondary};">
    ${p.openCount} oportunidade(s) aberta(s) &nbsp;·&nbsp; ${fmtCurrency(p.openValue)} em negociação
  </td></tr>`;
  html += `<tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">`;
  p.stages.forEach(s => {
    html += `<tr style="border-bottom:1px solid ${COLORS.divider};">
      <td style="padding:7px 6px;font-size:12px;color:${COLORS.textPrimary};">${esc(s.name)}</td>
      <td style="padding:7px 6px;font-size:12px;color:${COLORS.textSecondary};" align="right">${s.count} · ${fmtCurrency(s.value)}</td>
    </tr>`;
  });
  html += `</table></td></tr>`;
  return html;
}

function buildDataPendencies(data) {
  const p = data.pendencies;
  let html = sectionTitle('Pendências de dados', '📥');
  html += `<tr><td style="padding:0 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.textSecondary};">
    ${p.upToDateCount} campo(s) em dia &nbsp;·&nbsp; ${p.pendingCount} pendente(s) &nbsp;·&nbsp; ${p.staleCount} atrasado(s)
  </td></tr>`;
  const notOk = p.items.filter(i => i.status !== 'ok').slice(0, 8);
  if (notOk.length) {
    html += `<tr><td style="padding:0 24px;">`;
    notOk.forEach(i => {
      const when = i.lastFilledDate ? `Pendente desde ${fmtDateBR(i.lastFilledDate)}` : 'Nunca preenchido';
      html += `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${COLORS.textPrimary};padding:5px 0;border-bottom:1px solid ${COLORS.divider};">
        <strong>${esc(i.clientName)}</strong> <span style="color:${COLORS.textSecondary};">— ${esc(i.fieldName)} · ${when}</span>
      </div>`;
    });
    html += `</td></tr>`;
  }
  return html;
}

function buildInsight(insightText) {
  if (!insightText) return '';
  return `
    ${sectionTitle('Resumo do PRATA', '✦')}
    <tr><td style="padding:0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-radius:10px;">
        <tr><td style="padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${COLORS.textPrimary};">
          ${esc(insightText).replace(/\n+/g, '<br><br>')}
        </td></tr>
      </table>
    </td></tr>`;
}

function buildDigestEmailHtml(data, config, meta) {
  const sections = config.sections || {};
  const dashboardUrl = meta.dashboardUrl || '#';
  const whatsappUrl = meta.whatsappAiUrl;

  let body = '';
  if (sections.executive_summary !== false) body += buildExecutiveSummary(data);
  if (sections.attention_today !== false) body += buildAttentionToday(data);
  if (sections.portfolio_health !== false) body += buildPortfolioHealth(data);
  if (sections.client_performance !== false) body += buildClientTable(data).replace('{{DASHBOARD_URL}}', dashboardUrl);
  if (sections.commercial_pipeline !== false) body += buildCommercialPipeline(data);
  if (sections.data_pending !== false) body += buildDataPendencies(data);
  if (sections.ai_insights !== false && meta.insightText) body += buildInsight(meta.insightText);

  const dateLabel = fmtDateBR(data.generatedAtIso);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PRATA · Resumo da operação</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${COLORS.bg};">

          <tr><td style="padding:8px 24px 20px 24px;border-bottom:1px solid ${COLORS.divider};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:${COLORS.textPrimary};letter-spacing:.5px;">PRATA</td>
              <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${COLORS.textSecondary};">${esc(dateLabel)}</td>
            </tr></table>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COLORS.textSecondary};margin-top:6px;">Sua operação hoje</div>
          </td></tr>

          ${body}

          <tr><td style="padding:28px 24px 8px 24px;border-top:1px solid ${COLORS.divider};margin-top:20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td>
                <a href="${dashboardUrl}" style="display:inline-block;background:${COLORS.textPrimary};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;padding:10px 18px;border-radius:8px;">Abrir Dashboard no PRATA →</a>
              </td>
            </tr></table>
            ${whatsappUrl ? `<div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;">
              <span style="color:${COLORS.textSecondary};">Quer entender algum desses números?</span><br>
              <a href="${whatsappUrl}" style="color:${COLORS.accent};text-decoration:none;font-weight:700;">Pergunte ao PRATA →</a>
            </div>` : ''}
          </td></tr>

          <tr><td style="padding:20px 24px 32px 24px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${COLORS.textMuted};">
              PRATA · Revenue Tracking &amp; Intelligence — este resumo foi gerado automaticamente a partir dos dados da sua agência.
            </div>
          </td></tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailSubject(config, data) {
  const dateLabel = fmtDateBR(data.generatedAtIso);
  return `PRATA · Sua operação hoje · ${dateLabel}`;
}

module.exports = { buildDigestEmailHtml, buildEmailSubject };
