// /static/js/customer_form.js

// ===== API endpoints =====
const API_ALL            = '/api/customers/all';
const API_CREATE         = '/api/customers';
const API_UPDATE         = (idx) => `/api/customers/${idx}`;
const API_DELETE         = (idx) => `/api/customers/${idx}`;
const API_CHECK_DUP      = '/api/customers/check-duplicate';

// ===== State =====
let allCustomers = [];     // รายการทั้งหมดจากเซิร์ฟเวอร์
let selectedIdx = null;    // แถวที่เลือกแก้ไขในฟอร์ม (null = โหมดเพิ่มใหม่)

// ===== Helpers =====
const $ = (id) => document.getElementById(id);
const norm = (s) => (s ?? '').toString().trim().toLowerCase();
function debounce(fn, delay = 250) { let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),delay);} }
function setMsg(text, isError=false) {
  const el = $('formMsg'); if (!el) return;
  el.textContent = text || '';
  el.className = 'text-sm ' + (isError ? 'text-red-600' : 'text-green-700');
}
function val(id) { return $(id)?.value ?? ''; }
function setVal(id, v) { const el=$(id); if (el) el.value = v ?? ''; }

// ===== Load & Render =====
async function loadAll() {
  try {
    const res = await fetch(API_ALL);
    if (!res.ok) throw new Error('โหลดรายชื่อลูกค้าไม่สำเร็จ');
    allCustomers = await res.json();
    renderTable(allCustomers);
  } catch (e) {
    console.error(e);
    allCustomers = [];
    renderTable([]);
  }
}

