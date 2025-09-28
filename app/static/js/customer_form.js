// /static/js/customer_form.js

// ===== Config / Endpoints =====
const ENDPOINT_PROV_SUGGEST = '/api/suggest/province';

// ===== State & Helpers =====
let all = [];
let filtered = [];
let editing = null;
let currentPage = 1;
const PAGE_SIZE = 20;

const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const debounce = (fn, delay = 250) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// helper
function $(id) { return document.getElementById(id); }
function show(el) { if (!el) return; el.classList.remove('hidden'); el.style.display = ''; el.removeAttribute('hidden'); }
function hide(el) { if (!el) return; el.classList.add('hidden'); el.style.display = 'none'; el.setAttribute('hidden', ''); }

// แปลงค่าที่ได้จาก select ให้เป็น 0/1 เสมอ
function parseHqValue(v) {
  const s = String(v ?? '').trim();
  if (s === '0' || s.toLowerCase() === 'branch' || s === 'สาขา') return 0;
  if (s === '1' || s.toLowerCase() === 'hq' || s === 'สำนักงานใหญ่') return 1;
  return s === '' ? null : Number.isNaN(Number(s)) ? null : Number(s);
}

// ใช้ customer_name เป็นหลัก; ถ้าไม่มีค่อย fallback prename/fname/lname
function displayName(c) {
  const primary = (c.customer_name || '').toString().trim();
  if (primary) return primary;
  const combo = [c.prename, c.fname, c.lname].filter(Boolean).join(' ').trim();
  return combo || c.fname || '';
}
function displayPhone(c) {
  return c.mobile || c.tel || c.cf_personaddress_mobile || '';
}
// เลขภาษี รองรับหลายคีย์จาก backend
function getTaxId(c) {
  return c.cf_taxid ?? c.tax_id ?? c.taxid ?? '';
}
function getProvince(c) {
  return c.cf_provincename ?? c.province ?? '';
}

// ===== โหลดทั้งหมด =====
async function loadAll() {
  try {
    const res = await fetch('/api/customers/all');
    if (!res.ok) throw new Error('โหลดรายการลูกค้าไม่สำเร็จ');
    all = await res.json();
    filtered = all.slice();
    currentPage = 1;
    renderPage();
  } catch (e) {
    console.error(e);
    all = []; filtered = [];
    renderPage();
  }
}

// ===== แสดงหน้าปัจจุบัน =====
function renderPage() {
  const total = filtered.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > maxPage) currentPage = maxPage;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(total, startIdx + PAGE_SIZE);
  const pageRows = filtered.slice(startIdx, endIdx);

  renderTable(pageRows);

  const resultInfo = $('resultInfo');
  if (resultInfo) {
    const from = total === 0 ? 0 : startIdx + 1;
    resultInfo.textContent = `แสดง ${from}-${endIdx} จากทั้งหมด ${total} รายการ`;
  }
  const pageInfo = $('pageInfo');
  if (pageInfo) pageInfo.textContent = `หน้า ${currentPage} / ${maxPage}`;

  const prevBtn = $('prevPage'), nextBtn = $('nextPage');
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= maxPage;
}

// ===== เรนเดอร์ตารางของหน้า =====
function renderTable(rows) {
  const tb = $('tbody');
  if (!tb) return;
  tb.innerHTML = '';

  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="p-2 text-center text-gray-500" colspan="6">ไม่พบข้อมูล</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach((c) => {
    const tr = document.createElement('tr');
    tr.className = 'row border-b';

    tr.innerHTML = `
      <td class="p-2">${esc(displayName(c))}</td>
      <td class="p-2 hidden sm:table-cell">${esc(c.personid || '')}</td>
      <td class="p-2 hidden lg:table-cell">${esc(getTaxId(c))}</td>
      <td class="p-2">${esc(displayPhone(c))}</td>
      <td class="p-2 hidden md:table-cell">${esc(getProvince(c))}</td>
      <td class="p-2 w-24">
        <button type="button" class="text-blue-600 hover:underline btn-edit" data-idx="${c.idx}">แก้ไข</button>
      </td>
    `;
    tb.appendChild(tr);
  });
}

