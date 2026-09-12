// Run: node --test tests/form_regressions.cjs
// Requires Playwright and Chromium. Set PLAYWRIGHT_MODULE / CHROME_EXECUTABLE
// when those dependencies are installed outside the project.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, server, origin;
const customer = { idx: 1, personid: 'PC001', prename: 'บริษัท', fname: 'ทดสอบ จำกัด' };
const bill = {
    customer: { person_id: customer.personid, prename: customer.prename, name: customer.fname },
    bill_note_number: 'BNTEST', bill_date: '2026-08-15',
    invoices: [{ invoice_number: 'INV001', invoice_date: '2026-08-01', due_date: '2026-09-01', amount: 107 }],
    summary: { total_amount: 107 }
};

before(async () => {
    server = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        let file = pathname.startsWith('/static/') ? 'app' + pathname : 'app/templates' + pathname;
        const absolute = path.resolve(root, file);
        if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) {
            res.writeHead(404).end(); return;
        }
        const contentType = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.ttf': 'font/ttf' }[path.extname(absolute)];
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        res.end(fs.readFileSync(absolute));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || undefined, headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function openForm(name, { delayFonts = 0, failFonts = false, mobile = false } = {}) {
    const context = await browser.newContext({ timezoneId: 'Asia/Bangkok', ...(mobile ? { isMobile: true, viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/148.0.0.0 Mobile Safari/537.36' } : {}) });
    const page = await context.newPage();
    const dialogs = [];
    await page.clock.setFixedTime(new Date('2026-09-11T17:30:00Z'));
    // Keep test data isolated from the database and unrelated third-party UI assets.
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('flatpickr')) {
                if (!process.env.FLATPICKR_DIR) return route.continue();
                const suffix = url.pathname.includes('/dist/') ? url.pathname.split('/dist/')[1] : 'flatpickr.min.js';
                return route.fulfill({ path: path.join(process.env.FLATPICKR_DIR, suffix), contentType: suffix.endsWith('.css') ? 'text/css' : 'text/javascript' });
            }
            return route.fulfill({ body: '', contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        if (url.pathname === '/api/credit-notes/preview') return route.fulfill({ contentType: 'text/html', body: '<div class="A4-page"><div class="credit-note">Credit preview</div></div>' });
        if (url.pathname.startsWith('/api/')) {
            let data = {};
            if (url.pathname === '/api/customers/all') data = [{ idx: customer.idx, personid: customer.personid, prename: customer.prename, customer_name: customer.fname }];
            else if (url.pathname === '/api/billing-note-invoices') data = bill;
            else if (url.pathname === '/api/customers/by-personid' || url.pathname === '/api/customers/by-name') data = customer;
            else if (url.pathname.includes('suggest')) data = { items: [] };
            else if (url.pathname === '/api/billing-notes' && route.request().method() === 'POST') data = { billnote_number: 'BNTEST' };
            else if (url.pathname === '/api/search-billing-notes') data = [{ billnote_number: 'BNTEST', bill_date: bill.bill_date, fname: customer.fname }];
            else if (url.pathname.startsWith('/api/billing-notes/')) data = bill;
            else if (url.pathname === '/api/search-credit-notes') data = [{ creditnote_number: 'CNTEST', created_at: '2026-08-15', customer_name: customer.fname }];
            else if (url.pathname.startsWith('/api/credit-notes/')) data = { head: { creditnote_number: 'CNTEST', created_at: '2026-08-15' }, items: [], buyer: { personid: customer.personid, prename: customer.prename, name: customer.prename + ' ' + customer.fname } };
            return route.fulfill({ json: data });
        }
        if (url.pathname.endsWith('.ttf') && failFonts) return route.abort('failed');
        if (url.pathname.endsWith('.ttf') && delayFonts) await new Promise(resolve => setTimeout(resolve, delayFonts));
        return route.continue();
    });
    page.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.dismiss(); });
    await page.addInitScript(() => {
        window.printSnapshots = [];
        window.print = () => window.printSnapshots.push(
            ['normal 400', 'normal 700', 'italic 400', 'italic 700'].map(style =>
                [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'TH Sarabun New' && face.style === style.split(' ')[0] && (face.weight === style.split(' ')[1] || (face.weight === 'normal' && style.endsWith('400')) || (face.weight === 'bold' && style.endsWith('700'))) && face.status === 'loaded')));
    });
    await page.goto(origin + '/' + name, { waitUntil: 'domcontentloaded' });
    return { page, dialogs, recoverFonts: () => { failFonts = false; }, close: () => context.close() };
}

async function setDate(page, id, value) {
    await page.locator('#' + id).evaluate((el, date) => {
        if (el._flatpickr) el._flatpickr.setDate(date, true);
        else { el.value = date; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, value);
}

async function generateBill(page) {
    await page.waitForFunction(() => document.querySelector('#customerList option'));
    const label = await page.locator('#customerList option').first().getAttribute('value');
    await page.locator('#customerSearch').fill(label);
    await page.locator('#customerSearch').dispatchEvent('change');
    await setDate(page, 'startDate', '2026-08-01');
    await setDate(page, 'endDate', '2026-08-31');
    await setDate(page, 'billDate', '2026-08-15');
    await page.locator('#generateBillBtn').click();
    await page.waitForFunction(() => document.querySelector('#bill-note-container .cust-name')?.textContent);
}

test('first bill print waits for cold-cache normal and bold Thai fonts; repeat print works', async () => {
    const { page, close } = await openForm('bill_note.html', { delayFonts: 5000 });
    try {
        await generateBill(page);
        await page.locator('#printPdfBtn').evaluate(el => el.click());
        await page.waitForFunction(() => window.printSnapshots.length === 1);
        assert.deepEqual(await page.evaluate(() => window.printSnapshots[0]), [true, true, true, true]);
        await page.locator('#printPdfBtn').click();
        await page.waitForFunction(() => window.printSnapshots.length === 2);
        assert.deepEqual(await page.evaluate(() => window.printSnapshots[1]), [true, true, true, true]);
    } finally { await close(); }
});

test('bill customer picker preserves prename and selected customer identity', async () => {
    const { page, close } = await openForm('bill_note.html');
    try {
        await generateBill(page);
        assert.equal(await page.locator('#customerSearch').inputValue(), 'PC001 | บริษัท ทดสอบ จำกัด');
        assert.equal(await page.locator('#customerId').inputValue(), '1');
        assert.equal(await page.locator('.cust-name').textContent(), 'บริษัท ทดสอบ จำกัด');
    } finally { await close(); }
});

test('credit personid lookup includes prename in the form', async () => {
    const { page, close } = await openForm('credit_note_form.html');
    try {
        await page.locator('#personid').fill('PC001');
        await page.evaluate(() => selectCustomerByPersonid());
        assert.equal(await page.locator('#customer_name').inputValue(), 'บริษัท ทดสอบ จำกัด');
    } finally { await close(); }
});

test('all eight form and search dates use Thai picker, initial BE display and CE values', async () => {
    for (const [name, ids] of [
        ['bill_note.html', ['billDate', 'startDate', 'endDate', 'searchStartDate', 'searchEndDate']],
        ['credit_note_form.html', ['cn_date', 'searchStartDate', 'searchEndDate']]
    ]) {
        const { page, close } = await openForm(name);
        try {
            for (const id of ids) {
                assert.equal(await page.locator('#' + id).evaluate(el => !!el._flatpickr), true, `${name} #${id} missing picker`);
                const initial = await page.locator('#' + id).evaluate(el => ({ value: el.value, shown: el._flatpickr.altInput.value }));
                if (initial.value) assert.match(initial.shown, /2569/);
                await setDate(page, id, '2026-09-12');
                assert.equal(await page.locator('#' + id).inputValue(), '2026-09-12');
                assert.match(await page.locator('#' + id).evaluate(el => el._flatpickr.altInput.value), /2569/);
            }
        } finally { await close(); }
    }
});

test('bill save sends the selected document date instead of today', async () => {
    const { page, close } = await openForm('bill_note.html');
    try {
        await generateBill(page);
        const sent = page.waitForRequest(req => req.url().endsWith('/api/billing-notes') && req.method() === 'POST');
        await page.locator('#saveBillBtn').click();
        assert.equal((await sent).postDataJSON().bill_date, '2026-08-15');
    } finally { await close(); }
});

test('date picker handles initial local date, silent updates, year navigation and clear', async () => {
    const { page, close } = await openForm('bill_note.html');
    try {
        assert.equal(await page.locator('#billDate').inputValue(), '2026-09-12');
        assert.equal(await page.locator('#startDate').inputValue(), '2026-09-01');
        const result = await page.evaluate(async () => {
            const input = document.createElement('input');
            document.body.appendChild(input);
            const picker = ThaiDatePicker.init(input, { defaultDate: '2026-09-12' });
            const initial = picker.fp.altInput.value;
            picker.setDate('2025-12-31', false);
            const silent = { value: input.value, shown: picker.fp.altInput.value };
            picker.fp.changeYear(2024);
            await new Promise(requestAnimationFrame);
            const year = picker.fp.calendarContainer.querySelector('.cur-year').value;
            const unsafeYearSpinnersHidden = [...picker.fp.calendarContainer.querySelectorAll('.numInputWrapper .arrowUp, .numInputWrapper .arrowDown')].every(el => getComputedStyle(el).display === 'none');
            picker.clear();
            const cleared = { value: input.value, shown: picker.fp.altInput.value };
            picker.destroy(); input.remove();
            return { initial, silent, year, cleared, unsafeYearSpinnersHidden };
        });
        assert.match(result.initial, /2569/);
        assert.equal(result.silent.value, '2025-12-31');
        assert.match(result.silent.shown, /2568/);
        assert.equal(result.year, '2567');
        assert.equal(result.unsafeYearSpinnersHidden, true);
        assert.deepEqual(result.cleared, { value: '', shown: '' });
    } finally { await close(); }
});

test('mobile form keeps the Thai Buddhist year picker', async () => {
    const { page, close } = await openForm('credit_note_form.html', { mobile: true });
    try {
        const state = await page.locator('#cn_date').evaluate(el => ({ mobile: el._flatpickr.isMobile, shown: el._flatpickr.altInput.value }));
        assert.equal(state.mobile, false);
        assert.match(state.shown, /2569/);
    } finally { await close(); }
});

test('loading saved bill synchronizes its picker and update keeps the saved date', async () => {
    const { page, close } = await openForm('bill_note.html');
    try {
        await page.locator('#tab-search').click();
        await page.locator('#searchBillBtn').click();
        await page.locator('#searchResultsBody .btn-view-edit').click();
        await page.waitForFunction(() => !document.querySelector('#updateBillBtn').classList.contains('hidden'));
        assert.equal(await page.locator('#billDate').inputValue(), '2026-08-15');
        assert.match(await page.locator('#billDate').evaluate(el => el._flatpickr.altInput.value), /15.*2569/);
        const sent = page.waitForRequest(req => req.url().includes('/api/billing-notes/BNTEST') && req.method() === 'PUT');
        await page.locator('#updateBillBtn').click();
        assert.equal((await sent).postDataJSON().bill_date, '2026-08-15');
    } finally { await close(); }
});

test('loading and resetting credit note synchronize the displayed and submitted dates', async () => {
    const { page, close } = await openForm('credit_note_form.html');
    try {
        await page.locator('#tab-search').click();
        await page.locator('#searchBtn').click();
        await page.locator('#searchResultsBody .btn-view-edit').click();
        await page.waitForFunction(() => !document.querySelector('#btnUpdate').classList.contains('hidden'));
        assert.equal(await page.locator('#cn_date').inputValue(), '2026-08-15');
        assert.match(await page.locator('#cn_date').evaluate(el => el._flatpickr.altInput.value), /15.*2569/);
        assert.equal(await page.evaluate(() => buildPayload().creditnote_date), '2026-08-15');
        await page.locator('#btnNew').click();
        assert.equal(await page.locator('#cn_date').inputValue(), '2026-09-12');
        assert.match(await page.locator('#cn_date').evaluate(el => el._flatpickr.altInput.value), /12.*2569/);
    } finally { await close(); }
});

test('failed font load blocks print and the next attempt can recover', async () => {
    const { page, dialogs, recoverFonts, close } = await openForm('bill_note.html', { failFonts: true });
    try {
        await generateBill(page);
        await page.locator('#printPdfBtn').evaluate(el => el.click());
        await page.waitForFunction(() => !document.querySelector('#printPdfBtn').disabled);
        assert.equal(await page.evaluate(() => window.printSnapshots.length), 0);
        assert.ok(dialogs.length, 'User should see a font loading error');
        recoverFonts();
        await page.locator('#printPdfBtn').evaluate(el => el.click());
        await page.waitForFunction(() => window.printSnapshots.length === 1, null, { timeout: 12000 }).catch(async error => {
            error.message += JSON.stringify({ dialogs, fonts: await page.evaluate(() => [...document.fonts].map(face => ({ family: face.family, style: face.style, weight: face.weight, status: face.status }))) });
            throw new Error(error.message);
        });
        assert.deepEqual(await page.evaluate(() => window.printSnapshots[0]), [true, true, true, true]);
    } finally { await close(); }
});
test('search requests send CE dates from both Thai date pickers', async () => {
    for (const [name, button, endpoint] of [
        ['bill_note.html', 'searchBillBtn', '/api/search-billing-notes'],
        ['credit_note_form.html', 'searchBtn', '/api/search-credit-notes']
    ]) {
        const { page, close } = await openForm(name);
        try {
            await page.locator('#tab-search').click();
            await setDate(page, 'searchStartDate', '2025-12-01');
            await setDate(page, 'searchEndDate', '2025-12-31');
            const sent = page.waitForRequest(req => new URL(req.url()).pathname === endpoint);
            await page.locator('#' + button).click();
            const query = new URL((await sent).url()).searchParams;
            assert.equal(query.get('start'), '2025-12-01');
            assert.equal(query.get('end'), '2025-12-31');
        } finally { await close(); }
    }
});
test('credit lookup by legacy bare name normalizes the displayed customer name', async () => {
    const { page, close } = await openForm('credit_note_form.html');
    try {
        await page.locator('#customer_name').fill('ทดสอบ จำกัด');
        await page.evaluate(() => selectCustomer());
        assert.equal(await page.locator('#personid').inputValue(), 'PC001');
        assert.equal(await page.locator('#customer_name').inputValue(), 'บริษัท ทดสอบ จำกัด');
    } finally { await close(); }
});
test('credit browser preview is ready for its first print with a cold font cache', async () => {
    const { page, close } = await openForm('credit_note_form.html', { delayFonts: 1200 });
    try {
        await page.locator('#btnPreview').click();
        await page.waitForFunction(() => document.querySelector('#preview .A4-page'));
        await page.evaluate(() => window.print());
        assert.deepEqual(await page.evaluate(() => window.printSnapshots[0]), [true, true, true, true]);
        await page.emulateMedia({ media: 'print' });
        assert.match(await page.locator('#preview .A4-page').evaluate(el => getComputedStyle(el).fontFamily), /TH Sarabun New/);
    } finally { await close(); }
});
test('credit preview recovers when font downloads work again', async () => {
    const { page, recoverFonts, close } = await openForm('credit_note_form.html', { failFonts: true });
    try {
        const firstError = page.waitForEvent('dialog');
        await page.locator('#btnPreview').click();
        await firstError;
        assert.equal(await page.locator('#preview .A4-page').count(), 0);
        recoverFonts();
        await page.locator('#btnPreview').click();
        await page.waitForFunction(() => document.querySelector('#preview .A4-page'), null, { timeout: 12000 });
        await page.evaluate(() => window.print());
        assert.deepEqual(await page.evaluate(() => window.printSnapshots[0]), [true, true, true, true]);
    } finally { await close(); }
});