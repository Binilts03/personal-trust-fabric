[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$errors = [System.Collections.Generic.List[string]]::new()

$requiredFiles = @(
    'AGENTS.md',
    'docs\index.md',
    'docs\commands.md',
    'docs\program\requirements-ledger.md',
    'docs\program\capability-ledger.md',
    'docs\program\security-properties-ledger.md',
    'docs\program\build-plan.md',
    'docs\program\execution-ledger.md',
    'docs\program\harness-status.md',
    'docs\program\skill-registry.json',
    'docs\program\skill-registry-summary.md',
    'docs\research\current-sources.md',
    'docs\validation\reviews\product-scope.md',
    'docs\validation\reviews\architecture-alternatives.md',
    'docs\validation\reviews\security-review.md',
    'docs\validation\reviews\standards-review.md',
    'VALIDATION_REPORT.md'
)

foreach ($relative in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relative))) {
        $errors.Add("Missing harness file: $relative")
    }
}

$registrySummaryPath = Join-Path $repoRoot 'docs\program\skill-registry-summary.md'
if (Test-Path -LiteralPath $registrySummaryPath) {
    $registrySummary = Get-Content -Raw -LiteralPath $registrySummaryPath
    if ($registrySummary -match '(?m)^- ``:') { $errors.Add('Skill registry duplicate summary contains a blank identifier.') }
}

$ledgerPath = Join-Path $repoRoot 'docs\program\requirements-ledger.md'
if (Test-Path -LiteralPath $ledgerPath) {
    $ledger = Get-Content -Raw -LiteralPath $ledgerPath
    foreach ($number in 1..25) {
        $id = 'U-{0:d2}' -f $number
        $count = ([regex]::Matches($ledger, "(?m)^\| $([regex]::Escape($id)) \|")).Count
        if ($count -ne 1) { $errors.Add("Requirements ledger must contain exactly one row for $id; found $count.") }
    }
}

$registryPath = Join-Path $repoRoot 'docs\program\skill-registry.json'
if (Test-Path -LiteralPath $registryPath) {
    try {
        $registry = Get-Content -Raw -LiteralPath $registryPath | ConvertFrom-Json
        if ($registry.physical_package_count -lt 1) { $errors.Add('Skill registry is empty.') }
        if ($registry.entries.Count -ne $registry.physical_package_count) { $errors.Add('Skill registry count does not match its entries.') }
        if (-not $registry.limitation) { $errors.Add('Skill registry must state the physical-vs-active availability limitation.') }
    }
    catch {
        $errors.Add("Skill registry is not valid JSON: $($_.Exception.Message)")
    }
}

$coreDocuments = @('DOMAIN_MODEL.md', 'DATA_MODEL_AND_STATE_MACHINES.md', 'INTERFACE_CONTRACTS.md')
$scenarioPattern = '(?i)\b(airline|flight|hotel|shopping cart|product catalog|merchant sku)\b'
foreach ($relative in $coreDocuments) {
    $path = Join-Path $repoRoot $relative
    if ((Get-Content -Raw -LiteralPath $path) -match $scenarioPattern) {
        $errors.Add("Scenario vocabulary found in generic core specification: $relative")
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'W0 harness verification passed.'
Write-Host "Checked $($requiredFiles.Count) harness files, U-01..U-25, registry consistency, and generic core vocabulary."
