// /static/js/car_numberplate.js

// ====== Endpoints ======
const ENDPOINT_BRANDS_SUGGEST = '/api/suggest/car_brand';
const ENDPOINT_PROV_SUGGEST = '/api/suggest/province';
const ENDPOINT_CARS = '/api/cars';
const ENDPOINT_PLATE_SUGGEST = '/api/suggest/number_plate';


let currentPage = 1;
const PAGE_SIZE = 10;
let editingIdx = null; // idx แถวที่กำลังแก้ไขแบบ inline

// ====== Helpers ======
function debounce(fn, delay = 250) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
function escapeHtml(s = '') { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function $(id) { return document.getElementById(id); }
function setFormMsg(msg, isError = false) {
  const el = $('formMsg'); if (!el) return;
  el.textContent = msg || '';
  el.className = 'text-sm ml-2 ' + (isError ? 'text-red-600' : 'text-green-600');
}

async function suggestSearch() {
  const input = $('searchText');
  const list = document.getElementById('search_datalist');
  if (!input || !list) return;

  const q = (input.value || '').trim();
  list.innerHTML = '';
  if (q.length < 1) return;

  try {
    const qs = encodeURIComponent(q);
    const [plates, brands, provs] = await Promise.all([
      fetch(`${ENDPOINT_PLATE_SUGGEST}?q=${qs}`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${ENDPOINT_BRANDS_SUGGEST}?q=${qs}`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${ENDPOINT_PROV_SUGGEST}?q=${qs}`).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);

    const values = [];
    plates.forEach(p => values.push(p.number_plate));
    brands.forEach(b => values.push(b.brand_name));
    provs.forEach(p => values.push(p.prov_nam_t));

    const seen = new Set();
    values.filter(v => v && !seen.has(v) && seen.add(v)).slice(0, 20).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      list.appendChild(opt);
    });
  } catch (e) {
    console.error('suggestSearch error', e);
  }
}

// ====== Suggest: car brand ======
async function suggestBrands() {
  const q = ($('car_brand')?.value || '').trim();
  const dl = $('brand_datalist'); const msg = $('brandMsg');
  if (!dl) return;
  dl.innerHTML = ''; if (msg) msg.textContent = '';
  if (q.length < 1) return;
  try {
    const url = new URL(ENDPOINT_BRANDS_SUGGEST, location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url); if (!res.ok) throw new Error('โหลดยี่ห้อไม่สำเร็จ');
    const data = await res.json(); // [{brand_name}]
    data.forEach(r => { const opt = document.createElement('option'); opt.value = r.brand_name; dl.appendChild(opt); });
    if (msg) msg.textContent = `พบ ${data.length} รายการ`;
  } catch (e) { console.error(e); if (msg) msg.textContent = 'โหลดยี่ห้อผิดพลาด'; }
}

// ====== Suggest: province ======
async function suggestProvinces() {
  const q = ($('province')?.value || '').trim();
  const dl = $('province_datalist'); const msg = $('provMsg');
  if (!dl) return;
  dl.innerHTML = ''; if (msg) msg.textContent = '';
  if (q.length < 1) return;
  try {
    const url = new URL(ENDPOINT_PROV_SUGGEST, location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url); if (!res.ok) throw new Error('โหลดจังหวัดไม่สำเร็จ');
    const data = await res.json(); // [{prov_nam_t}]
    data.forEach(r => { const opt = document.createElement('option'); opt.value = r.prov_nam_t; dl.appendChild(opt); });
    if (msg) msg.textContent = `พบ ${data.length} รายการ`;
  } catch (e) { console.error(e); if (msg) msg.textContent = 'โหลดจังหวัดผิดพลาด'; }
}

// ====== Load table (with search & paging) ======
async function loadCars(isNextAttempt = false) {
  try {
    const q = ($('searchText')?.value || '').trim();
    const url = new URL(ENDPOINT_CARS, location.origin);
    url.searchParams.set('search', q);
    url.searchParams.set('page', currentPage);
    url.searchParams.set('page_size', PAGE_SIZE);

    const res = await fetch(url);
    if (!res.ok) throw new Error('โหลดรายการรถไม่สำเร็จ');
    const { items, page, page_size, total } = await res.json();
    renderTable(items, page, page_size, total);
  } catch (err) {
    if (isNextAttempt) currentPage = Math.max(1, currentPage - 1);
    console.error(err);
    renderTable([], 1, PAGE_SIZE, 0);
  }
}

