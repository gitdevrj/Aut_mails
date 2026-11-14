'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente } = require('./_ambiente');

const { ctx: p } = criarAmbiente();
const igual = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);

const CFG = {
  peso_proporcao_excluidos: 40, peso_sem_abrir: 20, peso_unsubscribe_promocao: 15, peso_volume: 25,
  peso_resposta: 100, peso_estrela: 40, peso_leitura: 20, peso_permanencia_caixa: 20, peso_anexo_fiscal: 30,
  volume_minimo: 5, min_exclusoes: 2, limiar_sugestao: 70, limiar_promocao: 90, semanas_promocao: 3,
  auto_promover: false, reducao_confianca_erro: 0.5, erros_para_pausar: 2
};
const est = (o) => Object.assign(p.estatisticaVazia(), o);

test('texto: extrai e-mail, nome e domínio', () => {
  assert.equal(p.extrairEmail('Loja X <Promo@LojaX.com.br>'), 'promo@lojax.com.br');
  assert.equal(p.extrairEmail('promo@lojax.com.br'), 'promo@lojax.com.br');
  assert.equal(p.extrairEmail('"Silva, Ana" <ana@x.com>'), 'ana@x.com');
  assert.equal(p.extrairNome('"Ana Silva" <ana@x.com>'), 'Ana Silva');
  assert.equal(p.extrairNome('ana@x.com'), '');
  assert.equal(p.extrairDominio('a@mkt.infomoney.com.br'), 'mkt.infomoney.com.br');
});

test('texto: domínio base trata .com.br e subdomínios', () => {
  assert.equal(p.dominioBase('mkt.infomoney.com.br'), 'infomoney.com.br');
  assert.equal(p.dominioBase('market.temuemail.com'), 'temuemail.com');
  assert.equal(p.dominioBase('linkedin.com'), 'linkedin.com');
  assert.equal(p.dominioBase('receita.fazenda.gov.br'), 'fazenda.gov.br');
  assert.equal(p.dominioBase('wam.group'), 'wam.group');
});

