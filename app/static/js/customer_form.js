// /static/js/customer_form.js  (REPLACE ALL)

// ===== Config =====
const ENDPOINT_PROV_SUGGEST = '/api/suggest/province';

// ===== State =====
let all = [];
let filtered = [];
let editing = null;
let currentPage = 1;
const PAGE_SIZE = 20;

// ===== Helpers =====
const $ = (id) => document.getElementById(id);
const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function displayName(c){
  const p = (c.customer_name || '').trim();
  if (p) return p;
  const combo = [c.prename, c.fname, c.lname].filter(Boolean).join(' ').trim();
  return combo || c.fname || '';
}
function displayPhone(c){ return c.mobile || c.tel || c.cf_personaddress_mobile || ''; }
function getTaxId(c){ return c.cf_taxid ?? c.tax_id ?? c.taxid ?? ''; }
function getProvince(c){ return c.cf_provincename ?? c.province ?? ''; }

// ===== Load all =====
async function loadAll(){
  try{
    const res = await fetch('/api/customers/all');
    if(!res.ok) throw new Error('โหลดรายการลูกค้าไม่สำเร็จ');
    all = await res.json();
    filtered = all.slice();
    currentPage = 1;
    renderPage();
  }catch(e){
    console.error(e);
    all = []; filtered = [];
    renderPage();
  }
}

// ===== Render (paging + table) =====
function renderPage(){
  const total = filtered.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(currentPage > maxPage) currentPage = maxPage;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx   = Math.min(total, startIdx + PAGE_SIZE);

  renderTable(filtered.slice(startIdx, endIdx));

  const resultInfo = $('resultInfo');
  if (resultInfo) resultInfo.textContent =
    `แสดง ${total ? startIdx + 1 : 0}-${endIdx} จากทั้งหมด ${total} รายการ`;
  const pageInfo = $('pageInfo');
  if (pageInfo) pageInfo.textContent = `หน้า ${currentPage} / ${maxPage}`;

  const prevBtn = $('prevPage'), nextBtn = $('nextPage');
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= maxPage;
}

function renderTable(rows){
  // tbody id="tbody" ตามหน้า customer_form.html
  const tb = $('tbody');
  if(!tb) return;

  if(!rows.length){
    tb.innerHTML = `<tr><td class="p-2 text-center text-gray-500" colspan="6">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(c => `
    <tr class="row border-b">
      <td class="p-2">${esc(displayName(c))}</td>
      <td class="p-2 hidden sm:table-cell">${esc(c.personid || '')}</td>
      <td class="p-2 hidden lg:table-cell">${esc(getTaxId(c))}</td>
      <td class="p-2">${esc(displayPhone(c))}</td>
      <td class="p-2 hidden md:table-cell">${esc(getProvince(c))}</td>
      <td class="p-2 w-24">
        <button type="button" class="text-blue-600 hover:underline btn-edit" data-idx="${c.idx}">แก้ไข</button>
      </td>
    </tr>
  `).join('');
}

// ===== Edit (fill the top form; no modal) =====
function fillForm(c){
  $('idx')?.value = c.idx ?? '';
  $('prename')?.value = c.prename ?? '';
  $('fname')?.value = (c.customer_name ?? c.fname ?? '') || '';
  $('lname')?.value = c.lname ?? '';
  $('personid')?.value = c.personid ?? '';

  // ในฟอร์มใช้ชื่อฟิลด์ cf_* อยู่แล้ว
  $('cf_taxid')?.value = getTaxId(c);
  $('cf_personaddress')?.value = c.cf_personaddress ?? '';
  $('cf_personzipcode')?.value = c.cf_personzipcode ?? '';
  $('cf_provincename')?.value = getProvince(c);
  $('cf_personaddress_tel')?.value = c.tel ?? '';
  $('cf_personaddress_mobile')?.value = c.mobile ?? '';

  $('fmlpaymentcreditday')?.value = c.fmlpaymentcreditday ?? '';
}

function resetForm(){
  $('customerForm')?.reset();
  $('idx')?.value = '';
  editing = null;
}

function editRowByIdx(idx){
  const c = all.find(it => String(it.idx) === String(idx));
  if(!c) return;
  editing = c.idx;
  fillForm(c);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Save / Delete (ถ้าต้องใช้ปุ่มบันทึก/รีเซ็ตบนฟอร์ม) =====
async function saveCustomer(e){
  e?.preventDefault();
  const f = new FormData($('customerForm'));
  const payload = Object.fromEntries(f.entries());

  // เข้ากับ backend เดิม: ใช้ form-data POST/PUT
  let url = '/api/customers', method = 'POST';
  if (payload.idx) url = `/api/customers/${payload.idx}`;

  const fd = new FormData();
  for (const [k,v] of Object.entries(payload)) if(k!=='idx') fd.append(k, v);

  const res = await fetch(url, { method, body: fd });
  if (res.redirected) { location.href = res.url; return; }
  if (!res.ok) { alert('บันทึกล้มเหลว'); return; }

  await loadAll();
  if (!payload.idx) resetForm();
  alert('บันทึกเรียบร้อย');
}

// ===== Search & province suggest =====
function doSearch(){
  const q = norm($('search')?.value);
  filtered = !q ? all.slice() : all.filter(c =>
    (c.customer_name||'').toLowerCase().includes(q) ||
    displayName(c).toLowerCase().includes(q) ||
    (c.personid||'').toLowerCase().includes(q) ||
    String(getTaxId(c)).toLowerCase().includes(q) ||
    displayPhone(c).toLowerCase().includes(q) ||
    String(getProvince(c)).toLowerCase().includes(q)
  );
  currentPage = 1;
  renderPage();
}

async function suggestProvinces(){
  const input = $('cf_provincename');
  const list = $('province_datalist');
  if(!input || !list) return;
  const q = (input.value || '').trim();
  list.innerHTML = '';
  if(!q) return;
  try{
    const url = new URL(ENDPOINT_PROV_SUGGEST, location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url);
    if(!res.ok) throw new Error();
    const data = await res.json();
    const seen = new Set();
    data.forEach(r=>{
      const name = r.prov_nam_t;
      if(name && !seen.has(name)){
        seen.add(name);
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
      }
    });
  }catch(e){ console.error(e); }
}

// ===== Wire up =====
function initCustomerForm(){
  $('customerForm')?.addEventListener('submit', saveCustomer);
  $('btnReset')?.addEventListener('click', resetForm);

  $('search')?.addEventListener('input', doSearch);
  $('prevPage')?.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; renderPage(); } });
  $('nextPage')?.addEventListener('click', ()=>{ currentPage++; renderPage(); });

  // event delegation ให้ปุ่มแก้ไขทำงานแน่ๆ
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('.btn-edit');
    if(btn && btn.dataset.idx) editRowByIdx(btn.dataset.idx);
  });

  // province suggest
  const prov = $('cf_provincename');
  if(prov){
    prov.addEventListener('input', ()=>suggestProvinces());
    prov.addEventListener('focus', ()=>prov.value && suggestProvinces());
  }

  loadAll();
}

document.addEventListener('DOMContentLoaded', initCustomerForm);
