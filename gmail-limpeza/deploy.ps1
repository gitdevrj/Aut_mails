<#
  Publica o projeto em cada conta listada em contas.json (Windows PowerShell 5.1 ou PowerShell 7).

  Uso:
    .\deploy.ps1                  # todas as contas
    .\deploy.ps1 -Conta pessoal   # so uma conta
    .\deploy.ps1 -WebApp          # tambem publica/atualiza o Web App (botoes do relatorio)
    .\deploy.ps1 -Abrir           # abre o editor do Apps Script ao final

  Para cada conta o script:
    1. faz "clasp login" com credenciais nomeadas (so na primeira vez; abre o navegador);
    2. cria o projeto Apps Script (so na primeira vez) e guarda o id em .clasp.<nome>.json;
    3. envia o codigo (clasp push);
    4. opcionalmente publica o Web App.

  (Sem acentos de proposito: o Windows PowerShell 5.1 le arquivos sem BOM como ANSI.)
#>
param(
  [string]$Conta = "",
  [switch]$WebApp,
  [switch]$Abrir
)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

function Invoke-Clasp {
  # Executa o clasp local e devolve a saida como texto. Falha se o codigo de saida nao for zero.
  param([string[]]$Argumentos, [switch]$Interativo)
  if ($Interativo) {
    & npx --no-install clasp @Argumentos
    if ($LASTEXITCODE -ne 0) { throw "clasp $($Argumentos -join ' ') falhou (codigo $LASTEXITCODE)." }
    return ""
  }
  $saida = (& npx --no-install clasp @Argumentos 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "clasp $($Argumentos -join ' ') falhou:`n$saida" }
  return $saida
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e abra um novo PowerShell."
}
if (-not (Test-Path "node_modules\@google\clasp")) {
  Write-Host "Instalando dependencias (npm install)..." -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install falhou." }
}

Write-Host "Rodando os testes..." -ForegroundColor Cyan
& npm test --silent | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Os testes falharam. Rode 'npm test' para ver os detalhes. Nada foi publicado." }

$contas = Get-Content -Raw -Encoding UTF8 "contas.json" | ConvertFrom-Json
if ($Conta) { $contas = @($contas | Where-Object { $_.nome -eq $Conta }) }
if (-not $contas -or @($contas).Count -eq 0) { throw "Nenhuma conta encontrada em contas.json (filtro: '$Conta')." }

foreach ($c in $contas) {
  $nome = $c.nome
  $projeto = ".clasp.$nome.json"
  $arqDeploy = ".deploy.$nome.txt"
  Write-Host ""
  Write-Host "=== Conta: $nome ===" -ForegroundColor Green

  # 1) login (credenciais nomeadas: uma por conta, guardadas em %USERPROFILE%\.clasprc.json)
  $estado = Invoke-Clasp @("--user", $nome, "--json", "show-authorized-user")
  if ($estado -notmatch '"loggedIn"\s*:\s*true') {
    Write-Host "Abrindo o navegador: entre com a conta Google '$nome' e autorize o clasp." -ForegroundColor Yellow
    Invoke-Clasp @("--user", $nome, "login") -Interativo | Out-Null
  }

  # 2) cria o projeto na primeira vez
  if (-not (Test-Path $projeto)) {
    Write-Host "Criando o projeto Apps Script..." -ForegroundColor Cyan
    if (Test-Path ".clasp.json") { Remove-Item ".clasp.json" }
    # o "create" baixa um manifesto padrao por cima do nosso: guarda e restaura
    Copy-Item "src\appsscript.json" "appsscript.backup.json" -Force
    try {
      Invoke-Clasp @("--user", $nome, "create-script", "--type", "standalone", "--title", "Gmail Auto-Limpeza", "--rootDir", "src") | Out-Null
    } finally {
      Copy-Item "appsscript.backup.json" "src\appsscript.json" -Force
      Remove-Item "appsscript.backup.json"
    }
    if (-not (Test-Path ".clasp.json")) { throw "O clasp nao criou o arquivo .clasp.json." }
    Move-Item ".clasp.json" $projeto
  }

  # 3) envia o codigo
  Write-Host "Enviando o codigo..." -ForegroundColor Cyan
  Invoke-Clasp @("--user", $nome, "--project", $projeto, "push", "--force") | Write-Host

  # 4) Web App (opcional)
  if ($WebApp) {
    $descricao = "deploy " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    if (Test-Path $arqDeploy) {
      $idDeploy = (Get-Content $arqDeploy -Raw).Trim()
      Invoke-Clasp @("--user", $nome, "--project", $projeto, "update-deployment", $idDeploy, "--description", $descricao) | Out-Null
    } else {
      $saida = Invoke-Clasp @("--user", $nome, "--project", $projeto, "create-deployment", "--description", $descricao)
      if ($saida -match "(AKfy[\w-]+)") {
        $idDeploy = $Matches[1]
        Set-Content -Path $arqDeploy -Value $idDeploy -Encoding ASCII
      } else {
        throw "Nao encontrei o id do deployment na saida do clasp:`n$saida"
      }
    }
    Write-Host "Web App: https://script.google.com/macros/s/$idDeploy/exec" -ForegroundColor Yellow
    Write-Host "Cole esse endereco na aba Config, chave webapp_url." -ForegroundColor Yellow
  }

  $idScript = (Get-Content -Raw $projeto | ConvertFrom-Json).scriptId
  Write-Host "Editor: https://script.google.com/d/$idScript/edit" -ForegroundColor Yellow
  if ($Abrir) { Start-Process "https://script.google.com/d/$idScript/edit" }
}

Write-Host ""
Write-Host "Pronto. Na primeira vez em cada conta: abra o editor, escolha a funcao 'instalar' e clique em Executar." -ForegroundColor Green