function renderTable(rows, page, page_size, total) {
  const tbody = $('carsTableBody'); if (!tbody) return;
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
        <td class="px-3 py-2 border w-24">${r.idx}</td>
        <td class="px-3 py-2 border cell-plate">${escapeHtml(r.number_plate || '')}</td>
        <td class="px-3 py-2 border cell-brand">${escapeHtml(r.car_brand || '')}</td>
        <td class="px-3 py-2 border cell-province">${escapeHtml(r.province || '')}</td>
        <td class="px-3 py-2 border cell-actions">
          <button class="btn-edit bg-white border px-2 py-1 rounded hover:bg-gray-50">แก้ไข</button>
          <button class="btn-delete bg-white border px-2 py-1 rounded hover:bg-gray-50 ml-2 text-red-700">ลบ</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if ($('pageInfo')) $('pageInfo').textContent = `หน้า ${page}`;
  const start = total === 0 ? 0 : (page - 1) * page_size + 1;
  const end = Math.min(total, page * page_size);
  if ($('resultInfo')) $('resultInfo').textContent = `แสดง ${start}-${end} จากทั้งหมด ${total} รายการ`;
}

// ====== Create ======
async function onCreateSubmit(e) {
  e.preventDefault();
  setFormMsg('');

  const number_plate = ($('number_plate')?.value || '').trim();
  const car_brand = ($('car_brand')?.value || '').trim();
  const province = ($('province')?.value || '').trim();

  if (!number_plate) { setFormMsg('กรุณากรอกเลขทะเบียนรถ', true); return; }

  try {
    const res = await fetch(ENDPOINT_CARS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number_plate, car_brand, province })
    });
    if (!res.ok) throw new Error(await res.text() || 'บันทึกไม่สำเร็จ');
    setFormMsg('บันทึกสำเร็จ ✅');
    resetForm(); currentPage = 1; loadCars();
  } catch (err) {
    console.error(err); setFormMsg(`ผิดพลาด: ${err.message}`, true);
  }
}

function resetForm() {
  if ($('number_plate')) $('number_plate').value = '';
  if ($('car_brand')) $('car_brand').value = '';
  if ($('province')) $('province').value = '';
}

// ====== Inline edit ======
function beginEditRow(tr) {
  if (!tr) return;
  editingIdx = parseInt(tr.dataset.idx, 10);

  const plateVal = tr.dataset.plate || '';
  const brandVal = tr.dataset.brand || '';
  const provVal = tr.dataset.province || '';

  tr.querySelector('.cell-plate').innerHTML =
    `<input data-field="number_plate" class="w-full border rounded px-2 py-1" value="${escapeHtml(plateVal)}">`;
  tr.querySelector('.cell-brand').innerHTML =
    `<input data-field="car_brand" class="w-full border rounded px-2 py-1" value="${escapeHtml(brandVal)}">`;
  tr.querySelector('.cell-province').innerHTML =
    `<input data-field="province" class="w-full border rounded px-2 py-1" value="${escapeHtml(provVal)}">`;

  tr.querySelector('.cell-actions').innerHTML = `
    <button class="btn-save bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 mr-1">บันทึก</button>
    <button class="btn-cancel bg-gray-100 border px-3 py-1 rounded hover:bg-gray-200">ยกเลิก</button>
  `;
}

function cancelEditRow(tr) {
  if (!tr) return;
  editingIdx = null;
  tr.querySelector('.cell-plate').textContent = tr.dataset.plate || '';
  tr.querySelector('.cell-brand').textContent = tr.dataset.brand || '';
  tr.querySelector('.cell-province').textContent = tr.dataset.province || '';
  tr.querySelector('.cell-actions').innerHTML = `
    <button class="btn-edit bg-white border px-2 py-1 rounded hover:bg-gray-50">แก้ไข</button>
    <button class="btn-delete bg-white border px-2 py-1 rounded hover:bg-gray-50 ml-2 text-red-700">ลบ</button>
  `;
}

