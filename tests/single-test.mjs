const BASE_URL = 'http://localhost:3001';

function generatePayload(index) {
  return {
    teamName: `LOADTEST-${String(index).padStart(4, '0')}`,
    domain: 'Artificial Intelligence & Machine Learning',
    leader: {
      fullName: `Load Test User ${index}`,
      email: `loadtest${String(index).padStart(4, '0')}@gmail.com`,
      phone: `900000${String(index).padStart(4, '0')}`,
      usn: `LT${String(index).padStart(4, '0')}`,
      college: 'Load Test College',
      state: 'Karnataka',
      gender: 'Male',
    },
    members: [
      {
        fullName: `Load Test Member ${index}A`,
        email: `loadtest${String(index).padStart(4, '0')}a@gmail.com`,
        phone: `900001${String(index).padStart(4, '0')}`,
        usn: `LT${String(index).padStart(4, '0')}A`,
        college: 'Load Test College',
        state: 'Karnataka',
        gender: 'Female',
      },
    ],
    paymentUtr: `100000${String(index).padStart(6, '0')}`,
    paymentUtrConfirm: `100000${String(index).padStart(6, '0')}`,
    paymentScreenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };
}

async function testSingleRegistration() {
  const payload = generatePayload(1);
  console.log('Sending registration payload:', JSON.stringify(payload, null, 2));

  const start = Date.now();
  try {
    const res = await fetch('http://localhost:3001/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - start;
    const text = await res.text();

    console.log('\n--- Response ---');
    console.log('HTTP Status:', res.status);
    console.log('Response Time:', elapsed, 'ms');
    console.log('Response Body:', text);

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (json) {
      console.log('Parsed JSON:', JSON.stringify(json, null, 2));
    }

    if (res.ok) {
      console.log('\n✅ SUCCESS: Registration accepted');
    } else if (res.status === 409) {
      console.log('\n⚠️ CONFLICT: Duplicate registration (expected if already exists)');
    } else if (res.status >= 400 && res.status < 500) {
      console.log('\n❌ CLIENT ERROR:', res.status);
    } else {
      console.log('\n❌ SERVER ERROR:', res.status);
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log('\n--- Network/Request Error ---');
    console.log('Time:', elapsed, 'ms');
    console.log('Error:', err.message);
  }
}

testSingleRegistration();