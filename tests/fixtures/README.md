# TEST-ONLY TLS fixtures — INSECURE, NEVER PRODUCTION

#

# `test-only-insecure-key.pem` + `test-only-insecure-cert.pem` are a

# self-signed pair (CN=127.0.0.1, SAN IP:127.0.0.1/DNS:localhost) committed

# ONLY so `tests/pdp-prod.test.ts` can run where `openssl` is absent from

# PATH (no CA, no chain, private key is public by construction).

#

# The test prefers generating a fresh CA + server cert to tmp at runtime when

# `openssl` is available and verifies against that CA

# (`rejectUnauthorized:true`); these fixtures are the fallback path, used

# with `rejectUnauthorized:false` documented test-only in the test file.

# Never copy them into any server config, image, or deployment.
