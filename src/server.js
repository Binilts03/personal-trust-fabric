import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSandbox } from './sandbox/fixtures.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(moduleDirectory, '..', 'public');
const staticFiles = new Map([
  ['/', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/webmcp.js', 'webmcp.js']
]);
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8']
]);

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new TypeError('request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function assertBodyFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('request body must be an object');
  }
  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) throw new TypeError(`unknown field: ${field}`);
  }
}

function getSessionToken(request) {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ptf_human_session='))
    ?.slice('ptf_human_session='.length);
}

function resolveHostedOrigin(request, allowedHosts) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(host)) {
    throw new Error('request host is not trusted');
  }
  const origin = new URL(`https://${host}`);
  const trusted = origin.hostname.endsWith('.vercel.app') || allowedHosts.has(origin.hostname);
  if (!trusted) throw new Error('request host is not trusted');
  return origin.origin;
}

function requireSession(request, sessions, { mutation = false, publicOrigin = null } = {}) {
  const session = sessions.get(getSessionToken(request));
  if (!session) throw new Error('browser session is required');
  if (!mutation) return session;
  const origin = request.headers.origin;
  if (!origin) throw new Error('same-origin Human action is required');
  const parsedOrigin = new URL(origin);
  const expectedOrigin = publicOrigin ? new URL(publicOrigin) : null;
  const localHost = ['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname);
  const allowedOrigin = expectedOrigin
    ? parsedOrigin.origin === expectedOrigin.origin && request.headers.host === expectedOrigin.host
    : localHost && parsedOrigin.host === request.headers.host;
  if (!allowedOrigin) {
    throw new Error('same-origin Human action is required');
  }
  if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
    throw new Error('cross-site Human action is not allowed');
  }
  return session;
}

async function sendStatic(response, requestPath) {
  const file = staticFiles.get(requestPath);
  if (!file) return false;
  const path = normalize(join(publicRoot, file));
  const metadata = await stat(path);
  response.writeHead(200, {
    'content-type': contentTypes.get(extname(path)) ?? 'application/octet-stream',
    'content-length': metadata.size,
    'cache-control': 'no-cache'
  });
  createReadStream(path).pipe(response);
  return true;
}

export function createAppHandler({
  publicOrigin = null,
  hosted = false,
  allowedHosts = [],
  sessions = new Map()
} = {}) {
  const parsedPublicOrigin = publicOrigin === null ? null : new URL(publicOrigin);
  if (parsedPublicOrigin !== null && parsedPublicOrigin.protocol !== 'https:') {
    throw new TypeError('PUBLIC_ORIGIN must use HTTPS');
  }
  const trustedHostedHosts = new Set(allowedHosts);

  function openSession(request) {
    const existingToken = getSessionToken(request);
    if (existingToken && sessions.has(existingToken)) {
      return { token: existingToken, session: sessions.get(existingToken) };
    }
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('base64url');
    const session = { sandbox: createSandbox(), operationRequests: 0 };
    sessions.set(token, session);
    return { token, session };
  }

  return async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('cross-origin-resource-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const url = new URL(request.url, 'http://ptf.local');

    try {
      const requestPublicOrigin = parsedPublicOrigin?.origin ?? (
        hosted ? resolveHostedOrigin(request, trustedHostedHosts) : null
      );
      if (request.method === 'GET' && url.pathname === '/api/session') {
        const { token, session } = openSession(request);
        const secure = requestPublicOrigin ? '; Secure' : '';
        response.setHeader(
          'set-cookie',
          `ptf_human_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure}`
        );
        return sendJson(response, 200, session.sandbox.state());
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const session = requireSession(request, sessions);
        return sendJson(response, 200, session.sandbox.state());
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-view') {
        const session = requireSession(request, sessions);
        const { assuranceLabel, safeView } = session.sandbox.state();
        return sendJson(response, 200, { assuranceLabel, safeView });
      }
      if (request.method === 'POST' && url.pathname === '/api/reset') {
        const session = requireSession(request, sessions, { mutation: true, publicOrigin: requestPublicOrigin });
        assertBodyFields(await readJson(request), []);
        session.sandbox = createSandbox();
        session.operationRequests = 0;
        return sendJson(response, 200, session.sandbox.state());
      }
      if (request.method === 'POST' && url.pathname === '/api/operations/request') {
        const session = requireSession(request, sessions);
        if (session.operationRequests >= 100) throw new TypeError('sandbox request limit reached; reset sandbox');
        session.operationRequests += 1;
        return sendJson(response, 200, session.sandbox.request(await readJson(request)));
      }
      const approval = url.pathname.match(/^\/api\/approvals\/([A-Za-z0-9_-]+)$/);
      if (request.method === 'POST' && approval) {
        const session = requireSession(request, sessions, { mutation: true, publicOrigin: requestPublicOrigin });
        const body = await readJson(request);
        assertBodyFields(body, ['decision']);
        return sendJson(response, 200, await session.sandbox.decide(approval[1], body.decision));
      }
      const correction = url.pathname.match(/^\/api\/persona\/([A-Za-z0-9_-]+)\/correct$/);
      if (request.method === 'POST' && correction) {
        const session = requireSession(request, sessions, { mutation: true, publicOrigin: requestPublicOrigin });
        return sendJson(response, 200, session.sandbox.correctPersona(correction[1], await readJson(request)));
      }
      if (request.method === 'GET' && url.pathname === '/') {
        const { token } = openSession(request);
        const secure = requestPublicOrigin ? '; Secure' : '';
        response.setHeader(
          'set-cookie',
          `ptf_human_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure}`
        );
      }
      if (request.method === 'GET' && (await sendStatic(response, url.pathname))) return;
      return sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      const conflict = error.message === 'approval is not pending';
      const clientError = error instanceof TypeError || error instanceof SyntaxError;
      return sendJson(response, conflict ? 409 : clientError ? 400 : 403, {
        error: conflict
          ? 'approval is not pending'
          : clientError
            ? error.message
            : 'request is not authorized'
      });
    }
  };
}

export function createAppServer(options) {
  return createServer(createAppHandler(options));
}

let vercelHandler;

export default function handleVercelRequest(request, response) {
  vercelHandler ??= createAppHandler({
    hosted: true,
    allowedHosts: (process.env.PTF_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean)
  });
  return vercelHandler(request, response);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? null;
  if (!['127.0.0.1', 'localhost'].includes(host) && !publicOrigin) {
    throw new Error('PUBLIC_ORIGIN is required when binding beyond loopback');
  }
  createAppServer({ publicOrigin }).listen(port, host, () => console.log(`PTF synthetic sandbox listening on ${publicOrigin ?? `http://${host}:${port}`}`));
}
