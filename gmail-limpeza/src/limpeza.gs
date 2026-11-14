/**
 * Motor de limpeza: aplica as regras ativas, em lotes, com ponto de continuação.
 * Nunca exclui permanentemente; a ação máxima é mover para a Lixeira.
 */

/** Acionador diário (madrugada). */
function executarLimpeza() {
  comTrava_(function () {
    limparContinuacoes_('executarLimpeza');
    if (limpezaInterna_()) agendarContinuacao_('executarLimpeza');
  });
}

/** Devolve true se ficou trabalho pendente por falta de tempo. */
function limpezaInterna_() {
  var cfg = lerConfig();
  var props = propriedades_();
  var hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var estado = JSON.parse(props.getProperty('LIMPEZA_ESTADO') || '{}');
  if (estado.dia !== hoje) estado = { dia: hoje, feitas: {}, examinadas: 0 };

  var regras = lerLinhas(ABAS.REGRAS).filter(function (r) { return String(r.status).trim() === 'ativa'; });
  if (!regras.length) return false;
  var protegidos = lerLinhas(ABAS.PROTEGIDOS);
  var simulacao = cfg.modo_simulacao;
  var jaSimulados = {};
  if (simulacao) {
    lerLinhas(ABAS.LOG).forEach(function (l) {
      if (paraBooleano(l.simulacao)) jaSimulados[l.id_mensagem + '|' + l.id_regra] = true;
    });
  }
  var idRotulo = gmailIdRotulo_(ROTULO, true);
  var pendente = false;

  for (var i = 0; i < regras.length && !pendente; i++) {
    var regra = regras[i];
    if (estado.feitas[regra.id]) continue;
    var acao = String(regra.acao).trim();
    var q = montarQuery(regra.query, { rotulo: ROTULO, carenciaDias: cfg.carencia_dias });
    if (!q || ACOES.indexOf(acao) < 0) {
      console.log('Regra ' + regra.id + ' ignorada: ' + (validarQueryRegra(regra.query) || 'ação inválida'));
      estado.feitas[regra.id] = true;
      continue;
    }
    // Lista só os ids (barato) e depois examina em lotes. Não usa token de página entre lotes:
    // o que é afetado sai do resultado da busca, então a retomada simplesmente lista de novo.
    var ignoradas = lerIgnoradas_(regra.id);
    var candidatos = gmailListarTodos_(q, 5000, false).filter(function (id) {
      return !ignoradas.mapa[id] && !(simulacao && jaSimulados[id + '|' + regra.id]);
    });
    var afetadas = 0;
    var terminou = true;
    for (var c = 0; c < candidatos.length; c += cfg.lote_mensagens) {
      if (tempoEsgotado_(cfg)) { pendente = true; terminou = false; break; }
      if (estado.examinadas >= cfg.max_mensagens_dia) { terminou = false; break; }
      var lote = candidatos.slice(c, c + Math.min(cfg.lote_mensagens, cfg.max_mensagens_dia - estado.examinadas));
      var escolhidas = [];
      lote.forEach(function (id) {
        var meta;
        try { meta = gmailMetadados_(id); } catch (e) { return; }
        estado.examinadas++;
        if (!podeAfetar(meta, regra, protegidos, cfg).ok) { ignoradas.lista.push(id); return; }
        if (jaRespondi_(meta.remetente)) {
          proteger_(meta.remetente, 'remetente', 'resposta', protegidos);
          ignoradas.lista.push(id);
          return;
        }
        escolhidas.push(meta);
      });
      afetadas += aplicarAcao_(regra, acao, escolhidas, simulacao, idRotulo);
    }
    salvarIgnoradas_(regra.id, ignoradas.lista);
    var campos = { ultima_execucao: new Date() };
    if (!simulacao && afetadas) campos.total_afetado = (Number(regra.total_afetado) || 0) + afetadas;
    atualizarCampos(ABAS.REGRAS, regra._linha, campos);
    if (terminou) estado.feitas[regra.id] = true;
  }
  props.setProperty('LIMPEZA_ESTADO', JSON.stringify(estado));
  return pendente;
}

/**
 * Mensagens que a regra encontrou mas não pode tocar (protegidas, com estrela etc.).
 * Ficam guardadas para não serem reexaminadas todo dia; a lista é zerada no aprendizado semanal.
 */
