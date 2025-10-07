// /static/js/customer_form.js (reorganized)
// ————————————————————————————————————————————
// Key fixes
// 1) Use $(id) helper = document.getElementById(id) — DO NOT prefix with '#'
// 2) Single submit flow (no double POST). Duplicate-check happens before submit.
// 3) Robust field serialization + type normalization (e.g., cf_hq to 0/1/null)
// 4) Clean pagination + search + edit-fill + province suggestions (fallback)
// 5) Defensive fetch wrappers + small UX helpers
// ————————————————————————————————————————————

// ===== Endpoints =====
const ENDPOINT_LIST = '/api/customers';
const ENDPOINT_ALL = '/api/customers/all';
const ENDPOINT_DETAIL = '/api/customers/detail';
const ENDPOINT_DUPCHK = '/api/customers/check-duplicate';
const ENDPOINT_PROV_SUGGEST = '/api/suggest/province'; // if backend not present, we fallback

// ===== State =====
let ALL_CACHE = []; // for datalist fallback & client-side utilities
let CURRENT_ITEMS = []; // current page items for table
let CURRENT_PAGE = 1;
let TOTAL_PAGES = 1;
let TOTAL_ITEMS = 0;
const PAGE_SIZE = 20;
let EDITING_IDX = null; // when editing existing row

// ===== Tiny utils =====
const $ = (id) => document.getElementById(id);
const norm = (s) => (s ?? '').toString().trim();
const lower = (s) => norm(s).toLowerCase();
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const debounce = (fn, delay = 250) => {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
};

// Parse cf_hq input into 0/1/null consistently
function parseHqValue(v) {
  const s = lower(v);
  if (s === '') return null;
  if (s === '1' || s === 'hq' || s === 'สำนักงานใหญ่') return 1;
  if (s === '0' || s === 'branch' || s === 'สาขา') return 0;
  // numeric fallback
  const n = Number(v);
  return Number.isNaN(n) ? null : (n === 0 ? 0 : 1);
}

<<<<<<< HEAD
// +++ เพิ่ม: ฟังก์ชันสำหรับขอรหัสลูกค้าใหม่จาก API +++
async function generateAndSetNewCustomerId() {
  const personIdInput = $('personid');
  if (!personIdInput) return;

  try {
    const response = await fetch('/api/customers/next-id');
    if (!response.ok) throw new Error('Failed to fetch next customer ID');
    
    const data = await response.json();
    personIdInput.value = data.next_id;
    personIdInput.readOnly = true; // ล็อคช่องนี้ ไม่ให้แก้ไข
    
  } catch (error) {
    console.error(error);
    personIdInput.value = 'ไม่สามารถสร้างรหัสได้';
    personIdInput.readOnly = true;
  }
}

