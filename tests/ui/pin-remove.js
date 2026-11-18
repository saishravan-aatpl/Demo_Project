const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://localhost:8123/');
  await page.click('#settingsBtn'); await page.click('#pinBtn');
  await page.fill('#pinNew', '1234'); await page.fill('#pinConfirm', '1234');
  await page.click('#pinDialogForm button[type=submit]');
  await page.waitForTimeout(400);
  await page.click('#settingsBtn'); await page.click('#pinBtn');
  await page.fill('#pinCurrent', '1111');
  await page.click('#pinRemove');
  await page.waitForTimeout(400);
  const msg = await page.textContent('#pinDialogError');
  const stillSet = await page.evaluate(() => !!localStorage.getItem('officeDailyDashboard.pin'));
  console.log(msg.includes('current PIN') && stillSet ? 'PASS  Wrong PIN cannot remove the lock' : `FAIL  "${msg}" stillSet=${stillSet}`);
  await browser.close();
})();
