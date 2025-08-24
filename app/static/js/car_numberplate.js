// ====== ตั้งค่า Endpoint ======
const ENDPOINT_BRANDS_SUGGEST = '/api/suggest/car_brand';
const ENDPOINT_PROV_SUGGEST   = '/api/suggest/province';
const ENDPOINT_CARS           = '/api/cars';

let currentPage = 1;
const PAGE_SIZE = 10;
let editingIdx = null; // กำลังแก้ไขแถวไหนอยู่ (inline)

// ====== Debounce helper ======
function debounce(fn, delay = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadCars();
});

function bindEvents() {
  const form = document.getElementById('carForm');
  const btnReset = document.getElementById('btnReset');
  const btnSearch = document.getElementById('btnSearch');
  const btnReload = document.getElementById('btnReload');
  const prevPage = document.getElementById('prevPage');
  const nextPage = document.getElementById('nextPage');
  const tbody = document.getElementById('carsTableBody');

  // Autocomplete bindings (สำหรับฟอร์มด้านบน)
  const brandInput = document.getElementById('car_brand');
  if (brandInput) {
    brandInput.addEventListener('input', debounce(suggestBrands));
    brandInput.addEventListener('focus', () => brandInput.value && suggestBrands());
  }
  const provInput = document.getElementById('province');
  if (provInput) {
    provInput.addEventListener('input', debounce(suggestProvinces));
    provInput.addEventListener('focus', () => provInput.value && suggestProvinces());
  }

  // ฟอร์มเพิ่มใหม่
  if (form) form.addEventListener('submit', onCreateSubmit);
  if (btnReset) btnReset.addEventListener('click', resetForm);

  // ค้นหา/รีโหลด/เพจจิ้ง
  if (btnSearch) btnSearch.addEventListener('click', () => { currentPage = 1; loadCars(); });
  if (btnReload) btnReload.addEventListener('click', () => { document.getElementById('searchText').value = ''; currentPage = 1; loadCars(); });
  if (prevPage) prevPage.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadCars(); } });
  if (nextPage) nextPage.addEventListener('click', () => { currentPage++; loadCars(true); });

  // ใช้ event delegation สำหรับปุ่มในตาราง
   if (tbody) tbody.addEventListener('click', onTableClick);
}

// ====== Suggest: car_brand ======
async function suggestBrands() {
  const q = (document.getElementById('car_brand').value || '').trim();
  const msg = document.getElementById('brandMsg');
  const dl = document.getElementById('brand_datalist');
  dl.innerHTML = '';
  msg.textContent = '';
  if (q.length < 1) return;

  try {
    const url = new URL(ENDPOINT_BRANDS_SUGGEST, window.location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('โหลดยี่ห้อไม่สำเร็จ');
    const data = await res.json(); // [{brand_name: 'Toyota'}, ...]
    data.forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.brand_name;
      dl.appendChild(opt);
    });
    msg.textContent = `พบ ${data.length} รายการ`;
  } catch (e) {
    console.error(e);
    msg.textContent = 'โหลดคำแนะนำยี่ห้อไม่สำเร็จ';
  }
}

// ====== Suggest: province ======
async function suggestProvinces() {
  const q = (document.getElementById('province').value || '').trim();
  const msg = document.getElementById('provMsg');
  const dl = document.getElementById('province_datalist');
  dl.innerHTML = '';
  msg.textContent = '';
  if (q.length < 1) return;

  try {
    const url = new URL(ENDPOINT_PROV_SUGGEST, window.location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('โหลดจังหวัดไม่สำเร็จ');
    const data = await res.json(); // [{prov_nam_t: 'กรุงเทพมหานคร'}, ...]
    data.forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.prov_nam_t;
      dl.appendChild(opt);
    });
    msg.textContent = `พบ ${data.length} รายการ`;
  } catch (e) {
    console.error(e);
    msg.textContent = 'โหลดคำแนะนำจังหวัดไม่สำเร็จ';
  }
}

// ====== โหลดรายการ ======
async function loadCars(isNextAttempt = false) {
  try {
    const q = document.getElementById('searchText').value || '';
    const url = new URL(ENDPOINT_CARS, window.location.origin);
    url.searchParams.set('search', q);
    url.searchParams.set('page', currentPage);
    url.searchParams.set('page_size', PAGE_SIZE);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('โหลดรายการรถไม่สำเร็จ');
    const { items, page, page_size, total } = await res.json();
    renderTable(items, page, page_size, total);
  } catch (err) {
    if (isNextAttempt) {
      currentPage = Math.max(1, currentPage - 1);
    }
    console.error(err);
    renderTable([], 1, PAGE_SIZE, 0);
  }
}

