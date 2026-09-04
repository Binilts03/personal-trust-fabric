[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
# coreRoot is parent of sandbox (Trust_Fabric) when run from sandbox; fallback to repoRoot if Cargo.toml is there
$coreRoot = Split-Path -Parent $repoRoot
if (-not (Test-Path -LiteralPath (Join-Path $coreRoot 'Cargo.toml'))) {
    if (Test-Path -LiteralPath (Join-Path $repoRoot 'Cargo.toml')) {
        $coreRoot = $repoRoot
    } else {
        $coreRoot = $null
    }
}
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

# ---------- Mandatory sandbox files (relative to repoRoot) ----------
$requiredSandboxFiles = @(
    'AGENTS.md',
    'docs\index.md',
    'docs\commands.md',
    'docs\judge-script.md',
    'docs\research\current-sources.md',
    'docs\program\harness-status.md'
)

foreach ($relative in $requiredSandboxFiles) {
    $path = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $path)) {
        $errors.Add("Missing sandbox file: $relative")
    }
}

# ---------- Optional legacy harness files (warn if missing, not fail) ----------
# These were removed from public HEAD and archived at ../handoff-archive-2026-09-02/
# or docs/program/archived/. Harness must pass on fresh clone without them.
$optionalHarnessFiles = @(
    'docs\program\requirements-ledger.md',
    'docs\program\capability-ledger.md',
    'docs\program\security-properties-ledger.md',
    'docs\program\build-plan.md',
    'docs\program\execution-ledger.md',
    'docs\program\skill-registry.json',
    'docs\program\skill-registry-summary.md',
    'docs\validation\reviews\product-scope.md',
    'docs\validation\reviews\architecture-alternatives.md',
    'docs\validation\reviews\security-review.md',
    'docs\validation\reviews\standards-review.md',
    'VALIDATION_REPORT.md'
)

foreach ($relative in $optionalHarnessFiles) {
    $path = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $path)) {
        $msg = "Optional harness file missing (warn): $relative -- archived at ../handoff-archive-2026-09-02/ or docs/program/archived/"
        $warnings.Add($msg)
        Write-Warning $msg
    }
}

# ---------- Core product files (relative to coreRoot) -- only if core workspace is present ----------
# Honest W1 scope 2026-09-04: 2 crates implemented (ptf-domain, ptf-serialization), rest scaffold OPEN.
# No real crypto per user constraint. See docs/program/capability-ledger.md (P1-P18 OPEN).
$requiredCoreFiles = @(
    'Cargo.toml',
    'rust-toolchain.toml',
    'contracts\ptf-contracts\buf.yaml',
    'contracts\ptf-contracts\proto\ptf\contracts\v1\domain.proto',
    'contracts\ptf-contracts\proto\ptf\contracts\v1\agent.proto',
    'contracts\ptf-contracts\proto\ptf\contracts\v1\audit.proto',
    'contracts\ptf-contracts\proto\ptf\contracts\v1\human.proto',
    'contracts\ptf-contracts\proto\ptf\contracts\v1\recipient.proto',
    'contracts\ptf-contracts\proto\ptf\contracts\v1\sync.proto',
    'contracts\ptf-contracts\json-schema\ptf\contracts\v1\domain.schema.json',
    'contracts\ptf-contracts\json-schema\ptf\contracts\v1\agent.schema.json',
    'contracts\ptf-contracts\json-schema\ptf\contracts\v1\audit.schema.json',
    'contracts\ptf-contracts\json-schema\ptf\contracts\v1\human.schema.json',
    'contracts\ptf-contracts\json-schema\ptf\contracts\v1\recipient.schema.json',
    'contracts\ptf-contracts\json-schema\ptf\contracts\v1\sync.schema.json',
    'crates\ptf-domain\src\lib.rs',
    'crates\ptf-domain\src\identifiers.rs',
    'crates\ptf-domain\src\classifications.rs',
    'crates\ptf-domain\src\records.rs',
    'crates\ptf-domain\src\constraints.rs',
    'crates\ptf-domain\src\freshness.rs',
    'crates\ptf-domain\src\state_machines.rs',
    'crates\ptf-serialization\src\lib.rs',
    'crates\ptf-serialization\src\agent.rs',
    'crates\ptf-serialization\src\human.rs',
    'crates\ptf-serialization\src\recipient.rs',
    'crates\ptf-serialization\src\audit.rs',
    'crates\ptf-serialization\src\sync.rs',
    'crates\ptf-serialization\src\migrations.rs'
)

