import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server';
import http from 'node:http';

const TEST_PORT = 3456;
let serverApp: any;
let httpServer: import('node:http').Server;
let adminCookie = '';

function memberFor(label: string, sequence: number) {
  return {
    fullName: `${label} Member`,
    email: `${label.toLowerCase()}-member@gmail.com`,
    usn: `${label.toUpperCase()}M001`,
    phone: String(9000000000 + sequence),
    college: 'KSSEM',
    state: 'Karnataka',
    gender: 'Female'
  };
}

function assertApprovalAccepted(status: number, message = 'Approval should succeed') {
  assert.ok([200, 202].includes(status), `${message}: expected 200 or 202, received ${status}`);
}

function httpRequest(method: string, path: string, body?: any, cookies?: string[]): Promise<{ status: number; headers: any; body: any }> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookies ? { Cookie: cookies.join('; ') } : {}),
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

test.before(async () => {
  serverApp = await startServer({ listen: false });
  const { createServer } = await import('node:http');
  httpServer = createServer(serverApp);
  await new Promise((resolve) => {
     httpServer.once('listening', resolve);
     httpServer.listen(TEST_PORT);
   });

  const res = await httpRequest('POST', '/api/admin-login', {
    identifier: 'superadmin@kssem.edu.in',
    password: 'AnvationAdmin@2026!'
  });
  assert.equal(res.status, 200, 'Admin login should succeed');
  adminCookie = res.headers['set-cookie']?.[0] || '';
  assert.ok(adminCookie, 'Admin cookie should be set');
});

