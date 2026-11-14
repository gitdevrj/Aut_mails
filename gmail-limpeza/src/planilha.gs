/**
 * Acesso à planilha. As colunas seguem sempre a ordem de CABECALHOS.
 */

var _planilha = null;

function propriedades_() { return PropertiesService.getScriptProperties(); }

function obterPlanilha() {
  if (_planilha) return _planilha;
  var id = propriedades_().getProperty('PLANILHA_ID');
  if (!id) throw new Error('Planilha não configurada. Execute instalar() primeiro.');
  _planilha = SpreadsheetApp.openById(id);
  return _planilha;
}

function aba_(nome) {
  var sh = obterPlanilha().getSheetByName(nome);
  if (!sh) throw new Error('Aba "' + nome + '" não existe. Execute instalar().');
  return sh;
}

/** Linhas como objetos { coluna: valor, _linha: número da linha na planilha }. */
function lerLinhas(nome) {
  var cab = CABECALHOS[nome];
  var valores = aba_(nome).getDataRange().getValues();
  var saida = [];
  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    if (linha.every(function (v) { return v === '' || v === null; })) continue;
    var o = { _linha: i + 1 };
    for (var j = 0; j < cab.length; j++) o[cab[j]] = linha[j] === undefined ? '' : linha[j];
    saida.push(o);
  }
  return saida;
}

function paraMatriz_(nome, objetos) {
  var cab = CABECALHOS[nome];
  return objetos.map(function (o) {
    return cab.map(function (c) { return o[c] === undefined || o[c] === null ? '' : seguroCelula(o[c]); });
  });
}

function anexarLinhas(nome, objetos) {
  if (!objetos || !objetos.length) return;
  var sh = aba_(nome);
  var m = paraMatriz_(nome, objetos);
  sh.getRange(sh.getLastRow() + 1, 1, m.length, m[0].length).setValues(m);
}

/** Altera só as células indicadas de uma linha (preserva o que o usuário editou no resto). */
function atualizarCampos(nome, linha, campos) {
  var cab = CABECALHOS[nome];
  var sh = aba_(nome);
  Object.keys(campos).forEach(function (c) {
    var j = cab.indexOf(c);
    if (j < 0) throw new Error('Coluna desconhecida: ' + c);
    sh.getRange(linha, j + 1, 1, 1).setValues([[seguroCelula(campos[c])]]);
  });
}

/** Regrava a aba inteira (cabeçalho + objetos). Usado só na poda. */
function regravarAba_(nome, objetos) {
  var sh = aba_(nome);
  var cab = CABECALHOS[nome];
  var ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, cab.length).clearContent();
  if (objetos.length) {
    var m = paraMatriz_(nome, objetos);
    sh.getRange(2, 1, m.length, cab.length).setValues(m);
  }
}

/** Remove linhas mais antigas que retencao_dias. */
function podarAba_(nome, colunaData, dias) {
  var limite = Date.now() - dias * 86400000;
  var linhas = lerLinhas(nome);
  var ficam = linhas.filter(function (l) {
    var t = paraMs(l[colunaData]);
    return isNaN(t) || t >= limite;
  });
  if (ficam.length < linhas.length) regravarAba_(nome, ficam);
  return linhas.length - ficam.length;
}

/* ---------- tempo e continuação ---------- */

var _inicioExecucao = Date.now();

function tempoEsgotado_(cfg) {
  return (Date.now() - _inicioExecucao) / 1000 > cfg.tempo_max_segundos;
}

/** Agenda a mesma função para daqui a 1 minuto (continuação após o limite de tempo). */
function agendarContinuacao_(funcao) {
  limparContinuacoes_(funcao);
  var t = ScriptApp.newTrigger(funcao).timeBased().after(60 * 1000).create();
  propriedades_().setProperty('CONT_' + funcao, t.getUniqueId());
}

function limparContinuacoes_(funcao) {
  var id = propriedades_().getProperty('CONT_' + funcao);
  if (!id) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getUniqueId() === id) ScriptApp.deleteTrigger(t);
  });
  propriedades_().deleteProperty('CONT_' + funcao);
}

/** Grava uma falha na aba Erros (criando a aba se preciso). Nunca lança exceção. */
function registrarErro_(funcao, e) {
  try {
    var ss = obterPlanilha();
    var sh = ss.getSheetByName(ABAS.ERROS);
    if (!sh) {
      sh = ss.insertSheet(ABAS.ERROS);
      sh.getRange(1, 1, 1, CABECALHOS.Erros.length).setValues([CABECALHOS.Erros]);
    }
    anexarLinhas(ABAS.ERROS, [{
      data: new Date(), funcao: funcao, mensagem: String((e && e.message) || e),
      pilha: String((e && e.stack) || '').slice(0, 2000)
    }]);
  } catch (x) { console.log('Falha ao registrar erro: ' + x); }
}

/** Executa fn com trava (duas execuções não se atropelam) e registra falhas na aba Erros. */
function comTrava_(fn, nome) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(5000)) { console.log('Outra execução em andamento; saindo.'); return; }
  try { return fn(); }
  catch (e) { registrarErro_(nome || '?', e); throw e; }
  finally { trava.releaseLock(); }
}
