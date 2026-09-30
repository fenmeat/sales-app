import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

function database(count = 5) {
  return { prepare(sql) {
    assert.match(sql, /^SELECT COUNT\(\*\) AS table_count FROM sqlite_master/);
    return { bind(...tables) {
      assert.deepEqual(tables, ['products', 'routes', 'route_runs', 'route_run_items', 'cash_ups']);
      return { first: async () => ({ table_count: count }) };
    }};
  }};
}
const request = (path = '/api/health', method = 'GET') => new Request(`https://test.example${path}`, { method });

test('health checks only schema metadata and never says the sales app is ready', async () => {
  const response = await worker.fetch(request(), { APP_ENV: 'test', DB: database() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { environment: 'test', sales_app_ready: false, database: 'connected', core_tables_ready: true });
});
test('missing tables are reported as incomplete', async () => {
  const response = await worker.fetch(request(), { APP_ENV: 'test', DB: database(4) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).core_tables_ready, false);
});
test('missing binding and database failure do not pretend to be ready or leak errors', async () => {
  const absent = await worker.fetch(request(), { APP_ENV: 'test' });
  assert.equal(absent.status, 503);
  assert.equal((await absent.json()).database, 'not_bound');
  const failed = await worker.fetch(request(), { APP_ENV: 'test', DB: { prepare() { throw Error('sensitive-internal-error'); } } });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).database, 'unavailable');
});
test('all mutation methods and business-data paths remain unavailable', async () => {
  const env = { APP_ENV: 'test', DB: { prepare() { assert.fail('database must not be touched'); } } };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await worker.fetch(request('/api/health', method), env)).status, 405);
  for (const path of ['/api/products', '/api/cash_ups', '/core.js', '/wrangler.jsonc', '/src/worker.js']) assert.equal((await worker.fetch(request(path), env)).status, 404);
});
test('deployment must be explicitly configured as test', async () => {
  assert.equal((await worker.fetch(request(), { APP_ENV: 'production', DB: database() })).status, 503);
});
test('HEAD omits a body and setup assets receive security headers', async () => {
  const head = await worker.fetch(request('/api/health', 'HEAD'), { APP_ENV: 'test', DB: database() });
  assert.equal(await head.text(), '');
  const page = await worker.fetch(request('/'), { APP_ENV: 'test', ASSETS: { fetch: async () => new Response('setup page') } });
  assert.equal(await page.text(), 'setup page');
  assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
  assert.match(page.headers.get('Content-Security-Policy'), /default-src 'self'/);
});
