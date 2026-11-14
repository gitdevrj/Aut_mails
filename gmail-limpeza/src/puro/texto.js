/**
 * Funções puras de texto. Sem nenhuma chamada a serviços Google:
 * rodam igual no Apps Script e no Node (npm test).
 */

var SLD_GENERICOS = ['com', 'net', 'org', 'gov', 'edu', 'co', 'ind', 'adv', 'art', 'eti', 'mil', 'jus',
  'leg', 'mp', 'blog', 'app', 'dev', 'emp', 'eco', 'esp', 'far', 'imb', 'inf', 'med', 'psc', 'rec',
  'srv', 'tur', 'tv', 'vet', 'ac'];

/** "Fulano <A@B.com>" -> "a@b.com" */
function extrairEmail(de) {
  var s = String(de || '');
  var m = s.match(/<([^<>]+)>\s*$/) || s.match(/([^\s<>"',;]+@[^\s<>"',;]+)/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** "Fulano de Tal <a@b.com>" -> "Fulano de Tal" (vazio se não houver nome). */
function extrairNome(de) {
  var s = String(de || '');
  var i = s.lastIndexOf('<');
  if (i <= 0) return '';
  return s.slice(0, i).replace(/["']/g, '').trim();
}

function extrairDominio(email) {
  var e = String(email || '');
  var i = e.lastIndexOf('@');
  return i < 0 ? '' : e.slice(i + 1).toLowerCase();
}

/** "mkt.infomoney.com.br" -> "infomoney.com.br"; "market.temuemail.com" -> "temuemail.com" */
function dominioBase(dominio) {
  var p = String(dominio || '').toLowerCase().split('.').filter(function (x) { return x; });
  var n = p.length;
  if (n <= 2) return p.join('.');
  if (p[n - 1].length === 2 && SLD_GENERICOS.indexOf(p[n - 2]) >= 0) return p.slice(n - 3).join('.');
  return p.slice(n - 2).join('.');
}

/** minúsculas e sem acentos */
function normalizar(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escaparHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "Nota.XML" -> "xml" */
function extensao(nomeArquivo) {
  var s = String(nomeArquivo || '');
  var i = s.lastIndexOf('.');
  return i < 0 ? '' : s.slice(i + 1).toLowerCase();
}

/** "a, b ,c" -> ["a","b","c"] (normalizado) */
function listaDeTexto(s) {
  return String(s || '').split(',').map(function (x) { return normalizar(x).trim(); })
    .filter(function (x) { return x; });
}

/**
 * Evita que um assunto de e-mail como "=HYPERLINK(...)" vire fórmula na planilha.
 * O apóstrofo inicial força texto e não aparece ao ler a célula de volta.
 */
function seguroCelula(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@']/.test(v) ? "'" + v : v;
}

/** Aceita TRUE/true/"VERDADEIRO"/"sim"/1 */
function paraBooleano(v) {
  if (typeof v === 'boolean') return v;
  var s = normalizar(v).trim();
  return s === 'true' || s === 'verdadeiro' || s === 'sim' || s === '1';
}

/** Data (Date, número ou texto) -> milissegundos; NaN se inválida. */
function paraMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (v && typeof v.getTime === 'function') return v.getTime();
  if (!v) return NaN;
  return new Date(v).getTime();
}

/** "7, 15" -> [7, 15] (inteiros de 0 a 23, sem repetição, em ordem). */
function listaDeHoras(s) {
  var saida = [];
  String(s === null || s === undefined ? '' : s).split(/[,;\s]+/).forEach(function (x) {
    if (!/^\d{1,2}$/.test(x)) return;
    var h = Number(x);
    if (h >= 0 && h <= 23 && saida.indexOf(h) < 0) saida.push(h);
  });
  return saida.sort(function (a, b) { return a - b; });
}

/** O erro devolvido pelo Google é de limite de requisições (e vale a pena esperar e repetir)? */
function ehErroDeCota(e) {
  var m = String((e && e.message) || e || '').toLowerCase();
  return m.indexOf('quota exceeded') >= 0 || m.indexOf('rate limit') >= 0 || m.indexOf('ratelimitexceeded') >= 0 ||
    m.indexOf('too many') >= 0 || m.indexOf('user-rate') >= 0 || m.indexOf('backend error') >= 0;
}
