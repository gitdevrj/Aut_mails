/**
 * Rascunhos de resposta para e-mails profissionais (endereço do remetente contendo
 * um dos termos de Config.rascunho_termos_endereco, por padrão "contec").
 * O script só cria o rascunho na conversa; nunca envia nada.
 */

/** Acionador de hora em hora. */
function criarRascunhos() {
  return comTrava_(function () { return rascunhosInterno_(); });
}

function rascunhosInterno_() {
  var cfg = lerConfig();
  if (!cfg.rascunho_ativo || !cfg.termosProfissionais.length) return 0;
  var props = propriedades_();
  var agoraS = Math.floor(Date.now() / 1000);
  var desde = Number(props.getProperty('RASCUNHO_DESDE')) || (agoraS - 86400);
  var idRotulo = gmailIdRotulo_(ROTULO_RASCUNHO, true);
  var q = 'in:inbox after:' + desde + ' -from:me -in:chats -label:' + ROTULO_RASCUNHO;
  var ids = gmailListarTodos_(q, 300, false);
  var conversas = {};
  var criados = 0;
  for (var i = 0; i < ids.length; i++) {
    if (tempoEsgotado_(cfg)) return criados; // não avança o marcador: retoma na próxima hora
    var m;
    try { m = gmailMetadados_(ids[i]); } catch (e) { continue; }
    if (!deveCriarRascunho(m, cfg.termosProfissionais, meuEmail_()).ok) continue;
    if (conversas[m.idConversa] || conversaTemRascunho_(m.idConversa)) continue;
    conversas[m.idConversa] = true;
    criarRascunho_(m, cfg);
    gmailRotular_([m.id], [idRotulo], []);
    criados++;
  }
  props.setProperty('RASCUNHO_DESDE', String(agoraS - 60));
  if (criados) {
    props.setProperty('RASCUNHOS_SEMANA', String((Number(props.getProperty('RASCUNHOS_SEMANA')) || 0) + criados));
  }
  return criados;
}

function conversaTemRascunho_(idConversa) {
  var t = Gmail.Users.Threads.get('me', idConversa, { format: 'minimal', fields: 'messages(id,labelIds)' });
  return (t.messages || []).some(function (x) { return (x.labelIds || []).indexOf('DRAFT') >= 0; });
}

function criarRascunho_(m, cfg) {
  var hora = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  var corpo = preencherModelo(cfg.rascunho_modelo, { nome: m.nome, assunto: m.assunto, hora: hora });
  var assunto = assuntoResposta(m.assunto);
  var corpo64 = Utilities.base64Encode(corpo, Utilities.Charset.UTF_8).replace(/(.{76})/g, '$1\r\n');
  var bruto = montarMensagemResposta({
    para: m.responderPara || m.remetente,
    assunto: cabecalhoCodificado(assunto, Utilities.base64Encode(assunto, Utilities.Charset.UTF_8)),
    idMensagemOriginal: m.idMensagemRfc,
    referencias: m.referencias,
    corpoBase64: corpo64
  });
  Gmail.Users.Drafts.create({
    message: { raw: Utilities.base64EncodeWebSafe(bruto), threadId: m.idConversa }
  }, 'me');
}
