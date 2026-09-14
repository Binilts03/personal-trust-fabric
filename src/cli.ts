#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Authority,
  Capabilities,
  Disclose,
  FakePaymentExecutor,
  FileAuditLog,
  RecipientRegistry,
  atomicWrite,
  claimsSubset,
  digestForOperation,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  loadAuthority,
  loadRegistry,
  openKeystore,
  parseDecision,
  paymentBounds,
  privateKeyFromPkcs8,
  publicKeyFromPrivate,
  rawPublicKey,
  readPassphrase,
  renderProposal,
  resealKeystore,
  saveAuthority,
  saveRegistry,
  sealKeystore,
  signBytes,
} from "./index.js";
import type {
  ActorSelector,
  AttributeBound,
  AuthorityOperation,
  AuthorityRequest,
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

const COMMANDS = [
  "init",
  "keygen",
  "rekey",
  "recipient",
  "grant",
  "pay",
  "disclose",
  "audit",
  "revoke",
  "help",
  "version",
] as const;

const BOOLEAN_FLAGS = new Set([
  "yes",
  "verify",
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
    "  grant --id ID --principal P --cmd /pay (--agent A | --actor-set a,b | --any-agent) [--amount-max N] [--currency C] [--allowed-claims a,b] [--exp-in S] [--max-uses N] [--purpose T] [--resource R] [--resource-type T] [--recipient R]",
    "         --any-agent is an explicit wildcard (audited, deliberate) — prefer --agent / --actor-set",
    "  pay --principal P --agent A --recipient R --amount N --currency C --resource R [--purpose T] [--yes]",
    "  disclose --holder H --verifier V --claims a,b --credential JSON [--allowed a,b] [--yes]",
    "  audit [--verify]                       verify hash chain (needs no passphrase)",
    "  revoke (--grant ID | --recipient ALIAS)",
    "  help                                   print this help",
    "",
    "env: PTF_PASSPHRASE (required for keygen/pay/disclose only; never passed as a flag)",
    "     alternatives: PTF_PASSPHRASE_FILE (0600 file, preferred over env), or an interactive TTY prompt",
    "examples:",
    "  PTF_PASSPHRASE=hunter2 ptf --dir ./ptf-store init",
    "  PTF_PASSPHRASE=hunter2 ptf keygen --alias you",
    "  ptf grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR",
    "  ptf grant --id g2 --principal you --cmd /pay --actor-set shopper,groceries --amount-max 2000 --currency INR",
    "  ptf grant --id g3 --principal you --cmd /pay --any-agent --amount-max 500 --currency INR",
    "  PTF_PASSPHRASE=hunter2 ptf pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes",
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
      "usage: ptf [--dir D] <init|keygen|recipient|grant|pay|disclose|audit|revoke> ..."
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
  recipient: new Set(["alias", "key"]),
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
  audit: new Set(["verify"]),
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
  opts: { promptPassphrase?: () => string } = {}
): Promise<number> {
  const { command, dir, flags } = parseArgs(argv);
  const now = () => io.now();
  const prompt = opts.promptPassphrase;

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

  const ctx = loadCtx(
    dir,
    env,
    now,
    command === "pay" || command === "disclose",
    prompt
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
    const capabilities = new Capabilities({
      resolveKey: (id: string) => ctx.reg.resolve(id),
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
    const redeemed = capabilities.authorize(
      [cap],
      {
        cmd: "/pay",
        args: { amount, currency },
        recipient,
        termsDigest: digest,
      },
      {
        consume: true,
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
      new FakePaymentExecutor(),
      {
        capabilityId: leafCidHex(cap),
        recipient,
        amount,
        currency,
        resource,
        purpose,
      },
      redeemed,
      now()
    );
    const cited = decision.allow
      ? decision.citations[0]?.authorityId
      : undefined;
    // Persist BEFORE audit: a crash between must not replay (authority
    // consumed + no receipt is safe; receipt + unconsumed is not — same
    // order as the MCP server). The entry stamps the post-save revisions
    // so a later file rollback fails the freshness check at load.
    persistState(ctx);
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

  if (command === "audit") {
    if (flags["verify"] === true) {
      const valid = ctx.audit.verifyChain();
      io.print(valid ? "audit chain: valid" : "audit chain: BROKEN");
      return valid ? 0 : 1;
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
