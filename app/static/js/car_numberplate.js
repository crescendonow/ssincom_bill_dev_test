// ====== Endpoint ======
const ENDPOINT_CARS = '/api/cars';
const ENDPOINT_BRANDS_SUGGEST = '/api/suggest/car_brand';
const ENDPOINT_PROV_SUGGEST   = '/api/suggest/province';

let currentPage = 1;
const PAGE_SIZE = 10;
let editingIdx = null;

const debounce = (fn, t=250)=>{ let x; return (...a)=>{ clearTimeout(x); x=setTimeout(()=>fn(...a),t);} };

document.addEventListener('DOMContentLoaded', () => {
  console.log('[car] init');
  bindEvents();
  loadCars();
});

function bindEvents(){
  const form = document.getElementById('carForm');
  const btnReset = document.getElementById('btnReset');
  const btnSearch = document.getElementById('btnSearch');
  const btnReload = document.getElementById('btnReload');
  const prevPage = document.getElementById('prevPage');
  const nextPage = document.getElementById('nextPage');
  const tbody = document.getElementById('carsTableBody');

  if (form) form.addEventListener('submit', onCreateSubmit);
  if (btnReset) btnReset.addEventListener('click', resetForm);
  if (btnSearch) btnSearch.addEventListener('click', ()=>{ currentPage=1; loadCars(); });
  if (btnReload) btnReload.addEventListener('click', ()=>{ const s=document.getElementById('searchText'); if(s) s.value=''; currentPage=1; loadCars(); });
  if (prevPage) prevPage.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; loadCars(); }});
  if (nextPage) nextPage.addEventListener('click', ()=>{ currentPage++; loadCars(true); });
  if (tbody) tbody.addEventListener('click', onTableClick);

  const brandInput = document.getElementById('car_brand');
  const provInput  = document.getElementById('province');
  if (brandInput){ brandInput.addEventListener('input', debounce(suggestBrands)); brandInput.addEventListener('focus', ()=>brandInput.value && suggestBrands()); }
  if (provInput){  provInput.addEventListener('input', debounce(suggestProvinces)); provInput.addEventListener('focus', ()=>provInput.value && suggestProvinces()); }
}

// ===== Load & Render =====
async function loadCars(isNextAttempt=false){
  try{
    const q = (document.getElementById('searchText')?.value || '').trim();
    const url = new URL(ENDPOINT_CARS, window.location.origin);
    url.searchParams.set('search', q);
    url.searchParams.set('page', currentPage);
    url.searchParams.set('page_size', PAGE_SIZE);
    console.log('[car] GET', url.toString());

    const res = await fetch(url.toString());
    console.log('[car] status', res.status);
    if(!res.ok){
      const txt = await res.text().catch(()=> '');
      console.error('[car] bad response', txt);
      return renderTable([],1,PAGE_SIZE,0);
    }

    let data;
    try{ data = await res.json(); }catch(e){ console.error('[car] json error', e); return renderTable([],1,PAGE_SIZE,0); }

    // รองรับหลายรูปแบบผลลัพธ์
    let items, page, page_size, total;
    if (Array.isArray(data)){
      items = data; page = 1; page_size = data.length; total = data.length;
    } else {
      items = data.items ?? data.data ?? [];
      page = data.page ?? 1;
      page_size = data.page_size ?? (Array.isArray(items) ? items.length : PAGE_SIZE);
      total = data.total ?? (Array.isArray(items) ? items.length : 0);
    }
    console.log('[car] items', items.length, 'page', page, '/', 'total', total);

    renderTable(items, page, page_size, total);
  }catch(err){
    if(isNextAttempt){ currentPage = Math.max(1, currentPage-1); }
    console.error('[car] fetch error', err);
    renderTable([],1,PAGE_SIZE,0);
  }
}

