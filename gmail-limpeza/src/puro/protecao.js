/**
 * Lista de proteção e conferência final antes de qualquer ação (puro).
 * Depende de texto.js (normalizar, extensao).
 */

var ROTULOS_INTOCAVEIS = ['STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'CHAT'];

/**
 * Um padrão da aba Protegidos casa com o remetente?
 *  - "fulano@x.com"  -> remetente exato
 *  - "*.gov.br"      -> domínio gov.br e subdomínios
 *  - "caixa.gov.br"  -> esse domínio e subdomínios
 *  - "sefaz"         -> palavra contida em qualquer parte do endereço
 */
function casaPadrao(padrao, email) {
  var p = normalizar(padrao).trim();
  var e = normalizar(email).trim();
  if (!p || !e) return false;
  var d = e.slice(e.lastIndexOf('@') + 1);
  if (p.indexOf('@') >= 0) return e === p;
  if (p.indexOf('*.') === 0) p = p.slice(2);
  if (p.indexOf('.') >= 0) return d === p || d.slice(-(p.length + 1)) === '.' + p;
  return e.indexOf(p) >= 0;
}

/** Devolve o padrão que protege o remetente, ou ''. protegidos: [{padrao}] */
function padraoQueProtege(email, protegidos) {
  for (var i = 0; i < (protegidos || []).length; i++) {
    if (casaPadrao(protegidos[i].padrao, email)) return String(protegidos[i].padrao);
  }
  return '';
}

/** O texto contém o termo como palavra inteira? (ambos já normalizados) */
function contemPalavra(texto, termo) {
  var re = new RegExp('(^|[^a-z0-9])' + termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
  return re.test(texto);
}

/**
 * Documento fiscal/financeiro: anexo .xml/.pdf/.ofx E assunto com termo fiscal.
 * Devolve o termo encontrado ou ''.
 */
function termoFiscal(assunto, anexos, termos, extensoes) {
  var temAnexo = (anexos || []).some(function (n) { return extensoes.indexOf(extensao(n)) >= 0; });
  if (!temAnexo) return '';
  var a = normalizar(assunto);
  for (var i = 0; i < termos.length; i++) {
    if (contemPalavra(a, termos[i])) return termos[i];
  }
  return '';
}

/**
 * Conferência final, mensagem a mensagem, antes de qualquer ação.
 * msg: { remetente, assunto, anexos:[nomes], rotulos:[ids] }
 * regra: { alvo }
 * cfg: { termosFiscais:[...], extensoesProtegidas:[...] }
 * Devolve { ok: bool, motivo: string }
 */
function podeAfetar(msg, regra, protegidos, cfg) {
  var rot = msg.rotulos || [];
  for (var i = 0; i < ROTULOS_INTOCAVEIS.length; i++) {
    if (rot.indexOf(ROTULOS_INTOCAVEIS[i]) >= 0) return { ok: false, motivo: 'rotulo ' + ROTULOS_INTOCAVEIS[i] };
  }
  if (!msg.remetente) return { ok: false, motivo: 'sem remetente' };
  if (!casaAlvo(regra.alvo, msg.remetente)) return { ok: false, motivo: 'remetente fora do alvo da regra' };
  var p = padraoQueProtege(msg.remetente, protegidos);
  if (p) return { ok: false, motivo: 'protegido: ' + p };
  var t = termoFiscal(msg.assunto, msg.anexos, cfg.termosFiscais || [], cfg.extensoesProtegidas || []);
  if (t) return { ok: false, motivo: 'documento fiscal: ' + t };
  return { ok: true, motivo: '' };
}
