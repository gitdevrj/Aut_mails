/**
 * Constantes, modelo de dados da planilha e leitura da aba Config.
 */

var NOME_PLANILHA = 'Gmail Auto-Limpeza';
var ROTULO = '_auto-limpeza';
var ROTULO_RASCUNHO = '_rascunho-criado';

var ABAS = {
  REGRAS: 'Regras',
  LOG: 'Log',
  HISTORICO: 'Historico_Lixeira',
  COMPORTAMENTO: 'Comportamento',
  PROTEGIDOS: 'Protegidos',
  CONFIG: 'Config',
  ERROS: 'Erros'
};

var CABECALHOS = {
  Regras: ['id', 'query', 'acao', 'status', 'origem', 'confianca', 'criada_em', 'ultima_execucao',
    'total_afetado', 'alvo', 'justificativa', 'exemplos', 'erros', 'semanas_acima_limiar'],
  Log: ['data', 'id_mensagem', 'id_conversa', 'remetente', 'dominio', 'assunto', 'id_regra', 'acao',
    'simulacao', 'restaurada_em', 'feedback'],
  Historico_Lixeira: ['id', 'recebida_em', 'excluida_em_aprox', 'remetente', 'dominio', 'assunto',
    'categoria', 'foi_aberta', 'tinha_anexo', 'tipos_anexo', 'list_unsubscribe'],
  Comportamento: ['chave', 'recebidos', 'lidos', 'respondidos', 'estrelados', 'mantidos_caixa', 'atualizado_em'],
  Protegidos: ['padrao', 'tipo', 'origem', 'adicionado_em'],
  Config: ['chave', 'valor', 'descricao'],
  Erros: ['data', 'funcao', 'mensagem', 'pilha']
};

var ACOES = ['lixeira', 'arquivar', 'ler_rotular'];
var STATUS = ['sugerida', 'ativa', 'pausada', 'rejeitada'];

/** [chave, valor padrão, descrição]. O tipo do padrão define como o valor é lido. */
var CONFIG_PADRAO = [
  ['horarios_limpeza', '7,15', 'Horas do dia (0-23, separadas por vírgula) em que a limpeza roda. Depois de alterar, execute instalar() de novo.'],
  ['horarios_rascunhos', '7,15', 'Horas do dia em que os rascunhos de resposta são criados. Depois de alterar, execute instalar() de novo.'],
  ['modo_simulacao', true, 'TRUE: só registra no Log o que seria feito, sem mover nada. Mude para FALSE para a limpeza valer.'],
  ['status_novas_regras', 'ativa', 'Status das regras criadas pelo aprendizado: "ativa" (entra direto) ou "sugerida" (espera aprovação).'],
  ['auto_promover', false, 'TRUE: promove regra sugerida para ativa após semanas_promocao semanas acima de limiar_promocao.'],
  ['limiar_sugestao', 70, 'Score mínimo (0-100) para o aprendizado criar uma regra.'],
  ['limiar_promocao', 90, 'Score mínimo para a promoção automática.'],
  ['semanas_promocao', 3, 'Semanas seguidas acima de limiar_promocao para promover.'],
  ['min_exclusoes', 2, 'Mínimo de exclusões manuais na janela para um remetente ser avaliado.'],
  ['janela_dias', 45, 'Janela de análise do histórico, em dias.'],
  ['volume_minimo', 5, 'Exclusões em 30 dias que dão pontuação máxima no fator de volume.'],
  ['dias_permanencia_caixa', 7, 'E-mail mantido na caixa de entrada por mais que isso conta como comportamento positivo.'],
  ['peso_proporcao_excluidos', 40, '(+) proporção de e-mails do remetente que você excluiu.'],
  ['peso_sem_abrir', 20, '(+) proporção dos excluídos que você nem abriu.'],
  ['peso_unsubscribe_promocao', 15, '(+) List-Unsubscribe ou categoria Promoções/Social.'],
  ['peso_volume', 25, '(+) volume recorrente de exclusões.'],
  ['peso_resposta', 100, '(-) você já respondeu a esse remetente (100 = veta).'],
  ['peso_estrela', 40, '(-) há e-mail do remetente com estrela.'],
  ['peso_leitura', 20, '(-) proporção de e-mails do remetente lidos e mantidos.'],
  ['peso_permanencia_caixa', 20, '(-) proporção mantida na caixa de entrada.'],
  ['peso_anexo_fiscal', 30, '(-) proporção dos excluídos com anexo XML/PDF/OFX.'],
  ['reducao_confianca_erro', 0.5, 'Multiplicador da confiança a cada e-mail que você recupera.'],
  ['erros_para_pausar', 2, 'Erros que pausam a regra.'],
  ['carencia_dias', 0, 'Só afeta e-mails com mais de N dias (0 = sem carência).'],
  ['lote_mensagens', 50, 'Mensagens por lote.'],
  ['max_mensagens_dia', 1500, 'Teto diário de mensagens examinadas pela limpeza (cotas do Gmail).'],
  ['tempo_max_segundos', 270, 'Tempo máximo por execução antes de salvar o ponto e continuar depois (limite do Google: 360).'],
  ['remetentes_por_coleta', 40, 'Remetentes cujo comportamento positivo é reamostrado a cada coleta.'],
  ['retencao_dias', 180, 'Linhas do Log e do Historico_Lixeira mais antigas que isso são apagadas.'],
  ['termos_fiscais', 'nota fiscal,nf-e,nfe,nfs-e,nfse,boleto,darf,guia,das,gps,fgts,extrato,intimacao,irpf,imposto de renda,informe de rendimentos,carne-leao,iptu,ipva,fatura',
    'Termos no assunto que, com anexo protegido, impedem qualquer ação.'],
  ['extensoes_protegidas', 'xml,pdf,ofx', 'Extensões de anexo consideradas documento fiscal/financeiro.'],
  ['rascunho_ativo', true, 'TRUE: cria rascunho de resposta para e-mails profissionais recebidos.'],
  ['rascunho_termos_endereco', 'contec', 'Termos (separados por vírgula) que, presentes no endereço do remetente, marcam o e-mail como profissional.'],
  ['rascunho_modelo', '{saudacao}, {nome}!\\n\\nRecebi seu e-mail sobre "{assunto}".\\n\\n\\n\\nAtenciosamente,\\nRoberto Junior',
    'Texto do rascunho. Aceita {saudacao}, {nome}, {assunto}; use \\n para quebra de linha.'],
  ['webapp_url', '', 'URL do Web App (termina em /exec) para os botões do relatório. Vazio = sem botões.'],
  ['restaurar_id_regra', '', 'Id da regra a restaurar com a função restaurarRegra().'],
  ['restaurar_desde', '', 'Data inicial (AAAA-MM-DD) para restaurarRegra(). Vazio = tudo.']
];

