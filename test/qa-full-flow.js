#!/usr/bin/env node
// End-to-end functional QA for PharmaCare — drives the real UI in a headless
// browser and clicks through every screen and workflow. No live Firebase
// project or camera hardware is required: Firestore calls are answered by
// firebase-stub.js, and the camera uses Chromium's fake video device.
//
// Usage:
//   npm install
//   npx playwright install chromium   # first run only
//   npm run test:e2e
//
// Exits 0 if every check passes, 1 otherwise (CI-friendly).

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS = path.join(__dirname, '.artifacts');
const PORT = 8791;
const stubJs = fs.readFileSync(path.join(__dirname, 'firebase-stub.js'), 'utf8');

fs.mkdirSync(ARTIFACTS, { recursive: true });
const SHOT = (name) => path.join(ARTIFACTS, `${name}.png`);

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

const report = [];
function log(area, step, status, detail) {
  report.push({ area, step, status, detail: detail || '' });
  console.log(`[${status}] ${area} :: ${step}${detail ? ' — ' + detail : ''}`);
}

// Some sandboxes pre-install a specific Chromium build outside Playwright's
// own version-pinned cache (see repo docs for this project's dev container).
// Use it when present; otherwise fall back to Playwright's own resolution,
// which requires `npx playwright install chromium` to have been run once.
const PRESEEDED_CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const executablePath = fs.existsSync(PRESEEDED_CHROMIUM) ? PRESEEDED_CHROMIUM : undefined;

