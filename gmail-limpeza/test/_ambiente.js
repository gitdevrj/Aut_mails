'use strict';
/**
 * Ambiente de teste: carrega os arquivos de src/ num contexto isolado, como o Apps Script faz
 * (todos os arquivos compartilham o mesmo escopo global), com imitações em memória do Gmail,
 * da planilha e dos demais serviços Google.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');
const EU = 'eu@exemplo.com';

function listarArquivos(dir) {
  let saida = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida = saida.concat(listarArquivos(p));
    else if (/\.(js|gs)$/.test(e.name)) saida.push(p);
  });
  return saida.sort();
}

/* ---------- planilha ---------- */
class Aba {
  constructor(nome) { this.nome = nome; this.linhas = []; this.maxLinhas = 1000; }
  getMaxRows() { return this.maxLinhas; }
  insertRowsAfter(_pos, n) { this.maxLinhas += n; }
  getName() { return this.nome; }
  _garantir(l, c) {
    while (this.linhas.length < l) this.linhas.push([]);
    this.linhas.forEach((r) => { while (r.length < c) r.push(''); });
  }
  getLastRow() {
    for (let i = this.linhas.length - 1; i >= 0; i--) {
      if (this.linhas[i].some((v) => v !== '' && v !== null)) return i + 1;
    }
    return 0;
  }
  getDataRange() {
    const n = this.getLastRow();
    return { getValues: () => (n ? this.linhas.slice(0, n).map((r) => r.slice()) : [['']]) };
  }
  getRange(l, c, nl = 1, nc = 1) {
    const aba = this;
    if (l + nl - 1 > this.maxLinhas) throw new Error('As coordenadas do intervalo estão fora das dimensões da página.');
    return {
      setValues(m) {
        aba._garantir(l + nl - 1, Math.max(c + nc - 1, ...aba.linhas.map((r) => r.length), 0));
        for (let i = 0; i < m.length; i++) {
          for (let j = 0; j < m[i].length; j++) {
            let v = m[i][j];
            if (typeof v === 'string' && v[0] === "'") v = v.slice(1); // a planilha esconde o apóstrofo
            aba.linhas[l - 1 + i][c - 1 + j] = v;
          }
        }
      },
      clearContent() {
        aba._garantir(l + nl - 1, c + nc - 1);
        for (let i = 0; i < nl; i++) for (let j = 0; j < nc; j++) aba.linhas[l - 1 + i][c - 1 + j] = '';
      },
      setDataValidation() {}
    };
  }
  setFrozenRows() {}
}