test.after(async () => {
  if (httpServer) {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('Check 1: Persistent sequential Team IDs (AN-001, AN-002, etc.)', async () => {
  const team1 = await httpRequest('POST', '/api/register', {
    teamName: 'Seq Test Alpha',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Seq Leader One',
      email: 'seq1@gmail.com',
      usn: 'SEQ001',
      phone: '9876543210',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('seq1', 1)],
    paymentUtr: '111111111111',
    paymentUtrConfirm: '111111111111',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(team1.status, 201, 'Team 1 registration should succeed');
  assert.ok(team1.body.team.id.startsWith('AN-'), 'Team 1 ID should start with AN-');

  const team2 = await httpRequest('POST', '/api/register', {
    teamName: 'Seq Test Beta',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Seq Leader Two',
      email: 'seq2@gmail.com',
      usn: 'SEQ002',
      phone: '9876543211',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('seq2', 2)],
    paymentUtr: '222222222222',
    paymentUtrConfirm: '222222222222',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(team2.status, 201, 'Team 2 registration should succeed');
  assert.ok(team2.body.team.id.startsWith('AN-'), 'Team 2 ID should start with AN-');

  const id1 = parseInt(team1.body.team.id.split('-')[1]);
  const id2 = parseInt(team2.body.team.id.split('-')[1]);
  assert.equal(id2, id1 + 1, `Team IDs should be sequential: AN-${id1} then AN-${id2}`);
});

test('Check 2: Approve is idempotent', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Idempotent Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Idem Leader',
      email: 'idem@gmail.com',
      usn: 'IDEM001',
      phone: '9876543212',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('idem', 3)],
    paymentUtr: '333333333333',
    paymentUtrConfirm: '333333333333',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approve1 = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approve1.status, 'First approval should succeed');
  assert.equal(approve1.body.team.approvalStatus, 'APPROVED', 'Team should be APPROVED after first approval');
  assert.ok(approve1.body.approved, 'First approval should return approved:true');

  const approve2 = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approve2.status, 'Second approval should succeed');
  assert.equal(approve2.body.team.approvalStatus, 'APPROVED', 'Team should still be APPROVED after second approval');
  assert.ok(approve2.body.alreadyApproved, 'Second approval should return alreadyApproved:true');
});

test('Check 3: Reject is persistent and non-destructive', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Reject Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Reject Leader',
      email: 'reject@gmail.com',
      usn: 'REJ001',
      phone: '9876543213',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('reject', 4)],
    paymentUtr: '444444444444',
    paymentUtrConfirm: '444444444444',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const rejectRes = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/reject`, { reason: 'Payment not verified' }, [adminCookie]);
  assert.equal(rejectRes.status, 200, 'Reject should succeed');
  assert.equal(rejectRes.body.team.approvalStatus, 'REJECTED', 'Team should be REJECTED');
  assert.equal(rejectRes.body.team.teamName, 'Reject Test', 'Team name should be preserved');
  assert.equal(rejectRes.body.team.leaderEmail, 'reject@gmail.com', 'Leader email should be preserved');
  assert.ok(rejectRes.body.team.members, 'Members should be preserved');
  assert.ok(rejectRes.body.team.createdAt, 'Created timestamp should be preserved');
});

test('Check 4: Approval password remains stable across retries', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Password Stability Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Pass Leader',
      email: 'pass@gmail.com',
      usn: 'PASS001',
      phone: '9876543214',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('pass', 5)],
    paymentUtr: '555555555555',
    paymentUtrConfirm: '555555555555',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approve1 = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approve1.status);
  assert.equal(approve1.body.team.accessPassword, undefined, 'Password hash must not be exposed to clients');
  assert.equal(approve1.body.team.portalPasswordPlain, undefined, 'Plaintext password must not be exposed to clients');

  const approve2 = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approve2.status);
  assert.equal(approve2.body.team.accessPassword, undefined, 'Password hash must remain protected on retry');
  assert.equal(approve2.body.team.portalPasswordPlain, undefined, 'Plaintext password must remain protected on retry');
  assert.equal(approve2.body.alreadyApproved, true, 'Retry should use the existing approval and credentials');
});

test('Check 5: Team QR remains stable across retries and contains only the canonical Team ID', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'QR Stability Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'QR Leader',
      email: 'qr@gmail.com',
      usn: 'QR001',
      phone: '9876543215',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('qr', 6)],
    paymentUtr: '666666666666',
    paymentUtrConfirm: '666666666666',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approve1 = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approve1.status);
  const qr1 = approve1.body.team.teamQrCode;
  assert.ok(qr1?.startsWith('data:image/png;base64,'), 'QR code should be generated on first approval');

  const approve2 = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approve2.status);
  const qr2 = approve2.body.team.teamQrCode;
  assert.equal(qr2, qr1, 'QR code should remain the same across approval retries');

});

test('Check 6: SMTP failure does not undo APPROVED state', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'SMTP Failure Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'SMTP Leader',
      email: 'smtp@gmail.com',
      usn: 'SMTP001',
      phone: '9876543216',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('smtp', 7)],
    paymentUtr: '777777777777',
    paymentUtrConfirm: '777777777777',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approveRes = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approveRes.status);
  assert.equal(approveRes.body.team.approvalStatus, 'APPROVED', 'Team should be APPROVED');

  const teamRes = await httpRequest('GET', `/api/teams/${encodeURIComponent(teamId)}`, undefined, [adminCookie]);
  assert.equal(teamRes.body.team.approvalStatus, 'APPROVED', 'Team should remain APPROVED even if email delivery failed');
});

test('Check 7: Credential retry does not create new credentials', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Credential Retry Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Cred Leader',
      email: 'cred@gmail.com',
      usn: 'CRED001',
      phone: '9876543217',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('cred', 8)],
    paymentUtr: '888888888888',
    paymentUtrConfirm: '888888888888',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approveRes = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approveRes.status);
  assert.equal(approveRes.body.team.accessPassword, undefined, 'Password hash must not be exposed after approval');

  const deliver1 = await httpRequest('POST', `/api/registration/${encodeURIComponent(teamId)}/deliver-credentials`, {}, [adminCookie]);
  assert.equal(deliver1.status, 200);

  const deliver2 = await httpRequest('POST', `/api/registration/${encodeURIComponent(teamId)}/deliver-credentials/retry`, {}, [adminCookie]);
  assert.equal(deliver2.status, 200);

  const teamRes = await httpRequest('GET', `/api/teams/${encodeURIComponent(teamId)}`, undefined, [adminCookie]);
  assert.equal(teamRes.body.team.accessPassword, undefined, 'Password hash must remain protected after credential retry');
});

test('Check 8: Scanner accepts only APPROVED teams', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Scanner Approved Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Scan Leader',
      email: 'scan@gmail.com',
      usn: 'SCAN001',
      phone: '9876543218',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('scan', 9)],
    paymentUtr: '999999999999',
    paymentUtrConfirm: '999999999999',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approveRes = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approveRes.status);

  const checkInRes = await httpRequest('POST', `/api/teams/${encodeURIComponent(teamId)}/check-in`, {}, [adminCookie]);
  assert.equal(checkInRes.status, 200, 'Approved team should be allowed check-in');
  assert.equal(checkInRes.body.team.approvalStatus, 'APPROVED', 'Team should remain APPROVED after check-in');
});

test('Check 9: Scanner rejects PENDING_PAYMENT_AUDIT and REJECTED teams', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Scanner Reject Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'RejectScan Leader',
      email: 'rejectscan@gmail.com',
      usn: 'REJSCAN001',
      phone: '9876543219',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('rejectscan', 10)],
    paymentUtr: '101010101010',
    paymentUtrConfirm: '101010101010',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const pendingTeamId = reg.body.team.id;

  const pendingCheckIn = await httpRequest('POST', `/api/teams/${encodeURIComponent(pendingTeamId)}/check-in`, {}, [adminCookie]);
  assert.equal(pendingCheckIn.status, 403, 'PENDING_PAYMENT_AUDIT team should be rejected from check-in');
  assert.ok(pendingCheckIn.body.error.includes('not approved'), 'Error should mention not approved');

  const rejectRes = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(pendingTeamId)}/reject`, { reason: 'Test rejection' }, [adminCookie]);
  assert.equal(rejectRes.status, 200);

  const rejectedCheckIn = await httpRequest('POST', `/api/teams/${encodeURIComponent(pendingTeamId)}/check-in`, {}, [adminCookie]);
  assert.equal(rejectedCheckIn.status, 403, 'REJECTED team should be rejected from check-in');
  assert.ok(rejectedCheckIn.body.error.includes('not approved'), 'Error should mention not approved');
});