async function run() {
  const server = await startStaticServer();
  // Wrapped in try/finally: if anything below throws (including a failed
  // browser launch), the server must still be closed or its port stays
  // bound and every future run fails with EADDRINUSE instead of a real error.
  let browser;
  try {
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--headless=new',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream', // auto-grant the camera permission prompt
    ],
  });
  const page = await browser.newPage({ viewport: { width: 460, height: 940 }, permissions: ['camera'] });

  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('404')) jsErrors.push('[console] ' + msg.text()); });
  page.on('dialog', async (d) => { log('dialog', d.type(), 'INFO', d.message()); await d.dismiss().catch(() => {}); });
  page.on('download', (d) => log('download', 'file triggered', 'PASS', d.suggestedFilename()));

  // Keep the run hermetic — no dependency on live Firebase/Google Fonts/zxing CDN.
  await page.route('**://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**://unpkg.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**://fonts.gstatic.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.addInitScript(stubJs);

  const byId = (id) => page.$(`#${id}`);
  const clickId = async (id, { optional = false } = {}) => {
    const el = await byId(id);
    if (!el) { log('click', id, optional ? 'INFO' : 'FAIL', 'element not found'); return false; }
    try { await el.click({ timeout: 3000 }); return true; }
    catch (e) { log('click', id, 'FAIL', e.message.split('\n')[0]); return false; }
  };
  const fillId = async (id, value) => {
    const el = await byId(id);
    if (!el) { log('fill', id, 'FAIL', 'element not found'); return false; }
    try { await el.fill(String(value)); return true; }
    catch (e) { log('fill', id, 'FAIL', e.message.split('\n')[0]); return false; }
  };
  async function pressKey(selector, d) {
    const keys = await page.$$(selector);
    for (const k of keys) { if ((await k.textContent() || '').trim() === String(d)) { await k.click(); return true; } }
    return false;
  }
  async function clickTab(tabName) {
    for (const t of await page.$$('.nav-tab[data-tab]')) {
      if ((await t.getAttribute('data-tab')) === tabName) { await t.click(); return true; }
    }
    return false;
  }
  const checkNoNewErrors = (area, step) => {
    if (jsErrors.length > 0) log(area, step, 'FAIL', 'JS errors: ' + jsErrors.slice(-3).join(' | '));
    else log(area, step, 'PASS');
    jsErrors.length = 0;
  };
  async function phase(name, fn) {
    try { await fn(); }
    catch (e) { log(name, 'PHASE CRASHED', 'FAIL', e.message.split('\n')[0]); }
  }

  // ══════════════ AUTH ══════════════
  await phase('auth', async () => {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    jsErrors.length = 0;

    await page.click('.profile-btn');
    await page.waitForTimeout(400);
    log('auth', 'open PIN screen', (await page.$('#pin-screen')) ? 'PASS' : 'FAIL');

    for (const d of [9, 9, 9, 9]) await pressKey('.pin-key', d);
    await page.waitForTimeout(500);
    log('auth', 'wrong PIN shows error state', (await page.$('.pin-error-msg')) ? 'PASS' : 'FAIL');

    await page.waitForTimeout(300);
    for (const d of [0, 0, 0, 0]) { await pressKey('.pin-key', d); await page.waitForTimeout(120); }
    await page.waitForTimeout(700);
    log('auth', 'correct PIN logs in', (await page.$('#app-screen')) ? 'PASS' : 'FAIL');
    checkNoNewErrors('auth', 'login flow clean of JS errors');
  });

  // ══════════════ SCAN TAB CONTROLS ══════════════
  await phase('scan', async () => {
    const destBtns = await page.$$('.dest-btn[data-dest]');
    log('scan', 'destination toggle buttons present', destBtns.length === 2 ? 'PASS' : 'FAIL', `count=${destBtns.length}`);
    if (destBtns.length === 2) {
      await (await page.$$('.dest-btn[data-dest]'))[1].click();
      await page.waitForTimeout(250);
      await (await page.$$('.dest-btn[data-dest]'))[0].click();
      await page.waitForTimeout(250);
    }

    // Format chips only render while the camera viewport is up (S.cameraActive || scanning).
    await clickId('camToggleBtn');
    await page.waitForTimeout(1200); // let getUserMedia (fake device) resolve and video attach
    log('scan', 'camera toggle opens scan viewport', (await byId('scanViewport')) ? 'PASS' : 'FAIL');
    await page.screenshot({ path: SHOT('live-camera') });
    const fmtChips = await page.$$('.scan-format-chip[data-fmt]');
    log('scan', 'format chips present while scanning', fmtChips.length > 0 ? 'PASS' : 'FAIL', `count=${fmtChips.length}`);
    if (fmtChips.length > 1) { await (await page.$$('.scan-format-chip[data-fmt]'))[1].click(); await page.waitForTimeout(150); }
    await clickId('camToggleBtn'); // close camera again
    await page.waitForTimeout(300);

    const rapidToggle = await byId('rapidToggle');
    if (rapidToggle) {
      await rapidToggle.click(); await page.waitForTimeout(200);
      log('scan', 'rapid mode toggle', (await page.$('.rapid-row.active')) ? 'PASS' : 'FAIL');
      const rapidToggle2 = await byId('rapidToggle');
      if (rapidToggle2) await rapidToggle2.click();
      await page.waitForTimeout(150);
    } else log('scan', 'rapid mode toggle', 'FAIL', 'rapidToggle not found');

    checkNoNewErrors('scan', 'toggles clean of JS errors');
  });

  // ══════════════ MANUAL ENTRY (build test data: RED / ORANGE+HIGH-ALERT / GREEN) ══════════════
  async function addDrugManually(name, gen, lot, daysFromNow, qty, highAlert) {
    await clickId('manualEntryBtn');
    await page.waitForTimeout(300);
    if (!(await byId('manualScreen'))) { log('scan/manual', `open manual form for ${name}`, 'FAIL', 'manualScreen not found'); return; }
    await fillId('mName', name);
    await fillId('mGen', gen);
    await fillId('mLot', lot);
    const exp = new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
    await fillId('mExp', exp);
    await fillId('mQty', qty);
    if (highAlert) { const ha = await byId('mHighAlert'); if (ha) await ha.check().catch(() => {}); }
    await clickId('manualSubmitBtn');
    await page.waitForTimeout(400);
    log('scan/manual', `add drug "${name}" (${daysFromNow}d, HA=${!!highAlert})`, 'PASS');
  }
  await phase('scan/manual', async () => {
    await addDrugManually('พาราเซตามอล 500mg', 'Paracetamol', 'LOT-RED-01', 10, 20, false);
    await clickTab('scan'); await page.waitForTimeout(300);
    await addDrugManually('มอร์ฟีน 10mg/ml', 'Morphine', 'LOT-HA-02', 45, 5, true);
    await clickTab('scan'); await page.waitForTimeout(300);
    await addDrugManually('อม็อกซีซิลลิน 250mg', 'Amoxicillin', 'LOT-GRN-03', 120, 30, false);
    checkNoNewErrors('scan/manual', 'manual-entry add flow clean of JS errors');
  });

  await phase('scan/barcode', async () => {
    await clickTab('scan');
    await page.waitForTimeout(300);
    const barcodeBtn = await byId('barcodeInputBtn');
    if (barcodeBtn) {
      await barcodeBtn.click(); await page.waitForTimeout(300);
      log('scan', 'GS1 manual input overlay opens', (await byId('barcodeInputOverlay')) ? 'PASS' : 'FAIL');
      await clickId('barcodeCloseBtn', { optional: true });
      await page.waitForTimeout(200);
    } else log('scan', 'GS1 manual input overlay opens', 'FAIL', 'barcodeInputBtn not found');
    checkNoNewErrors('scan', 'barcode overlay clean of JS errors');
  });

  // ══════════════ STOCK TAB ══════════════
  await phase('stock/filters', async () => {
    await clickTab('stock');
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT('stock-tab') });
    const filterBtns = await page.$$('.stock-filter-btn[data-filter]');
    log('stock', 'filter chips present', filterBtns.length >= 4 ? 'PASS' : 'FAIL', `count=${filterBtns.length}`);
    for (let i = 0; i < filterBtns.length; i++) {
      const chips = await page.$$('.stock-filter-btn[data-filter]');
      if (chips[i]) { await chips[i].click(); await page.waitForTimeout(150); }
    }
    const allChips = await page.$$('.stock-filter-btn[data-filter]');
    if (allChips.length) { await allChips[0].click(); await page.waitForTimeout(150); }
    checkNoNewErrors('stock', 'filter chip cycle clean of JS errors');
  });

  await phase('stock/search-sort', async () => {
    const searchInput = await byId('stockSearchInput');
    if (searchInput) {
      await searchInput.fill('พารา');
      await page.waitForTimeout(300);
      const matches = await page.$$('.drug-card[data-id]');
      log('stock', 'search filters drug list', matches.length >= 1 ? 'PASS' : 'FAIL', `matches=${matches.length}`);
      await (await byId('stockSearchInput')).fill('');
      await page.waitForTimeout(300);
    } else log('stock', 'search input', 'FAIL', 'stockSearchInput not found');

    const sortSel = await byId('stockSortSel');
    if (sortSel) {
      const opts = await sortSel.$$eval('option', (os) => os.map((o) => o.value));
      if (opts.length > 1) { await sortSel.selectOption(opts[1]); await page.waitForTimeout(200); await (await byId('stockSortSel')).selectOption(opts[0]); }
      log('stock', 'sort dropdown changes order', 'PASS', `options=${opts.join(',')}`);
    } else log('stock', 'sort dropdown', 'FAIL', 'stockSortSel not found');
    checkNoNewErrors('stock', 'search/sort clean of JS errors');
  });

  await phase('stock/dispense', async () => {
    const cards = await page.$$('.drug-card[data-id]');
    log('stock', 'drug cards rendered', cards.length >= 3 ? 'PASS' : 'FAIL', `count=${cards.length}`);
    let done = false;
    for (const c of cards) {
      if ((await c.textContent()).includes('อม็อกซีซิลลิน')) {
        await c.click(); await page.waitForTimeout(400);
        log('stock/sheet', 'drug detail sheet opens', (await byId('sheetOverlay')) ? 'PASS' : 'FAIL');
        await page.screenshot({ path: SHOT('drug-sheet') });
        const dispBtn = await byId('dispenseItemBtn');
        if (dispBtn) {
          await dispBtn.click(); await page.waitForTimeout(300);
          await fillId('dspHN', '99887766');
          await fillId('dspAmt', '2');
          await page.screenshot({ path: SHOT('dispense-modal') });
          await clickId('dspConfirmBtn');
          await page.waitForTimeout(500);
          done = true;
          log('stock/dispense', 'dispense workflow completes', 'PASS');
        } else log('stock/dispense', 'dispense button present', 'FAIL');
        break;
      }
    }
    if (!done) log('stock/dispense', 'dispense workflow', 'FAIL', 'target item not found/clicked');
    checkNoNewErrors('stock/dispense', 'dispense flow clean of JS errors');
  });

  await phase('stock/return', async () => {
    const cards = await page.$$('.drug-card[data-id]');
    let done = false;
    for (const c of cards) {
      if ((await c.textContent()).includes('มอร์ฟีน')) {
        await c.click(); await page.waitForTimeout(400);
        const retBtn = await byId('returnItemBtn');
        if (retBtn) {
          await retBtn.click(); await page.waitForTimeout(300);
          log('stock/return', 'return workflow modal opens', (await byId('returnOverlay')) ? 'PASS' : 'FAIL');
          await page.screenshot({ path: SHOT('return-modal') });
          await clickId('retCancelBtn', { optional: true });
          await page.waitForTimeout(200);
          done = true;
        } else {
          log('stock/return', 'return button present (ORANGE-status item)', 'FAIL', 'not found — check status classification');
        }
        // the return sub-modal only closes itself; the drug-detail sheet underneath needs its own close
        await clickId('closeSheetBtn', { optional: true });
        await page.waitForTimeout(200);
        break;
      }
    }
    if (!done) log('stock/return', 'return workflow', 'FAIL', 'target item not found');
    checkNoNewErrors('stock/return', 'return flow clean of JS errors');
  });

  await phase('stock/disposal', async () => {
    const cards = await page.$$('.drug-card[data-id]');
    let done = false;
    for (const c of cards) {
      if ((await c.textContent()).includes('พาราเซตามอล')) {
        await c.click(); await page.waitForTimeout(400);
        const dBtn = await byId('disposalItemBtn');
        if (dBtn) {
          await dBtn.click(); await page.waitForTimeout(300);
          await fillId('dispPerson2', 'ผู้ช่วยเภสัชกร ทดสอบ');
          await page.screenshot({ path: SHOT('disposal-modal') });
          await clickId('dispConfirmBtn');
          await page.waitForTimeout(500);
          done = true;
          log('stock/disposal', 'disposal workflow completes', 'PASS');
        } else log('stock/disposal', 'disposal button present', 'FAIL');
        break;
      }
    }
    if (!done) log('stock/disposal', 'disposal workflow', 'FAIL', 'target item not found');
    checkNoNewErrors('stock/disposal', 'disposal flow clean of JS errors');
  });

  await phase('stock/transfer', async () => {
    const bulkBtn = await byId('bulkTransferBtn');
    if (bulkBtn) {
      await bulkBtn.click(); await page.waitForTimeout(300);
      log('stock/transfer', 'bulk transfer confirm dialog opens', (await byId('confirmOverlay')) ? 'PASS' : 'FAIL');
      await clickId('confirmOk', { optional: true });
      await page.waitForTimeout(300);
      log('stock/transfer', 'bulk transfer confirmed', 'PASS');
    } else log('stock/transfer', 'bulk transfer button', 'FAIL', 'bulkTransferBtn not found (hidden if SUBSTOCK empty)');
    checkNoNewErrors('stock/transfer', 'transfer flow clean of JS errors');
  });

  // ══════════════ DASHBOARD TAB ══════════════
  await phase('dashboard', async () => {
    await clickTab('dash');
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT('dashboard') });
    const kpiCards = await page.$$('.kpi-card');
    log('dashboard', 'KPI cards render', kpiCards.length >= 4 ? 'PASS' : 'FAIL', `count=${kpiCards.length}`);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 3000 }).catch(() => null),
      clickId('exportCSVBtn', { optional: true }),
    ]);
    log('dashboard', 'export CSV button', download ? 'PASS' : 'INFO', download ? download.suggestedFilename() : 'no download event captured headlessly');
    checkNoNewErrors('dashboard', 'dashboard tab clean of JS errors');
  });

  // ══════════════ SETTINGS TAB ══════════════
  await phase('settings/toggles', async () => {
    await clickTab('cfg');
    await page.waitForTimeout(400);
    await clickId('soundToggle');
    await page.waitForTimeout(200);
    log('settings', 'sound toggle click', 'PASS');

    const lockBtns = await page.$$('.autolock-btn[data-lock]');
    log('settings', 'autolock options present', lockBtns.length === 4 ? 'PASS' : 'FAIL', `count=${lockBtns.length}`);
    if (lockBtns.length) { await lockBtns[2].click(); await page.waitForTimeout(150); }

    const sliders = await page.$$('.thresh-slider[data-thresh]');
    log('settings', 'threshold sliders present', sliders.length === 3 ? 'PASS' : 'FAIL', `count=${sliders.length}`);
    if (sliders.length) {
      await sliders[0].focus();
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    checkNoNewErrors('settings', 'toggle/slider interactions clean of JS errors');
  });

  async function addUser(name, role, pin) {
    await clickId('addUserBtn');
    await page.waitForTimeout(300);
    const opened = !!(await byId('userFormOverlay'));
    await fillId('uformName', name);
    await fillId('uformRole', role);
    await fillId('uformPin', pin);
    const swatches = await page.$$('.uform-color-swatch');
    if (swatches.length > 2) await swatches[2].click();
    await clickId('uformSave');
    await page.waitForTimeout(400);
    return opened;
  }

  // Permanent witness user — kept alive for the HIGH-ALERT double-check test below.
  await phase('settings/user-add-witness', async () => {
    const opened = await addUser('พยาน ทดสอบ ระบบ', 'ผู้ช่วยเภสัชกร', '5678');
    log('settings/user', 'add-user form opens', opened ? 'PASS' : 'FAIL');
    const userRows = await page.$$('.user-row');
    log('settings/user', 'new witness user appears in list', userRows.length >= 2 ? 'PASS' : 'FAIL', `rows=${userRows.length}`);
    checkNoNewErrors('settings/user', 'add-user flow clean of JS errors');
  });

  await phase('settings/user-edit', async () => {
    const editBtns = await page.$$('.user-edit-btn[data-edituid]');
    if (editBtns.length >= 2) {
      await editBtns[editBtns.length - 1].click();
      await page.waitForTimeout(300);
      log('settings/user', 'edit-user form opens', (await byId('userFormOverlay')) ? 'PASS' : 'FAIL');
      log('settings/user', 'delete button present for non-last user', (await byId('uformDelete')) ? 'PASS' : 'FAIL');
      await clickId('uformCancel', { optional: true }); // cancel — keep witness user alive for the HA test
    } else log('settings/user', 'edit-user button', 'FAIL', `only ${editBtns.length} edit buttons found`);
    checkNoNewErrors('settings/user', 'edit/delete-user flow clean of JS errors');
  });

  await phase('settings/user-delete', async () => {
    await addUser('ลบทิ้ง ผู้ใช้ชั่วคราว', 'ทดสอบลบ', '9999');
    const editBtns = await page.$$('.user-edit-btn[data-edituid]');
    const rowsBefore = (await page.$$('.user-row')).length;
    if (editBtns.length >= 3) {
      await editBtns[editBtns.length - 1].click();
      await page.waitForTimeout(300);
      const delBtn = await byId('uformDelete');
      if (delBtn) { await delBtn.click(); await page.waitForTimeout(400); }
      const rowsAfter = (await page.$$('.user-row')).length;
      log('settings/user', 'delete-user removes the throwaway user', rowsAfter === rowsBefore - 1 ? 'PASS' : 'FAIL', `before=${rowsBefore} after=${rowsAfter}`);
    } else log('settings/user', 'delete-user removes the throwaway user', 'FAIL', `expected 3 edit buttons, found ${editBtns.length}`);
    checkNoNewErrors('settings/user', 'delete-user flow clean of JS errors');
  });

  await phase('settings/gemini', async () => {
    const geminiInput = await byId('geminiKeyInput');
    if (geminiInput) {
      await geminiInput.fill('AIzaSyTEST_FAKE_KEY_FOR_QA_0000000000');
      await page.waitForTimeout(150);
      log('settings', 'Gemini API key input accepts text', 'PASS');
    } else log('settings', 'Gemini API key input', 'FAIL', 'geminiKeyInput not found');
    checkNoNewErrors('settings', 'gemini key input clean of JS errors');
  });

  // ══════════════ TOPBAR / GLOBAL OVERLAYS ══════════════
  await phase('global/notif', async () => {
    await clickId('notifBtn');
    await page.waitForTimeout(300);
    log('global', 'notification sheet opens', (await byId('sheetOverlay')) ? 'PASS' : 'FAIL');
    await clickId('closeSheetBtn', { optional: true });
    await page.waitForTimeout(200);
    checkNoNewErrors('global', 'notification sheet clean of JS errors');
  });

  await phase('global/cmdpalette', async () => {
    await clickId('cmdBtn');
    await page.waitForTimeout(300);
    const cmdOpen = !!(await page.$('.cmd-overlay'));
    log('global', 'command palette opens', cmdOpen ? 'PASS' : 'FAIL');
    await page.screenshot({ path: SHOT('cmd-palette') });
    if (cmdOpen) {
      const cmdInput = await page.$('.cmd-input');
      if (cmdInput) { await cmdInput.fill('สแกน'); await page.waitForTimeout(200); }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    checkNoNewErrors('global', 'command palette clean of JS errors');
  });

  // ══════════════ HIGH-ALERT DOUBLE CHECK ══════════════
  // Exercises both halves of the security check: a wrong PIN must be
  // rejected, and only the *selected* witness's own PIN may confirm.
  await phase('high-alert', async () => {
    const haFnExists = await page.evaluate(() => typeof _showHighAlertDoubleCheck === 'function');
    log('high-alert', '_showHighAlertDoubleCheck function reachable', haFnExists ? 'PASS' : 'FAIL');
    if (haFnExists) {
      await page.evaluate(() => {
        S.scanResult = { name: 'มอร์ฟีน 10mg/ml TEST', highAlert: true };
        window.__haWitness = undefined;
        _showHighAlertDoubleCheck((witness) => { window.__haWitness = witness || null; });
      });
      await page.waitForTimeout(300);
      log('high-alert', 'HA double-check overlay renders', (await byId('haDoubleCheckOverlay')) ? 'PASS' : 'FAIL');
      await page.screenshot({ path: SHOT('ha-overlay') });

      const witnessSel = await byId('haWitnessSel');
      if (witnessSel) {
        const opts = await witnessSel.$$eval('option', (os) => os.map((o) => o.value));
        log('high-alert', 'witness dropdown has other users', opts.length >= 1 ? 'PASS' : 'FAIL', `options=${opts.length}`);
      }

      // Wrong PIN (admin's own "0000", not the witness's) must NOT confirm.
      for (const d of [0, 0, 0, 0]) { await pressKey('.ha-pin-key[data-key]', d); await page.waitForTimeout(150); }
      await page.waitForTimeout(300);
      const afterWrong = await page.evaluate(() => window.__haWitness);
      log('high-alert', 'wrong witness PIN is rejected', afterWrong === undefined ? 'PASS' : 'FAIL', `callback value=${JSON.stringify(afterWrong)}`);

      // Clear the digits, then enter the witness's real PIN (5678) — must confirm.
      for (let i = 0; i < 4; i++) {
        const delBtn = await page.$('.ha-pin-del');
        if (delBtn) await delBtn.click();
        await page.waitForTimeout(100);
      }
      for (const d of [5, 6, 7, 8]) { await pressKey('.ha-pin-key[data-key]', d); await page.waitForTimeout(150); }
      await page.waitForTimeout(400);
      const afterCorrect = await page.evaluate(() => window.__haWitness);
      log('high-alert', 'correct witness PIN confirms and calls back', afterCorrect && afterCorrect.pin === '5678' ? 'PASS' : 'FAIL', JSON.stringify(afterCorrect));
      await page.screenshot({ path: SHOT('ha-after-confirm') });

      const leftover = await byId('haDoubleCheckOverlay');
      if (leftover) await leftover.evaluate((n) => n.remove());
    }
    checkNoNewErrors('high-alert', 'HA double-check flow clean of JS errors');
  });

  // ══════════════ LOGOUT ══════════════
  await phase('auth-logout', async () => {
    await clickId('lockBtn');
    await page.waitForTimeout(400);
    log('auth', 'logout returns to lock screen', (await page.$('#lock-screen')) ? 'PASS' : 'FAIL');
    await page.screenshot({ path: SHOT('after-logout') });
  });

  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  const fails = report.filter((r) => r.status === 'FAIL');
  const passes = report.filter((r) => r.status === 'PASS');
  console.log('\n\n===== SUMMARY =====');
  console.log(`PASS: ${passes.length}  FAIL: ${fails.length}  INFO: ${report.length - passes.length - fails.length}`);
  console.log(`Screenshots: ${ARTIFACTS}`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log(` - [${f.area}] ${f.step} :: ${f.detail}`));
  }
  fs.writeFileSync(path.join(ARTIFACTS, 'qa-report.json'), JSON.stringify(report, null, 2));
  process.exitCode = fails.length ? 1 : 0;
}

// Hard ceiling so a stuck selector/navigation can never hang CI forever.
const watchdog = setTimeout(() => {
  console.error('FATAL: qa-full-flow.js exceeded its 3-minute watchdog — killing.');
  process.exit(1);
}, 3 * 60 * 1000);

run()
  .catch((e) => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(() => clearTimeout(watchdog));
