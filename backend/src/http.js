const http = require('node:http');
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

class Reply {
  constructor(status, body, headers = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const created = (body) => new Reply(201, body);
const binary = (buffer, contentType) =>
  new Reply(200, buffer, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' });

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const source = pattern.replace(/:([A-Za-z_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (m) {
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

async function readJson(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'El cuerpo de la petición es demasiado grande');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function tokenMatches(received, expected) {
  const a = Buffer.from(String(received ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, reply) {
  const isBinary = Buffer.isBuffer(reply.body);
  const payload = isBinary ? reply.body : Buffer.from(JSON.stringify(reply.body ?? {}), 'utf8');
  res.writeHead(reply.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    ...reply.headers,
  });
  res.end(payload);
}

function createServer(router, { cfg }) {
  return http.createServer(async (req, res) => {
    // CORS abierto para desarrollo (Expo Web en Mac/Windows). En producción, limite el origen.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      const url = new URL(req.url, 'http://localhost');
      const isPublic = url.pathname === '/api/health';
      if (cfg.adminToken && url.pathname.startsWith('/api/') && !isPublic && !tokenMatches(req.headers['x-api-key'], cfg.adminToken)) {
        throw new HttpError(401, 'No autorizado');
      }
      const found = router.match(req.method, url.pathname);
      if (!found) throw new HttpError(404, 'Ruta no encontrada');

      const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
      const body = hasBody ? await readJson(req, cfg.maxBodyMb * 1024 * 1024) : {};
      const out = await found.handler({ params: found.params, query: Object.fromEntries(url.searchParams), body });
      return send(res, out instanceof Reply ? out : new Reply(200, out ?? {}));
    } catch (err) {
      if (err instanceof HttpError) {
        return send(res, new Reply(err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) }));
      }
      console.error('[error]', err);
      return send(res, new Reply(500, { error: 'Error interno del servidor' }));
    }
  });
}

module.exports = { HttpError, Reply, Router, created, binary, createServer };