function renderTable(rows) {
  const tbody = $('customersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" class="px-3 py-2 text-center text-gray-500">ไม่พบข้อมูล</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach(c => {
    const fullName = [c.prename, c.fname, c.lname].filter(Boolean).join(' ').trim();
    const tel = c.cf_personaddress_tel || '';
    const mobile = c.cf_personaddress_mobile || '';

    const tr = document.createElement('tr');
    tr.dataset.idx = c.idx;
    tr.innerHTML = `
      <td class="px-3 py-2 border w-16 text-center">${c.idx}</td>
      <td class="px-3 py-2 border">${c.personid || ''}</td>
      <td class="px-3 py-2 border">${fullName || c.fname || ''}</td>
      <td class="px-3 py-2 border">${c.cf_provincename || ''}</td>
      <td class="px-3 py-2 border">${c.cf_taxid || ''}</td>
      <td class="px-3 py-2 border">${[tel, mobile].filter(Boolean).join(' / ')}</td>
      <td class="px-3 py-2 border w-36">
        <button class="btn-edit bg-white border px-3 py-1 rounded hover:bg-gray-50">แก้ไข</button>
        <button class="btn-delete bg-white border px-3 py-1 rounded hover:bg-gray-50 ml-2 text-red-700">ลบ</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ===== Search (ชื่อ/รหัสลูกค้า/จังหวัด) =====
function searchBox() {
  const q = norm($('search')?.value);
  if (!q) { renderTable(allCustomers); return; }

  const filtered = allCustomers.filter(c => {
    const fullName = norm(`${c.prename||''} ${c.fname||''} ${c.lname||''}`);
    const code     = norm(c.personid);
    const prov     = norm(c.cf_provincename);
    return fullName.includes(q) || code.includes(q) || prov.includes(q);
  });
  renderTable(filtered);
}

// ===== Form utils =====
function resetForm() {
  selectedIdx = null;
  setVal('idx', '');
  setVal('prename', ''); setVal('fname',''); setVal('lname','');
  setVal('personid','');
  setVal('cf_taxid','');
  setVal('cf_personaddress_tel','');
  setVal('cf_personaddress_mobile','');
  setVal('cf_personaddress','');
  setVal('cf_provincename','');
  setVal('cf_personzipcode','');
  setVal('fmlpaymentcreditday','');
  setMsg('');
  $('fname')?.focus();
}

function fillForm(c) {
  selectedIdx = c.idx;
  setVal('idx', c.idx);
  setVal('prename', c.prename); setVal('fname', c.fname); setVal('lname', c.lname);
  setVal('personid', c.personid);
  setVal('cf_taxid', c.cf_taxid);
  setVal('cf_personaddress_tel', c.cf_personaddress_tel);
  setVal('cf_personaddress_mobile', c.cf_personaddress_mobile);
  setVal('cf_personaddress', c.cf_personaddress);
  setVal('cf_provincename', c.cf_provincename);
  setVal('cf_personzipcode', c.cf_personzipcode);
  setVal('fmlpaymentcreditday', c.fmlpaymentcreditday);
  setMsg('');
  $('fname')?.focus();
}

function buildFormData() {
  const fd = new FormData();
  fd.set('prename', val('prename'));
  fd.set('fname', val('fname'));
  fd.set('lname', val('lname'));
  fd.set('personid', val('personid'));
  fd.set('cf_taxid', val('cf_taxid'));
  fd.set('cf_personaddress_tel', val('cf_personaddress_tel'));
  fd.set('cf_personaddress_mobile', val('cf_personaddress_mobile'));
  fd.set('cf_personaddress', val('cf_personaddress'));
  fd.set('cf_provincename', val('cf_provincename'));
  fd.set('cf_personzipcode', val('cf_personzipcode'));
  const cred = val('fmlpaymentcreditday');
  if (cred !== '') fd.set('fmlpaymentcreditday', cred);
  return fd;
}

async function checkDuplicate(ignoreIdx=null) {
  const fd = new FormData();
  fd.set('fname', val('fname'));            // ตรวจซ้ำตามที่ backend รองรับ
  fd.set('personid', val('personid'));
  fd.set('cf_taxid', val('cf_taxid'));
  if (ignoreIdx != null) fd.set('ignore_idx', ignoreIdx);

  const res = await fetch(API_CHECK_DUP, { method: 'POST', body: fd });
  if (!res.ok) return false;
  const data = await res.json();
  return !!data.duplicate;
}

// ===== Save / Update / Delete =====
async function saveCustomer(e) {
  e.preventDefault();
  setMsg('');

  const fname = val('fname').trim();
  if (!fname) { setMsg('กรุณากรอกชื่อลูกค้า', true); $('fname')?.focus(); return; }

  try {
    const isDup = await checkDuplicate(selectedIdx ?? null);
    if (isDup) {
      setMsg('ข้อมูลซ้ำ (ชื่อ/รหัส/เลขภาษี) กรุณาตรวจสอบ', true);
      return;
    }

    const fd = buildFormData();
    let res;
    if (selectedIdx) {
      res = await fetch(API_UPDATE(selectedIdx), { method: 'POST', body: fd });
    } else {
      res = await fetch(API_CREATE, { method: 'POST', body: fd });
    }
    if (!res.ok) throw new Error(await res.text() || 'บันทึกไม่สำเร็จ');

    await loadAll();
    setMsg('บันทึกสำเร็จ ✅');
    resetForm();
  } catch (err) {
    console.error(err);
    setMsg('เกิดข้อผิดพลาดระหว่างบันทึก', true);
  }
}

async function deleteCustomerIdx(idx) {
  if (!idx) return;
  if (!confirm('ยืนยันการลบลูกค้ารายนี้?')) return;
  try {
    const res = await fetch(API_DELETE(idx), { method: 'DELETE' });
    if (!(res.ok || res.status === 204)) throw new Error('ลบไม่สำเร็จ');
    await loadAll();
    if (selectedIdx === idx) resetForm();
    setMsg('ลบสำเร็จ ✅');
  } catch (err) {
    console.error(err);
    setMsg('เกิดข้อผิดพลาดระหว่างลบ', true);
  }
}

// ===== Events =====
function bindEvents() {
  const form = $('customerForm');
  form?.addEventListener('submit', saveCustomer);

  const resetBtn = $('btnReset') || $('btnNew');
  resetBtn?.addEventListener('click', (e)=>{ e.preventDefault(); resetForm(); });

  const tbody = $('customersTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      const tr  = e.target.closest('tr'); if (!tr) return;
      const idx = parseInt(tr.dataset.idx, 10);

      if (btn.classList.contains('btn-edit')) {
        const item = allCustomers.find(c => c.idx === idx);
        if (item) fillForm(item);
      } else if (btn.classList.contains('btn-delete')) {
        deleteCustomerIdx(idx);
      }
    });
  }

  const search = $('search');
  if (search) {
    const deb = debounce(searchBox, 200);
    search.addEventListener('input', deb);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchBox(); } });
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadAll();
});
