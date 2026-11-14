/**
 * Rascunhos de resposta para e-mails profissionais (puro).
 * Depende de texto.js.
 */

var REMETENTES_AUTOMATICOS = ['noreply', 'no-reply', 'no_reply', 'naoresponder', 'nao-responder',
  'nao_responda', 'naoresponda', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'bounce'];

/** O endereço contém algum dos termos profissionais (ex.: "contec")? */
function ehProfissional(email, termos) {
  var e = normalizar(email);
  return (termos || []).some(function (t) { return t && e.indexOf(t) >= 0; });
}

/**
 * msg: { remetente, rotulos, listUnsubscribe }
 * Devolve { ok, motivo }
 */
function deveCriarRascunho(msg, termos, meuEmail) {
  var rem = String(msg.remetente || '').toLowerCase();
  var rot = msg.rotulos || [];
  if (!rem) return { ok: false, motivo: 'sem remetente' };
  if (rem === String(meuEmail || '').toLowerCase()) return { ok: false, motivo: 'enviado por mim' };
  if (rot.indexOf('SENT') >= 0 || rot.indexOf('DRAFT') >= 0) return { ok: false, motivo: 'enviado/rascunho' };
  if (rot.indexOf('TRASH') >= 0 || rot.indexOf('SPAM') >= 0) return { ok: false, motivo: 'lixeira/spam' };
  if (!ehProfissional(rem, termos)) return { ok: false, motivo: 'não profissional' };
  var local = rem.split('@')[0];
  if (REMETENTES_AUTOMATICOS.some(function (a) { return local.indexOf(a) >= 0; })) {
    return { ok: false, motivo: 'remetente automático' };
  }
  if (msg.listUnsubscribe) return { ok: false, motivo: 'lista de distribuição' };
  return { ok: true, motivo: '' };
}

/** "Bom dia" / "Boa tarde" / "Boa noite" conforme a hora local (0-23). */
function saudacao(hora) {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Primeiro nome com inicial maiúscula; vazio se o nome parecer um endereço. */
function primeiroNome(nome) {
  var n = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!n || n.indexOf('@') >= 0) return '';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** Preenche {saudacao}, {nome} e {assunto} no modelo. "\n" literal vira quebra de linha. */
function preencherModelo(modelo, dados) {
  var nome = primeiroNome(dados.nome);
  var s = String(modelo || '').replace(/\\n/g, '\n')
    .replace(/\{saudacao\}/g, saudacao(dados.hora))
    .replace(/\{nome\}/g, nome)
    .replace(/\{assunto\}/g, String(dados.assunto || ''));
  // "Bom dia, !" quando não há nome -> "Bom dia!"
  return s.replace(/,\s*([!,.:])/g, '$1');
}

function assuntoResposta(assunto) {
  var a = String(assunto || '').trim();
  return /^re:/i.test(a) ? a : 'Re: ' + a;
}

/** Cabeçalho com caracteres não ASCII em RFC 2047 (base64 já calculado por quem chama). */
function cabecalhoCodificado(texto, base64Utf8) {
  return /^[\x20-\x7e]*$/.test(texto) ? texto : '=?UTF-8?B?' + base64Utf8 + '?=';
}

/**
 * Mensagem RFC 822 da resposta.
 * d: { para, assunto (já codificado), idMensagemOriginal, referencias, corpoBase64 (com quebras a cada 76) }
 */
function montarMensagemResposta(d) {
  var linhas = ['To: ' + d.para, 'Subject: ' + d.assunto];
  if (d.idMensagemOriginal) {
    linhas.push('In-Reply-To: ' + d.idMensagemOriginal);
    linhas.push('References: ' + ((d.referencias ? d.referencias + ' ' : '') + d.idMensagemOriginal));
  }
  linhas.push('MIME-Version: 1.0');
  linhas.push('Content-Type: text/plain; charset=UTF-8');
  linhas.push('Content-Transfer-Encoding: base64');
  return linhas.join('\r\n') + '\r\n\r\n' + d.corpoBase64;
}