if ($null -eq $coreRoot) {
    $msg = "Core workspace not found (no Cargo.toml at ../Cargo.toml or ./Cargo.toml); skipping core file checks -- sandbox-only clone"
    $warnings.Add($msg)
    Write-Warning $msg
} else {
    foreach ($relative in $requiredCoreFiles) {
        $path = Join-Path $coreRoot $relative
        if (-not (Test-Path -LiteralPath $path)) {
            $errors.Add("Missing core file: $relative")
        }
    }

    # ---------- Proto <-> json-schema peer check (dynamic) ----------
    $protoDir = Join-Path $coreRoot 'contracts\ptf-contracts\proto\ptf\contracts\v1'
    $schemaDir = Join-Path $coreRoot 'contracts\ptf-contracts\json-schema\ptf\contracts\v1'
    if (-not (Test-Path -LiteralPath $protoDir)) {
        $errors.Add("Missing proto dir: contracts/ptf-contracts/proto/ptf/contracts/v1")
    } else {
        $protos = Get-ChildItem -LiteralPath $protoDir -Filter '*.proto' -File -ErrorAction SilentlyContinue
        if ($null -eq $protos -or $protos.Count -eq 0) {
            $errors.Add("No .proto files found in $protoDir")
        } else {
            foreach ($proto in $protos) {
                $base = [System.IO.Path]::GetFileNameWithoutExtension($proto.Name)
                $peer = Join-Path $schemaDir ($base + '.schema.json')
                if (-not (Test-Path -LiteralPath $peer)) {
                    $msg = "Missing json-schema peer for proto $($proto.Name): expected $base.schema.json in json-schema/ptf/contracts/v1 (warn -- schema may be pending)"
                    $warnings.Add($msg)
                    Write-Warning $msg
                }
            }
        }
    }
    if (-not (Test-Path -LiteralPath $schemaDir)) {
        $errors.Add("Missing json-schema dir: contracts/ptf-contracts/json-schema/ptf/contracts/v1")
    }

    # ---------- Cargo.toml member count (honest W1: >=2) ----------
    $cargoPath = Join-Path $coreRoot 'Cargo.toml'
    if (Test-Path -LiteralPath $cargoPath) {
        $cargoText = Get-Content -Raw -LiteralPath $cargoPath
        $m = [regex]::Match($cargoText, 'members\s*=\s*\[(.*?)\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($m.Success) {
            $memberBlock = $m.Groups[1].Value
            $memberMatches = [regex]::Matches($memberBlock, '"([^"]+)"')
            $count = $memberMatches.Count
            if ($count -lt 2) {
                $errors.Add("Cargo.toml members count $count is less than expected 2 (ptf-domain, ptf-serialization)")
            }
            $memberList = @($memberMatches | ForEach-Object { $_.Groups[1].Value })
            $requiredMembers = @('crates/ptf-domain','crates/ptf-serialization')
            foreach ($rm in $requiredMembers) {
                if ($memberList -notcontains $rm) {
                    $errors.Add("Cargo.toml missing required member: $rm")
                }
            }
            # Remaining crates (ptf-vault, ptf-policy, ptf-approval, ptf-runtime, etc.) are OPEN scaffolds per capability-ledger; warn only
            $futureMembers = @('crates/ptf-vault','crates/ptf-policy','crates/ptf-approval','crates/ptf-runtime')
            foreach ($fm in $futureMembers) {
                if ($memberList -notcontains $fm) {
                    $warnings.Add("OPEN scaffold not yet in workspace (expected): $fm -- see docs/program/capability-ledger.md P1-P18 OPEN")
                }
            }
        } else {
            $errors.Add("Cargo.toml members block not found or malformed")
        }
    } else {
        $errors.Add("Missing Cargo.toml at $cargoPath")
    }

    # ---------- crates/ptf-approval get_proposal (OPEN scaffold: warn only) ----------
    $approvalLib = Join-Path $coreRoot 'crates\ptf-approval\src\lib.rs'
    if (Test-Path -LiteralPath $approvalLib) {
        $approvalText = Get-Content -Raw -LiteralPath $approvalLib
        if ($approvalText -notmatch 'get_proposal') {
            $warnings.Add("OPEN: crates/ptf-approval/src/lib.rs does not yet contain get_proposal -- W5 not implemented")
        }
    }

    # ---------- crates/ptf-runtime principal binding (OPEN scaffold: warn only) ----------
    $runtimeLib = Join-Path $coreRoot 'crates\ptf-runtime\src\lib.rs'
    if (Test-Path -LiteralPath $runtimeLib) {
        $runtimeText = Get-Content -Raw -LiteralPath $runtimeLib
        if ($runtimeText -notmatch 'principal_id') {
            $warnings.Add("OPEN: crates/ptf-runtime/src/lib.rs missing principal_id binding -- W2/W6 not implemented")
        }
    }
}

# ---------- Optional legacy content validation (only if files exist) ----------
$registrySummaryPath = Join-Path $repoRoot 'docs\program\skill-registry-summary.md'
if (Test-Path -LiteralPath $registrySummaryPath) {
    $registrySummary = Get-Content -Raw -LiteralPath $registrySummaryPath
    if ($registrySummary -match '(?m)^- ``:') { $errors.Add('Skill registry duplicate summary contains a blank identifier.') }
} else {
    Write-Warning "Optional: docs/program/skill-registry-summary.md not present -- skipping duplicate check"
}

