#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Authority,
  Capabilities,
  Disclose,
  FakePaymentExecutor,
  FileAuditLog,
  RecipientRegistry,
  VaultStore,
  atomicWrite,
  claimsSubset,
  digestForOperation,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  loadAgents,
  loadAuthority,
  loadRegistry,
  loadVault,
  openKeystore,
  parseDecision,
  parseSensitivity,
  paymentBounds,
  privateKeyFromPkcs8,
  publicKeyFromPrivate,
  putRecord as putVaultRecord,
  rawPublicKey,
  readForPurpose,
  readPassphrase,
  renderProposal,
  resealKeystore,
  rotateVaultDek,
  saveAuthority,
  saveRegistry,
  saveAgents,
  sealKeystore,
  signBytes,
  VAULT_DEK_ALIAS,
  VAULT_DEK_NEXT_ALIAS,
  backupStore,
  createVaultDek,
  ensureVaultDek,
  migrateVault,
  readVaultKid,
  resolveVaultDek,
  restoreStore,
} from "./index.js";
import type {
  ActorSelector,
  AttributeBound,
  AuthorityOperation,
  AuthorityRequest,
  PaymentExecutor,
  VerifiedIdentity,
} from "./index.js";
import type { KeyObject } from "node:crypto";

/**
 * Minimal operator CLI (prod-03). Manual argv, stdin/stdout only, no framework.
 * Every flow reuses the tested modules verbatim — this file is wiring, not logic.
 * Secrets: the keystore passphrase comes from PTF_PASSPHRASE only, never argv.
 * Deliberately NOT re-exported from the package entry: the bin target loads
 * it directly, keeping the library seam free of process I/O.
 */

/** Private keys live in the keystore as PKCS#8 DER; rebuild them on use. */
function toPrivateKey(der: Uint8Array): KeyObject {
  return privateKeyFromPkcs8(der);
}

/**
 * Issuer/recipient key resolution for capability checks (ticket 05). The
 * registry is authoritative: a known-but-retired alias stays retired (null,
 * no fallback — revocation must keep failing closed). Truly unknown ids
 * fall back to locally-held keys, because issuers are the operator's own
 * identities and the quickstart never registers the principal as a
 * "recipient". This changes nothing for attackers: proofs still need the
 * private key, which never leaves the host; it only stops the operator's
 * own issuance from failing closed against itself.
 */
function resolveKeyWithLocalFallback(
  reg: RecipientRegistry,
  keys: Record<string, Uint8Array>
): (id: string) => Uint8Array | null {
  return (id: string): Uint8Array | null => {
    const bound = reg.resolve(id);
    if (bound !== null) return bound;
    if (reg.history(id) !== null) return null;
    const seed = keys[id];
    if (seed === undefined) return null;
    try {
      return rawPublicKey(publicKeyFromPrivate(toPrivateKey(seed)));
    } catch {
      return null;
    }
  };
}

const COMMANDS = [
  "init",
  "keygen",
  "rekey",
  "recipient",
  "agent",
  "grant",
  "pay",
  "disclose",
  "vault-put",
  "vault-read",
  "vault-migrate",
  "vault-rekey",
  "audit",
  "revoke",
  "backup",
  "restore",
  "help",
  "version",
] as const;

const BOOLEAN_FLAGS = new Set([
  "yes",
  "verify",
  "list",
  "help",
  "version",
  "any-agent",
]);

export const PTF_VERSION = "0.1.0";

export function helpText(): string {
  return [
    "ptf — Personal Trust Fabric operator CLI (use without possession)",
    "",
    "usage: ptf [--dir D] <command> [flags]   |   ptf --help   |   ptf --version",
    "",
    "commands:",
    "  init                                   create store (refuses to overwrite)",
    "  keygen --alias NAME                    generate Ed25519 key into encrypted keystore",
    "  rekey                                  rotate the keystore passphrase (old via PTF_PASSPHRASE(_FILE), new via PTF_NEW_PASSPHRASE(_FILE) or prompt)",
    "  recipient --alias NAME --key HEX       register 32-byte recipient key",
    "  agent --register ID [--key HEX]      register agent (key optional: keyless agents use launcher-asserted identity)",
    "  agent --remove ID                    retire agent permanently (takes effect on next tool call)",
    "  agent --rotate ID --key HEX          swap an agent's registry key (sessions re-authenticate)",
    "  agent --list                         list registered agents and status",
    "  grant --id ID --principal P --cmd /pay (--agent A | --actor-set a,b | --any-agent) [--amount-max N] [--currency C] [--allowed-claims a,b] [--exp-in S] [--max-uses N] [--purpose T] [--resource R] [--resource-type T] [--recipient R]",
    "         --any-agent is an explicit wildcard (audited, deliberate) — prefer --agent / --actor-set",
    "  pay --principal P --agent A --recipient R --amount N --currency C --resource R [--purpose T] [--yes]",
    "  disclose --holder H --verifier V --claims a,b --credential JSON [--allowed a,b] [--yes]",
    "  vault-put --id ID --owner O --type T --sensitivity general|sensitive|secret --source S --purposes p1,p2 --agents a1,a2 --value-file PATH [--expires-at EPOCH]",
    "         value from a 0600 file only (never argv: argv leaks into shell history/process list); one trailing newline stripped; values never print or audit",
    "  vault-read --holder H --agent A --purpose P --claims a,b --verifier V [--nonce N]",
    "         prints disclosed claim NAMES only (ids-only audit); secrets never leave via read (use in-host useCredential)",
    "  vault-migrate                          one-time migration of a legacy plaintext vault to AEAD (then destroy old plaintext backups)",
    "  vault-rekey                            rotate the vault DEK (re-seals vault data; keystore passphrase unchanged)",
    "  audit [--verify]                       verify hash chain (needs no passphrase)",
    "  backup --to DIR                        copy the store as one unit + anchor.json (refuses non-empty dest; stop writers first)",
    "  restore --from DIR                     copy a backup over fresh --dir, never merges; verifies chain + freshness + anchor",
    "  revoke (--grant ID | --recipient ALIAS)",
    "  help                                   print this help",
    "",
    "env: PTF_PASSPHRASE (required for keygen/pay/disclose/vault-*; audit needs it only when a vault file exists; never passed as a flag)",
    "     alternatives: PTF_PASSPHRASE_FILE (0600 file, preferred over env), or an interactive TTY prompt",
    "examples:",
    "  PTF_PASSPHRASE=test-passphrase-change-me ptf --dir ./ptf-store init",
    "  PTF_PASSPHRASE=test-passphrase-change-me ptf keygen --alias you",
    "  ptf grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR",
    "  ptf grant --id g2 --principal you --cmd /pay --actor-set shopper,groceries --amount-max 2000 --currency INR",
    "  ptf grant --id g3 --principal you --cmd /pay --any-agent --amount-max 500 --currency INR",
    "  PTF_PASSPHRASE=test-passphrase-change-me ptf pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes",
    "docs: README.md, docs/audit/README.md",
  ].join("\n");
}

