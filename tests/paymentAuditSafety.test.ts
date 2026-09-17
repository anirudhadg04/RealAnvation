import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const serverAst = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const helperNames = ['applyAuditDecision', 'persistAuditDecision', 'currentStoredTeam', 'isRejectedTeam', 'allowParticipantSession'] as const;
type Decision = 'APPROVED' | 'REJECTED';
type TeamRecord = Record<string, any>;

function descendants(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const matches: ts.Node[] = [];
  function visit(current: ts.Node) {
    if (predicate(current)) matches.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return matches;
}

function declaration(name: string): ts.FunctionDeclaration {
  const matches = descendants(serverAst, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1, `Expected exactly one named function declaration: ${name}`);
  return matches[0] as ts.FunctionDeclaration;
}

function evaluate(source: string, dependencies: Record<string, unknown>) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) || [];
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => '',
    getNewLine: () => '\n',
  }));
  const context = vm.createContext(dependencies, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(result.outputText, { filename: 'isolated-payment-audit.js' }).runInContext(context, { timeout: 1000 });
  return context;
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function response() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = snapshot(body); return this; },
  };
}

function fixture(overrides: TeamRecord = {}): TeamRecord {
  return {
    id: 'AN-042',
    regNumber: 'REG-0042',
    teamName: 'Audit safety fixture',
    status: 'PENDING',
    approvalStatus: 'PENDING',
    paymentStatus: 'Pending',
    leaderEmail: 'leader@example.invalid',
    leaderPhone: '0000000000',
    members: [
      { id: 'member-1', fullName: 'Test Leader', email: 'leader@example.invalid', usn: 'TEST001', isLeader: true },
      { id: 'member-2', fullName: 'Test Member', email: 'member@example.invalid', usn: 'TEST002', college: 'Test College' },
    ],
    paymentUtr: '123456789012',
    paymentScreenshot: 'data:image/png;base64,cGF5bWVudA==',
    paymentAmount: 500,
    paymentDate: '2026-09-01T10:00:00.000Z',
    transactionId: 'fixture-transaction',
    accessPassword: 'pbkdf2_sha256$fixture-salt$fixture-hash',
    portalPasswordPlain: 'fixture-portal-password',
    teamQrCode: 'data:image/png;base64,ZXhpc3RpbmctcXI=',
    registrationDate: '2026-08-31T10:00:00.000Z',
    domain: 'Software',
    checkInStatus: false,
    checkpoints: { gate: false },
    customMetadata: { retained: ['registration', 'payment', 'participants'] },
    ...overrides,
  };
}

function harness(initial: TeamRecord, options: { persistenceFails?: boolean; production?: boolean; lostRace?: boolean } = {}) {
  const teams = [snapshot(initial)];
  const auditLogs: any[] = [];
  const auditDecisions = new Set<string>();
  const calls = { writes: 0, dirty: 0, passwords: 0, hashes: 0, qr: 0, mail: 0, productionReads: 0, cas: 0 };
  const persisted: TeamRecord[][] = [];
  const mails: { team: TeamRecord; persisted: TeamRecord[][] }[] = [];
  const casAttempts: { previous: TeamRecord; patch: TeamRecord }[] = [];
  let productionTeam = snapshot(initial);
  const context = evaluate(helperNames.map(name => declaration(name).getText(serverAst)).join('\n'), {
    teams,
    productionStoreEnabled: options.production ?? false,
    persistNow: () => {
      calls.writes++;
      if (options.persistenceFails) return false;
      persisted.push(snapshot(teams));
      return true;
    },
    auditDecisions,
    QRCode: { toDataURL: async (id: string) => { calls.qr++; return `fixture-qr:${id}`; } },
    hashPassword: (password: string) => { calls.hashes++; return `fixture-hash:${password}`; },
    generatePortalPassword: () => { calls.passwords++; return `generated-fixture-password-${calls.passwords}`; },
    sendApprovalEmail: async (team: TeamRecord) => {
      calls.mail++;
      mails.push({ team: snapshot(team), persisted: snapshot(persisted) });
    },
    auditLogs,
    markDirty: () => { calls.dirty++; },
    sanitizeTeamForClient: (team: TeamRecord) => {
      const { accessPassword, portalPasswordPlain, ...safe } = team;
      return safe;
    },
    getClientIp: () => '192.0.2.1',
    rejectedPortalMessage: 'Fixture team rejected.',
    getProductionTeam: async (id: string) => {
      calls.productionReads++;
      return productionTeam.id.toLowerCase() === id.toLowerCase() ? snapshot(productionTeam) : undefined;
    },
    updateProductionTeamAudit: async (previous: TeamRecord, patch: TeamRecord) => {
      calls.cas++;
      casAttempts.push(snapshot({ previous, patch }));
      if (options.lostRace) {
        productionTeam = { ...productionTeam, status: 'REJECTED', approvalStatus: 'REJECTED' };
        return undefined;
      }
      productionTeam = { ...productionTeam, ...patch };
      return snapshot(productionTeam);
    },
    console: { error: () => {} },
  });
  return {
    teams, auditLogs, auditDecisions, calls, persisted, mails, casAttempts,
    async decide(decision: Decision, identifier = initial.id, legacy = false) {
      const res = response();
      await context.applyAuditDecision({
        params: legacy ? {} : { teamId: identifier },
        body: { teamId: identifier, reason: 'Fixture rejection reason' },
        session: { email: 'admin@example.invalid', role: 'ADMIN' },
      }, res, decision);
      return res;
    },
    async session(teamId = initial.id) {
      const res = response();
      const allowed = await context.allowParticipantSession({ user: { type: 'participant', teamId } }, res);
      return { allowed, res };
    },
  };
}