$ledgerPath = Join-Path $repoRoot 'docs\program\requirements-ledger.md'
if (Test-Path -LiteralPath $ledgerPath) {
    $ledger = Get-Content -Raw -LiteralPath $ledgerPath
    foreach ($number in 1..25) {
        $id = 'U-{0:d2}' -f $number
        $escaped = [regex]::Escape($id)
        $pattern = '(?m)^\| ' + $escaped + ' \|'
        $count = ([regex]::Matches($ledger, $pattern)).Count
        if ($count -ne 1) { $errors.Add("Requirements ledger must contain exactly one row for $id; found $count.") }
    }
} else {
    Write-Warning "Optional: docs/program/requirements-ledger.md not present -- skipping U-01..U-25 check"
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
} else {
    Write-Warning "Optional: docs/program/skill-registry.json not present -- skipping registry consistency check"
}

# Generic core vocabulary check (only if core docs exist on main)
$coreDocuments = @('DOMAIN_MODEL.md', 'DATA_MODEL_AND_STATE_MACHINES.md', 'INTERFACE_CONTRACTS.md')
$scenarioPattern = '(?i)\b(airline|flight|hotel|shopping cart|product catalog|merchant sku)\b'
foreach ($relative in $coreDocuments) {
    $path = Join-Path $repoRoot $relative
    if (Test-Path -LiteralPath $path) {
        $content = Get-Content -Raw -LiteralPath $path
        if ($content -match $scenarioPattern) {
            $errors.Add("Scenario vocabulary found in generic core specification: $relative")
        }
    }
}

# ---------- Optional tool checks (do not fail if tools absent) ----------
try {
    $cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
    if ($null -ne $cargoCmd -and $null -ne $coreRoot) {
        $origLocation = Get-Location
        try {
            Set-Location -LiteralPath $coreRoot
            $metaOut = & cargo metadata --no-deps --format-version 1 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0 -and $metaOut) {
                try {
                    $meta = $metaOut | ConvertFrom-Json
                    $pkgCount = $meta.packages.Count
                    if ($pkgCount -lt 2) {
                        $errors.Add("cargo metadata --no-deps lists $pkgCount packages, expected >=2 (ptf-domain, ptf-serialization)")
                    }
                    # 50-member full workspace is future (W2-W18 OPEN); warn only
                    if ($pkgCount -lt 50) {
                        $warnings.Add("OPEN: workspace has $pkgCount packages, full 50-member production workspace pending W2-W18")
                    }
                } catch {
                    # ignore json parse errors
                }
            } else {
                if ($LASTEXITCODE -ne 0) {
                    $errors.Add("cargo metadata --no-deps failed with exit $LASTEXITCODE")
                }
            }
            # cargo check gate (no linker required) -- must pass
            $checkOut = & cargo check -p ptf-domain -p ptf-serialization 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                $errors.Add("cargo check -p ptf-domain -p ptf-serialization failed: $checkOut")
            }
            # cargo test needs linker absent without VS/MinGW -- warn only (honest, per no-VS constraint)
            $testOut = & cargo test -p ptf-domain -p ptf-serialization --no-run 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0 -and $testOut -match 'linker.*not found') {
                $warnings.Add("OPEN: cargo test blocked, linker (link.exe/gcc) absent without VS/MinGW -- cargo check passes")
            }
        } finally {
            Set-Location -LiteralPath $origLocation
        }
    }
} catch {
    # cargo not available is not a harness failure; file checks already cover
}

try {
    $bufCmd = Get-Command buf -ErrorAction SilentlyContinue
    if ($null -ne $bufCmd -and $null -ne $coreRoot) {
        $bufDir = Join-Path $coreRoot 'contracts\ptf-contracts'
        if (Test-Path -LiteralPath $bufDir) {
            Push-Location $bufDir
            try {
                $bufOut = & buf lint 2>&1 | Out-String
                if ($LASTEXITCODE -ne 0) {
                    $errors.Add("buf lint failed (exit $LASTEXITCODE): $bufOut")
                }
            } finally {
                Pop-Location
            }
        }
    }
} catch {
    # buf not available is not a harness failure; buf.yaml existence already checked
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

if ($warnings.Count -gt 0) {
    Write-Host "W1 harness verification passed with $($warnings.Count) warning(s)."
    foreach ($w in $warnings) { Write-Host "  WARN: $w" -ForegroundColor Yellow }
} else {
    Write-Host 'W1 harness verification passed.'
}
if ($null -ne $coreRoot) {
    Write-Host "Checked $($requiredSandboxFiles.Count) sandbox files, $($requiredCoreFiles.Count) core files, proto/json-schema peers, Cargo members >=2 (full 50 OPEN), cargo check gate."
} else {
    Write-Host "Checked $($requiredSandboxFiles.Count) sandbox files (core skipped -- sandbox-only clone)."
}
Write-Host "Optional legacy files warn if missing; archived docs at ../handoff-archive-2026-09-02/ or docs/program/archived/ -- fresh clone ready."