// ===== โหลดทั้งหมด =====
async function loadAll() {
=======
function setDisabled(el, disabled = true) {
  if (!el) return;
  if (disabled) {
    el.setAttribute('disabled', 'disabled');
    el.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    el.removeAttribute('disabled');
    el.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

// ===== Fetch helpers =====
async function jget(url, params = {}) {
  const q = new URLSearchParams(params);
  const res = await fetch(q.size ? `${url}?${q}` : url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return await res.json();
}
async function jpost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return await res.json().catch(() => ({}));
}
async function jput(url, body) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return await res.json().catch(() => ({}));
}

// ===== Form serialization =====
function readForm() {
  const payload = {
    idx: norm($('idx')?.value) || null,
    personid: norm($('personid')?.value),
    prename: norm($('prename')?.value),
    fname: norm($('fname')?.value),
    lname: norm($('lname')?.value),
    cf_taxid: norm($('cf_taxid')?.value),
    cf_personaddress: norm($('cf_personaddress')?.value),
    cf_personzipcode: norm($('cf_personzipcode')?.value),
    cf_provincename: norm($('cf_provincename')?.value),
    cf_personaddress_tel: norm($('cf_personaddress_tel')?.value),
    cf_personaddress_mobile: norm($('cf_personaddress_mobile')?.value),
    fmlpaymentcreditday: norm($('fmlpaymentcreditday')?.value),
    cf_hq: $('cf_hq') ? $('cf_hq').value : '',
    cf_branch: norm($('cf_branch')?.value),
  };

  // normalize types
  payload.fmlpaymentcreditday = payload.fmlpaymentcreditday === '' ? null : Number(payload.fmlpaymentcreditday);
  payload.cf_hq = parseHqValue(payload.cf_hq);

  // personid: allow backend generation if empty
  if (!payload.personid) payload.personid = '';

  return payload;
}

function writeForm(c) {
  $('idx').value = c.idx ?? '';
  $('personid').value = c.personid ?? '';
  $('prename').value = c.prename ?? '';
  $('fname').value = c.fname ?? '';
  $('lname').value = c.lname ?? '';
  $('cf_taxid').value = c.cf_taxid ?? c.tax_id ?? c.taxid ?? '';
  $('cf_personaddress').value = c.cf_personaddress ?? c.address ?? '';
  $('cf_personzipcode').value = c.cf_personzipcode ?? c.zipcode ?? '';
  $('cf_provincename').value = c.cf_provincename ?? c.province ?? '';
  $('cf_personaddress_tel').value = c.cf_personaddress_tel ?? c.tel ?? '';
  $('cf_personaddress_mobile').value = c.cf_personaddress_mobile ?? c.mobile ?? '';
  $('fmlpaymentcreditday').value = c.fmlpaymentcreditday ?? '';
  const hq = (c.cf_hq ?? null);
  $('cf_hq').value = (hq === null ? '' : String(hq));
  $('cf_branch').value = c.cf_branch ?? '';
  toggleBranchBox();
}

function resetForm() {
  EDITING_IDX = null;
  $('customerForm').reset();
  $('idx').value = '';
  $('personid').value = '';
  toggleBranchBox();
  hideDupWarn();
}

// ===== Duplicate check =====
async function isDuplicate(payload, excludeIdx = null) {
>>>>>>> 01fab89be1e19f29a5821729c819e7fdd153faa8
  try {
    const body = {
      personid: payload.personid || null,
      fname: payload.fname || null,
      lname: payload.lname || null,
      cf_taxid: payload.cf_taxid || null,
      exclude_idx: excludeIdx,
    };
    const out = await jpost(ENDPOINT_DUPCHK, body);
    return !!out.duplicate; // backend returns { duplicate: false } for now
  } catch (e) {
    console.warn('dup-check failed (treat as not duplicate)', e);
    return false;
  }
}

// ===== Province suggest (with fallback) =====
async function suggestProvinces() {
  const input = $('cf_provincename');
  const dl = $('province_datalist');
  if (!input || !dl) return;
  const q = norm(input.value);
  if (!q) { dl.innerHTML = ''; return; }

  // try server suggest first
  try {
    const list = await jget(ENDPOINT_PROV_SUGGEST, { q });
    dl.innerHTML = list.map(p => `<option value="${esc(p)}"></option>`).join('');
    return;
  } catch {
    // fallback from ALL_CACHE
    const cand = Array.from(new Set(ALL_CACHE.map(c => c.cf_provincename || c.province || '')))
      .filter(Boolean)
      .filter(p => lower(p).includes(lower(q)))
      .slice(0, 15);
    dl.innerHTML = cand.map(p => `<option value="${esc(p)}"></option>`).join('');
  }
}

// ===== Table render helpers =====
function displayName(c) {
  const pre = c.prename ? `${c.prename}` : '';
  return `${pre}${pre ? ' ' : ''}${c.fname || ''} ${c.lname || ''}`.trim();
}
function displayPhone(c) { return c.cf_personaddress_mobile || c.mobile || c.cf_personaddress_tel || c.tel || ''; }
function getTaxId(c) { return c.cf_taxid ?? c.tax_id ?? c.taxid ?? ''; }
function getProvince(c) { return c.cf_provincename ?? c.province ?? ''; }

function renderTable(items) {
  const tb = $('tbody');
  if (!tb) return;
  tb.innerHTML = '';
  items.forEach((c) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b';
    tr.innerHTML = `
      <td class="p-2">${esc(displayName(c))}</td>
      <td class="p-2 hidden sm:table-cell">${esc(c.personid || '')}</td>
      <td class="p-2 hidden lg:table-cell">${esc(getTaxId(c))}</td>
      <td class="p-2">${esc(displayPhone(c))}</td>
      <td class="p-2 hidden md:table-cell">${esc(getProvince(c))}</td>
      <td class="p-2 w-24">
        <button type="button" class="text-blue-600 hover:underline btn-edit" data-idx="${c.idx}">แก้ไข</button>
      </td>`;
    tb.appendChild(tr);
  });

  // wire edit buttons
  tb.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = e.currentTarget.getAttribute('data-idx');
      const row = CURRENT_ITEMS.find(x => String(x.idx) === String(idx));
      if (row) {
        EDITING_IDX = row.idx;
        writeForm(row);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

function renderPager() {
  $('pageInfo').textContent = `หน้า ${CURRENT_PAGE} / ${TOTAL_PAGES}`;
  $('resultInfo').textContent = `${TOTAL_ITEMS.toLocaleString()} รายการ`;
}

// ===== Loading data =====
async function loadAllCache() {
  try {
    ALL_CACHE = await jget(ENDPOINT_ALL);
  } catch (e) {
    console.warn('loadAllCache failed', e);
    ALL_CACHE = [];
  }
}

<<<<<<< HEAD
// ===== ฟอร์ม =====
function resetForm() {
  editing = null;
  $('customerForm')?.reset();
  const idxEl = $('idx'); if (idxEl) idxEl.value = '';

  // ปลดล็อคช่องรหัสลูกค้าก่อน แล้วค่อยสร้างรหัสใหม่
  const personIdInput = $('personid');
  if (personIdInput) {
    personIdInput.readOnly = false;
  }
  $('btnDelete')?.classList.add('hidden');
  $('dupWarn')?.classList.add('hidden');

  generateAndSetNewCustomerId();
  const hqSelect = $('cf_hq'); if (hqSelect) hqSelect.dispatchEvent(new Event('change'));
}
function fillForm(c) {
  // +++ เพิ่ม: ปลดล็อคช่องรหัสลูกค้าเมื่ออยู่ในโหมดแก้ไข +++
  const personIdInput = $('personid');
  if (personIdInput) {
    personIdInput.readOnly = false;
  }
  // เติมค่าตามชื่อ field เดิม
  Object.keys(c || {}).forEach((k) => { const el = $(k); if (el) el.value = c[k] ?? ''; });
  // กรณีฟิลด์ที่ใช้หลายชื่อ ให้เติม fallback ด้วย
  if ($('cf_taxid') && !$('cf_taxid').value) $('cf_taxid').value = getTaxId(c);
  if ($('cf_provincename') && !$('cf_provincename').value) $('cf_provincename').value = getProvince(c);
  if ($('fname') && !$('fname').value) $('fname').value = displayName(c);

  const hqSelect = $('cf_hq'); if (hqSelect) hqSelect.dispatchEvent(new Event('change'));
}
async function isDuplicate(payload, ignoreIdx = null) {
  const fd = new FormData();
  fd.append('fname', payload.fname || '');
  fd.append('personid', payload.personid || '');
  // รองรับทั้ง cf_taxid/tax_id
  fd.append('cf_taxid', payload.cf_taxid || payload.tax_id || payload.taxid || '');
  if (ignoreIdx) fd.append('ignore_idx', ignoreIdx);
  const res = await fetch('/api/customers/check-duplicate', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  return !!data.duplicate;
}
async function saveCustomer(e) {
=======
async function loadPage(page = 1) {
  const q = $('search')?.value || '';
  const params = { page, limit: PAGE_SIZE };
  if (q) params.q = q;
  const data = await jget(ENDPOINT_LIST, params);
  CURRENT_ITEMS = data.items || [];
  CURRENT_PAGE = data.page || page;
  TOTAL_PAGES = data.pages || 1;
  TOTAL_ITEMS = data.total || (CURRENT_ITEMS?.length || 0);
  renderTable(CURRENT_ITEMS);
  renderPager();
}

// ===== Submit =====
function hideDupWarn() { $('dupWarn')?.classList.add('hidden'); }
function showDupWarn() { $('dupWarn')?.classList.remove('hidden'); }

async function onSubmit(e) {
>>>>>>> 01fab89be1e19f29a5821729c819e7fdd153faa8
  e.preventDefault();
  hideDupWarn();

<<<<<<< HEAD
  if (payload.cf_hq === '1') {
    payload.cf_branch = '';
  }

  const duplicate = await isDuplicate(payload, payload.idx || null);
  const warn = $('dupWarn');
  if (duplicate) { warn?.classList.remove('hidden'); return; }
  warn?.classList.add('hidden');
=======
  const btnSubmit = $('customerForm')?.querySelector('button[type="submit"]');
  setDisabled(btnSubmit, true);
>>>>>>> 01fab89be1e19f29a5821729c819e7fdd153faa8

  try {
    const payload = readForm();
    const duplicate = await isDuplicate(payload, payload.idx || null);
    if (duplicate) { showDupWarn(); return; }

    let res;
    if (payload.idx) {
      // UPDATE
      const idx = payload.idx; const body = { ...payload }; delete body.idx;
      res = await jput(`${ENDPOINT_LIST}/${idx}`, body);
    } else {
      // CREATE
      res = await jpost(ENDPOINT_LIST, payload);
    }

    // Backend may redirect (fastapi can also return json). Handle both.
    if (res && res.redirected && res.url) {
      window.location.href = res.url; return;
    }

    await loadPage(CURRENT_PAGE);
    if (!payload.idx) resetForm();
    alert('บันทึกเรียบร้อย');
  } catch (err) {
    console.error(err);
    alert('บันทึกล้มเหลว');
  } finally {
    setDisabled(btnSubmit, false);
  }
}

// ===== Edit helpers =====
async function fillFromDetailByPersonId(pid) {
  if (!pid) return;
  try {
    const c = await jget(ENDPOINT_DETAIL, { personid: pid });
    writeForm(c);
  } catch (e) {
    // ignore if not found
  }
}

// ===== UI wiring =====
function toggleBranchBox() {
  const sel = $('cf_hq');
  const box = $('branchBox');
  if (!sel || !box) return;
  const v = parseHqValue(sel.value);
  if (v === 0) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

function wireUI() {
  // search + pager
  $('search')?.addEventListener('input', debounce(() => loadPage(1), 300));
  $('prevPage')?.addEventListener('click', () => { if (CURRENT_PAGE > 1) loadPage(CURRENT_PAGE - 1); });
  $('nextPage')?.addEventListener('click', () => { if (CURRENT_PAGE < TOTAL_PAGES) loadPage(CURRENT_PAGE + 1); });

  // form
  $('customerForm')?.addEventListener('submit', onSubmit);
  $('btnReset')?.addEventListener('click', (e) => { e.preventDefault(); resetForm(); });
  $('btnDelete')?.addEventListener('click', (e) => { e.preventDefault(); alert('ยังไม่ได้เปิดใช้การลบ'); });
  $('redirectDash')?.addEventListener('click', (e) => { e.preventDefault(); window.location.href = '/'; });

  // HQ/Branch toggle
  $('cf_hq')?.addEventListener('change', toggleBranchBox);

<<<<<<< HEAD
  // +++ เพิ่ม: จัดการการแสดงผลของช่องรหัสสาขา +++
  const hqSelect = $('cf_hq');
  const branchWrapper = $('branch_field_wrapper');
  if (hqSelect && branchWrapper) {
    hqSelect.addEventListener('change', () => {
      // ถ้า cf_hq == 0 (สาขา) ให้แสดง, ถ้าเป็น 1 (สนง.ใหญ่) ให้ซ่อน
      branchWrapper.style.display = hqSelect.value === '0' ? 'block' : 'none';
    });
    // เรียกครั้งแรกตอนโหลดหน้า
    hqSelect.dispatchEvent(new Event('change'));
  }

  const provInput = $('cf_provincename');
  if (provInput) {
=======
  // Province suggest (typeahead)
  const prov = $('cf_provincename');
  if (prov) {
>>>>>>> 01fab89be1e19f29a5821729c819e7fdd153faa8
    const deb = debounce(suggestProvinces, 200);
    prov.addEventListener('input', deb);
    prov.addEventListener('focus', () => { if (prov.value) suggestProvinces(); });
  }
<<<<<<< HEAD
  generateAndSetNewCustomerId();
  loadAll();
=======

  // Optional: auto-fill by personid change
  $('personid')?.addEventListener('change', (e) => fillFromDetailByPersonId(e.target.value));
>>>>>>> 01fab89be1e19f29a5821729c819e7fdd153faa8
}

// ===== Init =====
async function init() {
  wireUI();
  toggleBranchBox();
  await loadAllCache();
  await loadPage(1);
}

document.addEventListener('DOMContentLoaded', init);