function withoutDecisionStatus(team: TeamRecord) {
  const { status, approvalStatus, ...rest } = snapshot(team);
  return rest;
}

function assertNoGeneratorsOrMail(calls: ReturnType<typeof harness>['calls']) {
  assert.equal(calls.passwords, 0);
  assert.equal(calls.hashes, 0);
  assert.equal(calls.qr, 0);
  assert.equal(calls.mail, 0);
}

test('A: approval and canonical/legacy retries preserve existing identity, credentials and QR; email once after persistence', async () => {
  const initial = fixture();
  const h = harness(initial);
  const approved = await h.decide('APPROVED', initial.regNumber.toLowerCase(), true);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.success, true);
  assert.equal(h.teams[0].status, 'APPROVED');
  assert.equal(h.teams[0].approvalStatus, 'APPROVED');
  assert.equal(h.teams[0].paymentStatus, 'PAYMENT_APPROVED');
  for (const key of ['id', 'regNumber', 'accessPassword', 'portalPasswordPlain', 'teamQrCode', 'members', 'paymentUtr', 'paymentScreenshot']) {
    assert.deepEqual(snapshot(h.teams[0][key]), initial[key], key);
  }
  assert.equal(h.calls.passwords + h.calls.hashes + h.calls.qr, 0);
  assert.equal(h.calls.mail, 1);
  assert.equal(h.mails[0].team.id, initial.id);
  assert.equal(h.mails[0].team.accessPassword, initial.accessPassword);
  assert.equal(h.mails[0].persisted.length, 1);
  assert.equal(h.mails[0].persisted[0][0].approvalStatus, 'APPROVED');
  assert.equal(h.teams[0].approvalEmailStatus, 'SENT');
  assert.ok(h.teams[0].approvalEmailSentAt);
  assert.equal(h.calls.writes, 2);
  assert.equal(h.auditLogs.length, 1);
  assert.equal(h.auditLogs[0].action, 'Team Approve');
  const saved = snapshot(h.teams);
  const counts = { ...h.calls };
  for (const [identifier, legacy] of [[initial.id.toLowerCase(), false], [initial.regNumber, true]] as const) {
    const retry = await h.decide('APPROVED', identifier, legacy);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.alreadyApproved, true);
  }
  assert.deepEqual(snapshot(h.teams), saved);
  assert.deepEqual(h.calls, counts);
  assert.equal(h.auditLogs.length, 1);
  assert.equal(h.auditDecisions.size, 0);
  assert.equal((await h.session()).allowed, true);
});

test('A: missing credentials and QR are generated for the canonical ID only once', async () => {
  const initial = fixture();
  delete initial.accessPassword;
  delete initial.portalPasswordPlain;
  delete initial.teamQrCode;
  const h = harness(initial);
  assert.equal((await h.decide('APPROVED', initial.regNumber, true)).statusCode, 200);
  assert.equal(h.teams[0].id, initial.id);
  assert.equal(h.teams[0].portalPasswordPlain, 'generated-fixture-password-1');
  assert.equal(h.teams[0].accessPassword, 'fixture-hash:generated-fixture-password-1');
  assert.equal(h.teams[0].teamQrCode, `fixture-qr:${initial.id}`);
  assert.equal(h.calls.passwords, 1);
  assert.equal(h.calls.hashes, 1);
  assert.equal(h.calls.qr, 1);
  assert.equal(h.calls.mail, 1);
  const saved = snapshot(h.teams);
  const counts = { ...h.calls };
  assert.equal((await h.decide('APPROVED')).body.alreadyApproved, true);
  assert.deepEqual(snapshot(h.teams), saved);
  assert.deepEqual(h.calls, counts);
});

