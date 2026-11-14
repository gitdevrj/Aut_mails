'use strict';
/**
 * Testes de ponta a ponta contra o Gmail e a planilha imitados em memória.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, listarArquivos, SRC } = require('./_ambiente');
const fs = require('fs');

const LIXO = ['TRASH', 'UNREAD', 'CATEGORY_PROMOTIONS'];

/** Ambiente instalado, com exclusões manuais de alguns remetentes já na lixeira. */
function cenario() {
  const a = criarAmbiente();
  // lixo recorrente: 4 da Temu, 2 + 2 de dois endereços do LinkedIn
  for (let i = 0; i < 4; i++) a.receber({ de: 'Temu <email@market.temuemail.com>', labelIds: LIXO, assunto: 'Oferta ' + i });
  for (let i = 0; i < 2; i++) a.receber({ de: 'LinkedIn <notifications-noreply@linkedin.com>', labelIds: LIXO, assunto: 'Convites' });
  for (let i = 0; i < 2; i++) a.receber({ de: 'LinkedIn <updates-noreply@linkedin.com>', labelIds: LIXO, assunto: 'Publicação' });
  // excluído uma única vez: não vira regra
  a.receber({ de: 'Raro <raro@unico.com>', labelIds: LIXO });
  // remetente a quem já respondi: excluí 3, mas nunca vira regra
  for (let i = 0; i < 3; i++) a.receber({ de: 'Cliente <cliente@empresa.com>', labelIds: LIXO, unsub: false });
  a.receber({ de: a.EU, labelIds: ['SENT'], headers: { To: 'cliente@empresa.com' }, unsub: false });
  // governo: excluí 3, mas é protegido
  for (let i = 0; i < 3; i++) a.receber({ de: 'Sefaz <aviso@sefaz.go.gov.br>', labelIds: LIXO });
  a.ctx.instalar();
  return a;
}

const regraDe = (a, alvo) => a.linhas('Regras').find((r) => r.alvo === alvo);
const naLixeira = (a, id) => a.estado.mensagens.find((m) => m.id === id).labelIds.includes('TRASH');

test('todos os arquivos de src/ carregam sem erro de sintaxe', () => {
  assert.ok(listarArquivos(SRC).length >= 13);
  criarAmbiente();
});

test('manifesto: escopos mínimos, sem acesso total ao Gmail, Web App só para mim', () => {
  const m = JSON.parse(fs.readFileSync(SRC + '/appsscript.json', 'utf8'));
  assert.deepEqual(m.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/spreadsheets'
  ]);
  assert.equal(m.webapp.access, 'MYSELF');
  assert.equal(m.webapp.executeAs, 'USER_DEPLOYING');
});

test('nenhum arquivo usa exclusão permanente nem GmailApp', () => {
  listarArquivos(SRC).forEach((arq) => {
    const codigo = fs.readFileSync(arq, 'utf8');
    assert.ok(!/Messages\.(remove|batchDelete)|Threads\.remove|moveToTrash|GmailApp/.test(codigo), arq);
  });
});

test('instalar é idempotente', () => {
  const a = cenario();
  const antes = {
    planilhas: Object.keys(a.estado.planilhas).length, config: a.linhas('Config').length,
    protegidos: a.linhas('Protegidos').length, regras: a.linhas('Regras').length,
    rotulos: a.estado.rotulos.length
  };
  a.novaExecucao();
  a.ctx.instalar();
  a.novaExecucao();
  a.ctx.instalar();
  assert.deepEqual({
    planilhas: Object.keys(a.estado.planilhas).length, config: a.linhas('Config').length,
    protegidos: a.linhas('Protegidos').length, regras: a.linhas('Regras').length,
    rotulos: a.estado.rotulos.length
  }, antes);
  const fixos = a.estado.gatilhos.filter((g) => g.tipo !== 'unico').map((g) => g.fn).sort();
  assert.deepEqual(fixos, ['coletarHistorico', 'criarRascunhos', 'enviarRelatorio', 'executarAprendizado', 'executarLimpeza']);
  assert.equal(a.estado.gatilhos.filter((g) => g.fn === 'semear').length, 1, 'carga inicial agendada uma única vez');
  const cfg = a.ctx.lerConfig();
  assert.equal(cfg.modo_simulacao, true);
  assert.equal(cfg.auto_promover, false);
  assert.ok(a.linhas('Regras').every((r) => r.origem !== 'manual' || r.status === 'sugerida'));
});

