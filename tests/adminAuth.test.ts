import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { startServer } from '../server';
import { resolveAdminBootstrapPassword } from '../src/utils/adminAuth';

test('uses the configured Vercel password when provided', () => {
  assert.equal(resolveAdminBootstrapPassword({ ADMIN_BOOTSTRAP_PASSWORD: 'StrongSecret123' }), 'StrongSecret123');
});

test('falls back to a safe emergency value when the env var is missing', () => {
  assert.equal(resolveAdminBootstrapPassword({}), 'AnvationAdmin@2026!');
});

test('invalidates admin session after logout', async () => {
  const app = await startServer({ listen: false });
  const server = http.createServer(app);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  const request = (method: string, path: string, body?: Record<string, unknown>, cookies: string[] = []) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {})
    };

    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let chunk = '';
      res.on('data', (data) => { chunk += String(data); });
      res.on('end', () => {
        let parsed: any = {};
        try {
          parsed = chunk ? JSON.parse(chunk) : {};
        } catch {
          parsed = chunk;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  try {
    const login = await request('POST', '/api/admin-login', { identifier: 'test', password: 'AnvationAdmin@2026!' });
    assert.equal(login.status, 200, 'Admin login should succeed');
    const cookieHeader = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie'];
    assert.ok(cookieHeader, 'Admin login should set a session cookie');
    const cookie = String(cookieHeader).split(';')[0];

    const beforeLogout = await request('GET', '/api/session', undefined, [cookie]);
    assert.equal(beforeLogout.status, 200, 'Session lookup should succeed while logged in');
    assert.equal(beforeLogout.body.authenticated, true, 'Admin should be authenticated before logout');

    const logout = await request('POST', '/api/admin/logout', {}, [cookie]);
    assert.equal(logout.status, 200, 'Logout request should succeed');
    assert.equal(logout.body.success, true, 'Logout should return success');

    const afterLogout = await request('GET', '/api/session', undefined, [cookie]);
    assert.equal(afterLogout.body.authenticated, false, 'Expired admin cookie should not remain authenticated after logout');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
