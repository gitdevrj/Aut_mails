/**
 * Score explicável de "lixo" por remetente e por domínio (puro).
 * Depende de texto.js.
 */

var DOMINIOS_PUBLICOS = ['gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'outlook.com.br',
  'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'uol.com.br', 'bol.com.br',
  'terra.com.br', 'ig.com.br', 'globo.com', 'protonmail.com', 'proton.me'];

function estatisticaVazia() {
  return {
    excluidos: 0, semAbrir: 0, comUnsub: 0, promoSocial: 0, excluidos30d: 0, anexosFiscais: 0,
    recebidos: 0, lidos: 0, respondidos: 0, estrelados: 0, mantidosCaixa: 0, exemplos: []
  };
}

/**
 * Agrupa as linhas da aba Historico_Lixeira por remetente.
 * linhas: [{ remetente, assunto, categoria, foi_aberta, tipos_anexo, list_unsubscribe, excluida_em_aprox }]
 * Devolve { 'a@b.com': estatistica }
 */
function agruparHistorico(linhas, agoraMs, janelaDias, extensoesProtegidas) {
  var DIA = 86400000;
  var saida = {};
  (linhas || []).forEach(function (l) {
    var rem = String(l.remetente || '').toLowerCase();
    if (!rem) return;
    var quando = paraMs(l.excluida_em_aprox);
    if (isNaN(quando) || agoraMs - quando > janelaDias * DIA) return;
    var e = saida[rem] || (saida[rem] = estatisticaVazia());
    e.excluidos++;
    if (!paraBooleano(l.foi_aberta)) e.semAbrir++;
    if (paraBooleano(l.list_unsubscribe)) e.comUnsub++;
    var cat = normalizar(l.categoria);
    if (cat === 'promocoes' || cat === 'social') e.promoSocial++;
    if (agoraMs - quando <= 30 * DIA) e.excluidos30d++;
    var tipos = listaDeTexto(l.tipos_anexo);
    if (tipos.some(function (t) { return (extensoesProtegidas || []).indexOf(t) >= 0; })) e.anexosFiscais++;
    var assunto = String(l.assunto || '');
    if (assunto && e.exemplos.length < 3 && e.exemplos.indexOf(assunto) < 0) e.exemplos.push(assunto);
  });
  return saida;
}

/** Junta o comportamento positivo (aba Comportamento) às estatísticas. */
function mesclarComportamento(porRemetente, comportamento) {
  Object.keys(porRemetente).forEach(function (rem) {
    var c = comportamento[rem];
    if (!c) return;
    var e = porRemetente[rem];
    e.recebidos = Number(c.recebidos) || 0;
    e.lidos = Number(c.lidos) || 0;
    e.respondidos = Number(c.respondidos) || 0;
    e.estrelados = Number(c.estrelados) || 0;
    e.mantidosCaixa = Number(c.mantidos_caixa) || 0;
  });
  return porRemetente;
}

function somarEstatisticas(lista) {
  var s = estatisticaVazia();
  lista.forEach(function (e) {
    ['excluidos', 'semAbrir', 'comUnsub', 'promoSocial', 'excluidos30d', 'anexosFiscais', 'recebidos',
      'lidos', 'respondidos', 'estrelados', 'mantidosCaixa'].forEach(function (k) { s[k] += e[k] || 0; });
    (e.exemplos || []).forEach(function (x) {
      if (s.exemplos.length < 3 && s.exemplos.indexOf(x) < 0) s.exemplos.push(x);
    });
  });
  return s;
}

/**
 * Score de 0 a 100, com os fatores que o compõem.
 * cfg: pesos e limiares (ver aba Config).
 */
function calcularScore(est, cfg) {
  var excl = est.excluidos || 0;
  var total = excl + (est.recebidos || 0);
  var fatores = [];
  function fator(nome, fracao, peso) {
    var f = Math.max(0, Math.min(1, fracao || 0));
    fatores.push({ nome: nome, fracao: f, peso: peso, pontos: f * peso });
  }
  if (excl > 0) {
    fator('proporcao_excluidos', excl / total, cfg.peso_proporcao_excluidos);
    fator('excluidos_sem_abrir', est.semAbrir / excl, cfg.peso_sem_abrir);
    fator('unsubscribe_ou_promocao', Math.max(est.comUnsub, est.promoSocial) / excl, cfg.peso_unsubscribe_promocao);
    fator('volume_recorrente', est.excluidos30d / cfg.volume_minimo, cfg.peso_volume);
    fator('ja_respondi', est.respondidos > 0 ? 1 : 0, -cfg.peso_resposta);
    fator('tem_estrela', est.estrelados > 0 ? 1 : 0, -cfg.peso_estrela);
    fator('leitura_frequente', est.lidos / total, -cfg.peso_leitura);
    fator('permanencia_na_caixa', est.mantidosCaixa / total, -cfg.peso_permanencia_caixa);
    fator('anexos_fiscais', est.anexosFiscais / excl, -cfg.peso_anexo_fiscal);
  }
  var soma = fatores.reduce(function (a, f) { return a + f.pontos; }, 0);
  var score = Math.round(Math.max(0, Math.min(100, soma)) * 10) / 10;
  return {
    score: score,
    confianca: Math.round(score) / 100,
    elegivel: excl >= cfg.min_exclusoes,
    fatores: fatores
  };
}