export interface ParsedArgs {
  readonly command: string;
  readonly dir: string;
  readonly flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", dir: "./ptf-store", flags: {} };
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    return { command: "version", dir: "./ptf-store", flags: {} };
  }
  let dir = "./ptf-store";
  const tokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string;
    if (t === "--dir") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        throw new Error("usage: --dir expects a value");
      }
      dir = v;
      i++;
    } else {
      tokens.push(t);
    }
  }
  const [command, ...rest] = tokens;
  if (command === undefined) {
    throw new Error(
      "usage: ptf [--dir D] <init|keygen|rekey|recipient|agent|grant|pay|disclose|vault-put|vault-read|vault-migrate|vault-rekey|audit|backup|restore|revoke|help|version> ..."
    );
  }
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (!t.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${t}`);
    }
    const name = t.slice(2);
    if (name.length === 0) throw new Error("usage: lone -- is not a flag");
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`usage: --${name} expects a value`);
    }
    flags[name] = next;
    i++;
  }
  const allowed = ALLOWED_FLAGS[command];
  if (allowed !== undefined) {
    for (const name of Object.keys(flags)) {
      if (!allowed.has(name)) {
        throw new Error(
          `unknown flag --${name} for ${command} (see: ptf help)`
        );
      }
    }
  }
  return { command, dir, flags };
}

const ALLOWED_FLAGS: Record<string, Set<string>> = {
  init: new Set(),
  keygen: new Set(["alias"]),
  rekey: new Set([]),
  recipient: new Set(["alias", "key"]),
  agent: new Set(["register", "remove", "rotate", "list", "key"]),
  grant: new Set([
    "id",
    "principal",
    "agent",
    "actor-set",
    "any-agent",
    "cmd",
    "purpose",
    "resource",
    "resource-type",
    "recipient",
    "amount-max",
    "currency",
    "allowed-claims",
    "exp-in",
    "max-uses",
  ]),
  pay: new Set([
    "agent",
    "principal",
    "recipient",
    "amount",
    "currency",
    "resource",
    "purpose",
    "yes",
  ]),
  disclose: new Set([
    "holder",
    "verifier",
    "claims",
    "credential",
    "allowed",
    "yes",
  ]),
  "vault-put": new Set([
    "id",
    "owner",
    "type",
    "sensitivity",
    "source",
    "purposes",
    "agents",
    "value-file",
    "expires-at",
  ]),
  "vault-read": new Set([
    "holder",
    "agent",
    "purpose",
    "claims",
    "verifier",
    "nonce",
  ]),
  "vault-migrate": new Set([]),
  "vault-rekey": new Set([]),
  audit: new Set(["verify"]),
  backup: new Set(["to"]),
  restore: new Set(["from"]),
  revoke: new Set(["grant", "recipient"]),
  help: new Set(),
  version: new Set(),
};

export interface CliIo {
  readLine(): string;
  print(line: string): void;
  now(): number;
}

function str(flags: Record<string, string | boolean>, name: string): string {
  const v = flags[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`usage: --${name} is required`);
  }
  return v;
}

function num(flags: Record<string, string | boolean>, name: string): number {
  const raw = str(flags, name);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`usage: --${name} must be a positive integer`);
  }
  return n;
}

function opt(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

interface Ctx {
  dir: string;
  auth: Authority;
  reg: RecipientRegistry;
  audit: FileAuditLog;
  keys: Record<string, Uint8Array>;
}

function passphraseFrom(
  env: Record<string, string | undefined>,
  prompt?: () => string
): string {
  return readPassphrase(env, ...(prompt !== undefined ? [{ prompt }] : []));
}

function persistKeys(
  dir: string,
  env: Record<string, string | undefined>,
  keys: Record<string, Uint8Array>,
  prompt?: () => string
): void {
  mkdirSync(dir, { recursive: true });
  atomicWrite(
    join(dir, "keystore.json"),
    `${JSON.stringify(sealKeystore(keys, passphraseFrom(env, prompt)))}\n`
  );
}

function persistState(ctx: Ctx): void {
  saveAuthority(ctx.dir, ctx.auth);
  saveRegistry(ctx.dir, ctx.reg);
}

function loadCtx(
  dir: string,
  env: Record<string, string | undefined>,
  now: () => number,
  needKeys: boolean,
  prompt?: () => string
): Ctx {
  if (!existsSync(join(dir, "authority.json"))) {
    throw new Error(`no store at ${dir} (run: ptf init --dir ${dir})`);
  }
  const auth = loadAuthority(dir, { nowSec: now });
  const reg = loadRegistry(dir, now);
  const audit = FileAuditLog.open(join(dir, "audit.jsonl"), now);
  const kp = join(dir, "keystore.json");
  let keys: Record<string, Uint8Array> = {};
  if (existsSync(kp)) {
    if (!needKeys) {
      // Read-only commands must not demand the passphrase: leave keys empty.
      return { dir, auth, reg, audit, keys };
    }
    let raw: string;
    try {
      raw = readFileSync(kp, "utf8");
    } catch {
      throw new Error(`keystore missing: ${kp}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`keystore corrupt: ${kp}`);
    }
    keys = openKeystore(
      parsed as Parameters<typeof openKeystore>[0],
      passphraseFrom(env, prompt)
    );
  } else if (needKeys) {
    throw new Error("no keystore yet (run: keygen)");
  }
  return { dir, auth, reg, audit, keys };
}

