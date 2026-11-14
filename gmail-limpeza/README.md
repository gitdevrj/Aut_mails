# Limpeza automática e adaptativa do Gmail

Automação em Google Apps Script que roda nos servidores do Google (não depende do seu computador ligado) e:

1. **limpa a caixa** todos os dias com base em regras guardadas numa planilha;
2. **aprende com você**: observa os e-mails que você manda para a lixeira e cria regras novas a partir disso;
3. **cria rascunhos de resposta** para e-mails profissionais (remetentes com `contec` no endereço), para você completar e enviar;
4. **envia um relatório semanal** com o que foi limpo e as regras para revisar.

O script **nunca exclui nada permanentemente**. A ação máxima é mover para a Lixeira, que o Gmail esvazia sozinho depois de 30 dias. O escopo de acesso usado (`gmail.modify`) nem permite exclusão definitiva.

## Como funciona

| Acionador | Quando | O que faz |
|---|---|---|
| `executarLimpeza` | todo dia, 7h e 15h | aplica as regras `ativa` |
| `coletarHistorico` | a cada 6 horas | registra o que você excluiu, mede seu comportamento por remetente, detecta e-mails que você recuperou |
| `criarRascunhos` | todo dia, 7h e 15h | cria rascunho de resposta para e-mails profissionais novos |
| `executarAprendizado` | domingo, 5h | calcula os scores e cria regras |
| `enviarRelatorio` | segunda, 7h | e-mail HTML para você mesmo |

A planilha **Gmail Auto-Limpeza** (criada na instalação) tem as abas:

| Aba | Conteúdo |
|---|---|
| `Regras` | uma linha por regra: `query`, `acao` (`lixeira`, `arquivar`, `ler_rotular`), `status` (`sugerida`, `ativa`, `pausada`, `rejeitada`), `origem`, `confianca`, justificativa e exemplos |
| `Log` | tudo o que o script moveu (ou moveria, em simulação) |
| `Historico_Lixeira` | metadados dos e-mails que **você** excluiu |
| `Comportamento` | por remetente: quantos e-mails você leu, respondeu, marcou com estrela ou manteve na caixa |
| `Protegidos` | domínios, remetentes e palavras que nunca são afetados |
| `Config` | pesos, limiares e chaves de operação |

Só metadados vão para a planilha (remetente, assunto, datas, rótulos). O corpo dos e-mails nunca é gravado.

### Proteções que valem para toda regra

- A query sempre recebe `-is:starred -is:important -in:sent -in:drafts -in:chats`, mesmo que você esqueça.
- Regras com `in:trash`, `in:spam`, `in:anywhere`, `is:starred` ou `is:important` são ignoradas.
- Cada mensagem é conferida de novo antes da ação: remetente fora da aba `Protegidos`, sem anexo `.xml`/`.pdf`/`.ofx` com termo fiscal no assunto (nota fiscal, boleto, DARF, DAS, IRPF, extrato etc.), e remetente a quem você **nunca** enviou e-mail.
- Qualquer remetente a quem você já respondeu é poupado e entra sozinho na aba `Protegidos`.
- Se você tirar da lixeira um e-mail que o script moveu, a regra perde confiança, é pausada no segundo erro e o remetente passa a ser protegido.

Observação: o Gmail marca sozinho alguns boletins como "importante". Esses e-mails ficam de fora da limpeza, mesmo que exista regra para o remetente.

Os horários são aproximados: o Google dispara cada acionador com até 15 minutos de diferença do horário marcado.

## 1. Instalação

