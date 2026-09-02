# ADR-0005: Dependency-minimal Node sandbox profile

**Date**: 2026-09-02
**Status**: accepted
**Deciders**: Controller
**Requirements**: U-08, U-14–U-16, U-24; M0

## Context

The supplied repository has no code or declared dependencies, Node 22 is installed, and M0 needs a live web application, deterministic fixtures, real WebMCP registration, and fast runnable verification. A framework does not reduce the current domain/security work.

## Decision

Build the hosted synthetic M0 profile with Node 22 ECMAScript modules, native HTTP/crypto/test facilities, and browser-native HTML/CSS/JavaScript. Add no runtime dependency until a concrete capability cannot be implemented clearly with the platform. Keep trust-core modules independent of HTTP, DOM, WebMCP, and scenario vocabulary.

## Alternatives considered

- Next.js/React: strong product ecosystem and hosting, but adds framework/build/dependency surface before a component/state requirement exists.
- Vite/React SPA plus API: same current cost without a demonstrated UI need.
- Cloudflare-specific Worker stack: attractive deployment target but would let one host define core runtime interfaces.

## Security and trust effect

The initial supply-chain surface is small and behavior is directly inspectable. This does not make Node, a hosted process, or an in-memory/synthetic store production-secure.

## Operational effect

One `npm` command can run/test without installation. Static assets and API remain portable to a later host adapter.

## Test obligations

Native unit/integration tests, deterministic fixture reset, architecture lint, canary/adversarial suite, browser e2e, and judge-like WebMCP testing.

## Consequences and residual risks

UI ergonomics and production persistence are manual. If complexity grows, a framework may reduce total maintenance; migration stays outside trust-core modules.

## Revisit trigger

Accessibility/state complexity, deployment limits, or verified developer productivity costs exceed the framework's added maintenance and TCB.
