import { createAppHandler } from '../src/server.js';

const handlerKey = Symbol.for('ptf.vercel.handler');

if (!globalThis[handlerKey]) {
  if (!process.env.VERCEL_URL) throw new Error('VERCEL_URL is required');
  globalThis[handlerKey] = createAppHandler({
    publicOrigin: `https://${process.env.VERCEL_URL}`
  });
}

export default globalThis[handlerKey];