test('texto: normaliza, escapa HTML e protege células contra fórmulas', () => {
  assert.equal(p.normalizar('Intimação FISCAL'), 'intimacao fiscal');
  assert.equal(p.escaparHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(p.seguroCelula('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(p.seguroCelula('-is:starred'), "'-is:starred");
  assert.equal(p.seguroCelula('normal'), 'normal');
  assert.equal(p.seguroCelula(12), 12);
  assert.equal(p.paraBooleano('VERDADEIRO'), true);
  assert.equal(p.paraBooleano('FALSE'), false);
});

test('query: sempre acrescenta as proteções obrigatórias', () => {
  const q = p.montarQuery('from:lojax.com.br', { rotulo: '_auto-limpeza' });
  assert.equal(q, '(from:lojax.com.br) -is:starred -is:important -in:sent -in:drafts -in:chats -label:_auto-limpeza');
});

test('query: não duplica termos e aplica carência', () => {
  const q = p.montarQuery('from:a@b.com -is:starred', { carenciaDias: 3 });
  assert.equal(q.match(/-is:starred/g).length, 1);
  assert.ok(q.endsWith('older_than:3d'));
  assert.ok(q.includes('-is:important') && q.includes('-in:sent'));
});

test('query: agrupa OR entre parênteses', () => {
  assert.ok(p.montarQuery('from:a OR from:b', {}).startsWith('(from:a OR from:b) '));
});

test('query: recusa regras que alcançam lixeira, spam, enviados ou estrelados', () => {
  ['in:trash', 'from:x in:spam', 'in:anywhere from:x', 'is:starred', 'from:x is:important', 'in:sent', ''].forEach((q) => {
    assert.notEqual(p.validarQueryRegra(q), '', q);
    assert.equal(p.montarQuery(q, {}), '', q);
  });
  assert.equal(p.validarQueryRegra('from:x -in:trash -is:starred'), '');
  assert.equal(p.validarQueryRegra('category:promotions older_than:30d'), '');
});

test('query: conferência exata do alvo', () => {
  assert.equal(p.casaAlvo('remetente:a@b.com', 'a@b.com'), true);
  assert.equal(p.casaAlvo('remetente:a@b.com', 'aa@b.com'), false);
  assert.equal(p.casaAlvo('dominio:linkedin.com', 'x@em.linkedin.com'), true);
  assert.equal(p.casaAlvo('dominio:linkedin.com', 'x@notlinkedin.com'), false);
  assert.equal(p.casaAlvo('', 'qualquer@x.com'), true);
  assert.equal(p.queryDoAlvo('dominio', 'LinkedIn.com'), 'from:linkedin.com');
});

test('query: comparação segura de tokens', () => {
  assert.equal(p.comparaSeguro('abc', 'abc'), true);
  assert.equal(p.comparaSeguro('abc', 'abd'), false);
  assert.equal(p.comparaSeguro('abc', 'abcd'), false);
});

test('proteção: padrões de domínio, curinga, remetente e palavra', () => {
  assert.equal(p.casaPadrao('*.gov.br', 'x@receita.fazenda.gov.br'), true);
  assert.equal(p.casaPadrao('*.gov.br', 'x@gov.br'), true);
  assert.equal(p.casaPadrao('*.gov.br', 'x@fakegov.br'), false);
  assert.equal(p.casaPadrao('caixa.gov.br', 'aviso@mail.caixa.gov.br'), true);
  assert.equal(p.casaPadrao('sefaz', 'nfe@sefaz.go.gov.br'), true);
  assert.equal(p.casaPadrao('prefeitura', 'iptu@prefeituraceres.go.br'), true);
  assert.equal(p.casaPadrao('contec', 'maria@conteccontabil.com.br'), true);
  assert.equal(p.casaPadrao('ana@x.com', 'ana@x.com'), true);
  assert.equal(p.casaPadrao('ana@x.com', 'joana@x.com'), false);
  assert.equal(p.casaPadrao('itau', 'promo@lojax.com.br'), false);
});

test('proteção: documento fiscal exige anexo protegido E termo no assunto', () => {
  const termos = ['nota fiscal', 'nf-e', 'boleto', 'das', 'guia'], ext = ['xml', 'pdf', 'ofx'];
  assert.equal(p.termoFiscal('Sua Nota Fiscal chegou', ['nfe.XML'], termos, ext), 'nota fiscal');
  assert.equal(p.termoFiscal('Boleto de novembro', ['boleto.pdf'], termos, ext), 'boleto');
  assert.equal(p.termoFiscal('Boleto de novembro', [], termos, ext), '');
  assert.equal(p.termoFiscal('Boleto de novembro', ['logo.png'], termos, ext), '');
  assert.equal(p.termoFiscal('Catálogo de ofertas', ['catalogo.pdf'], termos, ext), '');
  // "das" só casa como palavra inteira
  assert.equal(p.termoFiscal('Todas as novidades', ['x.pdf'], ['das'], ext), '');
  assert.equal(p.termoFiscal('Guia DAS 11/2026', ['x.pdf'], ['das'], ext), 'das');
});

test('proteção: conferência final barra estrela, importante, enviados, protegidos e fiscais', () => {
  const cfg = { termosFiscais: ['boleto'], extensoesProtegidas: ['pdf'] };
  const prot = [{ padrao: '*.gov.br' }];
  const msg = (o) => Object.assign({ remetente: 'promo@lojax.com.br', assunto: 'Oferta', anexos: [], rotulos: ['INBOX'] }, o);
  const regra = { alvo: 'dominio:lojax.com.br' };
  assert.equal(p.podeAfetar(msg({}), regra, prot, cfg).ok, true);
  ['STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'TRASH', 'SPAM'].forEach((r) => {
    assert.equal(p.podeAfetar(msg({ rotulos: ['INBOX', r] }), regra, prot, cfg).ok, false, r);
  });
  assert.equal(p.podeAfetar(msg({ remetente: 'x@outra.com' }), regra, prot, cfg).ok, false);
  assert.equal(p.podeAfetar(msg({ remetente: 'x@sefaz.go.gov.br' }), { alvo: '' }, prot, cfg).ok, false);
  assert.equal(p.podeAfetar(msg({ assunto: 'Seu boleto', anexos: ['b.pdf'] }), regra, prot, cfg).ok, false);
  assert.equal(p.podeAfetar(msg({ remetente: '' }), { alvo: '' }, prot, cfg).ok, false);
});

test('score: remetente excluído sempre, sem abrir, com descadastro -> score máximo', () => {
  const r = p.calcularScore(est({ excluidos: 18, semAbrir: 18, comUnsub: 18, excluidos30d: 18 }), CFG);
  assert.equal(r.score, 100);
  assert.equal(r.elegivel, true);
});

test('score: resposta minha veta', () => {
  const r = p.calcularScore(est({ excluidos: 18, semAbrir: 18, comUnsub: 18, excluidos30d: 18, respondidos: 1 }), CFG);
  assert.equal(r.score, 0);
});

test('score: estrela, leitura e permanência na caixa reduzem', () => {
  const base = { excluidos: 5, semAbrir: 5, comUnsub: 5, excluidos30d: 5 };
  const cheio = p.calcularScore(est(base), CFG).score;
  const comEstrela = p.calcularScore(est(Object.assign({ estrelados: 1 }, base)), CFG).score;
  const lidos = p.calcularScore(est(Object.assign({ recebidos: 5, lidos: 5, mantidosCaixa: 5 }, base)), CFG).score;
  assert.equal(cheio, 100);
  assert.equal(comEstrela, 60);
  assert.ok(lidos < 70, 'metade mantida e lida fica abaixo do limiar: ' + lidos);
});

test('score: anexos fiscais reduzem e poucas exclusões não são elegíveis', () => {
  const r = p.calcularScore(est({ excluidos: 4, semAbrir: 0, excluidos30d: 4, anexosFiscais: 4 }), CFG);
  assert.ok(r.score < 70);
  assert.equal(p.calcularScore(est({ excluidos: 1, semAbrir: 1, comUnsub: 1, excluidos30d: 1 }), CFG).elegivel, false);
});

test('score: os fatores explicam a soma', () => {
  const r = p.calcularScore(est({ excluidos: 4, semAbrir: 2, comUnsub: 4, excluidos30d: 4, recebidos: 4, lidos: 2 }), CFG);
  const soma = r.fatores.reduce((a, f) => a + f.pontos, 0);
  assert.ok(Math.abs(r.score - Math.max(0, Math.min(100, soma))) < 0.06);
});

test('histórico: agrupa por remetente dentro da janela', () => {
  const agora = Date.UTC(2026, 10, 14);
  const dia = 86400000;
  const l = (o) => Object.assign({
    remetente: 'promo@lojax.com.br', assunto: 'Oferta', categoria: 'promocoes', foi_aberta: false,
    tipos_anexo: '', list_unsubscribe: true, excluida_em_aprox: new Date(agora - dia)
  }, o);
  const g = p.agruparHistorico([
    l({}), l({ assunto: 'Outra', foi_aberta: true }), l({ excluida_em_aprox: new Date(agora - 40 * dia) }),
    l({ excluida_em_aprox: new Date(agora - 60 * dia) }), l({ remetente: 'nf@forn.com', tipos_anexo: 'xml,pdf', categoria: 'principal' })
  ], agora, 45, ['xml', 'pdf']);
  igual(Object.keys(g).sort(), ['nf@forn.com', 'promo@lojax.com.br']);
  const e = g['promo@lojax.com.br'];
  assert.equal(e.excluidos, 3);
  assert.equal(e.semAbrir, 2);
  assert.equal(e.excluidos30d, 2);
  assert.equal(e.promoSocial, 3);
  igual(e.exemplos, ['Oferta', 'Outra']);
  assert.equal(g['nf@forn.com'].anexosFiscais, 1);
});

test('alvos: vários remetentes do mesmo domínio viram regra de domínio', () => {
  const lixo = () => est({ excluidos: 4, semAbrir: 4, comUnsub: 4, excluidos30d: 4 });
  const alvos = p.escolherAlvos({
    'notifications-noreply@linkedin.com': lixo(), 'updates-noreply@linkedin.com': lixo(),
    'email@market.temuemail.com': lixo()
  }, CFG);
  igual(alvos.map((a) => a.tipo + ':' + a.valor).sort(), ['dominio:linkedin.com', 'remetente:email@market.temuemail.com']);
  assert.equal(alvos.find((a) => a.tipo === 'dominio').alternativas.length, 2);
});

test('alvos: resposta a alguém do domínio impede regra de domínio; domínio público nunca vira regra', () => {
  const lixo = (o) => est(Object.assign({ excluidos: 4, semAbrir: 4, comUnsub: 4, excluidos30d: 4 }, o));
  let alvos = p.escolherAlvos({ 'a@empresa.com': lixo(), 'b@empresa.com': lixo({ respondidos: 2 }) }, CFG);
  igual(alvos.map((a) => a.tipo + ':' + a.valor), ['remetente:a@empresa.com']);
  alvos = p.escolherAlvos({ 'spam1@gmail.com': lixo(), 'spam2@gmail.com': lixo() }, CFG);
  igual(alvos.map((a) => a.tipo).sort(), ['remetente', 'remetente']);
});

test('justificativa legível', () => {
  const s = p.montarJustificativa('dominio', 'lojax.com.br', est({ excluidos: 18, recebidos: 2, semAbrir: 17 }), 45);
  assert.ok(s.startsWith('Você excluiu 18 de 20 e-mails de @lojax.com.br nos últimos 45 dias, 17 sem abrir'), s);
});

test('promoção automática só com auto_promover e N semanas seguidas', () => {
  const regra = { status: 'sugerida', confianca: 0.95, semanas_acima_limiar: 2 };
  igual(p.avaliarPromocao(regra, CFG), { status: 'sugerida', semanas_acima_limiar: 3 });
  igual(p.avaliarPromocao(regra, Object.assign({}, CFG, { auto_promover: true })), { status: 'ativa', semanas_acima_limiar: 3 });
  igual(p.avaliarPromocao({ status: 'sugerida', confianca: 0.8, semanas_acima_limiar: 2 }, CFG), { status: 'sugerida', semanas_acima_limiar: 0 });
  igual(p.avaliarPromocao({ status: 'pausada', confianca: 0.99, semanas_acima_limiar: 5 }, Object.assign({}, CFG, { auto_promover: true })),
    { status: 'pausada', semanas_acima_limiar: 5 });
});

test('erro da regra reduz confiança e pausa no segundo', () => {
  const um = p.aplicarErro({ status: 'ativa', confianca: 0.9, erros: 0 }, CFG);
  igual(um, { confianca: 0.45, erros: 1, status: 'ativa' });
  igual(p.aplicarErro(Object.assign({ status: 'ativa' }, um), CFG), { confianca: 0.23, erros: 2, status: 'pausada' });
});

test('ids sequenciais', () => {
  assert.equal(p.proximoId(['R0001', 'M0003', 'R0007'], 'R'), 'R0008');
  assert.equal(p.proximoId([], 'R'), 'R0001');
});

test('rascunho: só para remetente profissional, humano e que não seja eu', () => {
  const t = ['contec'];
  const m = (o) => Object.assign({ remetente: 'maria@contec.com.br', rotulos: ['INBOX'], listUnsubscribe: false }, o);
  assert.equal(p.deveCriarRascunho(m({}), t, 'eu@x.com').ok, true);
  assert.equal(p.deveCriarRascunho(m({ remetente: 'ana@conteccontabil.com.br' }), t, 'eu@x.com').ok, true);
  assert.equal(p.deveCriarRascunho(m({ remetente: 'promo@lojax.com.br' }), t, 'eu@x.com').ok, false);
  assert.equal(p.deveCriarRascunho(m({ remetente: 'naoresponder@contec.com.br' }), t, 'eu@x.com').ok, false);
  assert.equal(p.deveCriarRascunho(m({ listUnsubscribe: true }), t, 'eu@x.com').ok, false);
  assert.equal(p.deveCriarRascunho(m({ remetente: 'eu@contec.com.br' }), t, 'eu@contec.com.br').ok, false);
  assert.equal(p.deveCriarRascunho(m({ rotulos: ['SENT'] }), t, 'eu@x.com').ok, false);
});

test('rascunho: modelo, saudação e cabeçalhos da resposta', () => {
  const modelo = '{saudacao}, {nome}!\\n\\nRecebi seu e-mail sobre "{assunto}".';
  assert.equal(p.preencherModelo(modelo, { nome: 'MARIA Souza', assunto: 'Balancete', hora: 9 }),
    'Bom dia, Maria!\n\nRecebi seu e-mail sobre "Balancete".');
  assert.equal(p.preencherModelo(modelo, { nome: '', assunto: 'X', hora: 15 }).split('\n')[0], 'Boa tarde!');
  assert.equal(p.saudacao(20), 'Boa noite');
  assert.equal(p.assuntoResposta('Balancete'), 'Re: Balancete');
  assert.equal(p.assuntoResposta('RE: Balancete'), 'RE: Balancete');
  assert.equal(p.cabecalhoCodificado('Re: Balancete', 'xx'), 'Re: Balancete');
  assert.equal(p.cabecalhoCodificado('Re: Conciliação', 'QUJD'), '=?UTF-8?B?QUJD?=');
  const bruto = p.montarMensagemResposta({ para: 'm@c.com', assunto: 'Re: X', idMensagemOriginal: '<1@c>', referencias: '<0@c>', corpoBase64: 'QQ==' });
  assert.ok(bruto.includes('In-Reply-To: <1@c>\r\nReferences: <0@c> <1@c>\r\n'));
  assert.ok(bruto.endsWith('\r\n\r\nQQ=='));
});

test('relatório HTML: escapa conteúdo e mostra botões só com link', () => {
  const regra = { id: 'R0001', query: 'from:<x>', acao: 'lixeira', confianca: 0.9, justificativa: 'J <b>', exemplos: 'A | B', links: { aprovar: 'https://a/exec?r=1', rejeitar: 'https://a/exec?r=2' } };
  const html = p.montarRelatorioHtml({
    periodo: '07/11 a 14/11', simulacao: true, urlPlanilha: 'https://p', total: 0, totalSimulado: 12, rascunhos: 2,
    porRegra: [{ id: 'R0001', query: 'from:<x>', acao: 'lixeira', movidos: 0, simulados: 12 }],
    novas: [], sugeridas: [regra], pausadas: [{ id: 'R0002', query: 'from:y', erros: 2 }]
  });
  assert.ok(html.includes('Modo simulação ligado'));
  assert.ok(html.includes('from:&lt;x&gt;') && !html.includes('from:<x>'));
  assert.ok(html.includes('J &lt;b&gt;'));
  assert.ok(html.includes('>Aprovar</a>') && html.includes('>Rejeitar</a>'));
  assert.ok(html.includes('2 erro(s)'));
  const semLink = p.montarRelatorioHtml({
    periodo: '', simulacao: false, total: 3, totalSimulado: 0, porRegra: [], novas: [],
    sugeridas: [Object.assign({}, regra, { links: {} })], pausadas: []
  });
  assert.ok(!semLink.includes('>Aprovar</a>'));
});