class Planilha {
  constructor(id, nome) { this.id = id; this.nome = nome; this.abas = [new Aba('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.abas.find((a) => a.nome === n) || null; }
  insertSheet(n) { const a = new Aba(n); this.abas.push(a); return a; }
  getSheets() { return this.abas; }
  deleteSheet(a) { this.abas = this.abas.filter((x) => x !== a); }
}

/* ---------- busca do Gmail (subconjunto usado pelo projeto) ---------- */
function emailDe(v) { const m = /<([^>]+)>/.exec(v || ''); return (m ? m[1] : v || '').toLowerCase(); }

function casaToken(msg, token, agora, rotulos) {
  const i = token.indexOf(':');
  const chave = token.slice(0, i), valor = token.slice(i + 1).toLowerCase();
  const L = msg.labelIds;
  switch (chave) {
    case 'from': return valor === 'me' ? emailDe(msg.headers.From) === EU : emailDe(msg.headers.From).includes(valor);
    case 'to': return emailDe(msg.headers.To).includes(valor);
    case 'in': return L.includes({ trash: 'TRASH', inbox: 'INBOX', sent: 'SENT', drafts: 'DRAFT', chats: 'CHAT', spam: 'SPAM' }[valor]);
    case 'is': return valor === 'read' ? !L.includes('UNREAD') : L.includes(valor.toUpperCase());
    case 'category': return L.includes('CATEGORY_' + valor.toUpperCase());
    case 'label': { const r = rotulos.find((x) => x.name.toLowerCase() === valor); return !!r && L.includes(r.id); }
    case 'newer_than': return agora - msg.internalDate <= parseInt(valor, 10) * 86400000;
    case 'older_than': return agora - msg.internalDate > parseInt(valor, 10) * 86400000;
    case 'after': return msg.internalDate / 1000 > Number(valor);
    default: throw new Error('busca não suportada no teste: ' + token);
  }
}

function buscar(estado, q, incluirLixeira) {
  const tokens = String(q).replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  const pedeLixeira = tokens.includes('in:trash');
  return estado.mensagens.filter((m) => {
    if (!pedeLixeira && !incluirLixeira && (m.labelIds.includes('TRASH') || m.labelIds.includes('SPAM'))) return false;
    return tokens.every((t) => (t[0] === '-' ? !casaToken(m, t.slice(1), estado.agora(), estado.rotulos)
      : casaToken(m, t, estado.agora(), estado.rotulos)));
  }).sort((a, b) => b.internalDate - a.internalDate);
}

/* ---------- ambiente ---------- */
function criarAmbiente() {
  const estado = {
    mensagens: [], rotulos: [], rascunhos: [], emailsEnviados: [], gatilhos: [], props: {}, cache: {},
    planilhas: {}, seq: 0, esperas: [], chamadas: { excluirPermanente: 0 },
    agora: () => Date.now()
  };
  const achar = (id) => {
    const m = estado.mensagens.find((x) => x.id === id);
    if (!m) throw new Error('Mensagem não encontrada: ' + id);
    return m;
  };
  const modificar = (m, corpo) => {
    (corpo.removeLabelIds || []).forEach((l) => { m.labelIds = m.labelIds.filter((x) => x !== l); });
    (corpo.addLabelIds || []).forEach((l) => { if (!m.labelIds.includes(l)) m.labelIds.push(l); });
  };

  const Gmail = {
    Users: {
      getProfile: () => ({ emailAddress: EU }),
      Messages: {
        list(_u, p) {
          const todos = buscar(estado, p.q, p.includeSpamTrash);
          const ini = Number(p.pageToken || 0), max = p.maxResults || 100;
          const pag = todos.slice(ini, ini + max);
          const r = { messages: pag.map((m) => ({ id: m.id, threadId: m.threadId })) };
          if (ini + max < todos.length) r.nextPageToken = String(ini + max);
          return r;
        },
        get(_u, id) {
          const m = achar(id);
          return {
            id: m.id, threadId: m.threadId, labelIds: m.labelIds.slice(), internalDate: String(m.internalDate),
            payload: {
              headers: Object.keys(m.headers).map((n) => ({ name: n, value: m.headers[n] })),
              parts: (m.anexos || []).map((f) => ({ filename: f }))
            }
          };
        },
        trash(_u, id) { modificar(achar(id), { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] }); },
        untrash(_u, id) { modificar(achar(id), { removeLabelIds: ['TRASH'] }); },
        modify(corpo, _u, id) { modificar(achar(id), corpo); },
        batchModify(corpo) { corpo.ids.forEach((id) => modificar(achar(id), corpo)); },
        remove() { estado.chamadas.excluirPermanente++; throw new Error('exclusão permanente proibida'); }
      },
      Labels: {
        list: () => ({ labels: estado.rotulos.slice() }),
        create(corpo) { const r = { id: 'Label_' + (++estado.seq), name: corpo.name }; estado.rotulos.push(r); return r; }
      },
      Threads: {
        get(_u, id) {
          return { messages: estado.mensagens.filter((m) => m.threadId === id).map((m) => ({ id: m.id, labelIds: m.labelIds })) };
        }
      },
      Drafts: {
        create(corpo) {
          const bruto = Buffer.from(corpo.message.raw, 'base64url').toString('utf8');
          estado.rascunhos.push({ threadId: corpo.message.threadId, bruto });
          estado.mensagens.push({
            id: 'd' + (++estado.seq), threadId: corpo.message.threadId, labelIds: ['DRAFT'],
            internalDate: estado.agora(), headers: { From: EU }, anexos: []
          });
        }
      }
    }
  };

  const criarGatilho = (fn) => {
    const g = { fn, id: 'g' + (++estado.seq), tipo: '' };
    const b = {
      timeBased: () => b, everyDays: () => { g.tipo = 'diario'; return b; }, atHour: (h) => { g.hora = h; return b; }, nearMinute: () => b,
      everyHours: (n) => { g.tipo = 'horas:' + n; return b; }, onWeekDay: () => { g.tipo = 'semanal'; return b; },
      after: (ms) => { g.tipo = 'unico'; g.apos = ms; return b; },
      create: () => { estado.gatilhos.push(g); return gatilhoPublico(g); }
    };
    return b;
  };
  const gatilhoPublico = (g) => ({ getUniqueId: () => g.id, getHandlerFunction: () => g.fn, _g: g });

  const pad = (n) => String(n).padStart(2, '0');
  const globais = {
    console: { log() {} },
    Gmail,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in estado.props ? estado.props[k] : null),
        setProperty: (k, v) => { estado.props[k] = String(v); },
        deleteProperty: (k) => { delete estado.props[k]; },
        getKeys: () => Object.keys(estado.props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in estado.cache ? estado.cache[k] : null),
        put: (k, v) => { estado.cache[k] = v; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: {
      WeekDay: { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY' },
      newTrigger: criarGatilho,
      getProjectTriggers: () => estado.gatilhos.map(gatilhoPublico),
      deleteTrigger: (t) => { estado.gatilhos = estado.gatilhos.filter((g) => g.id !== t.getUniqueId()); }
    },
    SpreadsheetApp: {
      create(nome) { const p = new Planilha('ss' + (++estado.seq), nome); estado.planilhas[p.id] = p; return p; },
      openById(id) { if (!estado.planilhas[id]) throw new Error('planilha inexistente'); return estado.planilhas[id]; },
      newDataValidation: () => { const b = { requireValueInList: () => b, build: () => ({}) }; return b; }
    },
    MailApp: { sendEmail: (m) => { estado.emailsEnviados.push(m); } },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    HtmlService: {
      createHtmlOutput: (h) => { const o = { conteudo: h, setTitle: () => o }; return o; }
    },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      formatDate(d, _tz, f) {
        return f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
          .replace('H', d.getHours());
      },
      getUuid: () => crypto.randomUUID(),
      sleep: (ms) => { estado.esperas.push(ms); },
      computeHmacSha256Signature: (texto, chave) => Array.from(crypto.createHmac('sha256', chave).update(texto).digest())
        .map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (s) => Buffer.from(s, 'utf8').toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64url')
    }
  };

  const ctx = vm.createContext(globais);
  listarArquivos(SRC).forEach((arq) => {
    vm.runInContext(fs.readFileSync(arq, 'utf8'), ctx, { filename: arq });
  });

  /** Acrescenta uma mensagem à caixa. */
  function receber(o) {
    const id = o.id || 'm' + (++estado.seq);
    estado.mensagens.push({
      id, threadId: o.threadId || 't' + id,
      labelIds: o.labelIds || ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
      internalDate: estado.agora() - (o.diasAtras || 0) * 86400000 - (o.segundosAtras || 0) * 1000,
      headers: Object.assign({ From: o.de, To: EU, Subject: o.assunto || 'Oferta', 'Message-ID': '<' + id + '@x>' },
        o.unsub === false ? {} : { 'List-Unsubscribe': '<mailto:sair@x>' }, o.headers || {}),
      anexos: o.anexos || []
    });
    return id;
  }
  /** Linhas de uma aba como objetos. */
  const linhas = (nome) => vm.runInContext('lerLinhas', ctx)(nome);
  /** Zera caches de execução (cada execução real do Apps Script começa limpa). */
  function novaExecucao() {
    vm.runInContext('_cfgCache = null; _planilha = null; _rotulos = null; _respondidos = {}; _inicioExecucao = Date.now();', ctx);
  }
  /** Altera um valor da aba Config. */
  function configurar(chave, valor) {
    const l = linhas('Config').find((x) => x.chave === chave);
    ctx.atualizarCampos('Config', l._linha, { valor });
    novaExecucao();
  }
  return { ctx, estado, receber, linhas, novaExecucao, configurar, EU };
}

module.exports = { criarAmbiente, listarArquivos, SRC, EU };
