# ADR 0004 — Plural Custody and Protected Executors

Status: Accepted  
Date: 2026-09-03

## Context

PTF's core promise depends on reducing unnecessary Agent possession of protected resources, but no single custody topology is suitable for every resource or deployment. A central PTF vault would place the service/operator inside a very large trusted computing base; a strict local-only model would make remote Agents, enterprise infrastructure, multi-device use, and existing wallets/providers difficult or impossible. Encryption at rest alone also does not establish runtime/operator non-possession when the same runtime holds the decryption key.

## Decision

PTF uses **plural custody**.

A Protected Resource is a logical object whose plaintext/key material may be held by an external provider, Principal device, customer-controlled runtime, managed PTF runtime, or attested-confidential runtime.

PTF invokes resources through narrow **Protected Executors** that prefer bounded operations such as sign, authenticate, prove, present, authorize-payment, disclose-approved-claims, or execute-account-action instead of generic secret/key extraction.

A ProtectedResourceRef identifies a resource but provides no bearer authority.

Every execution profile explicitly states which processes/parties can access plaintext or usable key material and which are inside the trusted computing base.

The Control Runtime and Protected Execution Domain may run in different physical or administrative locations.

## Consequences

- PTF need not copy credentials or payment instruments from existing wallets/providers merely to broker their use.
- Managed-cloud operation can honestly claim model/Agent non-possession without falsely claiming operator non-possession.
- Confidential computing may strengthen selected hosted profiles but is not a universal dependency.
- Recovery is profile/resource-specific and may require re-enrolment or reissuance rather than restoration of every key.
- Protected Executors are higher-trust modules with narrow interfaces and must validate the Execution Grant/Plan required by their topology.
- Key non-exportability does not eliminate the need for transaction/purpose/recipient authorization around key use.