async function onSaveRow(tr) {
  const idx = parseInt(tr.dataset.idx, 10);
  const np = tr.querySelector('input[data-field="number_plate"]')?.value.trim() || '';
  const br = tr.querySelector('input[data-field="car_brand"]')?.value.trim() || '';
  const pv = tr.querySelector('input[data-field="province"]')?.value.trim() || '';
  if (!np) { alert('กรุณากรอกเลขทะเบียนรถ'); return; }

  try {
    const res = await fetch(`${ENDPOINT_CARS}/${idx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number_plate: np, car_brand: br, province: pv })
    });
    if (!res.ok) throw new Error(await res.text() || 'บันทึกไม่สำเร็จ');

    // อัปเดต dataset + เปลี่ยนกลับเป็นโหมดดู
    tr.dataset.plate = np; tr.dataset.brand = br; tr.dataset.province = pv;
    cancelEditRow(tr);
  } catch (err) {
    console.error(err); alert('เกิดข้อผิดพลาดระหว่างบันทึก');
  }
}

// ช่องค้นหา: autocomplete + Enter เพื่อค้นหา
const searchInput = $('searchText');
if (searchInput) {
  const deb = debounce(suggestSearch, 200);
  searchInput.addEventListener('input', deb);
  searchInput.addEventListener('focus', () => searchInput.value && suggestSearch());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { currentPage = 1; loadCars(); }
  });
}

// ปุ่มค้นหา: ถ้ายังไม่ได้พิมพ์ ให้โฟกัสและโชว์คำแนะนำ; ถ้าพิมพ์แล้วให้ค้นหาเลย
if (btnSearch) {
  btnSearch.addEventListener('click', () => {
    const v = (searchInput?.value || '').trim();
    if (!v) {
      searchInput?.focus();
      suggestSearch();
    } else {
      currentPage = 1;
      loadCars();
    }
  });
}

async function onDeleteRow(tr) {
  const idx = parseInt(tr.dataset.idx, 10);
  if (!idx) return;
  if (!confirm('ยืนยันการลบรายการนี้?')) return;
  try {
    const res = await fetch(`${ENDPOINT_CARS}/${idx}`, { method: 'DELETE' });
    if (!(res.ok || res.status === 204)) throw new Error('ลบไม่สำเร็จ');
    if (editingIdx === idx) editingIdx = null;
    loadCars();
  } catch (err) { console.error(err); alert('เกิดข้อผิดพลาดระหว่างลบ'); }
}

function onTableClick(e) {
  const btn = e.target.closest('button'); if (!btn) return;
  const tr = e.target.closest('tr'); if (!tr) return;

  if (btn.classList.contains('btn-edit')) {
    if (editingIdx && editingIdx !== parseInt(tr.dataset.idx, 10)) {
      // ยกเลิกแถวที่กำลังแก้ไขก่อน
      const editingRow = document.querySelector(`tr[data-idx="${editingIdx}"]`);
      if (editingRow) cancelEditRow(editingRow);
    }
    beginEditRow(tr);
  } else if (btn.classList.contains('btn-cancel')) {
    cancelEditRow(tr);
  } else if (btn.classList.contains('btn-save')) {
    onSaveRow(tr);
  } else if (btn.classList.contains('btn-delete')) {
    onDeleteRow(tr);
  }
}

// ====== Bind events ======
function bindEvents() {
  const form = $('carForm');
  const btnReset = $('btnReset');
  const btnSearch = $('btnSearch');
  const btnReload = $('btnReload');
  const prevPage = $('prevPage');
  const nextPage = $('nextPage');
  const tbody = $('carsTableBody');

  // brand/province autocomplete
  const brandInput = $('car_brand');
  if (brandInput) {
    brandInput.addEventListener('input', debounce(suggestBrands, 200));
    brandInput.addEventListener('focus', () => brandInput.value && suggestBrands());
  }
  const provInput = $('province');
  if (provInput) {
    provInput.addEventListener('input', debounce(suggestProvinces, 200));
    provInput.addEventListener('focus', () => provInput.value && suggestProvinces());
  }

  // create form
  if (form) form.addEventListener('submit', onCreateSubmit);
  if (btnReset) btnReset.addEventListener('click', resetForm);

  // search / reload / paging
  if (btnSearch) btnSearch.addEventListener('click', () => { currentPage = 1; loadCars(); });
  if (btnReload) btnReload.addEventListener('click', () => { if ($('searchText')) $('searchText').value = ''; currentPage = 1; loadCars(); });
  if (prevPage) prevPage.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadCars(); } });
  if (nextPage) nextPage.addEventListener('click', () => { currentPage++; loadCars(true); });

  // table actions
  if (tbody) tbody.addEventListener('click', onTableClick);
}

document.addEventListener('DOMContentLoaded', () => { bindEvents(); loadCars(); });
