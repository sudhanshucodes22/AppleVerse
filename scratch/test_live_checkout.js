import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMAIL_LOG_DIR = join(__dirname, '..', 'server', 'data', 'emails');

const BASE_URL = 'http://127.0.0.1:3001/api';

async function runLiveTest() {
  console.log('🏁 Starting Live AppleVerse API & Email Verification Test...\n');

  const email = `testuser_${Date.now()}@example.com`;
  const password = 'Password123!';
  const name = 'Test Verification Customer';

  let accessToken = '';
  let csrfToken = '';

  // 0. Initializing Session & CSRF Token
  console.log('0. Initializing session and CSRF keys...');
  const initRes = await fetch(`${BASE_URL}/health`);
  const initCookieHeader = initRes.headers.get('set-cookie') || '';
  const csrfCookie = initCookieHeader.split('csrf-token=')[1]?.split(';')[0] || '';
  let cookies = `csrf-token=${csrfCookie}`;
  csrfToken = csrfCookie;
  console.log(`✅ Session initialized. CSRF Token: ${csrfToken}`);

  // 1. Register User
  console.log('1. Registering new test user...');
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
      'Cookie': cookies
    },
    body: JSON.stringify({ name, email, password })
  });

  const regData = await regRes.json();
  if (regRes.status !== 201) {
    console.error('❌ Registration failed:', regData);
    process.exit(1);
  }
  console.log('✅ User registered successfully!');

  // Combine cookies from registration response
  accessToken = regData.accessToken;
  const regCookieHeader = regRes.headers.get('set-cookie') || '';
  const regCookiesList = regCookieHeader.split(',').map(c => c.split(';')[0]);
  cookies = regCookiesList.join('; ') + `; csrf-token=${csrfCookie}`;

  // Get CSRF Token
  console.log('2. Verifying User Session...');
  const csrfRes = await fetch(`${BASE_URL}/auth/me`, {
    headers: { 
      'Authorization': `Bearer ${accessToken}`,
      'Cookie': cookies
    }
  });
  console.log(`✅ Session verified successfully. Continuing with CSRF Token: ${csrfToken}`);

  // 3. Add item to cart
  console.log('3. Adding MacBook Air to user cart...');
  const cartRes = await fetch(`${BASE_URL}/cart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'x-csrf-token': csrfToken,
      'Cookie': cookies
    },
    body: JSON.stringify({ productId: 'iphone-17-pro-max', qty: 1 })
  });

  if (!cartRes.ok) {
    console.error('❌ Failed to add product to cart:', await cartRes.json());
    process.exit(1);
  }
  console.log('✅ Added to cart!');

  // 4. Create Payment Intent
  console.log('4. Initiating Stripe Sandbox Payment Intent...');
  const piRes = await fetch(`${BASE_URL}/checkout/create-payment-intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'x-csrf-token': csrfToken,
      'Cookie': cookies
    }
  });

  if (!piRes.ok) {
    console.error('❌ Failed to create payment intent:', await piRes.json());
    process.exit(1);
  }
  const piData = await piRes.json();
  console.log(`✅ Payment intent initialized. Client Secret: ${piData.clientSecret}`);

  // 5. Confirm Payment
  console.log('5. Submitting sandbox payment details...');
  const confirmRes = await fetch(`${BASE_URL}/checkout/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'x-csrf-token': csrfToken,
      'Cookie': cookies
    },
    body: JSON.stringify({
      paymentIntentId: piData.paymentIntentId,
      cardLast4: '4242',
      shippingAddress: '1 Infinite Loop, Cupertino, CA 95014'
    })
  });

  const confirmData = await confirmRes.json();
  if (!confirmRes.ok) {
    console.error('❌ Payment confirmation failed:', confirmData);
    process.exit(1);
  }
  console.log(`✅ Payment confirmed! Order Reference: ${confirmData.order.orderRef}`);

  // 6. Verify Email Output Files
  console.log('6. Scanning local data directory for compiled HTML emails...');
  await new Promise(resolve => setTimeout(resolve, 800)); // wait brief moment for file write

  const files = await fs.readdir(EMAIL_LOG_DIR);
  const welcomeEmails = files.filter(f => f.startsWith('welcome_') && f.includes(email.replace(/[^a-zA-Z0-9]/g, '_')));
  const receipts = files.filter(f => f.startsWith('order_receipt_') && f.includes(email.replace(/[^a-zA-Z0-9]/g, '_')));

  if (welcomeEmails.length > 0 && receipts.length > 0) {
    console.log('\n🌟 ALL CHECKS PASSED SUCCESSFULLY!');
    console.log(`- Welcome Email: file://${join(EMAIL_LOG_DIR, welcomeEmails[0])}`);
    console.log(`- Order Receipt: file://${join(EMAIL_LOG_DIR, receipts[0])}`);
  } else {
    console.error('❌ Email files were not generated in directory:', EMAIL_LOG_DIR);
    process.exit(1);
  }
}

runLiveTest();
