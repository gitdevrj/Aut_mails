/**
 * HTML do relatório semanal (puro). Depende de texto.js (escaparHtml).
 *
 * d: {
 *   periodo, simulacao, urlPlanilha, total, totalSimulado,
 *   porRegra:  [{ id, query, acao, movidos, simulados }],
 *   novas:     [{ id, query, acao, status, confianca, justificativa, exemplos, links:{aprovar, rejeitar, pausar} }],
 *   sugeridas: [idem],
 *   pausadas:  [{ id, query, erros }],
 *   rascunhos: número de rascunhos criados
 * }
 */
function montarRelatorioHtml(d) {
  var e = escaparHtml;
  var td = 'style="padding:6px 10px;border-bottom:1px solid #e5e5e5;vertical-align:top;font-size:13px"';
  var th = 'style="padding:6px 10px;border-bottom:2px solid #999;text-align:left;font-size:12px;color:#555"';
  function botao(url, texto, cor) {
    if (!url) return '';
    return '<a href="' + e(url) + '" style="display:inline-block;margin:2px 6px 2px 0;padding:4px 10px;' +
      'border-radius:4px;background:' + cor + ';color:#fff;text-decoration:none;font-size:12px">' + e(texto) + '</a>';
  }
  function blocoRegras(lista, comBotoes) {
    return lista.map(function (r) {
      var l = r.links || {};
      var botoes = '';
      if (comBotoes === 'sugerida') botoes = botao(l.aprovar, 'Aprovar', '#1a7f37') + botao(l.rejeitar, 'Rejeitar', '#b42318');
      if (comBotoes === 'nova') botoes = botao(l.pausar, 'Pausar', '#b54708') + botao(l.rejeitar, 'Rejeitar', '#b42318');
      return '<div style="margin:0 0 14px;padding:10px 12px;border:1px solid #ddd;border-radius:6px">' +
        '<div style="font-size:13px"><b>' + e(r.id) + '</b> &middot; <code>' + e(r.query) + '</code> &middot; ' +
        e(r.acao) + ' &middot; confiança ' + Math.round((Number(r.confianca) || 0) * 100) + '%</div>' +
        '<div style="font-size:13px;margin:6px 0">' + e(r.justificativa) + '</div>' +
        (r.exemplos ? '<div style="font-size:12px;color:#555">Exemplos: ' + e(r.exemplos) + '</div>' : '') +
        (botoes ? '<div style="margin-top:8px">' + botoes + '</div>' : '') + '</div>';
    }).join('');
  }
  var h = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:760px">';
  h += '<h2 style="margin:0 0 4px">Limpeza automática do Gmail</h2>';
  h += '<div style="font-size:13px;color:#555;margin-bottom:12px">' + e(d.periodo) + '</div>';
  if (d.simulacao) {
    h += '<div style="padding:8px 12px;background:#fff4ce;border:1px solid #e0c060;border-radius:6px;font-size:13px;' +
      'margin-bottom:12px"><b>Modo simulação ligado.</b> Nada foi movido; os números abaixo mostram o que seria feito.</div>';
  }
  h += '<p style="font-size:14px">Movidos na semana: <b>' + d.total + '</b>' +
    (d.totalSimulado ? ' &middot; simulados: <b>' + d.totalSimulado + '</b>' : '') +
    (d.rascunhos ? ' &middot; rascunhos de resposta criados: <b>' + d.rascunhos + '</b>' : '') + '</p>';

  h += '<h3 style="margin:18px 0 6px">Volume por regra</h3>';
  if (d.porRegra.length) {
    h += '<table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Regra</th><th ' + th +
      '>Query</th><th ' + th + '>Ação</th><th ' + th + '>Movidos</th><th ' + th + '>Simulados</th></tr>';
    d.porRegra.forEach(function (r) {
      h += '<tr><td ' + td + '>' + e(r.id) + '</td><td ' + td + '><code>' + e(r.query) + '</code></td><td ' + td +
        '>' + e(r.acao) + '</td><td ' + td + '>' + r.movidos + '</td><td ' + td + '>' + r.simulados + '</td></tr>';
    });
    h += '</table>';
  } else {
    h += '<p style="font-size:13px;color:#555">Nenhuma regra afetou mensagens nesta semana.</p>';
  }

  if (d.novas.length) {
    h += '<h3 style="margin:18px 0 6px">Regras adicionadas nesta semana (' + d.novas.length + ')</h3>' +
      blocoRegras(d.novas, 'nova');
  }
  h += '<h3 style="margin:18px 0 6px">Regras sugeridas aguardando aprovação (' + d.sugeridas.length + ')</h3>';
  h += d.sugeridas.length ? blocoRegras(d.sugeridas, 'sugerida')
    : '<p style="font-size:13px;color:#555">Nenhuma.</p>';

  h += '<h3 style="margin:18px 0 6px">Regras pausadas por erro (' + d.pausadas.length + ')</h3>';
  if (d.pausadas.length) {
    h += '<ul style="font-size:13px">' + d.pausadas.map(function (r) {
      return '<li><b>' + e(r.id) + '</b> &middot; <code>' + e(r.query) + '</code> &middot; ' + r.erros + ' erro(s)</li>';
    }).join('') + '</ul>';
  } else {
    h += '<p style="font-size:13px;color:#555">Nenhuma.</p>';
  }
  if (d.urlPlanilha) {
    h += '<p style="font-size:13px;margin-top:18px"><a href="' + e(d.urlPlanilha) + '">Abrir a planilha de controle</a></p>';
  }
  return h + '</div>';
}
