[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$userRoot = [Environment]::GetFolderPath('UserProfile')
$scanRoots = @(
    (Join-Path $userRoot '.codex\skills'),
    (Join-Path $userRoot '.agents\skills'),
    (Join-Path $userRoot '.codex\plugins\cache')
) | Where-Object { Test-Path -LiteralPath $_ }

$skillFiles = $scanRoots |
    ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter SKILL.md -File -Recurse -ErrorAction SilentlyContinue } |
    Sort-Object FullName -Unique

if ($skillFiles.Count -eq 0) {
    throw 'No physical SKILL.md packages were found in the runtime roots.'
}

function Get-FrontmatterValue {
    param([string]$Text, [string]$Key)

    $pattern = '(?m)^{0}:\s*[''"]?([^\r\n''"]+)' -f [regex]::Escape($Key)
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) { return $null }
    $value = $match.Groups[1].Value.Trim()
    if ($value -in @('>', '|')) { return $null }
    return $value
}

function Get-Description {
    param([string]$Text)

    $inline = Get-FrontmatterValue -Text $Text -Key 'description'
    if ($inline) { return $inline }

    $block = [regex]::Match($Text, '(?ms)^description:\s*[>|][-+]?\s*\r?\n(?<body>(?:^[ \t]+.*(?:\r?\n|$))+)')
    if (-not $block.Success) { return $null }
    return (($block.Groups['body'].Value -split '\r?\n' | ForEach-Object { $_.Trim() }) -join ' ').Trim()
}

function Get-SourceInfo {
    param([string]$Path)

    $normalized = $Path -replace '/', '\'
    if ($normalized -match '\\.codex\\plugins\\cache\\(?<channel>[^\\]+)\\(?<plugin>[^\\]+)\\(?<version>[^\\]+)\\') {
        return [ordered]@{ kind = 'plugin-cache'; channel = $Matches.channel; package = $Matches.plugin; version = $Matches.version }
    }
    if ($normalized -match '\\.agents\\skills\\') {
        return [ordered]@{ kind = 'agents-local'; channel = $null; package = $null; version = $null }
    }
    return [ordered]@{ kind = 'codex-local'; channel = $null; package = $null; version = $null }
}

$inspected = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
$entries = foreach ($file in $skillFiles) {
    $text = Get-Content -Raw -LiteralPath $file.FullName
    $source = Get-SourceInfo -Path $file.FullName
    $name = Get-FrontmatterValue -Text $text -Key 'name'
    if (-not $name) { $name = $file.Directory.Name }
    $description = Get-Description -Text $text
    $allowedTools = Get-FrontmatterValue -Text $text -Key 'allowed-tools'

    [ordered]@{
        identifier = $name
        path = $file.FullName
        source = $source
        description = $description
        compatibility = if ($allowedTools) { "allowed-tools: $allowedTools" } else { $null }
        last_inspected = $inspected
        availability = 'physical-package; active runtime surfacing not machine-readable'
        outcome_notes = $null
    }
}

$duplicateNames = $entries | Group-Object { $_.identifier } | Where-Object Count -gt 1 | Sort-Object Name
$registry = [ordered]@{
    schema_version = 1
    generated_at = $inspected
    scan_roots = $scanRoots
    physical_package_count = $entries.Count
    unique_identifier_count = ($entries.identifier | Sort-Object -Unique).Count
    limitation = 'This filesystem registry includes cached, duplicate, and possibly inactive packages. The Codex active skill catalog shown per turn remains authoritative for callability, but no machine-readable active-catalog API was available to this repository.'
    entries = $entries
}

$jsonPath = Join-Path $repoRoot 'docs\program\skill-registry.json'
$summaryPath = Join-Path $repoRoot 'docs\program\skill-registry-summary.md'
$json = $registry | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($jsonPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

$pluginPackages = $entries | Where-Object { $_.source.kind -eq 'plugin-cache' } |
    ForEach-Object { "$($_.source.channel)/$($_.source.package)/$($_.source.version)" } |
    Sort-Object -Unique
$duplicateSummary = $duplicateNames | ForEach-Object { "- ``$($_.Name)``: $($_.Count) physical packages" }

$summary = @"
# Skill registry summary

Generated: $inspected.

- Physical `SKILL.md` packages: $($entries.Count)
- Unique parsed identifiers: $(($entries.identifier | Sort-Object -Unique).Count)
- Distinct plugin cache packages/versions: $($pluginPackages.Count)
- Scan roots: $($scanRoots -join ', ')

The full machine-readable inventory is `skill-registry.json`. Physical presence does not prove that a skill is actively surfaced in the current Codex turn; cached and duplicate versions are retained as evidence rather than silently collapsed.

## Duplicate identifiers

$($duplicateSummary -join [Environment]::NewLine)
"@
[System.IO.File]::WriteAllText($summaryPath, $summary.TrimEnd() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

Write-Host "Recorded $($entries.Count) physical skill packages ($((($entries.identifier | Sort-Object -Unique).Count)) unique identifiers)."
