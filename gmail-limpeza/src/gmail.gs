/**
 * Acesso ao Gmail pelo serviço avançado (Gmail API), com escopo gmail.modify:
 * permite ler metadados, rotular, mover para a lixeira e criar rascunhos,
 * mas NÃO permite exclusão permanente.
 */

var CATEGORIAS = {
  CATEGORY_PROMOTIONS: 'promocoes', CATEGORY_SOCIAL: 'social', CATEGORY_UPDATES: 'atualizacoes',
  CATEGORY_FORUMS: 'foruns', CATEGORY_PERSONAL: 'principal'
};

var _meuEmail = null;
function meuEmail_() {
  if (!_meuEmail) _meuEmail = String(gmailChamar_(function () { return Gmail.Users.getProfile('me'); }).emailAddress).toLowerCase();
  return _meuEmail;
}

/**
 * Executa uma chamada ao Gmail. Se o Google recusar por limite de requisições (cota por minuto),
 * espera e tenta de novo. Se o limite persistir, lança um erro marcado com "cota = true":
 * quem chamou salva o ponto e retoma minutos depois.
 */
var PAUSA_GMAIL_MS = 150; // intervalo entre chamadas, para não estourar o limite por minuto

function gmailChamar_(fn) {
  var esperas = [5, 15, 30, 45];
  for (var tentativa = 0; ; tentativa++) {
    try { var r = fn(); Utilities.sleep(PAUSA_GMAIL_MS); return r; }
    catch (e) {
      if (!ehErroDeCota(e)) throw e;
      var decorrido = (Date.now() - _inicioExecucao) / 1000;
      if (tentativa >= esperas.length || decorrido + esperas[tentativa] > 300) {
        var erro = new Error('Limite de requisições do Gmail atingido; a execução será retomada em alguns minutos.');
        erro.cota = true;
        throw erro;
      }
      Utilities.sleep(esperas[tentativa] * 1000);
    }
  }
}

function gmailLote_(corpo) {
  return gmailChamar_(function () { return Gmail.Users.Messages.batchModify(corpo, 'me'); });
}

/** Uma página de ids. Devolve { ids:[...], proximo:'token' }. */
function gmailListarIds_(q, token, max, incluirLixeira) {
  var p = { q: q, maxResults: max || 100 };
  if (token) p.pageToken = token;
  if (incluirLixeira) p.includeSpamTrash = true;
  var r = gmailChamar_(function () { return Gmail.Users.Messages.list('me', p); });
  return {
    ids: (r.messages || []).map(function (m) { return m.id; }),
    proximo: r.nextPageToken || ''
  };
}

/** Todos os ids de uma busca (até o limite). */
function gmailListarTodos_(q, limite, incluirLixeira) {
  var ids = [], token = '';
  do {
    var p = gmailListarIds_(q, token, 500, incluirLixeira);
    ids = ids.concat(p.ids);
    token = p.proximo;
  } while (token && ids.length < limite);
  return ids;
}

/** Quantas mensagens casam com a busca (conta até 100). */
function gmailContar_(q) {
  return gmailListarIds_(q, '', 100, false).ids.length;
}

function nomesDeAnexos_(parte, saida) {
  if (!parte) return saida;
  if (parte.filename) saida.push(parte.filename);
  (parte.parts || []).forEach(function (p) { nomesDeAnexos_(p, saida); });
  return saida;
}

/** Metadados de uma mensagem. O corpo não é baixado (campos parciais). */
function gmailMetadados_(id) {
  var m = gmailChamar_(function () {
    return Gmail.Users.Messages.get('me', id, {
      format: 'full',
      fields: 'id,threadId,labelIds,internalDate,payload(filename,headers(name,value),' +
        'parts(filename,parts(filename,parts(filename,parts(filename)))))'
    });
  });
  var cab = {};
  ((m.payload && m.payload.headers) || []).forEach(function (h) {
    var n = String(h.name).toLowerCase();
    if (cab[n] === undefined) cab[n] = h.value;
  });
  var de = cab['from'] || '';
  var remetente = extrairEmail(de);
  var rotulos = m.labelIds || [];
  var categoria = 'principal';
  rotulos.forEach(function (r) { if (CATEGORIAS[r]) categoria = CATEGORIAS[r]; });
  return {
    id: m.id,
    idConversa: m.threadId,
    rotulos: rotulos,
    recebidaEm: new Date(Number(m.internalDate)),
    de: de,
    nome: extrairNome(de),
    remetente: remetente,
    dominio: extrairDominio(remetente),
    responderPara: extrairEmail(cab['reply-to'] || de),
    assunto: cab['subject'] || '',
    idMensagemRfc: cab['message-id'] || '',
    referencias: cab['references'] || '',
    listUnsubscribe: !!cab['list-unsubscribe'],
    categoria: categoria,
    anexos: nomesDeAnexos_(m.payload, [])
  };
}

var _rotulos = null;
/** Id de um rótulo pelo nome; cria se pedido. Devolve '' se não existir. */
function gmailIdRotulo_(nome, criar) {
  if (!_rotulos) {
    _rotulos = {};
    (gmailChamar_(function () { return Gmail.Users.Labels.list('me'); }).labels || []).forEach(function (l) { _rotulos[l.name] = l.id; });
  }
  if (_rotulos[nome]) return _rotulos[nome];
  if (!criar) return '';
  var novo = gmailChamar_(function () {
    return Gmail.Users.Labels.create({
      name: nome, labelListVisibility: 'labelShow', messageListVisibility: 'show'
    }, 'me');
  });
  _rotulos[nome] = novo.id;
  return novo.id;
}

/** Adiciona/remove rótulos em lote (até 1000 ids por chamada). */
function gmailRotular_(ids, adicionar, remover) {
  for (var i = 0; i < ids.length; i += 1000) {
    var corpo = { ids: ids.slice(i, i + 1000) };
    if (adicionar && adicionar.length) corpo.addLabelIds = adicionar;
    if (remover && remover.length) corpo.removeLabelIds = remover;
    gmailLote_(corpo);
  }
}

var _respondidos = {};
/** Já enviei algum e-mail para este endereço (ou domínio)? Com cache de 6 horas. */
function jaRespondi_(endereco) {
  var e = String(endereco || '').toLowerCase();
  if (!e) return false;
  if (_respondidos[e] !== undefined) return _respondidos[e];
  var cache = CacheService.getScriptCache();
  var chave = 'resp_' + e.slice(0, 200);
  var c = cache.get(chave);
  var r;
  if (c !== null && c !== undefined) r = c === '1';
  else {
    r = gmailContar_('to:' + e + ' in:sent') > 0;
    cache.put(chave, r ? '1' : '0', 21600);
  }
  _respondidos[e] = r;
  return r;
}

/** Inclui um padrão na aba Protegidos, se ainda não estiver lá. */
function proteger_(padrao, tipo, origem, protegidos) {
  var p = String(padrao).toLowerCase();
  if (protegidos.some(function (x) { return String(x.padrao).toLowerCase() === p; })) return false;
  var linha = { padrao: p, tipo: tipo, origem: origem, adicionado_em: new Date() };
  anexarLinhas(ABAS.PROTEGIDOS, [linha]);
  protegidos.push(linha);
  return true;
}
