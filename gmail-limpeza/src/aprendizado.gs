/**
 * Aprendizado: transforma o histórico de exclusões manuais em regras.
 */

/** Acionador semanal. */
function executarAprendizado() {
  comTrava_(function () { aprendizadoInterno_(); });
}

/**
 * Carga inicial: lê toda a lixeira atual, mede o comportamento e já cria as regras.
 * Agendada por instalar(); retoma sozinha se o tempo acabar.
 */
function semear() {
  comTrava_(function () {
    limparContinuacoes_('semear');
    if (!coletaInterna_(true)) { agendarContinuacao_('semear'); return; }
    var criadas = aprendizadoInterno_();
    propriedades_().deleteProperty('SEMENTE_PENDENTE');
    console.log('Carga inicial concluída: ' + criadas + ' regra(s) criada(s).');
    enviarRelatorio();
  });
}

/** Devolve o número de regras criadas. */
function aprendizadoInterno_() {
  var cfg = lerConfig();
  var agora = new Date();
  var comportamento = {};
  lerLinhas(ABAS.COMPORTAMENTO).forEach(function (l) { comportamento[String(l.chave).toLowerCase()] = l; });
  var porRemetente = agruparHistorico(lerLinhas(ABAS.HISTORICO), agora.getTime(), cfg.janela_dias,
    cfg.extensoesProtegidas);
  mesclarComportamento(porRemetente, comportamento);
  var alvos = escolherAlvos(porRemetente, cfg);

  var regras = lerLinhas(ABAS.REGRAS);
  var porAlvo = {};
  regras.forEach(function (r) { if (r.alvo) porAlvo[String(r.alvo).toLowerCase()] = r; });
  var ids = regras.map(function (r) { return r.id; });
  var protegidos = lerLinhas(ABAS.PROTEGIDOS);
  var novas = [];
  var vistos = {};

  function avaliar(a) {
    var chave = a.tipo + ':' + a.valor;
    if (vistos[chave]) return;
    vistos[chave] = true;
    var existente = porAlvo[chave];
    if (existente) { atualizarExistente_(existente, a, cfg); return; }
    var exemploEndereco = a.tipo === 'dominio' ? 'x@' + a.valor : a.valor;
    if (padraoQueProtege(exemploEndereco, protegidos)) return;
    if (a.tipo === 'dominio') {
      // regra por domínio já coberta por remetentes? então cada remetente segue individual
      if (jaRespondi_(a.valor)) { a.alternativas.forEach(avaliar); return; }
    } else {
      if (jaRespondi_(a.valor)) { proteger_(a.valor, 'remetente', 'resposta', protegidos); return; }
      // já existe regra para o domínio inteiro
      if (porAlvo['dominio:' + dominioBase(extrairDominio(a.valor))]) return;
    }
    var id = proximoId(ids, 'R');
    ids.push(id);
    novas.push({
      id: id, query: queryDoAlvo(a.tipo, a.valor), acao: 'lixeira', status: cfg.status_novas_regras,
      origem: 'aprendida', confianca: a.resultado.confianca, criada_em: agora, ultima_execucao: '',
      total_afetado: 0, alvo: chave,
      justificativa: montarJustificativa(a.tipo, a.valor, a.est, cfg.janela_dias),
      exemplos: a.est.exemplos.join(' | '), erros: 0, semanas_acima_limiar: 0
    });
    porAlvo[chave] = novas[novas.length - 1];
  }
  alvos.forEach(avaliar);
  anexarLinhas(ABAS.REGRAS, novas);

  limparIgnoradas_();
  podarAba_(ABAS.LOG, 'data', cfg.retencao_dias);
  podarAba_(ABAS.HISTORICO, 'excluida_em_aprox', cfg.retencao_dias);
  return novas.length;
}

/** Atualiza a confiança de uma regra aprendida e avalia a promoção automática. */
function atualizarExistente_(regra, alvo, cfg) {
  if (String(regra.origem) !== 'aprendida' || !regra._linha) return;
  var status = String(regra.status);
  if (status !== 'sugerida' && status !== 'ativa') return;
  var campos = { confianca: alvo.resultado.confianca };
  if (status === 'sugerida') {
    var p = avaliarPromocao({
      status: status, confianca: alvo.resultado.confianca, semanas_acima_limiar: regra.semanas_acima_limiar
    }, cfg);
    campos.semanas_acima_limiar = p.semanas_acima_limiar;
    if (p.status !== status) campos.status = p.status;
  }
  atualizarCampos(ABAS.REGRAS, regra._linha, campos);
}
