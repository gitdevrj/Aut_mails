/**
 * Coleta: histórico das exclusões manuais, comportamento positivo e feedback negativo.
 * Só metadados vão para a planilha; o corpo dos e-mails nunca é gravado.
 */

/** Acionador a cada 6 horas (a lixeira pode ser esvaziada a qualquer momento). */
function coletarHistorico() {
  comTrava_(function () {
    limparContinuacoes_('coletarHistorico');
    if (!coletaInterna_(false)) agendarContinuacao_('coletarHistorico');
  }, 'coletarHistorico');
}

/** Devolve true quando terminou tudo; false se parou por tempo. */
function coletaInterna_(todosOsRemetentes) {
  var cfg = lerConfig();
  detectarRestauracoes_(cfg);
  if (!coletarLixeira_(cfg)) return false;
  return amostrarComportamento_(cfg, todosOsRemetentes);
}

/** Copia para Historico_Lixeira o que está na lixeira e não foi movido pelo script. */
function coletarLixeira_(cfg) {
  var conhecidos = {};
  lerLinhas(ABAS.HISTORICO).forEach(function (l) { conhecidos[l.id] = true; });
  lerLinhas(ABAS.LOG).forEach(function (l) {
    if (!paraBooleano(l.simulacao)) conhecidos[l.id_mensagem] = true;
  });
  var idRotulo = gmailIdRotulo_(ROTULO, true);
  var novos = gmailListarTodos_('in:trash -in:sent -in:drafts -from:me -label:' + ROTULO, 10000, true).filter(function (id) { return !conhecidos[id]; });
  var agora = new Date();
  var buffer = [];
  var completo = true;
  for (var i = 0; i < novos.length; i++) {
    if (tempoEsgotado_(cfg)) { completo = false; break; }
    var m;
    try { m = gmailMetadados_(novos[i]); }
    catch (e) { if (e && e.cota) { anexarLinhas(ABAS.HISTORICO, buffer); throw e; } continue; }
    var rot = m.rotulos;
    if (rot.indexOf(idRotulo) >= 0 || rot.indexOf('SENT') >= 0 || rot.indexOf('DRAFT') >= 0) continue;
    if (!m.remetente || m.remetente === meuEmail_()) continue;
    var tipos = [];
    m.anexos.forEach(function (n) { var x = extensao(n); if (x && tipos.indexOf(x) < 0) tipos.push(x); });
    buffer.push({
      id: m.id, recebida_em: m.recebidaEm, excluida_em_aprox: agora, remetente: m.remetente,
      dominio: m.dominio, assunto: m.assunto, categoria: m.categoria,
      foi_aberta: rot.indexOf('UNREAD') < 0, tinha_anexo: m.anexos.length > 0,
      tipos_anexo: tipos.join(','), list_unsubscribe: m.listUnsubscribe
    });
    if (buffer.length >= 100) { anexarLinhas(ABAS.HISTORICO, buffer); buffer = []; }
  }
  anexarLinhas(ABAS.HISTORICO, buffer);
  return completo;
}

/**
 * Feedback negativo: e-mail com o rótulo _auto-limpeza que saiu da lixeira
 * (ou voltou para a caixa de entrada, no caso de "arquivar") é erro da regra.
 */