function lerIgnoradas_(idRegra) {
  var lista = JSON.parse(propriedades_().getProperty('IGN_' + idRegra) || '[]');
  var mapa = {};
  lista.forEach(function (id) { mapa[id] = true; });
  return { lista: lista, mapa: mapa };
}

function salvarIgnoradas_(idRegra, lista) {
  propriedades_().setProperty('IGN_' + idRegra, JSON.stringify(lista.slice(-400)));
}

function limparIgnoradas_() {
  var props = propriedades_();
  props.getKeys().forEach(function (k) { if (k.indexOf('IGN_') === 0) props.deleteProperty(k); });
}

/**
 * Registra no Log e executa a ação. Devolve quantas mensagens foram afetadas.
 * Ordem na lixeira: Log -> mover -> rótulo. Assim, se a execução for interrompida no meio,
 * nenhuma mensagem fica "rotulada fora da lixeira" (o que seria lido como erro da regra).
 */
function aplicarAcao_(regra, acao, metas, simulacao, idRotulo) {
  if (!metas.length) return 0;
  var agora = new Date();
  anexarLinhas(ABAS.LOG, metas.map(function (m) {
    return {
      data: agora, id_mensagem: m.id, id_conversa: m.idConversa, remetente: m.remetente,
      dominio: m.dominio, assunto: m.assunto, id_regra: regra.id, acao: acao,
      simulacao: simulacao, restaurada_em: '', feedback: ''
    };
  }));
  if (simulacao) return metas.length;
  var ids = metas.map(function (m) { return m.id; });
  if (acao === 'arquivar') { gmailRotular_(ids, [idRotulo], ['INBOX']); return ids.length; }
  if (acao === 'ler_rotular') { gmailRotular_(ids, [idRotulo], ['UNREAD']); return ids.length; }
  var movidas = [];
  ids.forEach(function (id) {
    try { Gmail.Users.Messages.trash('me', id); movidas.push(id); }
    catch (e) { console.log('Falha ao mover ' + id + ': ' + e); }
  });
  if (movidas.length) gmailRotular_(movidas, [idRotulo], []);
  return movidas.length;
}

/**
 * Tira da Lixeira tudo o que uma regra moveu (a partir de "desde") e pausa a regra,
 * para ela não mover de novo. Pode ser executada várias vezes: continua de onde parou.
 * Devolve a quantidade restaurada.
 */
function restaurar(idRegra, desde) {
  var cfg = lerConfig();
  var inicio = desde ? paraMs(desde) : 0;
  if (isNaN(inicio)) throw new Error('Data inválida: ' + desde);
  var id = String(idRegra || '').trim();
  if (!id) throw new Error('Informe o id da regra.');
  var idRotulo = gmailIdRotulo_(ROTULO, true);

  var regra = lerLinhas(ABAS.REGRAS).filter(function (r) { return String(r.id) === id; })[0];
  if (regra && String(regra.status) === 'ativa') atualizarCampos(ABAS.REGRAS, regra._linha, { status: 'pausada' });

  var linhas = lerLinhas(ABAS.LOG).filter(function (l) {
    return String(l.id_regra) === id && String(l.acao) === 'lixeira' && !paraBooleano(l.simulacao) &&
      !l.restaurada_em && paraMs(l.data) >= inicio;
  });
  var n = 0;
  for (var i = 0; i < linhas.length; i++) {
    if (tempoEsgotado_(cfg)) { console.log('Tempo esgotado: execute de novo para continuar.'); break; }
    var l = linhas[i];
    try {
      Gmail.Users.Messages.untrash('me', l.id_mensagem);
      Gmail.Users.Messages.modify({ addLabelIds: ['INBOX'], removeLabelIds: [idRotulo] }, 'me', l.id_mensagem);
      atualizarCampos(ABAS.LOG, l._linha, { restaurada_em: new Date(), feedback: 'restaurada_por_funcao' });
      n++;
    } catch (e) {
      atualizarCampos(ABAS.LOG, l._linha, { restaurada_em: new Date(), feedback: 'nao_encontrada' });
    }
  }
  console.log('Restauradas ' + n + ' de ' + linhas.length + ' mensagens da regra ' + id + '.');
  return n;
}

/** Atalho sem argumentos: usa restaurar_id_regra e restaurar_desde da aba Config. */
function restaurarRegra() {
  var cfg = lerConfig();
  return restaurar(cfg.restaurar_id_regra, cfg.restaurar_desde);
}