for (const previouslyApproved of [false, true]) {
  test(`B: rejecting ${previouslyApproved ? 'previously approved' : 'pending'} team preserves every non-decision-status field and denies its session`, async () => {
    const initial = fixture(previouslyApproved ? {
      status: 'APPROVED', approvalStatus: 'APPROVED', paymentStatus: 'PAYMENT_APPROVED',
      approvalTimestamp: '2026-09-01T11:00:00.000Z', approvalEmailStatus: 'SENT', approvalEmailSentAt: '2026-09-01T11:00:01.000Z',
    } : {});
    const h = harness(initial);
    assert.equal((await h.session()).allowed, true);
    const rejected = await h.decide('REJECTED');
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.body.success, true);
    assert.equal(h.teams.length, 1);
    assert.equal(h.teams[0].status, 'REJECTED');
    assert.equal(h.teams[0].approvalStatus, 'REJECTED');
    assert.deepEqual(withoutDecisionStatus(h.teams[0]), withoutDecisionStatus(initial));
    assert.deepEqual(h.persisted, [snapshot(h.teams)]);
    assert.equal(h.calls.writes, 1);
    assert.equal(h.calls.dirty, 1);
    assertNoGeneratorsOrMail(h.calls);
    assert.equal(h.auditLogs.length, 1);
    assert.equal(h.auditLogs[0].action, 'Team Reject');
    const session = await h.session(initial.id.toLowerCase());
    assert.equal(session.allowed, false);
    assert.equal(session.res.statusCode, 403);
    assert.equal(session.res.body.code, 'TEAM_REJECTED');
    assert.equal(session.res.body.error, 'Fixture team rejected.');
    assert.equal(h.auditDecisions.size, 0);
  });
}

test('C: repeated rejection has zero additional writes, generation or mail and reapproval returns 409', async () => {
  const h = harness(fixture());
  assert.equal((await h.decide('REJECTED')).statusCode, 200);
  const saved = snapshot(h.teams);
  const logs = snapshot(h.auditLogs);
  const counts = { ...h.calls };
  const retry = await h.decide('REJECTED', 'reg-0042', true);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.alreadyRejected, true);
  const reapprove = await h.decide('APPROVED', 'an-042');
  assert.equal(reapprove.statusCode, 409);
  assert.equal(reapprove.body.success, false);
  assert.deepEqual(snapshot(h.teams), saved);
  assert.deepEqual(snapshot(h.auditLogs), logs);
  assert.deepEqual(h.calls, counts);
  assertNoGeneratorsOrMail(h.calls);
  assert.equal(h.auditDecisions.size, 0);
});

for (const statusField of ['status', 'approvalStatus', 'paymentStatus']) {
  test(`legacy rejection in ${statusField} denies participant access and blocks approval without writes`, async () => {
    const initial = fixture({ [statusField]: 'Rejected' });
    const h = harness(initial);
    assert.equal((await h.session()).allowed, false);
    assert.equal((await h.decide('APPROVED')).statusCode, 409);
    assert.equal((await h.decide('REJECTED')).body.alreadyRejected, true);
    assert.deepEqual(snapshot(h.teams), [initial]);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.dirty, 0);
    assert.equal(h.auditLogs.length, 0);
    assertNoGeneratorsOrMail(h.calls);
  });
}

for (const decision of ['APPROVED', 'REJECTED'] as const) {
  test(`persistence failure rolls back ${decision} and sends no mail`, async () => {
    const initial = fixture();
    const h = harness(initial, { persistenceFails: true });
    const original = h.teams[0];
    const failed = await h.decide(decision);
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.body.success, false);
    assert.equal(h.teams[0], original);
    assert.deepEqual(snapshot(h.teams), [initial]);
    assert.equal(h.calls.writes, 1);
    assert.equal(h.persisted.length, 0);
    assert.equal(h.calls.dirty, 0);
    assert.equal(h.auditLogs.length, 0);
    assertNoGeneratorsOrMail(h.calls);
    assert.equal(h.auditDecisions.size, 0);
  });

  test(`mocked production CAS lost race returns 409 for ${decision} without local mutation or mail`, async () => {
    const initial = fixture();
    const h = harness(initial, { production: true, lostRace: true });
    const failed = await h.decide(decision);
    assert.equal(failed.statusCode, 409);
    assert.equal(failed.body.success, false);
    assert.equal(h.calls.productionReads, 1);
    assert.equal(h.calls.cas, 1);
    assert.equal(h.casAttempts[0].previous.id, initial.id);
    assert.equal(h.casAttempts[0].patch.approvalStatus, decision);
    assert.deepEqual(snapshot(h.teams), [initial]);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.dirty, 0);
    assert.equal(h.auditLogs.length, 0);
    assertNoGeneratorsOrMail(h.calls);
    assert.equal(h.auditDecisions.size, 0);
    const session = await h.session();
    assert.equal(session.allowed, false);
    assert.equal(session.res.statusCode, 403);
  });
}