export async function run(
  argv: string[],
  io: CliIo,
  env: Record<string, string | undefined>,
  opts: { promptPassphrase?: () => string; executor?: PaymentExecutor } = {}
): Promise<number> {
  const { command, dir, flags } = parseArgs(argv);
  const now = () => io.now();
  const prompt = opts.promptPassphrase;
  // Value-movement rail, injectable for fault-injection tests; production
  // hosts supply their own PaymentExecutor (ticket 05).
  const executor = opts.executor ?? new FakePaymentExecutor();

  if (command === "help") {
    io.print(helpText());
    return 0;
  }
  if (command === "version") {
    io.print(`ptf ${PTF_VERSION}`);
    return 0;
  }

  if (command === "init") {
    if (
      existsSync(join(dir, "authority.json")) ||
      existsSync(join(dir, "registry.json"))
    ) {
      throw new Error(
        `store already exists at ${dir} (refusing to overwrite grants)`
      );
    }
    mkdirSync(dir, { recursive: true });
    saveAuthority(dir, new Authority({ nowSec: now }));
    saveRegistry(dir, new RecipientRegistry(now));
    FileAuditLog.open(join(dir, "audit.jsonl"), now);
    io.print(`initialized store at ${dir}`);
    return 0;
  }

  if (command === "backup") {
    const to = str(flags, "to");
    io.print(
      "stop writers first: a backup is a point-in-time copy (single-writer topology)"
    );
    const ppFile = env["PTF_PASSPHRASE_FILE"];
    const summary = backupStore(dir, to, {
      nowSec: now,
      ...(typeof ppFile === "string" && ppFile.length > 0
        ? { passphraseFile: ppFile }
        : {}),
    });
    io.print(
      `backup: ${summary.files.length} files + ${summary.proposals} proposals + ${summary.executions} executions → ${summary.destDir}`
    );
    io.print(
      `anchor: root=${summary.anchor.root === "" ? "(empty log)" : summary.anchor.root} count=${summary.anchor.count}`
    );
    return 0;
  }

  if (command === "restore") {
    const from = str(flags, "from");
    // Key material comes from the BACKUP's keystore (when present) so the
    // restored vault can be verified before the target is trusted.
    let keys: Record<string, Uint8Array> = {};
    if (existsSync(join(from, "keystore.json"))) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          readFileSync(join(from, "keystore.json"), "utf8")
        ) as unknown;
      } catch {
        throw new Error(`keystore corrupt: ${join(from, "keystore.json")}`);
      }
      keys = openKeystore(
        parsed as Parameters<typeof openKeystore>[0],
        passphraseFrom(env, prompt)
      ) as Record<string, Uint8Array>;
    }
    const summary = restoreStore(from, dir, {
      nowSec: now,
      ...(Object.keys(keys).length > 0 ? { keys } : {}),
    });
    io.print(`restore: ${summary.files.length} files → ${summary.destDir}`);
    io.print(
      summary.anchorChecked
        ? "anchor: MATCH (restored log equals the backup checkpoint)"
        : "anchor: no anchor.json in backup (point-in-time only — record one next time)"
    );
    io.print(`next: ptf --dir ${dir} audit --verify`);
    return 0;
  }

  if (command === "keygen") {
    const alias = str(flags, "alias");
    // Load existing keys when a keystore is present: sealing only the new
    // key would silently delete every other alias (fail-closed, never
    // clobber). First run has no keystore yet, so no passphrase is needed
    // to load — only to seal.
    const ctx = loadCtx(
      dir,
      env,
      now,
      existsSync(join(dir, "keystore.json")),
      prompt
    );
    if (ctx.keys[alias] !== undefined) {
      throw new Error(`key exists: ${alias}`);
    }
    const kp = generateEd25519Keypair();
    ctx.keys[alias] = new Uint8Array(
      kp.privateKey.export({ format: "der", type: "pkcs8" })
    );
    persistKeys(dir, env, ctx.keys, prompt);
    io.print(
      `${alias}: ${Buffer.from(rawPublicKey(kp.publicKey)).toString("hex")}`
    );
    return 0;
  }

  if (command === "rekey") {
    // Rotate the keystore passphrase without re-issuing keys: open with
    // the old passphrase, re-seal under the new one (fresh salt/IV), and
    // overwrite only on success. New secret from PTF_NEW_PASSPHRASE /
    // PTF_NEW_PASSPHRASE_FILE / prompt — never argv.
    const kp = join(dir, "keystore.json");
    let raw: string;
    try {
      raw = readFileSync(kp, "utf8");
    } catch {
      throw new Error(`no keystore yet at ${kp} (run: keygen)`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`keystore corrupt: ${kp}`);
    }
    const oldPass = readPassphrase(
      env,
      ...(prompt !== undefined ? [{ prompt }] : [])
    );
    const newPass = readPassphrase(
      {
        PTF_PASSPHRASE: env["PTF_NEW_PASSPHRASE"],
        PTF_PASSPHRASE_FILE: env["PTF_NEW_PASSPHRASE_FILE"],
      },
      ...(prompt !== undefined ? [{ prompt }] : [])
    );
    const resealed = resealKeystore(
      parsed as Parameters<typeof resealKeystore>[0],
      oldPass,
      newPass
    );
    mkdirSync(dir, { recursive: true });
    atomicWrite(kp, `${JSON.stringify(resealed)}\n`);
    io.print(`rekeyed keystore at ${kp}`);
    return 0;
  }

  // Passphrase demand per command. Vault commands need the keystore: reads
  // and rekeys open it; puts and migrates load-or-create it (missing keys
  // are sealed below once the DEK exists). Audit opens it only when a vault
  // file exists, since freshness verification needs the DEK.
  const keystoreExists = existsSync(join(dir, "keystore.json"));
  const ctx = loadCtx(
    dir,
    env,
    now,
    command === "pay" ||
      command === "disclose" ||
      command === "vault-read" ||
      command === "vault-rekey" ||
      ((command === "vault-put" || command === "vault-migrate") &&
        keystoreExists) ||
      (command === "audit" && existsSync(join(dir, "personal-state.json"))),
    prompt
  );

  /** Vault error messages that are authorization denys (vs operational). */
  const isVaultDeny = (msg: string): boolean =>
    /authority denied|no records satisfy|purpose denied|agent denied|record expired|unknown record|owner mismatch|holder must equal/.test(
      msg
    );

  if (command === "recipient") {
    const alias = str(flags, "alias");
    const key = new Uint8Array(Buffer.from(str(flags, "key"), "hex"));
    ctx.reg.register(alias, key, now());
    persistState(ctx);
    // Authority mutations are audit-worthy: the entry stamps post-save
    // revisions so rolling back registry.json past this point alarms.
    ctx.audit.append({
      actor: "operator",
      action: "register",
      detail: alias,
      authorityRev: ctx.auth.loadedRevision(),
      registryRev: ctx.reg.loadedRevision(),
    });
    io.print(`registered ${alias}`);
    return 0;
  }

  if (command === "agent") {
    // Exactly one action: register (id [+ key]), remove (id), rotate
    // (id + key), or list. Registry mutations are audit-appended with the
    // post-save revision so rollback past them alarms at load.
    const registerId = opt(flags, "register");
    const removeId = opt(flags, "remove");
    const rotateId = opt(flags, "rotate");
    const listAll = flags["list"] === true;
    const keyHex = opt(flags, "key");
    const given = [
      registerId !== undefined,
      removeId !== undefined,
      rotateId !== undefined,
      listAll,
    ].filter((v) => v).length;
    if (given !== 1) {
      throw new Error(
        "usage: agent needs exactly one of --register ID [--key HEX] | --remove ID | --rotate ID --key HEX | --list"
      );
    }
    if (listAll) {
      const agents = loadAgents(dir);
      for (const id of agents.ids()) {
        const rec = agents.get(id);
        io.print(
          `${id} ${rec?.status}${rec?.publicKeyHex !== undefined ? " keyed" : " keyless"}`
        );
      }
      return 0;
    }
    const agents = loadAgents(dir);
    if (registerId !== undefined) {
      agents.register(registerId, keyHex, now());
      saveAgents(dir, agents);
      ctx.audit.append({
        actor: "operator",
        action: "agent-register",
        detail: registerId,
        authorityRev: ctx.auth.loadedRevision(),
        registryRev: ctx.reg.loadedRevision(),
        agentRev: agents.loadedRevision(),
      });
      io.print(`registered agent ${registerId}`);
      return 0;
    }
    if (rotateId !== undefined) {
      if (keyHex === undefined) {
        throw new Error("usage: agent --rotate ID needs --key HEX");
      }
      agents.rotate(rotateId, keyHex);
      saveAgents(dir, agents);
      ctx.audit.append({
        actor: "operator",
        action: "agent-rotate",
        detail: rotateId,
        authorityRev: ctx.auth.loadedRevision(),
        registryRev: ctx.reg.loadedRevision(),
        agentRev: agents.loadedRevision(),
      });
      io.print(`rotated agent key ${rotateId}`);
      return 0;
    }
    // removeId is defined (exactly-one check above).
    agents.remove(removeId as string, now());
    saveAgents(dir, agents);
    ctx.audit.append({
      actor: "operator",
      action: "agent-remove",
      detail: removeId as string,
      authorityRev: ctx.auth.loadedRevision(),
      registryRev: ctx.reg.loadedRevision(),
      agentRev: agents.loadedRevision(),
    });
    io.print(`removed agent ${removeId}`);
    return 0;
  }

  if (command === "grant") {
    // Actor binding is mandatory: exactly one selector, never a silent wildcard.
    const agentRaw = opt(flags, "agent");
    const actorSetRaw = opt(flags, "actor-set");
    const anyAgent = flags["any-agent"] === true;
    const given = [
      agentRaw !== undefined,
      actorSetRaw !== undefined,
      anyAgent,
    ].filter((v) => v).length;
    if (given !== 1) {
      throw new Error(
        "usage: grant needs exactly one of --agent A | --actor-set a,b | --any-agent"
      );
    }
    let actor: ActorSelector;
    if (agentRaw !== undefined) {
      actor = { kind: "exact", id: agentRaw };
    } else if (actorSetRaw !== undefined) {
      const ids = actorSetRaw.split(",");
      if (ids.some((x) => x.length === 0)) {
        throw new Error("usage: --actor-set must be a non-empty comma list");
      }
      actor = { kind: "set", ids };
    } else {
      actor = { kind: "any" };
    }
    // Payment/disclosure attributes become context bounds (ADR-0010 profiles).
    const bounds: AttributeBound[] = [];
    const amountMaxRaw = opt(flags, "amount-max");
    const currencyRaw = opt(flags, "currency");
    if (amountMaxRaw !== undefined && currencyRaw !== undefined) {
      bounds.push(
        ...paymentBounds({
          amountMax: num(flags, "amount-max"),
          currency: currencyRaw,
        })
      );
    } else if (amountMaxRaw !== undefined) {
      bounds.push({
        path: ".context.amount",
        op: "<=",
        value: num(flags, "amount-max"),
      });
    } else if (currencyRaw !== undefined) {
      if (currencyRaw.length === 0) {
        throw new Error("usage: --currency must be non-empty");
      }
      bounds.push({ path: ".context.currency", op: "==", value: currencyRaw });
    }
    const grantRecipient = opt(flags, "recipient");
    if (grantRecipient !== undefined) {
      bounds.push({
        path: ".context.recipient",
        op: "==",
        value: grantRecipient,
      });
    }
    const allowedClaimsRaw = opt(flags, "allowed-claims");
    if (allowedClaimsRaw !== undefined) {
      bounds.push(...claimsSubset(allowedClaimsRaw.split(",")));
    }
    const resourceRaw = opt(flags, "resource");
    const resourceTypeRaw = opt(flags, "resource-type");
    const resourceFilter:
      { readonly type?: string; readonly id?: string } | undefined =
      resourceRaw !== undefined || resourceTypeRaw !== undefined
        ? {
            ...(resourceTypeRaw !== undefined ? { type: resourceTypeRaw } : {}),
            ...(resourceRaw !== undefined ? { id: resourceRaw } : {}),
          }
        : undefined;
    ctx.auth.addGrant({
      id: str(flags, "id"),
      principal: str(flags, "principal"),
      actor,
      action: { name: str(flags, "cmd") as `/${string}` },
      ...(resourceFilter !== undefined ? { resource: resourceFilter } : {}),
      ...(opt(flags, "purpose") !== undefined
        ? { purpose: opt(flags, "purpose") as string }
        : {}),
      bounds,
      ...(opt(flags, "exp-in") !== undefined
        ? { exp: now() + num(flags, "exp-in") }
        : {}),
      ...(opt(flags, "max-uses") !== undefined
        ? { maxUses: num(flags, "max-uses") }
        : {}),
    });
    persistState(ctx);
    const grantId = str(flags, "id");
    ctx.audit.append({
      actor: "operator",
      action: "grant",
      authorityId: grantId,
      authorityRev: ctx.auth.loadedRevision(),
      registryRev: ctx.reg.loadedRevision(),
    });
    io.print(`grant ${grantId} recorded`);
    return 0;
  }

  if (command === "pay") {
    const agent = str(flags, "agent");
    const principal = str(flags, "principal");
    const recipient = str(flags, "recipient");
    const amount = num(flags, "amount");
    const currency = str(flags, "currency");
    const resource = str(flags, "resource");
    const purpose = opt(flags, "purpose") ?? "payment";
    // Binding is derived from the operation + the trusted operator ingress
    // (ADR-0013) — never caller-supplied.
    const op: AuthorityOperation = {
      action: { name: "/pay" as const },
      resource: { type: "ptf-resource", id: resource },
      context: { amount, currency, recipient },
      purpose,
    };
    const ingress: VerifiedIdentity = {
      id: agent,
      principal,
      source: "local-registration",
      proofRef: "cli-operator",
    };
    const bound = { ...op, principal, actor: agent };
    const digest = digestForOperation(bound);
    const demand: AuthorityRequest = { ...bound, termsDigest: digest };
    const capExp = now() + 300;
    // Fail fast before spending authority: keys must exist first.
    const principalSeed = ctx.keys[principal];
    if (principalSeed === undefined) {
      throw new Error(`no key for principal ${principal}`);
    }
    const recipientSeed = ctx.keys[recipient];
    if (recipientSeed === undefined) {
      throw new Error(
        `no local key for recipient ${recipient} (v0.1 CLI pays self-controlled identities only)`
      );
    }
    const preview = ctx.auth.evaluate(op, ingress, { nowSec: now() });
    if (!preview.allow) {
      io.print(`denied before approval: ${preview.reason}`);
      return 1;
    }
    io.print(
      renderProposal({
        demand,
        citations: preview.citations,
        maxUses: 1,
        expiresAt: capExp,
      })
    );
    const answer = flags["yes"] === true ? "yes" : io.readLine();
    if (parseDecision(answer) !== "approve") {
      io.print("denied by human");
      return 1;
    }
    const decision = ctx.auth.evaluate(op, ingress, {
      consume: true,
      nowSec: now(),
    });
    if (!decision.allow) {
      io.print(`denied at redeem time: ${decision.reason}`);
      return 1;
    }
    // Persist the consumption BEFORE executing (ticket 05): a crash or a
    // failing rail between persist and execute can only burn a use, never
    // double-spend — the safe direction. A failed execute therefore denies
    // the retry (uses-exhausted), it does not refund it.
    persistState(ctx);
    const capabilities = new Capabilities({
      resolveKey: resolveKeyWithLocalFallback(ctx.reg, ctx.keys),
      nowSec: now,
    });
    const cap = capabilities.issue(
      null,
      {
        iss: principal,
        aud: agent,
        sub: principal,
        cmd: "/pay",
        pol: [["<=", ".amount", amount]],
        purpose,
        resource,
        recipient,
        amountMax: amount,
        currency,
        exp: capExp,
        maxUses: 1,
        termsDigest: digest,
      },
      toPrivateKey(principalSeed)
    );
    const recipientPriv = toPrivateKey(recipientSeed);
    const recipientPub = publicKeyFromPrivate(recipientPriv);
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const redeemed = capabilities.redeem(
      [cap],
      {
        cmd: "/pay",
        args: { amount, currency },
        recipient,
        resource,
        purpose,
        termsDigest: digest,
      },
      {
        proof: {
          key: rawPublicKey(recipientPub),
          sig: signBytes(recipientPriv, cidBytes),
        },
      }
    );
    if (!redeemed.ok) {
      io.print(`redeem failed: ${redeemed.reason}`);
      return 1;
    }
    const receipt = await executeAndReceipt(
      executor,
      {
        capabilityId: leafCidHex(cap),
        recipient,
        amount,
        currency,
        resource,
        purpose,
        termsDigest: digest,
      },
      redeemed,
      now()
    );
    const cited = decision.allow
      ? decision.citations[0]?.authorityId
      : undefined;
    // Authority already persisted above; the entry stamps the post-save
    // revisions so a later file rollback fails the freshness check at load.
    ctx.audit.append({
      actor: agent,
      action: "pay",
      ...(cited !== undefined ? { authorityId: cited } : {}),
      capabilityId: receipt.capabilityId,
      detail: receipt.transaction,
      authorityRev: ctx.auth.loadedRevision(),
      registryRev: ctx.reg.loadedRevision(),
    });
    io.print(JSON.stringify(receipt));
    return 0;
  }

  if (command === "disclose") {
    const holder = str(flags, "holder");
    const verifier = str(flags, "verifier");
    const requested = str(flags, "claims").split(",");
    let credential: {
      issuer: string;
      subject: string;
      claims: Record<string, unknown>;
    };
    try {
      credential = JSON.parse(str(flags, "credential")) as {
        issuer: string;
        subject: string;
        claims: Record<string, unknown>;
      };
    } catch {
      throw new Error("usage: --credential must be valid JSON");
    }
    const allowed = (opt(flags, "allowed") ?? requested.join(",")).split(",");
    // Binding is derived from the operation + the trusted operator ingress:
    // claims + verifier ride in context.
    const op: AuthorityOperation = {
      action: { name: "/disclose" as const },
      resource: { type: "credential", id: `credential:${credential.issuer}` },
      context: { claims: requested, verifier },
      purpose: "disclose",
    };
    const ingress: VerifiedIdentity = {
      id: holder,
      principal: holder,
      source: "local-registration",
      proofRef: "cli-operator",
    };
    const bound = { ...op, principal: holder, actor: holder };
    const digest = digestForOperation(bound);
    const demand: AuthorityRequest = { ...bound, termsDigest: digest };
    const holderSeed = ctx.keys[holder];
    if (holderSeed === undefined) {
      throw new Error(`no key for holder ${holder}`);
    }
    const preview = ctx.auth.evaluate(op, ingress, { nowSec: now() });
    if (!preview.allow) {
      io.print(`denied before approval: ${preview.reason}`);
      return 1;
    }
    io.print(
      renderProposal({
        demand,
        citations: preview.citations,
        maxUses: 1,
      })
    );
    const answer = flags["yes"] === true ? "yes" : io.readLine();
    if (parseDecision(answer) !== "approve") {
      io.print("denied by human");
      return 1;
    }
    const decision = ctx.auth.evaluate(op, ingress, {
      consume: true,
      nowSec: now(),
    });
    if (!decision.allow) {
      io.print(`denied at redeem time: ${decision.reason}`);
      return 1;
    }
    const holderPriv = toPrivateKey(holderSeed);
    const pres = Disclose.present(
      { ...credential, cnf: holder },
      { verifier, nonce: `n-${now()}`, requested },
      { recipient: verifier, allowed },
      { id: holder, privateKey: holderPriv },
      now()
    );
    // Persist BEFORE audit (same crash order as pay/MCP): the entry stamps
    // the post-save revisions for the load-time freshness check.
    persistState(ctx);
    ctx.audit.append({
      actor: holder,
      action: "disclose",
      detail: pres.disclosures.map((d) => d.name).join(","),
      authorityRev: ctx.auth.loadedRevision(),
      registryRev: ctx.reg.loadedRevision(),
    });
    io.print(JSON.stringify(pres.disclosures.map((d) => d.name)));
    return 0;
  }

  if (command === "vault-put") {
    const id = str(flags, "id");
    const owner = str(flags, "owner");
    const type = str(flags, "type");
    const sensitivity = parseSensitivity(str(flags, "sensitivity"));
    const source = str(flags, "source");
    const purposes = str(flags, "purposes").split(",");
    if (purposes.some((x) => x.length === 0)) {
      throw new Error("usage: --purposes must be a non-empty comma list");
    }
    const agents = str(flags, "agents").split(",");
    if (agents.some((x) => x.length === 0)) {
      throw new Error("usage: --agents must be a non-empty comma list");
    }
    // Value from a file only — never argv (argv leaks into shell history and
    // the process list). One trailing newline stripped (0600 file
    // convention); anything else is significant. The value never prints or
    // audits either way.
    const valueFileRaw = opt(flags, "value-file");
    if (valueFileRaw === undefined || valueFileRaw.length === 0) {
      throw new Error("usage: --value-file PATH is required");
    }
    let raw: string;
    try {
      raw = readFileSync(valueFileRaw, "utf8");
    } catch {
      throw new Error(`vault-put: cannot read --value-file ${valueFileRaw}`);
    }
    const value: unknown = raw.replace(/\r?\n$/, "");
    const expiresRaw = opt(flags, "expires-at");
    let expiresAt: number | null = null;
    if (expiresRaw !== undefined) {
      const n = Number(expiresRaw);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error("usage: --expires-at must be a non-negative epoch int");
      }
      expiresAt = n;
    }
    // Load-or-create: a missing personal-state.json starts a fresh vault at
    // revision 0 (saveVault CAS); a corrupt file fails closed via loadVault.
    // The keystore is persisted BEFORE the vault write: a vault sealed under
    // a DEK that never reaches the keystore would be unrecoverable.
    const ensured = ensureVaultDek(ctx.keys);
    if (ensured.created) persistKeys(dir, env, ensured.keys, prompt);
    const dek = ensured.keys[VAULT_DEK_ALIAS] as Uint8Array;
    let vault: VaultStore;
    try {
      vault = loadVault(dir, { nowSec: now, dek });
    } catch (err) {
      if (
        err instanceof Error &&
        /store missing/.test(err.message) &&
        !existsSync(join(dir, "personal-state.json"))
      ) {
        vault = new VaultStore(now);
      } else {
        throw err;
      }
    }
    const rec = putVaultRecord(
      dir,
      vault as VaultStore,
      {
        id,
        owner,
        type,
        value,
        sensitivity,
        source,
        allowedPurposes: purposes,
        allowedAgents: agents,
        ...(expiresAt !== null ? { expiresAt } : {}),
      },
      { at: now(), audit: ctx.audit, dek }
    );
    // ids-only: the value never prints, never audits (putVaultRecord detail
    // carries id/type/sensitivity/revision only).
    io.print(`vault-put ${rec.id} (${rec.sensitivity})`);
    return 0;
  }

  if (command === "vault-read") {
    const holder = str(flags, "holder");
    const agent = str(flags, "agent");
    const purpose = str(flags, "purpose");
    const requested = str(flags, "claims").split(",");
    if (requested.some((x) => x.length === 0)) {
      throw new Error("usage: --claims must be a non-empty comma list");
    }
    const verifier = str(flags, "verifier");
    const nonce = opt(flags, "nonce") ?? `n-${now()}`;
    if (nonce.length === 0) throw new Error("usage: --nonce must be non-empty");
    const holderSeed = ctx.keys[holder];
    if (holderSeed === undefined) {
      throw new Error(`no key for holder ${holder}`);
    }
    let vault: VaultStore;
    try {
      vault = loadVault(dir, { nowSec: now, keys: ctx.keys });
    } catch (err) {
      if (err instanceof Error && /legacy plaintext/.test(err.message)) {
        throw new Error(`${err.message} — vault-read needs ciphertext`);
      }
      if (err instanceof Error && /vault store missing/.test(err.message)) {
        throw new Error(`no vault yet at ${dir} (run: vault-put first)`);
      }
      throw err;
    }
    try {
      const pres = readForPurpose(vault, {
        ingress: {
          id: agent,
          principal: holder,
          source: "local-registration",
          proofRef: "cli-operator",
        },
        purpose,
        requested,
        verifier,
        nonce,
        nowSec: now(),
        authority: ctx.auth,
        resource: { type: "vault", id: "personal-state" },
        holder: { id: holder, privateKey: toPrivateKey(holderSeed) },
        audit: ctx.audit,
      });
      // NAMES only — values never print (secret records never even reach here:
      // readForPurpose drops `secret` before presenting). Persist the
      // consumed use BEFORE delivering (burn-before-deliver, ticket 05).
      persistState(ctx);
      io.print(JSON.stringify(pres.disclosures.map((d) => d.name)));
      return 0;
    } catch (err) {
      // Authorization denys stay user-facing (`denied`, exit 1); operational
      // failures (decrypt, corrupt, stale) rethrow with their message so a
      // tampered store is never misreported as a policy deny.
      const msg = err instanceof Error ? err.message : String(err);
      if (isVaultDeny(msg)) {
        io.print(`denied: ${msg}`);
        return 1;
      }
      throw err;
    }
  }

  if (command === "vault-migrate") {
    // One-time migration of a legacy plaintext vault to AEAD. Keystore
    // persisted first (see vault-put ordering note), then the migration
    // seals and audits. Old plaintext backups must be destroyed by hand.
    const ensured = ensureVaultDek(ctx.keys);
    if (ensured.created) persistKeys(dir, env, ensured.keys, prompt);
    const dek = ensured.keys[VAULT_DEK_ALIAS] as Uint8Array;
    const { records, revision } = migrateVault(dir, {
      dek,
      nowSec: now,
      audit: ctx.audit,
    });
    io.print(
      `vault migrated: ${records} records at rev ${revision} (destroy old plaintext backups)`
    );
    return 0;
  }

  if (command === "vault-rekey") {
    // Crash-safe rotation in three persisted steps: stage the new DEK under
    // the next alias first, re-seal vault data second, promote third. Every
    // crash prefix leaves a keystore DEK matching the envelope kid on disk
    // (current, next, or both), and every load resolves by kid — so no brick
    // state exists. A rerun after a crash reuses the staged next alias
    // instead of minting another DEK (which could orphan a re-sealed vault).
    const kid = readVaultKid(dir);
    const cur = resolveVaultDek(ctx.keys, kid);
    const vault = loadVault(dir, { nowSec: now, dek: cur });
    const staged = ctx.keys[VAULT_DEK_NEXT_ALIAS];
    const newDek =
      staged instanceof Uint8Array && staged.length === 32
        ? staged
        : createVaultDek();
    if (newDek === staged) {
      io.print("reusing staged DEK from an interrupted rotation");
    }
    persistKeys(
      dir,
      env,
      { ...ctx.keys, [VAULT_DEK_NEXT_ALIAS]: newDek },
      prompt
    );
    rotateVaultDek(dir, vault, { dek: cur, newDek, audit: ctx.audit });
    const { [VAULT_DEK_NEXT_ALIAS]: _staged, ...rest } = ctx.keys;
    void _staged;
    persistKeys(dir, env, { ...rest, [VAULT_DEK_ALIAS]: newDek }, prompt);
    io.print(`vault rekeyed at rev ${vault.loadedRevision()}`);
    return 0;
  }

  if (command === "audit") {
    if (flags["verify"] === true) {
      const valid = ctx.audit.verifyChain();
      if (!valid) {
        io.print("audit chain: BROKEN");
        return 1;
      }
      if (existsSync(join(dir, "personal-state.json"))) {
        try {
          loadVault(dir, { nowSec: now, keys: ctx.keys });
        } catch (err) {
          io.print(
            `vault freshness failed: ${err instanceof Error ? err.message : String(err)}`
          );
          return 1;
        }
      }
      io.print("audit chain: valid");
      return 0;
    }
    io.print("(use --verify to check the chain; entries live in audit.jsonl)");
    return 0;
  }

  if (command === "revoke") {
    const grant = opt(flags, "grant");
    const recipient = opt(flags, "recipient");
    if (grant !== undefined) {
      ctx.auth.revoke(grant);
      persistState(ctx);
      ctx.audit.append({
        actor: "operator",
        action: "revoke",
        authorityId: grant,
        authorityRev: ctx.auth.loadedRevision(),
        registryRev: ctx.reg.loadedRevision(),
      });
      io.print(`revoked grant ${grant}`);
      return 0;
    }
    if (recipient !== undefined) {
      ctx.reg.revoke(recipient);
      persistState(ctx);
      ctx.audit.append({
        actor: "operator",
        action: "revoke",
        detail: recipient,
        authorityRev: ctx.auth.loadedRevision(),
        registryRev: ctx.reg.loadedRevision(),
      });
      io.print(`revoked recipient ${recipient}`);
      return 0;
    }
    throw new Error("usage: revoke --grant ID | --recipient ALIAS");
  }

  throw new Error(`unreachable command: ${command}`);
}

