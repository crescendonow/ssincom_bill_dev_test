// /static/js/customer_form.js
let all = [];          // เก็บรายการลูกค้าทั้งหมด
let editing = null;    // idx ที่กำลังแก้ไขอยู่ (ถ้ามี)

const $ = (id) => document.getElementById(id);

// รวมชื่อให้สวย ๆ ถ้ามีคำนำหน้า/นามสกุล
function displayName(c) {
  const parts = [c.prename, c.fname, c.lname].filter(Boolean);
  return parts.join(' ').trim() || c.fname || '';
}

// เบอร์โทร: เอาอันที่มีก่อน
function displayPhone(c) {
  return c.mobile || c.tel || c.cf_personaddress_mobile || '';
}

// ===== โหลดและเรนเดอร์ =====
async function loadAll() {
  try {
    const res = await fetch('/api/customers/all');
    if (!res.ok) throw new Error('โหลดรายการลูกค้าไม่สำเร็จ');
    all = await res.json();
    renderTable(all);
  } catch (e) {
    console.error(e);
    all = [];
    renderTable(all);
  }
}

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
      <td class="p-2">${displayName(c)}</td>
      <td class="p-2">${c.personid || ''}</td>
      <td class="p-2">${c.cf_taxid || ''}</td>
      <td class="p-2">${displayPhone(c)}</td>
      <td class="p-2">${c.cf_provincename || ''}</td>
      <td class="p-2">
        <button type="button" class="text-blue-600 hover:underline btn-edit" data-idx="${c.idx}">แก้ไข</button>
      </td>
    `;
    tb.appendChild(tr);
  });
}

// ===== ค้นหา =====
function doSearch() {
  const q = ($('search')?.value || '').toLowerCase().trim();
  const filtered = all.filter((c) =>
    (displayName(c).toLowerCase().includes(q)) ||
    ((c.personid || '').toLowerCase().includes(q)) ||
    ((c.cf_taxid || '').toLowerCase().includes(q)) ||
    (displayPhone(c).toLowerCase().includes(q)) ||
    ((c.cf_provincename || '').toLowerCase().includes(q))
  );
  renderTable(filtered);
}

// ===== ฟอร์ม =====
function resetForm() {
  editing = null;
  const form = $('customerForm');
  form?.reset();

  const idxEl = $('idx');
  if (idxEl) idxEl.value = '';

  $('btnDelete')?.classList.add('hidden');
  $('dupWarn')?.classList.add('hidden');
}

function fillForm(c) {
  // ใส่ค่าลงทุกช่องที่ id ตรงกับ key
  Object.keys(c || {}).forEach((k) => {
    const el = $(k);
    if (el) el.value = c[k] ?? '';
  });
  // เผื่อชื่อแยกฟิลด์ (ถ้าฟอร์มมีเฉพาะ fname ก็พอแล้ว)
  if ($('fname') && !$('fname').value) $('fname').value = displayName(c);
}

async function isDuplicate(payload, ignoreIdx = null) {
  const fd = new FormData();
  fd.append('fname', payload.fname || '');
  fd.append('personid', payload.personid || '');
  fd.append('cf_taxid', payload.cf_taxid || '');
  if (ignoreIdx) fd.append('ignore_idx', ignoreIdx);

  const res = await fetch('/api/customers/check-duplicate', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  return !!data.duplicate;
}

async function saveCustomer(e) {
  e.preventDefault();

  const form = $('customerForm');
  const f = new FormData(form);
  const payload = Object.fromEntries(f.entries());

  const duplicate = await isDuplicate(payload, payload.idx || null);
  const warn = $('dupWarn');
  if (duplicate) {
    warn?.classList.remove('hidden');
    return;
  } else {
    warn?.classList.add('hidden');
  }

  const toDash = $('redirectDash')?.checked ? '1' : null;

  let url = '/api/customers';
  let method = 'POST';
  if (payload.idx) {
    url = `/api/customers/${payload.idx}`;
    method = 'POST'; // ฝั่ง backend รับเป็น POST update อยู่แล้ว
  }

  const fd = new FormData();
  for (const [k, v] of Object.entries(payload)) if (k !== 'idx') fd.append(k, v);
  if (toDash) fd.append('redirect_to_dashboard', '1');

  const res = await fetch(url, { method, body: fd });

  // ถ้ามี redirect (เช่น บันทึกแล้วกลับ dashboard)
  if (res.redirected) {
    window.location.href = res.url;
    return;
  }

  if (!res.ok) {
    const t = await res.text();
    alert('บันทึกล้มเหลว: ' + t);
    return;
  }

  await loadAll();
  if (!payload.idx) resetForm();
  alert('บันทึกเรียบร้อย');
}

function editRowByIdx(idx) {
  const c = all.find((it) => String(it.idx) === String(idx));
  if (!c) return;
  editing = c.idx;
  fillForm(c);

  const idxEl = $('idx');
  if (idxEl) idxEl.value = c.idx;

  $('btnDelete')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteCustomer() {
  if (!editing) return;
  if (!confirm('ยืนยันลบลูกค้ารายนี้?')) return;
  const res = await fetch(`/api/customers/${editing}`, { method: 'DELETE' });
  if (!res.ok) {
    alert('ลบไม่สำเร็จ');
    return;
  }
  await loadAll();
  resetForm();
  alert('ลบเรียบร้อย');
}

// ===== บูตสคริปต์ =====
function initCustomerForm() {
  $('customerForm')?.addEventListener('submit', saveCustomer);
  // รองรับทั้ง id เดิมและใหม่ (btnReset / btnNew)
  const resetBtn = $('btnReset') || $('btnNew');
  resetBtn?.addEventListener('click', resetForm);
  $('btnDelete')?.addEventListener('click', deleteCustomer);
  $('search')?.addEventListener('input', doSearch);

  // Event delegation สำหรับปุ่มแก้ไขในตาราง
  $('tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-edit');
    if (btn && btn.dataset.idx) {
      editRowByIdx(btn.dataset.idx);
    }
  });

  loadAll();
}

document.addEventListener('DOMContentLoaded', initCustomerForm);