test('carga inicial: lê a lixeira e já cria as regras, respeitando respostas e protegidos', () => {
  const a = cenario();
  a.novaExecucao();
  a.ctx.semear();
  const hist = a.linhas('Historico_Lixeira');
  assert.equal(hist.length, 15);
  assert.ok(hist.every((h) => h.foi_aberta === false && h.categoria === 'promocoes'));
  assert.ok(!('corpo' in hist[0]));

  const temu = regraDe(a, 'remetente:email@market.temuemail.com');
  assert.ok(temu, 'regra da Temu criada');
  assert.equal(temu.status, 'ativa');
  assert.equal(temu.origem, 'aprendida');
  assert.equal(temu.query, 'from:email@market.temuemail.com');
  assert.match(temu.justificativa, /^Você excluiu 4 de 4 e-mails de email@market\.temuemail\.com/);
  assert.ok(regraDe(a, 'dominio:linkedin.com'), 'dois endereços do LinkedIn viram uma regra de domínio');
  assert.equal(regraDe(a, 'remetente:raro@unico.com'), undefined);
  assert.equal(regraDe(a, 'remetente:cliente@empresa.com'), undefined, 'já respondi: nunca vira regra');
  assert.equal(regraDe(a, 'remetente:aviso@sefaz.go.gov.br'), undefined, 'gov.br protegido');
  assert.equal(a.estado.emailsEnviados.length, 1, 'relatório inicial enviado');
  assert.equal(a.estado.emailsEnviados[0].to, a.EU);

  // rodar de novo não duplica nada
  a.novaExecucao();
  const n = a.linhas('Regras').length;
  a.ctx.coletarHistorico();
  a.ctx.executarAprendizado();
  assert.equal(a.linhas('Regras').length, n);
  assert.equal(a.linhas('Historico_Lixeira').length, 15);
});

test('status_novas_regras = sugerida faz o aprendizado só sugerir', () => {
  const a = cenario();
  a.configurar('status_novas_regras', 'sugerida');
  a.ctx.semear();
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').status, 'sugerida');
});

test('aprende com novas exclusões manuais ao longo do tempo', () => {
  const a = cenario();
  a.novaExecucao();
  a.ctx.semear();
  assert.equal(regraDe(a, 'remetente:mkt@lojanova.com.br'), undefined);
  a.receber({ de: 'Loja <mkt@lojanova.com.br>', labelIds: LIXO });
  a.receber({ de: 'Loja <mkt@lojanova.com.br>', labelIds: LIXO });
  a.novaExecucao();
  a.ctx.coletarHistorico();
  a.ctx.executarAprendizado();
  assert.ok(regraDe(a, 'remetente:mkt@lojanova.com.br'));
});

test('modo simulação: registra no Log e não move nada', () => {
  const a = cenario();
  a.novaExecucao();
  a.ctx.semear();
  const id = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.novaExecucao();
  a.ctx.executarLimpeza();
  assert.equal(naLixeira(a, id), false);
  const log = a.linhas('Log');
  assert.equal(log.length, 1);
  assert.equal(log[0].simulacao, true);
  assert.equal(log[0].id_mensagem, id);
  // no dia seguinte a mesma mensagem não é registrada de novo
  a.estado.props.LIMPEZA_ESTADO = '{}';
  a.novaExecucao();
  a.ctx.executarLimpeza();
  assert.equal(a.linhas('Log').length, 1);
});

/** Ambiente com regras criadas e simulação desligada. */
function cenarioReal() {
  const a = cenario();
  a.novaExecucao();
  a.ctx.semear();
  a.configurar('modo_simulacao', false);
  return a;
}

