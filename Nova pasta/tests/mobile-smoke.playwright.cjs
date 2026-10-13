/* Playwright smoke test for the V0.18 mobile critical path. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
function startServer() {
  const server = http.createServer((req,res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) && file !== path.join(root,'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {'content-type':mime[path.extname(file)] || 'application/octet-stream','cache-control':'no-store'});
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0,'127.0.0.1',()=>resolve(server)));
}
(async () => {
  const server = await startServer();
  let browser;
  try {
    const address = server.address();
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`, {waitUntil:'domcontentloaded'});
    await page.waitForSelector('#heroDemoBtn');
    const layout = await page.evaluate(() => ({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,buttonSizes:['#heroDemoBtn','#tabBtnLocal','#tabBtnUrl','#tabBtnNasa','#recommendedParamsBtn'].map(sel=>{const e=document.querySelector(sel);const r=e.getBoundingClientRect();return {sel,width:r.width,height:r.height,visible:!!(r.width&&r.height)};})}));
    assert.ok(layout.scrollWidth <= layout.width + 1, `horizontal overflow at 390px: ${layout.scrollWidth} > ${layout.width}`);
    for (const button of layout.buttonSizes.filter(item=>item.visible)) assert.ok(button.height >= 44, `${button.sel} target too short: ${button.height}px`);
    await page.locator('#heroDemoBtn').click();
    await page.waitForFunction(() => {const e=document.querySelector('#resultsSection');return e && !e.classList.contains('hidden');}, null, {timeout:60000});
    await page.waitForFunction(() => {const b=document.querySelector('#mobileAnalyzeBtn');const s=document.querySelector('#mobileCalculateStatus');return b && s && b.dataset.busy==='false' && !b.disabled;}, null, {timeout:60000});
    // Verify the top shortcut is not overlapping the fixed calculate dock on mobile.
    const overlap = await page.evaluate(() => {
      const dock=document.querySelector('#mobileCalculateDock'),top=document.querySelector('#backToTopBtn');
      return !!(dock && top && !dock.classList.contains('hidden') && getComputedStyle(top).display!=='none');
    });
    assert.equal(overlap,false,'back-to-top should hide while the fixed calculate dock is visible');
    assert.deepEqual(pageErrors, [], `page JavaScript errors: ${pageErrors.join('; ')}`);
    console.log('Playwright mobile smoke test passed at 390px, including demo calculation and mobile button recovery.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