function renderTable(rows, page, page_size, total){
  const tbody = document.getElementById('carsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if(!rows || rows.length===0){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'px-3 py-3 border text-center text-gray-500';
    td.textContent = 'ไม่พบข้อมูล';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    rows.forEach(r=>{
      const tr = document.createElement('tr');
      tr.dataset.idx = r.idx;
      tr.dataset.plate = r.number_plate || '';
      tr.dataset.brand = r.car_brand || '';
      tr.dataset.province = r.province || '';

      const tdIdx = mkCell(r.idx);
      const tdPlate = mkCell(r.number_plate || '', 'cell-plate');
      const tdBrand = mkCell(r.car_brand || '', 'cell-brand');
      const tdProv  = mkCell(r.province || '', 'cell-province');
      const tdAct   = document.createElement('td');
      tdAct.className = 'px-3 py-2 border cell-actions';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-edit bg-white border px-3 py-1 rounded hover:bg-gray-50 mr-1';
      btnEdit.textContent = 'แก้ไข';

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn-del bg-white border px-3 py-1 rounded hover:bg-gray-50 text-red-600';
      btnDel.textContent = 'ลบ';

      tdAct.appendChild(btnEdit);
      tdAct.appendChild(btnDel);

      tr.appendChild(tdIdx);
      tr.appendChild(tdPlate);
      tr.appendChild(tdBrand);
      tr.appendChild(tdProv);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  }

  const pageInfo = document.getElementById('pageInfo');
  if (pageInfo) pageInfo.textContent = `หน้า ${page}`;
  const start = total===0?0:(page-1)*page_size+1;
  const end = Math.min(total, page*page_size);
  const resultInfo = document.getElementById('resultInfo');
  if (resultInfo) resultInfo.textContent = `แสดง ${start}-${end} จากทั้งหมด ${total} รายการ`;
}

function mkCell(text, extraCls=''){
  const td = document.createElement('td');
  td.className = 'px-3 py-2 border' + (extraCls ? ' '+extraCls : '');
  td.textContent = text;
  return td;
}

// ===== Create (form) =====
async function onCreateSubmit(e){
  e.preventDefault();
  const number_plate = (document.getElementById('number_plate')?.value || '').trim();
  const car_brand    = (document.getElementById('car_brand')?.value || '').trim();
  const province     = (document.getElementById('province')?.value || '').trim();
  if (!number_plate) return setFormMsg('กรุณากรอกเลขทะเบียนรถ', true);

  try{
    const res = await fetch(ENDPOINT_CARS, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ number_plate, car_brand, province })
    });
    if(!res.ok) throw new Error(await res.text()||'บันทึกไม่สำเร็จ');
    setFormMsg('บันทึกสำเร็จ ✅');
    resetForm();
    currentPage = 1;
    loadCars();
  }catch(err){
    console.error(err);
    setFormMsg('ผิดพลาด: '+err.message, true);
  }
}