/**
 * Decide quais regras propor: por domínio quando vários remetentes do mesmo
 * domínio são lixo e ninguém ali recebeu resposta; senão, por remetente.
 * Devolve [{ tipo, valor, est, resultado, alternativas:[...] }] por score decrescente.
 */
function escolherAlvos(porRemetente, cfg) {
  var grupos = {};
  Object.keys(porRemetente).forEach(function (rem) {
    var base = dominioBase(extrairDominio(rem));
    if (!base) return;
    (grupos[base] || (grupos[base] = [])).push(rem);
  });
  var alvos = [];
  Object.keys(grupos).forEach(function (base) {
    var rems = grupos[base];
    var individuais = [];
    rems.forEach(function (rem) {
      var r = calcularScore(porRemetente[rem], cfg);
      if (r.elegivel && r.score >= cfg.limiar_sugestao) {
        individuais.push({ tipo: 'remetente', valor: rem, est: porRemetente[rem], resultado: r, alternativas: [] });
      }
    });
    var todos = rems.map(function (r) { return porRemetente[r]; });
    var soma = somarEstatisticas(todos);
    var rDom = calcularScore(soma, cfg);
    var alguemRespondido = todos.some(function (e) { return e.respondidos > 0 || e.estrelados > 0; });
    var podeDominio = rems.length >= 2 && DOMINIOS_PUBLICOS.indexOf(base) < 0 && !alguemRespondido &&
      rDom.elegivel && rDom.score >= cfg.limiar_sugestao;
    if (podeDominio) {
      alvos.push({ tipo: 'dominio', valor: base, est: soma, resultado: rDom, alternativas: individuais });
    } else {
      alvos = alvos.concat(individuais);
    }
  });
  alvos.sort(function (a, b) { return b.resultado.score - a.resultado.score; });
  return alvos;
}

/** Frase legível que explica a sugestão. */
function montarJustificativa(tipo, valor, est, janelaDias) {
  var quem = tipo === 'dominio' ? '@' + valor : valor;
  var total = est.excluidos + est.recebidos;
  var s = 'Você excluiu ' + est.excluidos + ' de ' + total + ' e-mails de ' + quem +
    ' nos últimos ' + janelaDias + ' dias, ' + est.semAbrir + ' sem abrir';
  var extras = [];
  if (est.comUnsub > 0) extras.push(est.comUnsub + ' com link de descadastro');
  if (est.promoSocial > 0) extras.push(est.promoSocial + ' em Promoções/Social');
  if (est.lidos > 0) extras.push(est.lidos + ' dos mantidos foram lidos');
  if (extras.length) s += ' (' + extras.join('; ') + ')';
  return s + '.';
}

/**
 * Promoção automática de uma regra sugerida.
 * regra: { status, confianca, semanas_acima_limiar }
 * Devolve { status, semanas_acima_limiar }
 */
function avaliarPromocao(regra, cfg) {
  var semanas = Number(regra.semanas_acima_limiar) || 0;
  if (String(regra.status) !== 'sugerida') return { status: regra.status, semanas_acima_limiar: semanas };
  semanas = Number(regra.confianca) * 100 >= cfg.limiar_promocao ? semanas + 1 : 0;
  var status = (cfg.auto_promover && semanas >= cfg.semanas_promocao) ? 'ativa' : 'sugerida';
  return { status: status, semanas_acima_limiar: semanas };
}

/**
 * Feedback negativo: o usuário recuperou um e-mail que a regra moveu.
 * Devolve { confianca, erros, status }
 */
function aplicarErro(regra, cfg) {
  var erros = (Number(regra.erros) || 0) + 1;
  var conf = Math.round((Number(regra.confianca) || 0) * cfg.reducao_confianca_erro * 100) / 100;
  var status = erros >= cfg.erros_para_pausar ? 'pausada' : regra.status;
  return { confianca: conf, erros: erros, status: status };
}

/** Próximo id sequencial: proximoId(['R0001','M001','R0007'], 'R') -> 'R0008' */
function proximoId(idsExistentes, prefixo) {
  var max = 0;
  (idsExistentes || []).forEach(function (id) {
    var m = String(id).match(new RegExp('^' + prefixo + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return prefixo + n;
}