// ===== ค้นหา (รวม customer_name/เลขภาษี/จังหวัด) =====
function doSearch() {
  const q = norm($('search')?.value);
  if (!q) {
    filtered = all.slice();
  } else {
    filtered = all.filter((c) =>
      (c.customer_name || '').toLowerCase().includes(q) ||
      displayName(c).toLowerCase().includes(q) ||
      (c.personid || '').toLowerCase().includes(q) ||
      String(getTaxId(c)).toLowerCase().includes(q) ||
      displayPhone(c).toLowerCase().includes(q) ||
      String(getProvince(c)).toLowerCase().includes(q)
    );
  }
  currentPage = 1;
  renderPage();
}

// ===== Province autocomplete =====
async function suggestProvinces() {
  const input = $('cf_provincename');
  const list = $('province_datalist');
  if (!input || !list) return;
  const q = (input.value || '').trim();
  list.innerHTML = '';
  if (q.length < 1) return;

  try {
    const url = new URL('/api/suggest/province', location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url);
    if (!res.ok) throw new Error('โหลดจังหวัดไม่สำเร็จ');

    const data = await res.json(); // [{ prov_nam_t }]
    const seen = new Set();
    data.forEach(r => {
      const name = r.prov_nam_t;
      if (name && !seen.has(name)) {
        seen.add(name);
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
      }
    });
  } catch (e) {
    console.error(e);
  }
}

// === ฟังก์ชันเปิด/ปิดช่องชื่อสาขาตาม cf_hq ===
function toggleBranchBox() {
  const sel = $('cf_hq');
  const box = $('branchBox');
  if (!sel || !box) return;

  const val = parseHqValue(sel.value);
  // DEBUG ชั่วคราว: ดูค่าใน console
  console.debug('[toggleBranchBox] cf_hq=', sel.value, '->', val);

  if (val === 0) {  // 0 = สาขา
    show(box);
  } else {
    hide(box);
  }
}

// bind event ตอนโหลด
document.addEventListener('DOMContentLoaded', () => {
  const sel = $('cf_hq');
  if (sel) {
    sel.addEventListener('change', toggleBranchBox);
    toggleBranchBox();
  }
});

