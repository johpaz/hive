const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: '/usr/bin/google-chrome' // Adjust if necessary, or let puppeteer download
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:18790', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/home/johnpaez/.gemini/antigravity/brain/1c8de7c4-2d54-4e8c-8683-2b3920c0da02/artifacts/layout_screenshot.png' });
  await browser.close();
})();
