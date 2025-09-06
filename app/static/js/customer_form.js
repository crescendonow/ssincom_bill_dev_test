// /static/js/customer_form.js

const ENDPOINT_PROV_SUGGEST = '/api/suggest/province';

let all = [];
let filtered = [];
let editing = null;
let currentPage = 1;
const PAGE_SIZE = 20;

const $ = (id) => document.getElementById(id);
const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function displayName(c) { const p = (c.customer_name || '').trim(); if (p) return p; const combo = [c.prename, c.fname, c.lname].filter(Boolean).join(' ').trim(); return combo || c.fname || ''; }
function displayPhone(c) { return c.mobile || c.tel || c.cf_personaddress_mobile || ''; }
function getTaxId(c) { return c.cf_taxid ?? c.tax_id ?? c.taxid ?? ''; }
function getProvince(c) { return c.cf_provincename ?? c.province ?? ''; }

async function loadAll() {
  try {
    const res = await fetch('/api/customers/all');
    if (!res.ok) throw new Error('load fail');
    all = await res.json();
    filtered = all.slice();
    currentPage = 1;
    renderPage();
  } catch (e) {
    console.error(e); all = []; filtered = []; renderPage();
  }
}

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

function renderTable(rows) {
  const tbody = $('tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(c => `
    <tr class="border-b">
      <td class="p-2">${esc(displayName(c))}</td>
      <td class="p-2">${esc(c.personid || '')}</td>
      <td class="p-2">${esc(getTaxId(c))}</td>
      <td class="p-2">${esc(getProvince(c))}</td>
      <td class="p-2">${esc(displayPhone(c))}</td>
      <td class="p-2 text-right">
        <button class="px-3 py-1 rounded border hover:bg-gray-50" data-edit="${c.idx}">แก้ไข</button>
      </td>
    </tr>
  `).join('');

  // bind edit buttons
  tbody.querySelectorAll('button[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-edit'));
      const item = all.find(x => x.idx === idx);
      if (item) openEdit(item);
    });
  });
}

function openEdit(c) {
  editing = c;
  $('edit_idx').value = c.idx ?? '';
  $('edit_prename').value = c.prename ?? '';
  $('edit_fname').value = (c.customer_name ?? c.fname ?? '') || '';
  $('edit_lname').value = c.lname ?? '';
  $('edit_personid').value = c.personid ?? '';
  $('edit_taxid').value = getTaxId(c);
  $('edit_address').value = c.cf_personaddress ?? c.address ?? '';
  $('edit_zipcode').value = c.cf_personzipcode ?? c.zipcode ?? '';
  $('edit_province').value = getProvince(c);
  $('edit_tel').value = c.tel ?? '';
  $('edit_mobile').value = c.mobile ?? '';
  $('edit_creditday').value = c.fmlpaymentcreditday ?? '';
  // เปิด modal ตามที่หน้า html ใช้ (เช่น ค่อยๆ ใส่ hidden/visible)
  document.getElementById('editModal').classList.remove('hidden');
}

function closeEdit() {
  document.getElementById('editModal').classList.add('hidden');
  editing = null;
}

// ==== บันทึกโดย "ไม่เช็กซ้ำ" ====
async function saveEdit() {
  if (!editing) { alert('ไม่พบรายการที่จะแก้ไข'); return; }

  const idx = Number($('edit_idx').value || editing.idx);
  const payload = {
    prename: $('edit_prename').value || null,
    fname: $('edit_fname').value || null,
    lname: $('edit_lname').value || null,
    personid: $('edit_personid').value || null,
    cf_taxid: $('edit_taxid').value || null,
    cf_personaddress: $('edit_address').value || null,
    cf_personzipcode: $('edit_zipcode').value || null,
    cf_provincename: $('edit_province').value || null,
    tel: $('edit_tel').value || null,
    mobile: $('edit_mobile').value || null,
    fmlpaymentcreditday: $('edit_creditday').value ? Number($('edit_creditday').value) : null,
  };

  try {
    const res = await fetch(`/api/customers/${idx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'บันทึกล้มเหลว');
    }
    // อัปเดตสำเร็จ: รีโหลดรายการเพื่อให้ตารางตรงกับ DB
    await loadAll();
    closeEdit();
    alert('บันทึกสำเร็จ');
  } catch (e) {
    console.error(e);
    alert('บันทึกล้มเหลว');
  }
}

// ค้นหา/กรองบนหน้า
function onSearchInput(ev) {
  const q = norm(ev.target.value);
  if (!q) { filtered = all.slice(); renderPage(); return; }
  filtered = all.filter(c => {
    const blob = [
      displayName(c), c.personid, getTaxId(c),
      getProvince(c), c.tel, c.mobile
    ].map(x => norm(x)).join(' ');
    return blob.includes(q);
  });
  currentPage = 1;
  renderPage();
}

// เปลี่ยนหน้า
function gotoPrev() { if (currentPage > 1) { currentPage--; renderPage(); } }
function gotoNext() {
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage < maxPage) { currentPage++; renderPage(); }
}

// init
window.addEventListener('DOMContentLoaded', () => {
  // ปุ่ม/อินพุตต่าง ๆ บนหน้าให้ผูกกับฟังก์ชันนี้
  $('searchBox')?.addEventListener('input', onSearchInput);
  $('prevPage')?.addEventListener('click', gotoPrev);
  $('nextPage')?.addEventListener('click', gotoNext);
  $('btnSaveEdit')?.addEventListener('click', saveEdit);
  $('btnCloseEdit')?.addEventListener('click', closeEdit);
  loadAll();
});