test('limpeza real: move para a lixeira, rotula, registra e poupa o que é protegido', () => {
  const a = cenarioReal();
  const alvo1 = a.receber({ de: 'Temu <email@market.temuemail.com>', assunto: '=SOMA(1;2)' });
  const alvo2 = a.receber({ de: 'LinkedIn <jobs@em.linkedin.com>' });
  const estrela = a.receber({ de: 'Temu <email@market.temuemail.com>', labelIds: ['INBOX', 'STARRED'] });
  const importante = a.receber({ de: 'Temu <email@market.temuemail.com>', labelIds: ['INBOX', 'IMPORTANT'] });
  const boleto = a.receber({ de: 'Temu <email@market.temuemail.com>', assunto: 'Seu boleto', anexos: ['boleto.pdf'] });
  const outro = a.receber({ de: 'Amigo <amigo@pessoal.com>', unsub: false });
  a.ctx.executarLimpeza();

  assert.equal(naLixeira(a, alvo1), true);
  assert.equal(naLixeira(a, alvo2), true, 'subdomínio coberto pela regra de domínio');
  [estrela, importante, boleto, outro].forEach((id) => assert.equal(naLixeira(a, id), false, id));
  const idRotulo = a.estado.rotulos.find((r) => r.name === '_auto-limpeza').id;
  assert.ok(a.estado.mensagens.find((m) => m.id === alvo1).labelIds.includes(idRotulo));
  const log = a.linhas('Log');
  assert.deepEqual(Array.from(log, (l) => l.id_mensagem).sort(), [alvo1, alvo2].sort());
  assert.ok(log.every((l) => l.simulacao === false && l.acao === 'lixeira'));
  assert.equal(log.find((l) => l.id_mensagem === alvo1).assunto, '=SOMA(1;2)', 'assunto gravado como texto');
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').total_afetado, 1);
  assert.equal(a.estado.chamadas.excluirPermanente, 0);

  // o que o script moveu não entra no histórico de exclusões manuais
  const antes = a.linhas('Historico_Lixeira').length;
  a.novaExecucao();
  a.ctx.coletarHistorico();
  assert.equal(a.linhas('Historico_Lixeira').length, antes);
});

test('regra manual não atinge remetente a quem já respondi', () => {
  const a = cenarioReal();
  const m3 = a.linhas('Regras').find((r) => r.id === 'M0001');
  a.ctx.atualizarCampos('Regras', m3._linha, { status: 'ativa' });
  const velhoPromo = a.receber({ de: 'Loja <promo@lojaqualquer.com>', diasAtras: 40 });
  const velhoCliente = a.receber({ de: 'Cliente <cliente@empresa.com>', diasAtras: 40 });
  const novoPromo = a.receber({ de: 'Loja <promo@lojaqualquer.com>', diasAtras: 2 });
  a.novaExecucao();
  a.ctx.executarLimpeza();
  assert.equal(naLixeira(a, velhoPromo), true);
  assert.equal(naLixeira(a, velhoCliente), false);
  assert.equal(naLixeira(a, novoPromo), false);
  assert.ok(a.linhas('Protegidos').some((p) => p.padrao === 'cliente@empresa.com' && p.origem === 'resposta'));
});

test('continuação: para por tempo, salva o ponto e termina na execução seguinte', () => {
  const a = cenarioReal();
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(a.receber({ de: 'Temu <email@market.temuemail.com>', segundosAtras: i }));
  a.configurar('lote_mensagens', 3);
  a.configurar('tempo_max_segundos', -1); // esgota imediatamente
  a.ctx.executarLimpeza();
  assert.equal(ids.filter((id) => naLixeira(a, id)).length, 0);
  assert.equal(a.estado.gatilhos.filter((g) => g.fn === 'executarLimpeza' && g.tipo === 'unico').length, 1);
  a.configurar('tempo_max_segundos', 270);
  a.ctx.executarLimpeza();
  assert.equal(ids.filter((id) => naLixeira(a, id)).length, 7);
  assert.equal(a.estado.gatilhos.filter((g) => g.fn === 'executarLimpeza' && g.tipo === 'unico').length, 0);
});

test('teto diário de mensagens é respeitado', () => {
  const a = cenarioReal();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(a.receber({ de: 'Temu <email@market.temuemail.com>', segundosAtras: i }));
  a.configurar('lote_mensagens', 2);
  a.configurar('max_mensagens_dia', 4);
  a.ctx.executarLimpeza();
  assert.equal(ids.filter((id) => naLixeira(a, id)).length, 4);
});

test('feedback negativo: recuperar e-mails reduz a confiança, pausa a regra e protege o remetente', () => {
  const a = cenarioReal();
  const m1 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  const m2 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.ctx.executarLimpeza();
  const conf = regraDe(a, 'remetente:email@market.temuemail.com').confianca;
  // o usuário tira os dois da lixeira
  [m1, m2].forEach((id) => {
    const m = a.estado.mensagens.find((x) => x.id === id);
    m.labelIds = m.labelIds.filter((l) => l !== 'TRASH').concat('INBOX');
  });
  a.novaExecucao();
  a.ctx.coletarHistorico();
  const regra = regraDe(a, 'remetente:email@market.temuemail.com');
  assert.equal(regra.erros, 2);
  assert.equal(regra.status, 'pausada');
  assert.ok(regra.confianca < conf);
  assert.ok(a.linhas('Protegidos').some((p) => p.padrao === 'email@market.temuemail.com' && p.origem === 'erro_regra'));
  assert.ok(a.linhas('Log').filter((l) => l.feedback === 'restaurada_pelo_usuario').length === 2);
  // não conta o mesmo erro duas vezes
  a.novaExecucao();
  a.ctx.coletarHistorico();
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').erros, 2);
  // e a regra pausada não age mais
  const m3 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.estado.props.LIMPEZA_ESTADO = '{}';
  a.novaExecucao();
  a.ctx.executarLimpeza();
  assert.equal(naLixeira(a, m3), false);
});

