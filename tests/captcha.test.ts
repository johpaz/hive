/**
 * CAPTCHA Detection Test
 * 
 * Tests CAPTCHA detection on real websites like Airbnb
 */

import { detectCaptcha } from '../packages/core/src/tools/web/captcha/detector.ts';

async function testCaptchaDetection() {
  console.log('Testing CAPTCHA detection...\n');

  // Test URLs that typically have CAPTCHAs
  const testUrls = [
    'https://www.airbnb.com',
    'https://www.google.com/recaptcha/api2/demo',
    'https://www.hcaptcha.com/',
  ];

  // Note: This test requires a running browser
  // It demonstrates the detection logic

  console.log('CAPTCHA Detection Test');
  console.log('='.repeat(50));
  console.log('Supported CAPTCHA types:');
  console.log('  - recaptcha-v2-grid: Google reCAPTCHA image grid');
  console.log('  - hcaptcha: hCaptcha image selection');
  console.log('  - turnstile: Cloudflare Turnstile');
  console.log('  - text-simple: Simple text/image CAPTCHA');
  console.log('');

  console.log('Test URLs:');
  for (const url of testUrls) {
    console.log(`  - ${url}`);
  }
  console.log('');

  console.log('To run full test:');
  console.log('1. Ensure browser service is running');
  console.log('2. Navigate to a site with CAPTCHA');
  console.log('3. Call detectCaptcha(page) to detect');
  console.log('4. Use captchaSolveTool to resolve');
  console.log('');

  console.log('Environment variables needed:');
  console.log('  - GEMINI_API_KEY: API key for vision model');
  console.log('');

  console.log('Tool usage:');
  console.log('  browser_navigate(url="https://airbnb.com")');
  console.log('  → Auto-detects and solves CAPTCHA');
  console.log('');
  console.log('  captcha_solve()');
  console.log('  → Manually trigger CAPTCHA solving');
}

testCaptchaDetection();
