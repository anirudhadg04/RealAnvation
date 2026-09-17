const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('C:\\Users\\gurur\\TF3\\RealAnvation\\sample-xlsx\\test.xlsx').then(async () => {
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

  const findNthCol = (tokens, n) => {
    let seen = 0;
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (tokens.every(t => h.includes(t))) {
        if (seen === n) return i;
        seen++;
      }
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
      return {
        full_name: -1,
        department: 52,
        semester: 53,
        email: 54,
        phone: 55,
        gender: 56,
      };
    }
    if (n === 3) {
      return {
        full_name: 44,
        department: 45,
        semester: 46,
        email: 47,
        phone: 48,
        gender: 49,
      };
    }
    return {
      full_name: 37,
      department: 38,
      semester: 39,
      email: 40,
      phone: 41,
      gender: 42,
    };
  };

  const p2 = participantBlock(2);
  const p3 = participantBlock(3);
  const p4 = participantBlock(4);

  const getCell = (row, idx) => {
    if (idx < 0) return '';
    const cell = ws.getCell(row._row, idx + 1);
    let val = cell.value;
    if (val && typeof val === 'object' && 'text' in val) val = val.text;
    if (val && typeof val === 'object' && 'value' in val) val = val.value;
    if (typeof val === 'object' && val !== null) {
      if (val.r != null && val.t === 'n') val = val.r;
      else if (val.t === 'd') val = val.v ? new Date(val.v).toISOString() : '';
      else val = String(val);
    }
    return String(val ?? '').trim();
  };

  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const teamName = getCell(row, fieldMap.team_name);
    if (!teamName) continue;
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
      })).filter(p => p.full_name !== ''),
      payment: { utr: getCell(row, fieldMap.utr) },
    });
  }

  console.log('Payload:', JSON.stringify(dataRows, null, 2));

  const res = await fetch('http://localhost:3001/api/admin/import-xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: dataRows, confirm: true })
  });
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
});