test('restaurar: devolve à caixa de entrada o que a regra moveu e pausa a regra', () => {
  const a = cenarioReal();
  const m1 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  const m2 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.ctx.executarLimpeza();
  const regra = regraDe(a, 'remetente:email@market.temuemail.com');
  a.novaExecucao();
  assert.equal(a.ctx.restaurar(regra.id, '2020-01-01'), 2);
  [m1, m2].forEach((id) => {
    assert.equal(naLixeira(a, id), false);
    assert.ok(a.estado.mensagens.find((m) => m.id === id).labelIds.includes('INBOX'));
  });
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').status, 'pausada');
  assert.equal(a.ctx.restaurar(regra.id), 0, 'segunda chamada não tem mais nada a fazer');
  // restauração pela função não conta como erro da regra
  a.novaExecucao();
  a.ctx.coletarHistorico();
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').erros, 0);
  // atalho pela aba Config
  a.configurar('restaurar_id_regra', regra.id);
  assert.equal(a.ctx.restaurarRegra(), 0);
});

test('ações arquivar e marcar como lido', () => {
  const a = cenarioReal();
  const regra = regraDe(a, 'remetente:email@market.temuemail.com');
  a.ctx.atualizarCampos('Regras', regra._linha, { acao: 'arquivar' });
  const m1 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.novaExecucao();
  a.ctx.executarLimpeza();
  let rot = a.estado.mensagens.find((m) => m.id === m1).labelIds;
  assert.ok(!rot.includes('INBOX') && !rot.includes('TRASH'));

  a.ctx.atualizarCampos('Regras', regra._linha, { acao: 'ler_rotular' });
  const m2 = a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.estado.props.LIMPEZA_ESTADO = '{}';
  a.novaExecucao();
  a.ctx.executarLimpeza();
  rot = a.estado.mensagens.find((m) => m.id === m2).labelIds;
  assert.ok(rot.includes('INBOX') && !rot.includes('UNREAD'));
});

test('rascunhos: cria resposta em rascunho para remetente "contec", uma vez por conversa, sem enviar', () => {
  const a = cenario();
  a.novaExecucao();
  const prof = a.receber({
    de: 'Maria Souza <maria@contec.com.br>', assunto: 'Conciliação de outubro', unsub: false,
    labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], threadId: 'conv1'
  });
  a.receber({ de: 'Temu <email@market.temuemail.com>' });
  a.receber({ de: 'Sistema <naoresponder@contec.com.br>', unsub: false });
  assert.equal(a.ctx.criarRascunhos(), 1);
  assert.equal(a.estado.rascunhos.length, 1);
  const r = a.estado.rascunhos[0];
  assert.equal(r.threadId, 'conv1');
  assert.match(r.bruto, /^To: maria@contec\.com\.br\r\n/);
  assert.match(r.bruto, /Subject: =\?UTF-8\?B\?/);
  assert.match(r.bruto, new RegExp('In-Reply-To: <' + prof + '@x>'));
  const corpo = Buffer.from(r.bruto.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(corpo, /^(Bom dia|Boa tarde|Boa noite), Maria!/);
  assert.ok(corpo.includes('Recebi seu e-mail sobre "Conciliação de outubro".'));
  assert.equal(a.estado.emailsEnviados.length, 0, 'nada é enviado');

  // nova mensagem na mesma conversa, com rascunho ainda pendente: não duplica
  a.receber({ de: 'Maria Souza <maria@contec.com.br>', assunto: 'Re: Conciliação', unsub: false, threadId: 'conv1' });
  a.novaExecucao();
  assert.equal(a.ctx.criarRascunhos(), 0);
  // desligado pela Config
  a.configurar('rascunho_ativo', false);
  a.receber({ de: 'Ana <ana@conteccontabil.com.br>', unsub: false });
  assert.equal(a.ctx.criarRascunhos(), 0);
});

