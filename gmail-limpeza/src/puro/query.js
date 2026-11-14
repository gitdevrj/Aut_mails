/**
 * Montagem das queries do Gmail (puro).
 */

/** Termos que TODA regra recebe, mesmo que o usuário esqueça. */
var TERMOS_OBRIGATORIOS = ['-is:starred', '-is:important', '-in:sent', '-in:drafts', '-in:chats'];

/** Trechos que uma regra não pode conter: tirariam a proteção ou alcançariam lixeira/spam. */
var TERMOS_PROIBIDOS = ['in:trash', 'in:spam', 'in:anywhere', 'in:sent', 'in:drafts', 'is:starred',
  'is:important', 'label:trash', 'label:spam'];

/** Devolve '' se a query é aceitável ou o motivo da recusa. */
function validarQueryRegra(query) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return 'query vazia';
  var semNegados = ' ' + q.replace(/[()]/g, ' ') + ' ';
  for (var i = 0; i < TERMOS_PROIBIDOS.length; i++) {
    var t = TERMOS_PROIBIDOS[i];
    // só é problema quando aparece afirmativo (sem o "-" na frente)
    var re = new RegExp('[^\\-\\w]' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    if (re.test(semNegados)) return 'a query não pode conter "' + t + '"';
  }
  return '';
}

/**
 * Query final de uma regra: (query do usuário) + termos obrigatórios.
 * opcoes: { rotulo: '_auto-limpeza', carenciaDias: 0 }
 * Devolve '' quando a query é inválida (a regra é ignorada).
 */
function montarQuery(queryRegra, opcoes) {
  var q = String(queryRegra || '').trim();
  if (validarQueryRegra(q)) return '';
  var o = opcoes || {};
  var termos = TERMOS_OBRIGATORIOS.slice();
  if (o.rotulo) termos.push('-label:' + o.rotulo);
  if (o.carenciaDias > 0) termos.push('older_than:' + Math.floor(o.carenciaDias) + 'd');
  var minusculo = ' ' + q.toLowerCase() + ' ';
  var saida = '(' + q + ')';
  termos.forEach(function (t) {
    if (minusculo.indexOf(' ' + t + ' ') < 0) saida += ' ' + t;
  });
  return saida;
}

/** Query de uma regra aprendida: tipo 'remetente' ou 'dominio'. */
function queryDoAlvo(tipo, valor) {
  return 'from:' + String(valor || '').toLowerCase();
}

/**
 * Confere se o remetente realmente pertence ao alvo da regra
 * (a busca do Gmail é aproximada; isto é a conferência exata).
 * alvo: "remetente:a@b.com" | "dominio:b.com" | "" (regra manual, sem conferência)
 */
function casaAlvo(alvo, email) {
  var a = String(alvo || '').trim().toLowerCase();
  if (!a) return true;
  var i = a.indexOf(':');
  if (i < 0) return true;
  var tipo = a.slice(0, i), valor = a.slice(i + 1);
  var e = String(email || '').toLowerCase();
  if (tipo === 'remetente') return e === valor;
  if (tipo === 'dominio') {
    var d = e.slice(e.lastIndexOf('@') + 1);
    return d === valor || d.slice(-(valor.length + 1)) === '.' + valor;
  }
  return false;
}

/** Comparação de strings em tempo constante (tokens). */
function comparaSeguro(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