// ===== ฟอร์ม =====
function resetForm() {
  editing = null;
  $('customerForm')?.reset();
  const idxEl = $('idx'); if (idxEl) idxEl.value = '';
  $('btnDelete')?.classList.add('hidden');
  $('dupWarn')?.classList.add('hidden');
}
function fillForm(c) {
  // เติมค่าตามชื่อ field เดิม
  const data = c || {};
  Object.keys(c || {}).forEach((k) => { const el = $(k); if (el) el.value = c[k] ?? ''; });
  // กรณีฟิลด์ที่ใช้หลายชื่อ ให้เติม fallback ด้วย
  if ($('cf_taxid') && !$('cf_taxid').value) $('cf_taxid').value = getTaxId(c);
  if ($('cf_provincename') && !$('cf_provincename').value) $('cf_provincename').value = getProvince(c);
  if ($('fname') && !$('fname').value) $('fname').value = displayName(c);

  const hq = $('cf_hq');
  if (hq) {
    hq.value = String(data.cf_hq ?? '');   // รองรับ 0/1 (number)
    // ถ้าค่าใน option ไม่มี ให้เคลียร์เพื่อเลี่ยง Invalid value
    if (![...hq.options].some(o => o.value === hq.value)) hq.value = '';
    // กระตุ้นให้ toggle ทำงาน
    hq.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const br = $('cf_branch');
  if (br) br.value = data.cf_branch ?? '';
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
  e.preventDefault();
  const payload = {
    idx: $('#idx')?.value || null,
    personid: $('#personid')?.value || '',
    prename: $('#prename')?.value || '',
    fname: $('#fname')?.value || '',
    lname: $('#lname')?.value || '',

    cf_taxid: $('#cf_taxid')?.value || '',
    cf_personaddress: $('#cf_personaddress')?.value || '',
    cf_personzipcode: $('#cf_personzipcode')?.value || '',
    cf_provincename: $('#cf_provincename')?.value || '',

    // ตรงกับ HTML
    cf_personaddress_tel: $('#cf_personaddress_tel')?.value || '',
    cf_personaddress_mobile: $('#cf_personaddress_mobile')?.value || '',

    fmlpaymentcreditday: $('#fmlpaymentcreditday')?.value || '',

    // HQ / Branch
    cf_hq: $('#cf_hq')?.value ?? '',
    cf_branch: $('#cf_branch')?.value ?? '',
  };
  await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.debug('[saveCustomer] payload =', payload);
  const duplicate = await isDuplicate(payload, payload.idx || null);
  const warn = $('dupWarn');
  if (duplicate) { warn?.classList.remove('hidden'); return; }
  warn?.classList.add('hidden');

  const toDash = $('redirectDash')?.checked ? '1' : null;
  let url = '/api/customers', method = 'POST';
  if (payload.idx) {
    url = `/api/customers/${payload.idx}`;
    method = 'PUT'; // <--- เพิ่มบรรทัดนี้เพื่อเปลี่ยนเมธอดเป็น PUT
  }

  if (payload.fmlpaymentcreditday === '') {
    payload.fmlpaymentcreditday = null;
  }
  // ถ้ามีฟิลด์ตัวเลขอื่นๆ ที่อาจเป็นค่าว่าง ก็ควรทำแบบเดียวกัน
  const submitBtn = document.querySelector('#customerForm button[type="submit"]');
  submitBtn?.setAttribute('disabled', 'disabled');
  submitBtn?.classList.add('opacity-60', 'cursor-not-allowed');
  // --- เปลี่ยนจากการส่ง FormData เป็น JSON ---
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  submitBtn?.removeAttribute('disabled');
  submitBtn?.classList.remove('opacity-60', 'cursor-not-allowed');

  if (res.redirected) { window.location.href = res.url; return; }
  if (!res.ok) { alert('บันทึกล้มเหลว'); return; }

  await loadAll();
  if (!payload.idx) resetForm();
  alert('บันทึกเรียบร้อย');
}
function editRowByIdx(idx) {
  const c = all.find((it) => String(it.idx) === String(idx));
  if (!c) return;
  editing = c.idx;
  fillForm(c);
  const idxEl = $('idx'); if (idxEl) idxEl.value = c.idx;
  $('btnDelete')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function deleteCustomer() {
  if (!editing) return;
  if (!confirm('ยืนยันลบลูกค้ารายนี้?')) return;
  const res = await fetch(`/api/customers/${editing}`, { method: 'DELETE' });
  if (!res.ok) { alert('ลบไม่สำเร็จ'); return; }
  await loadAll(); resetForm(); alert('ลบเรียบร้อย');
}

// ===== Events =====
function initCustomerForm() {
  $('customerForm')?.addEventListener('submit', saveCustomer);
  const resetBtn = $('btnReset') || $('btnNew');
  resetBtn?.addEventListener('click', resetForm);
  $('btnDelete')?.addEventListener('click', deleteCustomer);

  $('search')?.addEventListener('input', doSearch);

  $('prevPage')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderPage(); } });
  $('nextPage')?.addEventListener('click', () => { currentPage++; renderPage(); });

  $('tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-edit');
    if (btn && btn.dataset.idx) editRowByIdx(btn.dataset.idx);
  });

  const provInput = $('cf_provincename');
  if (provInput) {
    const deb = debounce(suggestProvinces, 200);
    provInput.addEventListener('input', deb);
    provInput.addEventListener('focus', () => {
      if (provInput.value) suggestProvinces();
    });
  }

  loadAll();
}
document.addEventListener('DOMContentLoaded', initCustomerForm); 