var PROTEGIDOS_INICIAIS = [
  ['*.gov.br', 'dominio'], ['receita.fazenda.gov.br', 'dominio'], ['caixa.gov.br', 'dominio'],
  ['*.jus.br', 'dominio'], ['*.leg.br', 'dominio'], ['*.mp.br', 'dominio'],
  ['sefaz', 'termo'], ['prefeitura', 'termo'], ['receita', 'termo'], ['contec', 'termo'],
  ['bb.com.br', 'dominio'], ['bancodobrasil', 'termo'], ['caixa.com.br', 'dominio'], ['itau', 'termo'],
  ['bradesco', 'termo'], ['santander', 'termo'], ['sicoob', 'termo'], ['sicredi', 'termo'],
  ['bancointer.com.br', 'dominio'], ['inter.co', 'dominio'], ['nubank.com.br', 'dominio'],
  ['btgpactual', 'termo'], ['safra.com.br', 'dominio'], ['c6bank', 'termo'], ['bcb.gov.br', 'dominio']
];

/** Regras manuais iniciais, criadas como "sugerida" (não rodam até você ativar). */
var REGRAS_INICIAIS = [
  ['M0001', 'category:promotions is:unread older_than:30d', 'lixeira', 'Promoções não lidas há mais de 30 dias.'],
  ['M0002', 'category:social is:unread older_than:30d', 'lixeira', 'Social não lido há mais de 30 dias.'],
  ['M0003', 'category:updates is:unread older_than:90d', 'arquivar', 'Atualizações não lidas há mais de 90 dias (só arquiva).']
];

var _cfgCache = null;

/** Lê a aba Config, completando com os padrões. */
function lerConfig() {
  if (_cfgCache) return _cfgCache;
  var lido = {};
  lerLinhas(ABAS.CONFIG).forEach(function (l) { lido[String(l.chave).trim()] = l.valor; });
  var cfg = {};
  CONFIG_PADRAO.forEach(function (c) {
    var chave = c[0], padrao = c[1], v = lido[chave];
    if (v === undefined || v === '' || v === null) { cfg[chave] = padrao; return; }
    if (typeof padrao === 'boolean') cfg[chave] = paraBooleano(v);
    else if (typeof padrao === 'number') cfg[chave] = isNaN(Number(v)) ? padrao : Number(v);
    else cfg[chave] = v instanceof Date ? v : String(v);
  });
  cfg.termosFiscais = listaDeTexto(cfg.termos_fiscais);
  cfg.extensoesProtegidas = listaDeTexto(cfg.extensoes_protegidas);
  cfg.termosProfissionais = listaDeTexto(cfg.rascunho_termos_endereco);
  if (STATUS.indexOf(cfg.status_novas_regras) < 0) cfg.status_novas_regras = 'sugerida';
  _cfgCache = cfg;
  return cfg;
}
