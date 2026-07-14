import nodemailer from 'nodemailer';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMAIL_LOG_DIR = join(__dirname, '..', 'data', 'emails');

// Create local mail logs directory if it doesn't exist
async function ensureLogDir() {
  try {
    await fs.mkdir(EMAIL_LOG_DIR, { recursive: true });
  } catch (err) {
    console.error('[email-service] Failed to create email log dir:', err);
  }
}

// SMTP Transporter configuration
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure: port == 465,
      auth: { user, pass }
    });
  }
  return null;
}

// Main email sender function
async function sendEmail({ to, subject, html, filenamePrefix = 'email' }) {
  await ensureLogDir();
  const from = process.env.SMTP_FROM || 'AppleVerse <no-reply@appleverse.com>';

  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({ from, to, subject, html });
      console.log(`[email-service] Successfully dispatched email to ${to} ("${subject}")`);
      return;
    } catch (err) {
      console.warn('[email-service] SMTP dispatch failed, falling back to local file:', err.message);
    }
  }

  // Fallback: Write HTML file locally
  const sanitizedTo = to.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${filenamePrefix}_${sanitizedTo}_${Date.now()}.html`;
  const filePath = join(EMAIL_LOG_DIR, filename);

  try {
    // Add custom helper tag at top to facilitate reading
    const devHTML = `
      <!--
        Subject: ${subject}
        Recipient: ${to}
        Sender: ${from}
        Date: ${new Date().toISOString()}
      -->
      ${html}
    `;
    await fs.writeFile(filePath, devHTML, 'utf-8');
    
    // Output a gorgeous console log with standard file URL
    const fileUrl = `file://${filePath}`;
    console.log('\n┌────────────────────────────────────────────────────────┐');
    console.log('│  ✉️   AppleVerse Local Email Simulator                  │');
    console.log(`│  Subject:   ${subject.substring(0, 40).padEnd(40)} │`);
    console.log(`│  Recipient: ${to.substring(0, 40).padEnd(40)} │`);
    console.log(`│  File Link: ${fileUrl.substring(0, 40).padEnd(40)} │`);
    console.log('└────────────────────────────────────────────────────────┘\n');
  } catch (err) {
    console.error('[email-service] Failed to log email locally:', err);
  }
}

// ─── Email Templates ──────────────────────────────────────────────────