test('audit helpers contain no record deletion, team filtering/splicing or identity/participant replacement', () => {
  const protectedProperties = new Set(['id', 'regNumber', 'members', 'participants', 'leaderEmail', 'paymentUtr', 'paymentScreenshot']);
  for (const name of ['applyAuditDecision', 'persistAuditDecision']) {
    const fn = declaration(name);
    const destructive = descendants(fn, node => {
      if (ts.isDeleteExpression(node)) return true;
      if (ts.isCallExpression(node)) {
        const target = node.expression.getText(serverAst);
        if (/deleteProductionTeam|deleteTeam|removeTeam|unlink|writeFile|execSync/.test(target)) return true;
        if (/^(teams|team\.members|team\.participants)\.(filter|splice|pop|shift)$/.test(target)) return true;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (ts.isIdentifier(node.left) && node.left.text === 'teams') return true;
        if (ts.isPropertyAccessExpression(node.left) && protectedProperties.has(node.left.name.text)) return true;
      }
      return false;
    });
    assert.deepEqual(destructive.map(node => node.getText(serverAst)), [], `${name} must remain non-destructive`);
  }
});

test('canonical approve/reject and legacy verification routes delegate to the shared audit helper', async () => {
  const paths = ['/api/admin/teams/:teamId/approve', '/api/admin/teams/:teamId/reject', '/api/finance/verify-utr'];
  const routes = descendants(serverAst, node => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(serverAst) === 'app'
    && node.expression.name.text === 'post'
    && !!node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && paths.includes(node.arguments[0].text)) as ts.CallExpression[];
  const registered = new Map<string, ((...args: any[]) => any)[]>();
  const calls: { req: any; res: any; decision: Decision }[] = [];
  const requireAdmin = () => {};
  assert.equal(routes.length, 3);
  for (const path of paths) {
    assert.equal(routes.filter(route => (route.arguments[0] as ts.StringLiteral).text === path).length, 1);
  }
  for (const route of routes) {
    assert.equal(descendants(route, node => ts.isCallExpression(node) && node.expression.getText(serverAst) === 'applyAuditDecision').length, 1);
  }
  evaluate(routes.map(route => `${route.getText(serverAst)};`).join('\n'), {
    app: { post: (path: string, ...handlers: ((...args: any[]) => any)[]) => registered.set(path, handlers) },
    requireAdmin,
    applyAuditDecision: (req: any, res: any, decision: Decision) => { calls.push({ req, res, decision }); return res.json({ success: true }); },
  });
  for (const [path, paymentStatus, decision] of [
    [paths[0], undefined, 'APPROVED'],
    [paths[1], undefined, 'REJECTED'],
    [paths[2], 'Verified', 'APPROVED'],
    [paths[2], 'Rejected', 'REJECTED'],
  ] as const) {
    const handlers = registered.get(path)!;
    assert.equal(handlers[0], requireAdmin);
    const req = { params: { teamId: 'AN-042' }, body: { teamId: 'AN-042', paymentStatus } };
    const res = response();
    await handlers.at(-1)!(req, res);
    assert.equal(calls.at(-1)?.decision, decision);
    assert.equal(calls.at(-1)?.req, req);
    assert.equal(calls.at(-1)?.res, res);
  }
  assert.equal(calls.length, 4);
  const invalid = response();
  await registered.get(paths[2])!.at(-1)!({ params: {}, body: { paymentStatus: 'Pending' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 4);
});

test('payment ledger maps all teams and retains View Participants for every row', () => {
  const ui = readFileSync(new URL('../src/components/AdminPortal.tsx', import.meta.url), 'utf8');
  const start = ui.indexOf('Team Payment Audit Ledger');
  assert.notEqual(start, -1, 'Payment audit ledger heading must remain present');
  const end = ui.indexOf('</table>', start);
  assert.ok(end > start);
  const ledger = ui.slice(start, end);
  assert.match(ledger, /\{\s*teams\.map\s*\(/);
  assert.doesNotMatch(ledger, /teams\.filter\s*\(/);
  assert.match(ledger, /View Participants/);
  assert.match(ledger, /onClick=\{\(\)\s*=>\s*setSelectedLedgerTeam\(t\)\}/);
  assert.match(ledger, /t\.members/);
  const ast = ts.createSourceFile('AdminPortal.tsx', ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rows = descendants(ast, node => ts.isCallExpression(node)
    && node.expression.getText(ast) === 'teams.map'
    && node.getText(ast).includes('View Participants'));
  assert.equal(rows.length, 1, 'View Participants must be inside the unfiltered teams.map row');
});
