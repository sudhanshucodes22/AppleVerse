// scratch/test_auth.js
// Script to programmatically verify and security-test registration, login, lockout, cookies, and tokens.
import { deepStrictEqual, ok } from 'assert';

const BASE_URL = 'http://localhost:3001/api';

async function runTests() {
  console.log('🧪 Starting Authentication & Security Integration Tests...');

  // Helper to parse set-cookie header
  function parseCookies(headers) {
    const cookies = {};
    const setCookieHeaders = headers.getSetCookie(); // Node 18+ method to get all set-cookie headers
    for (const cookieStr of setCookieHeaders) {
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length === 2) {
        cookies[parts[0].trim()] = parts[1].trim();
      }
    }
    return cookies;
  }

  // 1. Get CSRF Token
  console.log('\n[Test 1] Fetching CSRF Token...');
  const csrfRes = await fetch(`${BASE_URL}/auth/csrf`);
  deepStrictEqual(csrfRes.status, 200, 'CSRF endpoint should return 200');
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  ok(csrfToken, 'CSRF Token must be returned');
  const initialCookies = parseCookies(csrfRes.headers);
  deepStrictEqual(initialCookies['csrf-token'], csrfToken, 'CSRF Cookie should match token');
  console.log('✅ CSRF Token obtained successfully.');

  const testEmail = `testuser_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testName = 'Test User';

  // 2. Register new user
  console.log('\n[Test 2] Registering a new user...');
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf-token=${csrfToken}`,
    },
    body: JSON.stringify({
      name: testName,
      email: testEmail,
      password: testPassword,
    }),
  });

  deepStrictEqual(regRes.status, 201, 'Registration should return 201 Created');
  const regData = await regRes.json();
  deepStrictEqual(regData.code, 'REGISTER_SUCCESS', 'Code should be REGISTER_SUCCESS');
  ok(regData.accessToken, 'Access token should be returned');
  deepStrictEqual(regData.user.email, testEmail, 'Emails should match');
  ok(!regData.user.passwordHash, 'Password hash should NOT be leaked in public user object');

  const regCookies = parseCookies(regRes.headers);
  const refreshToken = regCookies['__refresh_token'];
  ok(refreshToken, 'Refresh token cookie should be set');
  console.log('✅ User registered and refresh token cookie set.');

  // 3. Login with correct password
  console.log('\n[Test 3] Logging in with correct password...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf-token=${csrfToken}`,
    },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
    }),
  });

  deepStrictEqual(loginRes.status, 200, 'Login should return 200 OK');
  const loginData = await loginRes.json();
  ok(loginData.accessToken, 'Access token should be returned');
  
  const loginCookies = parseCookies(loginRes.headers);
  ok(loginCookies['__refresh_token'], 'Refresh token cookie should be set on login');
  console.log('✅ Successful login verified.');

  const userAccessToken = loginData.accessToken;

  // 4. Access protected profile endpoint
  console.log('\n[Test 4] Accessing protected route with valid token...');
  const profileRes = await fetch(`${BASE_URL}/user/profile`, {
    headers: {
      'Authorization': `Bearer ${userAccessToken}`,
    },
  });
  deepStrictEqual(profileRes.status, 200, 'Profile should return 200 OK with token');
  const profileData = await profileRes.json();
  deepStrictEqual(profileData.user.email, testEmail, 'Profile email should match');
  console.log('✅ Protected endpoint accessed successfully.');

  // 5. Access profile endpoint without token
  console.log('\n[Test 5] Accessing protected route without token...');
  const unauthRes = await fetch(`${BASE_URL}/user/profile`);
  deepStrictEqual(unauthRes.status, 401, 'Profile should return 401 without token');
  console.log('✅ Token absence guard verified.');

  // 6. Test Account Lockout (5 failed attempts)
  console.log('\n[Test 6] Testing account lockout after 5 failed attempts...');
  const lockoutEmail = `lockout_${Date.now()}@example.com`;
  
  // Register account for lockout test
  await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf-token=${csrfToken}`,
    },
    body: JSON.stringify({
      name: 'Lockout Test',
      email: lockoutEmail,
      password: testPassword,
    }),
  });

  // Attempt 5 incorrect logins
  for (let i = 1; i <= 5; i++) {
    const failRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie': `csrf-token=${csrfToken}`,
      },
      body: JSON.stringify({
        email: lockoutEmail,
        password: 'WrongPassword!',
      }),
    });
    console.log(`   Attempt ${i}: Status = ${failRes.status}`);
    if (i < 5) {
      deepStrictEqual(failRes.status, 401, 'Attempts < 5 should return 401 Unauthorized');
    } else {
      // The 5th attempt trigger lockout, so it might return 401 or 423
      ok([401, 423].includes(failRes.status), '5th attempt should be unauthorized or locked');
    }
  }

  // The 6th attempt must be blocked as ACCOUNT_LOCKED (423)
  console.log('   Testing 6th attempt (must be locked)...');
  const lockedRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf-token=${csrfToken}`,
    },
    body: JSON.stringify({
      email: lockoutEmail,
      password: testPassword, // correct password, but locked
    }),
  });

  deepStrictEqual(lockedRes.status, 423, 'Locked account login should return 423');
  const lockedData = await lockedRes.json();
  deepStrictEqual(lockedData.code, 'ACCOUNT_LOCKED', 'Locked response code should be ACCOUNT_LOCKED');
  console.log('✅ Account lockout functionality successfully verified.');

  // 7. Token Refresh & Rotation
  console.log('\n[Test 7] Testing token refresh & rotation...');
  const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': `__refresh_token=${loginCookies['__refresh_token']}`,
    },
  });

  deepStrictEqual(refreshRes.status, 200, 'Refresh should return 200 OK');
  const refreshData = await refreshRes.json();
  ok(refreshData.accessToken, 'Should return new access token');
  
  const refreshCookies = parseCookies(refreshRes.headers);
  const rotatedRefreshToken = refreshCookies['__refresh_token'];
  ok(rotatedRefreshToken, 'Should return new refresh token cookie');
  ok(rotatedRefreshToken !== loginCookies['__refresh_token'], 'Refresh token MUST be rotated');
  console.log('✅ Token refresh and rotation verified.');

  // 8. Token Blacklisting / Reuse Detection
  console.log('\n[Test 8] Testing refresh token reuse detection...');
  const reuseRes = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': `__refresh_token=${loginCookies['__refresh_token']}`, // Reuse the old one
    },
  });
  deepStrictEqual(reuseRes.status, 401, 'Reusing old token should return 401');
  const reuseData = await reuseRes.json();
  deepStrictEqual(reuseData.code, 'TOKEN_REUSE', 'Reusing old token should return TOKEN_REUSE code');
  console.log('✅ Refresh token reuse detection verified.');

  // Cleanup: Delete users
  console.log('\n[Test 9] Cleaning up test users...');
  const delRes1 = await fetch(`${BASE_URL}/user/account`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userAccessToken}`,
      'X-CSRF-Token': csrfToken,
      'Cookie': `csrf-token=${csrfToken}`,
    },
    body: JSON.stringify({ password: testPassword }),
  });
  deepStrictEqual(delRes1.status, 200, 'Account deletion should return 200 OK');
  console.log('✅ Test user 1 deleted.');

  console.log('\n✨ All authentication and security integration tests PASSED successfully!');
}

runTests().catch(err => {
  console.error('❌ Integration tests FAILED:', err);
  process.exit(1);
});
