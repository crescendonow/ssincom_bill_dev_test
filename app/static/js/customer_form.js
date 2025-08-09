
// static/js/customer_form.js
let all = [];    // all customer data
let editing = null; // idx edit 

async function loadAll() {
  const res = await fetch('/api/customers/all');
  all = await res.json();
  renderTable(all);
}

function renderTable(rows) {
  const tb = document.getElementById('tbody');
  if (!tb) return;
  tb.innerHTML = '';
  rows.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'row border-b';
    tr.innerHTML = `
      <td class="p-2">${c.fname || ''}</td>
      <td class="p-2">${c.personid || ''}</td>
      <td class="p-2">${c.cf_taxid || ''}</td>
      <td class="p-2">${c.cf_personaddress_mobile || ''}</td>
      <td class="p-2">${c.cf_provincename || ''}</td>
      <td class="p-2">
        <button class="text-blue-600 hover:underline" onclick='editRow(${JSON.stringify(c).replace(/'/g,"&#39;")})'>แก้ไข</button>
      </td>`;
    tb.appendChild(tr);
  });
}

function resetForm() {
  editing = null;
  const form = document.getElementById('customerForm');
  if (form) form.reset();
  const idxEl = document.getElementById('idx');
  if (idxEl) idxEl.value = '';
  const delBtn = document.getElementById('btnDelete');
  if (delBtn) delBtn.classList.add('hidden');
  const warn = document.getElementById('dupWarn');
  if (warn) warn.classList.add('hidden');
}

function fillForm(c) {
  for (const k in c) {
    const el = document.getElementById(k);
    if (el) el.value = c[k] ?? '';
  }
}

async function isDuplicate(payload, ignoreIdx=null) {
  const fd = new FormData();
  fd.append('fname', payload.fname || '');
  fd.append('personid', payload.personid || '');
  fd.append('cf_taxid', payload.cf_taxid || '');
  if (ignoreIdx) fd.append('ignore_idx', ignoreIdx);
  const res = await fetch('/api/customers/check-duplicate', { method:'POST', body: fd });
  const data = await res.json();
  return !!data.duplicate;
}

async function saveCustomer(e) {
  e.preventDefault();
  const form = document.getElementById('customerForm');
  const f = new FormData(form);
  const payload = Object.fromEntries(f.entries());

  const duplicate = await isDuplicate(payload, payload.idx || null);
  const warn = document.getElementById('dupWarn');
  if (duplicate) {
    if (warn) warn.classList.remove('hidden');
    return;
  } else {
    if (warn) warn.classList.add('hidden');
  }

  const toDash = document.getElementById('redirectDash')?.checked ? '1' : null;

  let url = '/api/customers';
  let method = 'POST';
  if (payload.idx) { url = `/api/customers/${payload.idx}`; method = 'POST'; } 

  const fd = new FormData();
  for (const [k,v] of Object.entries(payload)) if (k!=='idx') fd.append(k, v);
  if (toDash) fd.append('redirect_to_dashboard', '1');

  const res = await fetch(url, { method, body: fd });
  if (res.redirected) {
    window.location.href = res.url; // redirect to dashboard with message 
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

function editRow(c) {
  editing = c.idx;
  fillForm(c);
  const idxEl = document.getElementById('idx');
  if (idxEl) idxEl.value = c.idx;
  const delBtn = document.getElementById('btnDelete');
  if (delBtn) delBtn.classList.remove('hidden');
  window.scrollTo({top:0, behavior:'smooth'});
}

async function deleteCustomer() {
  if (!editing) return;
  if (!confirm('ยืนยันลบลูกค้ารายนี้?')) return;
  const res = await fetch(`/api/customers/${editing}`, { method:'DELETE' });
  if (!res.ok) { alert('ลบไม่สำเร็จ'); return; }
  await loadAll();
  resetForm();
  alert('ลบเรียบร้อย');
}

function searchBox() {
  const qEl = document.getElementById('search');
  const q = (qEl?.value || '').toLowerCase().trim();
  const filtered = all.filter(c =>
    (c.fname||'').toLowerCase().includes(q) ||
    (c.personid||'').toLowerCase().includes(q) ||
    (c.cf_taxid||'').toLowerCase().includes(q) ||
    (c.cf_personaddress_mobile||'').toLowerCase().includes(q) ||
    (c.cf_provincename||'').toLowerCase().includes(q)
  );
  renderTable(filtered);
}

function initCustomerForm() {
  const form = document.getElementById('customerForm');
  form?.addEventListener('submit', saveCustomer);
  // Support both Reset and legacy New ids
  const resetBtn = document.getElementById('btnReset') || document.getElementById('btnNew');
  resetBtn?.addEventListener('click', resetForm);
  const delBtn = document.getElementById('btnDelete');
  delBtn?.addEventListener('click', deleteCustomer);
  const search = document.getElementById('search');
  search?.addEventListener('input', searchBox);
  loadAll();
}

document.addEventListener('DOMContentLoaded', initCustomerForm);
