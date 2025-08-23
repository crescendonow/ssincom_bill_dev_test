// ====== ตั้งค่า Endpoint ======
const ENDPOINT_BRANDS_SUGGEST = '/api/suggest/car_brand';
const ENDPOINT_PROV_SUGGEST   = '/api/suggest/province';
const ENDPOINT_CARS           = '/api/cars';

let currentPage = 1;
const PAGE_SIZE = 10;

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

  // Autocomplete bindings
  const brandInput = document.getElementById('car_brand');
  const provInput = document.getElementById('province');

  brandInput.addEventListener('input', debounce(suggestBrands));
  brandInput.addEventListener('focus', () => brandInput.value && suggestBrands());

  provInput.addEventListener('input', debounce(suggestProvinces));
  provInput.addEventListener('focus', () => provInput.value && suggestProvinces());

  // List table & submit
  form.addEventListener('submit', onSubmit);
  btnReset.addEventListener('click', resetForm);
  btnSearch.addEventListener('click', () => { currentPage = 1; loadCars(); });
  btnReload.addEventListener('click', () => { document.getElementById('searchText').value = ''; currentPage = 1; loadCars(); });
  prevPage.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadCars(); } });
  nextPage.addEventListener('click', () => { currentPage++; loadCars(true); });
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
    const data = await res.json(); // คาด [{brand_name: 'Toyota'}, ...]
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
    const data = await res.json(); // คาด [{prov_nam_t: 'กรุงเทพมหานคร'}, ...]
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

// ====== Table listing ======
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
    tr.innerHTML = `<td colspan="4" class="px-3 py-3 border text-center text-gray-500">ไม่พบข้อมูล</td>`;
    tbody.appendChild(tr);
  } else {
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2 border">${r.idx}</td>
        <td class="px-3 py-2 border">${escapeHtml(r.number_plate || '')}</td>
        <td class="px-3 py-2 border">${escapeHtml(r.car_brand || '')}</td>
        <td class="px-3 py-2 border">${escapeHtml(r.province || '')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('pageInfo').textContent = `หน้า ${page}`;
  const start = total === 0 ? 0 : (page - 1) * page_size + 1;
  const end = Math.min(total, page * page_size);
  document.getElementById('resultInfo').textContent = `แสดง ${start}-${end} จากทั้งหมด ${total} รายการ`;
}

async function onSubmit(e) {
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
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || 'บันทึกไม่สำเร็จ');
    }
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