Pré-requisito: [Node.js LTS](https://nodejs.org) instalado no Windows.

1. Ative a Apps Script API na sua conta Google: abra <https://script.google.com/home/usersettings> e ligue **Google Apps Script API**. Faça isso em cada conta que for usar.
2. No PowerShell, dentro da pasta `gmail-limpeza`:

```powershell
npm install
```

```powershell
npm test
```

O `clasp` (ferramenta de linha de comando do Apps Script) é instalado localmente pelo `npm install`; não precisa de instalação global.

3. Publique:

```powershell
.\deploy.ps1
```

Se o PowerShell bloquear a execução de scripts, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

Na primeira vez o navegador abre para você entrar na conta Google e autorizar o clasp. O script então cria o projeto, envia o código e mostra o endereço do editor.

4. Abra o endereço do editor, escolha a função **`instalar`** na barra superior e clique em **Executar**. O Google pede autorização uma única vez (como o app é seu e não foi verificado, clique em *Avançado* e depois em *Acessar Gmail Auto-Limpeza*).

O `instalar` cria a planilha, as abas, os rótulos `_auto-limpeza` e `_rascunho-criado` e os acionadores. Um minuto depois começa a **carga inicial**: o script lê tudo o que está na sua lixeira, cria as primeiras regras e envia o primeiro relatório, com o link da planilha. Pode ser executado de novo a qualquer momento; só cria o que estiver faltando.

Para ver o endereço da planilha depois, execute a função `mostrarPlanilha` e veja o registro de execução.

## 2. Várias contas

Liste as contas em `contas.json`, com um apelido para cada uma:

```json
[
  { "nome": "pessoal" },
  { "nome": "outra" }
]
```

```powershell
.\deploy.ps1
```

Para cada conta o `deploy.ps1` faz um `clasp login` com credenciais nomeadas (`clasp --user <nome> login`, só na primeira vez), cria o projeto e grava o id em `.clasp.<nome>.json`. Nas vezes seguintes ele só envia o código. Cada conta tem seu próprio projeto e sua própria planilha.

| Comando | Efeito |
|---|---|
| `.\deploy.ps1 -Conta pessoal` | publica só nessa conta |
| `.\deploy.ps1 -WebApp` | também publica o Web App dos botões do relatório |
| `.\deploy.ps1 -Abrir` | abre o editor ao final |

Depois de publicar numa conta nova, execute `instalar` no editor dessa conta.

Manualmente, o equivalente é:

```powershell
npx clasp --user pessoal login
```

```powershell
npx clasp --user pessoal --project .clasp.pessoal.json push --force
```

## 3. Operação

### Sair do modo simulação

A instalação começa com `modo_simulacao = TRUE`: o script registra no `Log` o que faria, mas não move nada. Acompanhe por uma ou duas semanas, confira a aba `Log` e o relatório, e então mude `modo_simulacao` para `FALSE` na aba `Config`.

Enquanto a simulação estiver ligada, **você continua excluindo normalmente**; é disso que o aprendizado se alimenta.

### Aprovar, pausar e criar regras

- Para ligar ou desligar uma regra, mude a coluna `status` na aba `Regras`: `ativa` roda, `sugerida` espera, `pausada` não roda, `rejeitada` não roda e não é sugerida de novo.
- Para criar uma regra sua, acrescente uma linha com `id` (qualquer texto único), `query` (a mesma sintaxe da busca do Gmail), `acao`, `status = ativa` e `origem = manual`. Deixe `alvo` vazio.
- As regras criadas pelo aprendizado entram como `ativa` por padrão. Se preferir aprovar uma a uma, mude `status_novas_regras` para `sugerida` na `Config`.
- Com `status_novas_regras = sugerida`, a chave `auto_promover = TRUE` promove sozinha a regra que ficar `semanas_promocao` semanas seguidas acima de `limiar_promocao`.

### Botões no e-mail (opcional)

```powershell
.\deploy.ps1 -WebApp
```

Copie o endereço mostrado (termina em `/exec`) para a chave `webapp_url` da `Config`. O relatório passa a trazer os botões Aprovar, Rejeitar e Pausar. O Web App só responde a você (acesso "somente eu") e cada link leva um token próprio da regra e da ação.

### Ajustar a Config

Tudo é lido da aba `Config` a cada execução; a coluna `descricao` explica cada chave. As mais usadas:

| Chave | Padrão | Para que serve |
|---|---|---|
| `horarios_limpeza` | 7,15 | horas em que a limpeza roda (execute `instalar` de novo após mudar) |
| `horarios_rascunhos` | 7,15 | horas em que os rascunhos são criados (idem) |
| `modo_simulacao` | TRUE | liga/desliga a limpeza de verdade |
| `status_novas_regras` | ativa | como as regras aprendidas entram |
| `limiar_sugestao` | 70 | score mínimo para criar regra |
| `min_exclusoes` | 2 | exclusões mínimas para avaliar um remetente |
| `janela_dias` | 45 | período analisado |
| `peso_*` | | pesos do score (positivos e negativos) |
| `carencia_dias` | 0 | só afeta e-mails com mais de N dias |
| `rascunho_ativo` | TRUE | liga/desliga os rascunhos |
| `rascunho_termos_endereco` | contec | termos que marcam um remetente como profissional |
| `rascunho_modelo` | | texto do rascunho; aceita `{saudacao}`, `{nome}`, `{assunto}` e `\n` |

O score vai de 0 a 100. Soma: proporção excluída, excluídos sem abrir, descadastro/Promoções/Social, volume recorrente. Subtrai: resposta sua (veta), estrela, leitura, permanência na caixa, anexos fiscais.

### Restaurar e-mails

1. Na `Config`, preencha `restaurar_id_regra` (por exemplo `R0007`) e, se quiser, `restaurar_desde` (`AAAA-MM-DD`).
2. No editor, execute a função **`restaurarRegra`**.

Tudo o que a regra moveu volta para a caixa de entrada e a regra é pausada. Se houver muitos e-mails e o tempo acabar, execute de novo: continua de onde parou. Só é possível restaurar o que ainda está na lixeira (30 dias).

Para um e-mail isolado, basta tirá-lo da lixeira pelo próprio Gmail; o script entende isso como erro da regra.

### Rascunhos de resposta

Quando chega na caixa de entrada um e-mail cujo remetente tem `contec` no endereço (por exemplo `maria@contec.com.br` ou `ana@conteccontabil.com.br`), o script cria na mesma conversa um rascunho já endereçado, com saudação e assunto, para você completar e enviar. Ele não envia nada, não cria rascunho para endereços automáticos (`noreply`, `naoresponder`) nem para listas, e cria no máximo um rascunho pendente por conversa. Esses remetentes também ficam na lista de proteção.

O texto é um modelo fixo; o script não redige o conteúdo da resposta.

### Parar tudo

Execute a função `desinstalar` no editor: remove os acionadores. A planilha e os rótulos ficam.

## Desenvolvimento

```
src/
  appsscript.json   manifesto (escopos, Web App)
  config.gs         constantes, modelo da planilha, leitura da Config
  planilha.gs       leitura/escrita das abas, continuação por tempo
  gmail.gs          acesso ao Gmail (serviço avançado)
  limpeza.gs        motor de regras e restaurar()
  coleta.gs         histórico da lixeira, comportamento, feedback negativo
  aprendizado.gs    criação de regras e carga inicial
  rascunhos.gs      rascunhos de resposta
  relatorio.gs      relatório semanal e Web App
  instalar.gs       instalar() e desinstalar()
  puro/             lógica sem serviços Google (score, query, proteção, HTML)
test/               testes (npm test)
deploy.ps1          publicação nas contas de contas.json
```

Os testes rodam no Node, sem acessar o Google: `test/puro.test.js` cobre as funções puras e `test/integracao.test.js` executa o fluxo completo contra um Gmail e uma planilha imitados em memória.

Limites do Google respeitados: cada execução para antes de 6 minutos, salva o ponto e agenda a continuação; a limpeza examina no máximo `max_mensagens_dia` mensagens por dia.