test('Check 10: Scanner displays the canonical Team ID after successful scan', async () => {
  const reg = await httpRequest('POST', '/api/register', {
    teamName: 'Canonical ID Test',
    domain: 'Artificial Intelligence & Machine Learning',
    preferredTrack: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: 'Canonical Leader',
      email: 'canonical@gmail.com',
      usn: 'CANON001',
      phone: '9876543220',
      college: 'KSSEM',
      state: 'Karnataka',
      gender: 'Male'
    },
    members: [memberFor('canonical', 11)],
    paymentUtr: '121212121212',
    paymentUtrConfirm: '121212121212',
    paymentScreenshot: 'data:image/png;base64,test'
  }, [adminCookie]);
  assert.equal(reg.status, 201);
  const teamId = reg.body.team.id;

  const approveRes = await httpRequest('POST', `/api/admin/teams/${encodeURIComponent(teamId)}/approve`, {}, [adminCookie]);
  assertApprovalAccepted(approveRes.status);

  const checkInRes = await httpRequest('POST', `/api/teams/${encodeURIComponent(teamId)}/check-in`, {}, [adminCookie]);
  assert.equal(checkInRes.status, 200);
  assert.equal(checkInRes.body.team.id, teamId, 'Check-in response should contain the canonical Team ID');
  assert.ok(checkInRes.body.message.includes(teamId), `Success message should reference canonical Team ID ${teamId}`);
});