function renderTable(rows, page, page_size, total) {
  const tbody = document.getElementById('carsTableBody');
  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5" class="px-3 py-3 border text-center text-gray-500">ไม่พบข้อมูล</td>`;
    tbody.appendChild(tr);
  } else {
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.dataset.idx = r.idx;
      tr.dataset.plate = r.number_plate || '';
      tr.dataset.brand = r.car_brand || '';
      tr.dataset.province = r.province || '';

      tr.innerHTML = `
        <td class="px-3 py-2 border">${r.idx}</td>
        <td class="px-3 py-2 border cell-plate">${escapeHtml(r.number_plate || '')}</td>
        <td class="px-3 py-2 border cell-brand">${escapeHtml(r.car_brand || '')}</td>
        <td class="px-3 py-2 border cell-province">${escapeHtml(r.province || '')}</td>
        <td class="px-3 py-2 border cell-actions">
          <button class="btn-edit bg-white border px-3 py-1 rounded hover:bg-gray-50 mr-1">แก้ไข</button>
          <button class="btn-del bg-white border px-3 py-1 rounded hover:bg-gray-50 text-red-600">ลบ</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // pager info
  document.getElementById('pageInfo').textContent = `หน้า ${page}`;
  const start = total === 0 ? 0 : (page - 1) * page_size + 1;
  const end = Math.min(total, page * page_size);
  document.getElementById('resultInfo').textContent = `แสดง ${start}-${end} จากทั้งหมด ${total} รายการ`;
}

// ====== สร้างใหม่จากฟอร์มด้านบน ======
async function onCreateSubmit(e) {
  e.preventDefault();
  setFormMsg('');

  const number_plate = (document.getElementById('number_plate').value || '').trim();
  const car_brand = (document.getElementById('car_brand').value || '').trim();
  const province = (document.getElementById('province').value || '').trim();
  if (!number_plate) return setFormMsg('กรุณากรอกเลขทะเบียนรถ', true);

  try {
    const res = await fetch(ENDPOINT_CARS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number_plate, car_brand, province })
    });
    if (!res.ok) throw new Error(await res.text() || 'บันทึกไม่สำเร็จ');

    setFormMsg('บันทึกสำเร็จ ✅');
    resetForm();
    currentPage = 1;
    loadCars();
  } catch (err) {
    console.error(err);
    setFormMsg(`ผิดพลาด: ${err.message}`, true);
  }
}

function resetForm() {
  document.getElementById('number_plate').value = '';
  document.getElementById('car_brand').value = '';
  document.getElementById('province').value = '';
}

function setFormMsg(msg, isError = false) {
  const el = document.getElementById('formMsg');
  el.textContent = msg || '';
  el.className = 'text-sm ml-2 ' + (isError ? 'text-red-600' : 'text-green-600');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"'`=\/]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    "'": '&#39;', '`': '&#x60;', '=': '&#x3D;', '/': '&#x2F;'
  })[c]);
}

// ================= Inline Edit / Delete =================
function onTableClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const tr = btn.closest('tr');
  if (!tr) return;

  if (btn.classList.contains('btn-edit')) {
    enterInlineEdit(tr);
  } else if (btn.classList.contains('btn-del')) {
    onDeleteRow(tr);
  } else if (btn.classList.contains('btn-save')) {
    onSaveRow(tr);
  } else if (btn.classList.contains('btn-cancel')) {
    onCancelRow(tr);
  }
}

function enterInlineEdit(tr) {
  const idx = parseInt(tr.dataset.idx, 10);
  if (editingIdx && editingIdx !== idx) {
    // รีโหลดเพื่อยกเลิกแถวที่กำลังแก้ แล้วค่อยเข้าแก้แถวใหม่
    editingIdx = null;
    loadCars().then(() => {
      const t2 = [...document.querySelectorAll('#carsTableBody tr')].find(r => parseInt(r.dataset.idx,10) === idx);
      if (t2) enterInlineEdit(t2);
    });
    return;
  }
  editingIdx = idx;

  const plateCell = tr.querySelector('.cell-plate');
  const brandCell = tr.querySelector('.cell-brand');
  const provCell  = tr.querySelector('.cell-province');
  const actCell   = tr.querySelector('.cell-actions');

  const plateVal = tr.dataset.plate || '';
  const brandVal = tr.dataset.brand || '';
  const provVal  = tr.dataset.province || '';

  plateCell.innerHTML = `<input data-field="number_plate" class="w-full border rounded px-2 py-1" value="${plateVal.replace(/"/g,'&quot;')}">`;
  brandCell.innerHTML = `<input data-field="car_brand" class="w-full border rounded px-2 py-1" value="${brandVal.replace(/"/g,'&quot;')}">`;
  provCell.innerHTML  = `<input data-field="province" class="w-full border rounded px-2 py-1" value="${provVal.replace(/"/g,'&quot;')}">`;

  actCell.innerHTML = `
    <button class="btn-save bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 mr-1">บันทึก</button>
    <button class="btn-cancel bg-gray-100 border px-3 py-1 rounded hover:bg-gray-200">ยกเลิก</button>
  `;
}

async function onSaveRow(tr) {
  const idx = parseInt(tr.dataset.idx, 10);
  const np  = tr.querySelector('input[data-field="number_plate"]')?.value.trim() || '';
  const br  = tr.querySelector('input[data-field="car_brand"]')?.value.trim() || '';
  const pv  = tr.querySelector('input[data-field="province"]')?.value.trim() || '';

  if (!np) { alert('กรุณากรอกเลขทะเบียนรถ'); return; }

  try {
    const res = await fetch(`${ENDPOINT_CARS}/${idx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number_plate: np, car_brand: br, province: pv })
    });
    if (!res.ok) throw new Error(await res.text() || 'อัปเดตไม่สำเร็จ');

    editingIdx = null;
    await loadCars();
  } catch (err) {
    console.error(err);
    alert('ผิดพลาด: ' + err.message);
  }
}

function onCancelRow(tr) {
  editingIdx = null;
  loadCars(); // รีโหลดคืนค่าเดิมของแถว
}

async function onDeleteRow(tr) {
  const idx = parseInt(tr.dataset.idx, 10);
  if (!idx) return;
  if (!confirm('ยืนยันการลบรายการนี้?')) return;

  try {
    const res = await fetch(`${ENDPOINT_CARS}/${idx}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('ลบไม่สำเร็จ');
    if (editingIdx === idx) editingIdx = null;
    loadCars();
  } catch (err) {
    console.error(err);
    alert('เกิดข้อผิดพลาดระหว่างลบ');
  }
}
