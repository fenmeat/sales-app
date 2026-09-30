// Deployment foundation only. Business data and write endpoints stay disabled
// until authentication, audit logging and the operational workflows are ready.
const CORE_TABLES = ['products', 'routes', 'route_runs', 'route_run_items', 'cash_ups'];
const PUBLIC_ASSETS = new Set(['/', '/index.html', '/app.js', '/styles.css']);

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: SECURITY_HEADERS });
}

async function databaseHealth(env) {
  const common = { environment: 'test', sales_app_ready: false };
  if (!env.DB) return json({ ...common, database: 'not_bound', core_tables_ready: false }, 503);
  try {
    const placeholders = CORE_TABLES.map(() => '?').join(', ');
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
    ).bind(...CORE_TABLES).first();
    const complete = Number(row?.table_count) === CORE_TABLES.length;
    return json({ ...common, database: 'connected', core_tables_ready: complete }, complete ? 200 : 503);
  } catch {
    // Never expose database errors, identifiers or contents to a public request.
    return json({ ...common, database: 'unavailable', core_tables_ready: false }, 503);
  }
}

export default {
  async fetch(request, env) {
    if (env.APP_ENV !== 'test') return json({ error: 'Test environment is not configured.' }, 503);
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'This setup build does not accept data changes.' }, 405);
    }
    let response;
    if (path === '/api/health') {
      response = await databaseHealth(env);
    } else if (PUBLIC_ASSETS.has(path) && env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      response = new Response(asset.body, asset);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    } else {
      response = json({ error: 'Not found.' }, 404);
    }
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  }
};
