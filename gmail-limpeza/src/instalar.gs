/**
 * Instalação. Pode ser executada quantas vezes quiser: só cria o que falta.
 */

var ACIONADORES = ['executarLimpeza', 'coletarHistorico', 'executarAprendizado', 'enviarRelatorio', 'criarRascunhos'];

function instalar() {
  var props = propriedades_();

  // 1) planilha
  var ss = null;
  var id = props.getProperty('PLANILHA_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(NOME_PLANILHA);
    props.setProperty('PLANILHA_ID', ss.getId());
  }
  _planilha = ss;

  // 2) abas e cabeçalhos
  Object.keys(CABECALHOS).forEach(function (nome) {
    var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    var cab = CABECALHOS[nome];
    sh.getRange(1, 1, 1, cab.length).setValues([cab]);
    sh.setFrozenRows(1);
  });
  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  // 3) Config: inclui só as chaves que faltam
  var chaves = {};
  lerLinhas(ABAS.CONFIG).forEach(function (l) { chaves[String(l.chave).trim()] = true; });
  anexarLinhas(ABAS.CONFIG, CONFIG_PADRAO.filter(function (c) { return !chaves[c[0]]; }).map(function (c) {
    return { chave: c[0], valor: c[1], descricao: c[2] };
  }));
  _cfgCache = null;

  // 4) Protegidos iniciais
  var agora = new Date();
  var ja = {};
  lerLinhas(ABAS.PROTEGIDOS).forEach(function (l) { ja[String(l.padrao).toLowerCase()] = true; });
  anexarLinhas(ABAS.PROTEGIDOS, PROTEGIDOS_INICIAIS.filter(function (p) { return !ja[p[0]]; }).map(function (p) {
    return { padrao: p[0], tipo: p[1], origem: 'inicial', adicionado_em: agora };
  }));

  // 5) regras manuais iniciais (sugeridas)
  var idsRegras = {};
  lerLinhas(ABAS.REGRAS).forEach(function (r) { idsRegras[r.id] = true; });
  anexarLinhas(ABAS.REGRAS, REGRAS_INICIAIS.filter(function (r) { return !idsRegras[r[0]]; }).map(function (r) {
    return {
      id: r[0], query: r[1], acao: r[2], status: 'sugerida', origem: 'manual', confianca: '',
      criada_em: agora, ultima_execucao: '', total_afetado: 0, alvo: '', justificativa: r[3],
      exemplos: '', erros: 0, semanas_acima_limiar: 0
    };
  }));

  // 6) validação de dados nas colunas acao e status
  try {
    var shR = ss.getSheetByName(ABAS.REGRAS);
    var regraAcao = SpreadsheetApp.newDataValidation().requireValueInList(ACOES, true).build();
    var regraStatus = SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).build();
    shR.getRange(2, CABECALHOS.Regras.indexOf('acao') + 1, 2000, 1).setDataValidation(regraAcao);
    shR.getRange(2, CABECALHOS.Regras.indexOf('status') + 1, 2000, 1).setDataValidation(regraStatus);
  } catch (e) { console.log('Validação de dados não aplicada: ' + e); }

  // 7) rótulos
  gmailIdRotulo_(ROTULO, true);
  gmailIdRotulo_(ROTULO_RASCUNHO, true);

  // 8) acionadores (recria os do projeto)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ACIONADORES.indexOf(t.getHandlerFunction()) >= 0 || t.getHandlerFunction() === 'semear') ScriptApp.deleteTrigger(t);
  });
  var cfg = lerConfig();
  var horasLimpeza = listaDeHoras(cfg.horarios_limpeza);
  if (!horasLimpeza.length) horasLimpeza = [7, 15];
  horasLimpeza.forEach(function (h) {
    ScriptApp.newTrigger('executarLimpeza').timeBased().everyDays(1).atHour(h).nearMinute(0).create();
  });
  listaDeHoras(cfg.horarios_rascunhos).forEach(function (h) {
    ScriptApp.newTrigger('criarRascunhos').timeBased().everyDays(1).atHour(h).nearMinute(0).create();
  });
  ScriptApp.newTrigger('coletarHistorico').timeBased().everyHours(6).create();
  ScriptApp.newTrigger('executarAprendizado').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(5).create();
  ScriptApp.newTrigger('enviarRelatorio').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();

  // 9) carga inicial: lê a lixeira atual e cria as primeiras regras (só na primeira instalação)
  if (!props.getProperty('SEMENTE_FEITA')) {
    props.setProperty('SEMENTE_FEITA', '1');
    props.setProperty('SEMENTE_PENDENTE', '1');
  }
  if (props.getProperty('SEMENTE_PENDENTE')) agendarContinuacao_('semear');
  if (!props.getProperty('RASCUNHO_DESDE')) {
    props.setProperty('RASCUNHO_DESDE', String(Math.floor(Date.now() / 1000)));
  }

  console.log('Instalação concluída. Planilha: ' + ss.getUrl());
  return ss.getUrl();
}

/** Remove todos os acionadores (a planilha e os rótulos ficam). */
function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('Acionadores removidos.');
}

/** Mostra no log da execução o endereço da planilha de controle. */
function mostrarPlanilha() {
  var url = obterPlanilha().getUrl();
  console.log(url);
  return url;
}