test('remetente "contec" nunca é alvo de limpeza nem de regra', () => {
  const a = criarAmbiente();
  for (let i = 0; i < 4; i++) a.receber({ de: 'Sistema <avisos@contec.com.br>', labelIds: LIXO });
  a.ctx.instalar();
  a.novaExecucao();
  a.ctx.semear();
  assert.equal(regraDe(a, 'remetente:avisos@contec.com.br'), undefined);
});

test('relatório e Web App: links com token aprovam, rejeitam e recusam token errado', () => {
  const a = cenario();
  a.configurar('status_novas_regras', 'sugerida');
  a.configurar('webapp_url', 'https://script.google.com/macros/s/ABC/exec');
  a.ctx.semear();
  const email = a.estado.emailsEnviados[0];
  assert.match(email.subject, /regra\(s\) para revisar/);
  assert.ok(email.htmlBody.includes('Modo simulação ligado'));
  const temu = regraDe(a, 'remetente:email@market.temuemail.com');
  const re = new RegExp('exec\\?r=' + temu.id + '&amp;a=aprovar&amp;t=([0-9a-f]{64})');
  const m = re.exec(email.htmlBody);
  assert.ok(m, 'link Aprovar presente');

  a.novaExecucao();
  let resp = a.ctx.doGet({ parameter: { r: temu.id, a: 'aprovar', t: 'f'.repeat(64) } });
  assert.match(resp.conteudo, /Link inválido/);
  assert.equal(regraDe(a, temu.alvo).status, 'sugerida');
  resp = a.ctx.doGet({ parameter: { r: temu.id, a: 'rejeitar', t: m[1] } });
  assert.match(resp.conteudo, /Link inválido/, 'token de aprovar não serve para rejeitar');
  resp = a.ctx.doGet({ parameter: { r: temu.id, a: 'aprovar', t: m[1] } });
  assert.match(resp.conteudo, /agora está &quot;ativa&quot;/);
  assert.equal(regraDe(a, temu.alvo).status, 'ativa');
  assert.match(a.ctx.doGet({}).conteudo, /Link inválido/);

  // regra rejeitada não é sugerida de novo
  const li = regraDe(a, 'dominio:linkedin.com');
  a.ctx.atualizarCampos('Regras', li._linha, { status: 'rejeitada' });
  const n = a.linhas('Regras').length;
  a.novaExecucao();
  a.ctx.executarAprendizado();
  assert.equal(a.linhas('Regras').length, n);
  assert.equal(regraDe(a, 'dominio:linkedin.com').status, 'rejeitada');
});

test('promoção automática após N semanas, só com auto_promover', () => {
  const a = cenario();
  a.configurar('status_novas_regras', 'sugerida');
  a.ctx.semear();
  a.configurar('auto_promover', true);
  for (let s = 0; s < 2; s++) { a.novaExecucao(); a.ctx.executarAprendizado(); }
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').status, 'sugerida');
  a.novaExecucao();
  a.ctx.executarAprendizado();
  assert.equal(regraDe(a, 'remetente:email@market.temuemail.com').status, 'ativa');
});

test('poda remove linhas antigas do Log', () => {
  const a = cenario();
  a.novaExecucao();
  a.ctx.anexarLinhas('Log', [
    { data: new Date(Date.now() - 200 * 86400000), id_mensagem: 'velha', id_regra: 'R1', acao: 'lixeira', simulacao: true },
    { data: new Date(), id_mensagem: 'nova', id_regra: 'R1', acao: 'lixeira', simulacao: true }
  ]);
  a.ctx.executarAprendizado();
  assert.deepEqual(Array.from(a.linhas('Log'), (l) => l.id_mensagem), ['nova']);
});

test('instalação pelo Web App (?a=instalar) cria tudo e é idempotente', () => {
  const a = criarAmbiente();
  let resp = a.ctx.doGet({ parameter: { a: 'instalar' } });
  assert.match(resp.conteudo, /Instalação concluída/);
  assert.match(resp.conteudo, /docs\.google\.com\/spreadsheets/);
  assert.equal(Object.keys(a.estado.planilhas).length, 1);
  a.novaExecucao();
  resp = a.ctx.doGet({ parameter: { a: 'instalar' } });
  assert.equal(Object.keys(a.estado.planilhas).length, 1);
  assert.equal(a.estado.gatilhos.filter((g) => g.tipo !== 'unico').length, 5);
});