function detectarRestauracoes_(cfg) {
  var idRotulo = gmailIdRotulo_(ROTULO, false);
  if (!idRotulo) return 0;
  var porId = {};
  var ha = false;
  lerLinhas(ABAS.LOG).forEach(function (l) {
    if (paraBooleano(l.simulacao) || l.restaurada_em || l.feedback) return;
    if (l.acao !== 'lixeira' && l.acao !== 'arquivar') return;
    porId[l.id_mensagem] = l; ha = true;
  });
  if (!ha) return 0;
  var erros = [];
  gmailListarTodos_('label:' + ROTULO, 5000, false).forEach(function (id) {
    if (porId[id] && porId[id].acao === 'lixeira') erros.push(porId[id]);
  });
  gmailListarTodos_('label:' + ROTULO + ' in:inbox', 5000, false).forEach(function (id) {
    if (porId[id] && porId[id].acao === 'arquivar') erros.push(porId[id]);
  });
  if (!erros.length) return 0;

  var regras = {};
  lerLinhas(ABAS.REGRAS).forEach(function (r) { regras[r.id] = r; });
  var protegidos = lerLinhas(ABAS.PROTEGIDOS);
  var agora = new Date();
  erros.forEach(function (l) {
    var r = regras[l.id_regra];
    if (r) {
      var novo = aplicarErro(r, cfg);
      r.confianca = novo.confianca; r.erros = novo.erros; r.status = novo.status;
      atualizarCampos(ABAS.REGRAS, r._linha, novo);
    }
    if (l.remetente) proteger_(l.remetente, 'remetente', 'erro_regra', protegidos);
    atualizarCampos(ABAS.LOG, l._linha, { restaurada_em: agora, feedback: 'restaurada_pelo_usuario' });
  });
  gmailRotular_(erros.map(function (l) { return l.id_mensagem; }), [], [idRotulo]);
  return erros.length;
}

/** Contraexemplos: o que você lê, responde, marca com estrela ou mantém na caixa, por remetente. */
function medirComportamento_(email, cfg) {
  var janela = ' newer_than:' + cfg.janela_dias + 'd';
  var m = { chave: email, recebidos: 0, lidos: 0, respondidos: 0, estrelados: 0, mantidos_caixa: 0, atualizado_em: new Date() };
  m.respondidos = gmailContar_('to:' + email + ' in:sent');
  if (m.respondidos > 0) return m; // já veta a regra; não gasta mais buscas
  m.recebidos = gmailContar_('from:' + email + janela);
  if (m.recebidos > 0) {
    m.lidos = gmailContar_('from:' + email + ' is:read' + janela);
    m.mantidos_caixa = gmailContar_('from:' + email + ' in:inbox older_than:' + cfg.dias_permanencia_caixa + 'd');
  }
  m.estrelados = gmailContar_('from:' + email + ' is:starred');
  return m;
}

/**
 * Atualiza a aba Comportamento para os remetentes candidatos (os que aparecem no histórico).
 * todos = true: mede todos os que estão sem medição recente (usado na carga inicial).
 * Devolve false se parou por tempo.
 */
function amostrarComportamento_(cfg, todos) {
  var agora = Date.now();
  var contagem = {};
  lerLinhas(ABAS.HISTORICO).forEach(function (l) {
    if (agora - paraMs(l.excluida_em_aprox) > cfg.janela_dias * 86400000) return;
    var r = String(l.remetente).toLowerCase();
    contagem[r] = (contagem[r] || 0) + 1;
  });
  var existentes = {};
  lerLinhas(ABAS.COMPORTAMENTO).forEach(function (l) { existentes[String(l.chave).toLowerCase()] = l; });
  var validade = (todos ? 7 : 3) * 86400000;
  var pendentes = Object.keys(contagem).filter(function (r) {
    if (contagem[r] < cfg.min_exclusoes) return false;
    var e = existentes[r];
    return !e || isNaN(paraMs(e.atualizado_em)) || agora - paraMs(e.atualizado_em) > validade;
  });
  pendentes.sort(function (a, b) {
    var ta = existentes[a] ? paraMs(existentes[a].atualizado_em) : 0;
    var tb = existentes[b] ? paraMs(existentes[b].atualizado_em) : 0;
    return (ta || 0) - (tb || 0);
  });
  if (!todos) pendentes = pendentes.slice(0, cfg.remetentes_por_coleta);
  for (var i = 0; i < pendentes.length; i++) {
    if (tempoEsgotado_(cfg)) return false;
    var medida = medirComportamento_(pendentes[i], cfg);
    var e = existentes[pendentes[i]];
    if (e) atualizarCampos(ABAS.COMPORTAMENTO, e._linha, medida);
    else anexarLinhas(ABAS.COMPORTAMENTO, [medida]);
  }
  return true;
}
