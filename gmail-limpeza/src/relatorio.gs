/**
 * Relatório semanal por e-mail e Web App de aprovação (links protegidos por token).
 */

function assinar_(texto) {
  var props = propriedades_();
  var segredo = props.getProperty('SEGREDO_TOKEN');
  if (!segredo) {
    segredo = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SEGREDO_TOKEN', segredo);
  }
  return Utilities.computeHmacSha256Signature(texto, segredo).map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

function linkAcao_(base, idRegra, acao) {
  if (!base) return '';
  return base + '?r=' + encodeURIComponent(idRegra) + '&a=' + acao + '&t=' + assinar_(idRegra + '|' + acao);
}

/** Acionador semanal. */
function enviarRelatorio() {
  try { enviarRelatorioInterno_(); }
  catch (e) { registrarErro_('enviarRelatorio', e); throw e; }
}

function enviarRelatorioInterno_() {
  var cfg = lerConfig();
  var agora = new Date();
  var semana = agora.getTime() - 7 * 86400000;
  var tz = Session.getScriptTimeZone();
  var base = String(cfg.webapp_url || '').trim();
  if (base && !/\/exec$/.test(base)) base = '';

  var regras = lerLinhas(ABAS.REGRAS);
  var porId = {};
  regras.forEach(function (r) { porId[r.id] = r; });

  var contagem = {};
  var total = 0, totalSimulado = 0;
  lerLinhas(ABAS.LOG).forEach(function (l) {
    if (paraMs(l.data) < semana) return;
    var c = contagem[l.id_regra] || (contagem[l.id_regra] = { movidos: 0, simulados: 0 });
    if (paraBooleano(l.simulacao)) { c.simulados++; totalSimulado++; } else { c.movidos++; total++; }
  });
  var porRegra = Object.keys(contagem).map(function (id) {
    var r = porId[id] || {};
    return { id: id, query: r.query || '(regra removida)', acao: r.acao || '', movidos: contagem[id].movidos, simulados: contagem[id].simulados };
  }).sort(function (a, b) { return (b.movidos + b.simulados) - (a.movidos + a.simulados); });

  function resumo(r) {
    return {
      id: r.id, query: r.query, acao: r.acao, status: r.status, confianca: r.confianca,
      justificativa: r.justificativa, exemplos: r.exemplos, erros: r.erros,
      links: {
        aprovar: linkAcao_(base, r.id, 'aprovar'),
        rejeitar: linkAcao_(base, r.id, 'rejeitar'),
        pausar: linkAcao_(base, r.id, 'pausar')
      }
    };
  }
  var props = propriedades_();
  var dados = {
    periodo: Utilities.formatDate(new Date(semana), tz, 'dd/MM/yyyy') + ' a ' + Utilities.formatDate(agora, tz, 'dd/MM/yyyy'),
    simulacao: cfg.modo_simulacao,
    urlPlanilha: obterPlanilha().getUrl(),
    total: total,
    totalSimulado: totalSimulado,
    rascunhos: Number(props.getProperty('RASCUNHOS_SEMANA')) || 0,
    porRegra: porRegra,
    novas: regras.filter(function (r) {
      return r.status === 'ativa' && r.origem === 'aprendida' && paraMs(r.criada_em) >= semana;
    }).map(resumo),
    sugeridas: regras.filter(function (r) { return r.status === 'sugerida'; }).map(resumo),
    pausadas: regras.filter(function (r) { return r.status === 'pausada' && Number(r.erros) > 0; }).map(resumo)
  };
  MailApp.sendEmail({
    to: meuEmail_(),
    subject: 'Limpeza do Gmail: ' + (cfg.modo_simulacao ? totalSimulado + ' simulados' : total + ' movidos') +
      ', ' + (dados.novas.length + dados.sugeridas.length) + ' regra(s) para revisar',
    htmlBody: montarRelatorioHtml(dados)
  });
  props.deleteProperty('RASCUNHOS_SEMANA');
}

/**
 * Web App: aprova, rejeita ou pausa uma regra a partir do link do relatório.
 * Publicado como "executar como eu" e "acesso: somente eu"; além disso cada link leva um token HMAC.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  // Instalação pelo navegador: só o dono da conta alcança este endereço (acesso "somente eu").
  if (String(p.a || '') === 'instalar') {
    var url = instalar();
    return HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;padding:24px;font-size:16px">Instalação concluída.<br><br>' +
      '<a target="_blank" href="' + escaparHtml(url) + '">Abrir a planilha de controle</a><br><br>' +
      'Em alguns minutos você recebe um e-mail com as primeiras regras.</div>'
    ).setTitle('Limpeza do Gmail');
  }
  var id = String(p.r || ''), acao = String(p.a || ''), token = String(p.t || '');
  // Dispara a carga inicial agora e mostra o resultado (ou o erro) na tela.
  if (String(p.a || '') === 'semear') {
    var texto;
    try {
      propriedades_().setProperty('SEMENTE_PENDENTE', '1');
      semear();
      texto = propriedades_().getProperty('SEMENTE_PENDENTE')
        ? 'Carga inicial em andamento; continua sozinha em 1 minuto.' : 'Carga inicial concluída.';
    } catch (err) { texto = 'Erro: ' + ((err && err.stack) || err); }
    return HtmlService.createHtmlOutput(
      '<pre style="font-family:Consolas,monospace;padding:24px;white-space:pre-wrap">' + escaparHtml(texto) + '</pre>'
    ).setTitle('Limpeza do Gmail');
  }
  var destino = { aprovar: 'ativa', rejeitar: 'rejeitada', pausar: 'pausada' }[acao];
  var msg;
  if (!id || !destino || !comparaSeguro(token, assinar_(id + '|' + acao))) {
    msg = 'Link inválido ou expirado.';
  } else {
    var regra = lerLinhas(ABAS.REGRAS).filter(function (r) { return String(r.id) === id; })[0];
    if (!regra) msg = 'Regra ' + id + ' não encontrada.';
    else {
      atualizarCampos(ABAS.REGRAS, regra._linha, { status: destino });
      msg = 'Regra ' + id + ' agora está "' + destino + '".';
    }
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:24px;font-size:16px">' + escaparHtml(msg) + '</div>'
  ).setTitle('Limpeza do Gmail');
}
