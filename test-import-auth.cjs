const ExcelJS = require('exceljs');
const fs = require('fs');

async function main() {
  // 1. Login as admin
  const loginRes = await fetch('http://localhost:3001/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'superadmin', password: 'AnvationAdmin@2026!' }),
  });
  const loginData = await loginRes.json();
  console.log('Login:', loginData.success ? 'OK' : 'FAILED', loginData.error || '');

  // Extract session cookie
  const setCookie = loginRes.headers.get('set-cookie');
  const cookieHeader = setCookie ? setCookie.split(';')[0] : '';

  if (!loginData.success || !cookieHeader) {
    console.error('Cannot proceed without admin session.');
    process.exit(1);
  }

  // 2. Parse XLSX
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('C:\\Users\\gurur\\TF3\\RealAnvation\\sample-xlsx\\test.xlsx');
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const obj = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      let val = cell.value;
      if (val && typeof val === 'object' && 'text' in val) val = val.text;
      if (val && typeof val === 'object' && 'value' in val) val = val.value;
      if (typeof val === 'object' && val !== null) {
        if (val.r != null && val.t === 'n') val = val.r;
        else if (val.t === 'd') val = val.v ? new Date(val.v).toISOString() : '';
        else val = String(val);
      }
      obj['col_' + colNumber] = String(val ?? '');
    });
    obj._row = rowNumber;
    rows.push(obj);
  });

  const normalizeHeader = (raw) =>
    String(raw ?? '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[?:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const headerRow = rows[0];
  const headers = [];
  for (let c = 1; c <= 80; c++) {
    const v = headerRow['col_' + c];
    if (v === undefined || v === '') break;
    headers.push(normalizeHeader(v));
  }

  const findCol = (tokens, from = 0) => {
    for (let i = from; i < headers.length; i++) {
      const h = headers[i];
      if (tokens.every(t => h.includes(t))) return i;
    }
    return -1;
  };

  const fieldMap = {
    team_name: findCol(['team name']),
    domain: findCol(['select the domain']),
    college: findCol(['college']),
    city: findCol(['city']),
    district: findCol(['district']),
    state: findCol(['state']),
    accommodation: findCol(['accommodation']),
    leader_full_name: findCol(['team leader full name']),
    leader_department: 17,
    leader_semester: 18,
    leader_email: findCol(['team leader email']),
    leader_phone: findCol(['team leader whatsapp']) || findCol(['team leader phone']),
    leader_gender: findCol(['team leader gender']),
    num_teammates: findCol(['number of teammates']),
    utr: 68,
  };

  const participantBlock = (n) => {
    if (n === 4) {
      return { full_name: -1, department: 52, semester: 53, email: 54, phone: 55, gender: 56 };
    }
    if (n === 3) {
      return { full_name: 44, department: 45, semester: 46, email: 47, phone: 48, gender: 49 };
    }
    return { full_name: 37, department: 38, semester: 39, email: 40, phone: 41, gender: 42 };
  };

  const p2 = participantBlock(2);
  const p3 = participantBlock(3);
  const p4 = participantBlock(4);

  const getCell = (row, idx) => {
    if (idx < 0) return '-';
    const cell = ws.getCell(row._row, idx + 1);
    let val = cell.value;
    if (val && typeof val === 'object' && 'text' in val) val = val.text;
    if (val && typeof val === 'object' && 'value' in val) val = val.value;
    if (typeof val === 'object' && val !== null) {
      if (val.r != null && val.t === 'n') val = val.r;
      else if (val.t === 'd') val = val.v ? new Date(val.v).toISOString() : '';
      else val = String(val);
    }
    const s = String(val ?? '').trim();
    return s || '-';
  };

  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const teamName = getCell(row, fieldMap.team_name);
    if (!teamName || teamName === '-') continue;
    const numTeammates = parseInt(getCell(row, fieldMap.num_teammates), 10);
    const participantCount = (numTeammates >= 2 && numTeammates <= 4) ? numTeammates : 0;
    dataRows.push({
      team_name: teamName,
      domain: getCell(row, fieldMap.domain),
      college: getCell(row, fieldMap.college),
      city: getCell(row, fieldMap.city),
      district: getCell(row, fieldMap.district),
      state: getCell(row, fieldMap.state),
      accommodation: getCell(row, fieldMap.accommodation),
      num_teammates: String(participantCount),
      leader: {
        full_name: getCell(row, fieldMap.leader_full_name),
        department: getCell(row, fieldMap.leader_department),
        semester: getCell(row, fieldMap.leader_semester),
        email: getCell(row, fieldMap.leader_email),
        phone: getCell(row, fieldMap.leader_phone),
        gender: getCell(row, fieldMap.leader_gender),
      },
      participants: [p2, p3, p4].map(b => ({
        full_name: getCell(row, b.full_name),
        department: getCell(row, b.department),
        semester: getCell(row, b.semester),
        email: getCell(row, b.email),
        phone: getCell(row, b.phone),
        gender: getCell(row, b.gender),
      })),
      payment: { utr: getCell(row, fieldMap.utr) },
    });
  }

  console.log('Payload rows:', dataRows.length);

  // 3. Validate
  const validateRes = await fetch('http://localhost:3001/api/admin/import-xlsx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    },
    body: JSON.stringify({ rows: dataRows }),
  });
  const validateText = await validateRes.text();
  let validateData;
  try { validateData = JSON.parse(validateText); } catch { validateData = { raw: validateText }; }
  console.log('Validate status:', validateRes.status);
  console.log('Validate response:', JSON.stringify(validateData, null, 2));

  // 4. If valid, confirm import
  if (validateData && validateData.success && validateData.valid && validateData.canImport) {
    const importRes = await fetch('http://localhost:3001/api/admin/import-xlsx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({ rows: dataRows, confirm: true }),
    });
    const importText = await importRes.text();
    let importData;
    try { importData = JSON.parse(importText); } catch { importData = { raw: importText }; }
    console.log('Import status:', importRes.status);
    console.log('Import response:', JSON.stringify(importData, null, 2));
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