function resetForm(){
  ['number_plate','car_brand','province'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function setFormMsg(msg, isError=false){
  const el = document.getElementById('formMsg');
  if (el){
    el.textContent = msg || '';
    el.className = 'text-sm ml-2 ' + (isError? 'text-red-600':'text-green-600');
  }
}

// ===== Inline edit / delete =====
function onTableClick(e){
  const btn = e.target.closest('button');
  if (!btn) return;
  const tr = btn.closest('tr');
  if (!tr) return;

  if (btn.classList.contains('btn-edit')) return enterInlineEdit(tr);
  if (btn.classList.contains('btn-del'))  return onDeleteRow(tr);
  if (btn.classList.contains('btn-save')) return onSaveRow(tr);
  if (btn.classList.contains('btn-cancel')) return onCancelRow(tr);
}

function enterInlineEdit(tr){
  const idx = parseInt(tr.dataset.idx, 10);
  editingIdx = idx;

  const plateCell = tr.querySelector('.cell-plate');
  const brandCell = tr.querySelector('.cell-brand');
  const provCell  = tr.querySelector('.cell-province');
  const actCell   = tr.querySelector('.cell-actions');

  const plateVal = tr.dataset.plate || '';
  const brandVal = tr.dataset.brand || '';
  const provVal  = tr.dataset.province || '';

  plateCell.innerHTML = '';
  brandCell.innerHTML = '';
  provCell.innerHTML  = '';

  plateCell.appendChild(inlineInput(plateVal, 'number_plate', 'เลขทะเบียนรถ'));
  brandCell.appendChild(inlineInput(brandVal, 'car_brand', 'ยี่ห้อรถยนต์'));
  provCell.appendChild(inlineInput(provVal,  'province', 'จังหวัด'));

  actCell.innerHTML = '';
  const btnSave = document.createElement('button');
  btnSave.type = 'button';
  btnSave.className = 'btn-save bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 mr-1';
  btnSave.textContent = 'บันทึก';
  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.className = 'btn-cancel bg-gray-100 border px-3 py-1 rounded hover:bg-gray-200';
  btnCancel.textContent = 'ยกเลิก';
  actCell.appendChild(btnSave);
  actCell.appendChild(btnCancel);
}

function inlineInput(value, field, label){
  const inp = document.createElement('input');
  inp.value = value || '';
  inp.setAttribute('data-field', field);
  inp.setAttribute('aria-label', label);
  inp.className = 'w-full border rounded px-2 py-1';
  return inp;
}

async function onSaveRow(tr){
  const idx = parseInt(tr.dataset.idx, 10);
  const np  = tr.querySelector('input[data-field="number_plate"]')?.value.trim() || '';
  const br  = tr.querySelector('input[data-field="car_brand"]')?.value.trim() || '';
  const pv  = tr.querySelector('input[data-field="province"]')?.value.trim() || '';
  if (!np) return alert('กรุณากรอกเลขทะเบียนรถ');

  try{
    const res = await fetch(`${ENDPOINT_CARS}/${idx}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ number_plate: np, car_brand: br, province: pv })
    });
    if (!res.ok) throw new Error(await res.text() || 'อัปเดตไม่สำเร็จ');

    editingIdx = null;
    loadCars();
  }catch(err){
    console.error(err);
    alert('ผิดพลาด: '+err.message);
  }
}

function onCancelRow(tr){
  editingIdx = null;
  loadCars();
}

async function onDeleteRow(tr){
  const idx = parseInt(tr.dataset.idx, 10);
  if (!idx) return;
  if (!confirm('ยืนยันการลบรายการนี้?')) return;
  try{
    const res = await fetch(`${ENDPOINT_CARS}/${idx}`, { method:'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('ลบไม่สำเร็จ');
    if (editingIdx === idx) editingIdx = null;
    loadCars();
  }catch(err){
    console.error(err);
    alert('เกิดข้อผิดพลาดระหว่างลบ');
  }
}

// ===== Suggest (ใช้กับฟอร์มเพิ่มใหม่ด้านบน) =====
async function suggestBrands(){
  const target = document.getElementById('car_brand');
  const msg = document.getElementById('brandMsg');
  const dl  = document.getElementById('brand_datalist');
  if (!target || !dl) return;
  const q = (target.value||'').trim();
  dl.innerHTML = ''; if (msg) msg.textContent='';
  if (q.length<1) return;
  try{
    const url = new URL(ENDPOINT_BRANDS_SUGGEST, window.location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url);
    const data = await res.json();
    data.forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.brand_name;
      dl.appendChild(opt);
    });
    if (msg) msg.textContent = `พบ ${data.length} รายการ`;
  }catch(e){ if (msg) msg.textContent='โหลดคำแนะนำยี่ห้อไม่สำเร็จ'; }
}

async function suggestProvinces(){
  const target = document.getElementById('province');
  const msg = document.getElementById('provMsg');
  const dl  = document.getElementById('province_datalist');
  if (!target || !dl) return;
  const q = (target.value||'').trim();
  dl.innerHTML = ''; if (msg) msg.textContent='';
  if (q.length<1) return;
  try{
    const url = new URL(ENDPOINT_PROV_SUGGEST, window.location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url);
    const data = await res.json();
    data.forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.prov_nam_t;
      dl.appendChild(opt);
    });
    if (msg) msg.textContent = `พบ ${data.length} รายการ`;
  }catch(e){ if (msg) msg.textContent='โหลดคำแนะนำจังหวัดไม่สำเร็จ'; }
}