/**
 * TTY passphrase prompt with echo disabled (ticket 04). Raw-mode byte loop
 * over fd 0; Ctrl-C aborts, Backspace edits, Enter submits. Anything
 * non-TTY throws with the env alternatives — never falls back to echoed
 * input, which would defeat the point. stdlib only, no new dependency.
 */
function ttyPromptHidden(question: string): string {
  const stdin = process.stdin;
  if (stdin.isTTY !== true || typeof stdin.setRawMode !== "function") {
    throw new Error(
      "keystore: no TTY to prompt on — set PTF_PASSPHRASE or PTF_PASSPHRASE_FILE"
    );
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  try {
    let out = "";
    const one = Buffer.alloc(1);
    for (;;) {
      const n = readSync(0, one, 0, 1, null);
      if (n === 0) continue;
      const ch = one[0] as number;
      if (ch === 13 || ch === 10) break; // Enter
      if (ch === 3) throw new Error("keystore: cancelled at prompt"); // Ctrl-C
      if (ch === 127 || ch === 8) {
        out = out.slice(0, -1);
        continue;
      }
      if (ch >= 32) out += String.fromCharCode(ch);
    }
    return out;
  } finally {
    stdin.setRawMode(false);
    process.stdout.write("\n");
  }
}

function ttyPromptPassphrase(): string {
  const pass = ttyPromptHidden("passphrase: ");
  if (pass.length === 0) throw new Error("keystore: passphrase required");
  return pass;
}

function main(): void {
  const io: CliIo = {
    readLine: () => readFileSync(0, "utf8").split("\n")[0]?.trim() ?? "",
    print: (line: string) => process.stdout.write(`${line}\n`),
    now: () => Math.floor(Date.now() / 1000),
  };
  const env: Record<string, string | undefined> = { ...process.env };
  run(process.argv.slice(2), io, env, {
    promptPassphrase: ttyPromptPassphrase,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(
        `${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