export async function sendWelcomeEmail(user) {
  const subject = 'Welcome to AppleVerse — Set up your Apple ID';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #F5F5F7; margin: 0; padding: 40px 20px; color: #1D1D1F; }
        .card { max-width: 580px; margin: 0 auto; background-color: #FFFFFF; border-radius: 24px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .logo { text-align: center; margin-bottom: 30px; }
        .logo img { height: 44px; }
        h1 { font-size: 28px; font-weight: 700; text-align: center; margin-bottom: 20px; letter-spacing: -0.5px; }
        p { font-size: 15px; line-height: 1.6; color: #515154; margin-bottom: 20px; }
        .btn-container { text-align: center; margin: 35px 0; }
        .btn { display: inline-block; background-color: #0066CC; color: #FFFFFF; text-decoration: none; padding: 14px 30px; font-size: 14px; font-weight: 600; border-radius: 30px; }
        .footer { text-align: center; font-size: 12px; color: #8E8E93; margin-top: 40px; line-height: 1.5; }
        .divider { height: 1px; background-color: #E5E5EA; margin: 30px 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">
          <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuD9tK5a2V00wJ2_zS2E_tVOh1U" alt="AppleVerse Logo" style="height: 44px; display: inline-block;">
        </div>
        <h1>Welcome to AppleVerse, ${user.name}</h1>
        <p>Your new account has been successfully created. You can now use your email address as your Apple ID to explore new collections, buy mock hardware configurations, track shipments, and save items to your wishlist.</p>
        
        <p>To verify your email address and activate your account features, click the confirmation button below:</p>
        
        <div class="btn-container">
          <a href="#" class="btn" style="color: #ffffff;">Verify Account</a>
        </div>
        
        <p>If you didn't create an account, you can safely ignore this email.</p>
        
        <div class="divider"></div>
        
        <div class="footer">
          This email was sent to ${user.email} because you signed up for an account at AppleVerse.<br>
          Copyright © 2026 AppleVerse Digital Store Inc. One Apple Park Way, Cupertino, CA 95014. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({ to: user.email, subject, html, filenamePrefix: 'welcome' });
}

export async function sendPasswordChangedEmail(user) {
  const subject = 'Your Apple ID password has been updated';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #F5F5F7; margin: 0; padding: 40px 20px; color: #1D1D1F; }
        .card { max-w: 580px; margin: 0 auto; background-color: #FFFFFF; border-radius: 24px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .logo { text-align: center; margin-bottom: 30px; }
        h1 { font-size: 24px; font-weight: 700; text-align: center; margin-bottom: 20px; letter-spacing: -0.5px; }
        p { font-size: 15px; line-height: 1.6; color: #515154; margin-bottom: 20px; }
        .alert-box { background-color: #FFF9E6; border-left: 4px solid #FFCC00; padding: 15px; border-radius: 8px; margin: 25px 0; }
        .footer { text-align: center; font-size: 12px; color: #8E8E93; margin-top: 40px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">
          <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuD9tK5a2V00wJ2_zS2E_tVOh1U" alt="AppleVerse Logo" style="height: 44px; display: inline-block;">
        </div>
        <h1>Password Changed Successfully</h1>
        <p>Dear ${user.name},</p>
        <p>The password associated with your Apple ID account (<strong>${user.email}</strong>) was changed on ${new Date().toLocaleString()}.</p>
        
        <div class="alert-box">
          <p style="margin: 0; font-size: 14px; font-weight: 600; color: #7F5F00;">If you did not perform this change:</p>
          <p style="margin: 5px 0 0 0; font-size: 13px; color: #5C4B00;">Please immediately contact the AppleVerse security response team or log in to secure your account credentials.</p>
        </div>
        
        <p>Thank you for using AppleVerse.</p>
        
        <div class="footer">
          This security alert was sent automatically.<br>
          Copyright © 2026 AppleVerse Digital Store Inc. One Apple Park Way, Cupertino, CA 95014. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({ to: user.email, subject, html, filenamePrefix: 'security_alert' });
}

export async function sendOrderInvoiceEmail(user, order) {
  const subject = `Your AppleVerse Invoice - Order ${order.order_ref}`;
  const items = JSON.parse(order.items);
  const USD_TO_INR = 83.0;
  let itemsHTML = '';
  items.forEach(item => {
    const qty = item.qty || item.quantity || 1;
    const priceInr = (item.price * USD_TO_INR).toLocaleString('en-IN');
    const totalInr = (item.price * qty * USD_TO_INR).toLocaleString('en-IN');
    
    itemsHTML += `
      <tr style="border-bottom: 1px solid #E5E5EA;">
        <td style="padding: 15px 0; vertical-align: top; display: flex; align-items: center; gap: 10px;">
          <img src="${item.image.startsWith('http') ? item.image : 'https://lh3.googleusercontent.com/aida-public/AB6AXuD-9PUFnWZ8pjq6YYgyVCCzM70HqngIteUCVWQm1D5PoxDeZqtAYxAVGNrMbf24kuq28fnRvH5fExMd79-_LI309-SGl2y_ILr4IClbMuZNhEDMSY9LSnH07XMOM1RVLU0RaXtwxJAycdgMGRFxK2Q5Th1yjlssLzmqn_2dKDPLHYw7gGnSbPjBU8YuKss4ORB85go9u8T1E9AN56unRlA2TJcLo0cbJ5_lksp8VyDaH5YALQqsh7mBWw'}" alt="${item.name}" style="height: 50px; width: auto; object-fit: contain; border-radius: 8px; border: 1px solid #F5F5F7;">
          <div style="margin-left: 10px;">
            <span style="font-weight: 600; font-size: 15px; color: #1D1D1F; display: block;">${item.name}</span>
            <span style="font-size: 12px; color: #8E8E93;">Standard Config</span>
          </div>
        </td>
        <td style="padding: 15px 0; text-align: center; color: #515154; vertical-align: middle;">${qty}</td>
        <td style="padding: 15px 0; text-align: right; font-weight: 500; color: #1D1D1F; vertical-align: middle;">₹${priceInr}</td>
        <td style="padding: 15px 0; text-align: right; font-weight: 600; color: #1D1D1F; vertical-align: middle;">₹${totalInr}</td>
      </tr>
    `;
  });

  const subtotalStr = order.subtotal.toLocaleString('en-IN');
  const taxStr = order.tax.toLocaleString('en-IN');
  const totalStr = order.total.toLocaleString('en-IN');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #F5F5F7; margin: 0; padding: 40px 20px; color: #1D1D1F; }
        .card { max-w: 640px; margin: 0 auto; background-color: #FFFFFF; border-radius: 24px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .logo { text-align: center; margin-bottom: 20px; }
        .logo img { height: 44px; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { font-size: 24px; font-weight: 700; margin: 0 0 10px 0; }
        .header p { color: #8E8E93; font-size: 14px; margin: 0; }
        .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .meta-table td { padding: 8px 0; font-size: 13px; color: #515154; }
        .meta-table td strong { color: #1D1D1F; }
        .product-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .product-table th { border-bottom: 1px solid #D2D2D7; padding-bottom: 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8E8E93; text-align: left; }
        .totals-table { width: 100%; border-collapse: collapse; margin-top: 30px; border-top: 1px solid #D2D2D7; }
        .totals-table td { padding: 12px 0; font-size: 14px; }
        .totals-table tr.grand-total td { font-size: 18px; font-weight: 700; color: #1D1D1F; border-top: 2px solid #1D1D1F; padding-top: 15px; }
        .footer { text-align: center; font-size: 11px; color: #8E8E93; margin-top: 50px; line-height: 1.5; }
        .divider { height: 1px; background-color: #E5E5EA; margin: 25px 0; }
        .status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; background-color: #EAF9EE; color: #2E7D32; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">
          <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuD9tK5a2V00wJ2_zS2E_tVOh1U" alt="AppleVerse Logo" style="height: 44px; display: inline-block;">
        </div>
        <div class="header">
          <h1>Thank you for your purchase.</h1>
          <p>Invoice reference ID: ${order.order_ref}</p>
        </div>
        
        <table class="meta-table">
          <tr>
            <td>Order Placed: <strong>${new Date(order.placed_at || Date.now()).toLocaleDateString('en-IN', { dateStyle: 'long' })}</strong></td>
            <td style="text-align: right;">Status: <span class="status-badge">${order.status}</span></td>
          </tr>
          <tr>
            <td>Customer Name: <strong>${user.name}</strong></td>
            <td style="text-align: right;">Email ID: <strong>${user.email}</strong></td>
          </tr>
          <tr>
            <td>Payment Method: <strong>Card Checkout (Simulated)</strong></td>
            <td style="text-align: right;">Currency: <strong>${order.currency}</strong></td>
          </tr>
        </table>
        
        <table class="product-table">
          <thead>
            <tr>
              <th style="width: 50%;">Item</th>
              <th style="width: 10%; text-align: center;">Qty</th>
              <th style="width: 20%; text-align: right;">Unit Price</th>
              <th style="width: 20%; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>
        
        <table class="totals-table">
          <tr>
            <td style="color: #8E8E93;">Subtotal</td>
            <td style="text-align: right; font-weight: 500;">₹${subtotalStr}</td>
          </tr>
          <tr>
            <td style="color: #8E8E93;">GST (18% inclusive)</td>
            <td style="text-align: right; font-weight: 500;">₹${taxStr}</td>
          </tr>
          <tr class="grand-total">
            <td>Total paid</td>
            <td style="text-align: right;">₹${totalStr}</td>
          </tr>
        </table>
        
        <div class="divider"></div>
        <p style="font-size: 13px; text-align: center; color: #8E8E93; line-height: 1.5; margin: 0 0 10px 0;">
          Need help? Log in to your <a href="http://localhost:5173/account.html" style="color: #0066CC; text-decoration: none;">Apple ID Dashboard</a> to track order status or register AppleCare+ coverage.
        </p>
        
        <div class="footer">
          This receipt is your official confirmation of transaction receipt.<br>
          Copyright © 2026 AppleVerse Digital Store Inc. One Apple Park Way, Cupertino, CA 95014. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({ to: user.email, subject, html, filenamePrefix: 'order_receipt' });
}
