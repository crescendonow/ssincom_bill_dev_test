// /static/js/customer_form.js  (REPLACE ALL)

// ===== Config =====
const ENDPOINT_PROV_SUGGEST = '/api/suggest/province';

// ===== State =====
let all = [];
let filtered = [];
let editingIdx = null;
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
function displayPhone(c){ return c.cf_personaddress_mobile || c.mobile || c.cf_personaddress_tel || c.tel || ''; }
function getTaxId(c){ return c.cf_taxid ?? c.tax_id ?? c.taxid ?? ''; }
function getProvince(c){ return c.cf_provincename ?? c.province ?? ''; }

// ===== Load all =====
async function loadAll(){
  try{
    const res = await fetch('/api/customers/all', { credentials: 'same-origin' });
    if(!res.ok) throw new Error('โหลดรายการลูกค้าไม่สำเร็จ');
    all = await res.json();
    filtered = all.slice();
    currentPage = 1;
    renderPage();
  }catch(e){
    console.error('[customer_form] loadAll error:', e);
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

  $('resultInfo') && ( $('resultInfo').textContent =
    `แสดง ${total ? startIdx + 1 : 0}-${endIdx} จากทั้งหมด ${total} รายการ` );
  $('pageInfo') && ( $('pageInfo').textContent = `หน้า ${currentPage} / ${maxPage}` );

  $('prevPage') && ( $('prevPage').disabled = currentPage <= 1 );
  $('nextPage') && ( $('nextPage').disabled = currentPage >= maxPage );
}

function renderTable(rows){
  const tb = $('tbody'); // ตามหน้า customer_form.html
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

// ===== Fill / Reset form =====
function fillForm(c){
  $('idx')?.value = c.idx ?? '';
  $('prename')?.value = c.prename ?? '';
  $('fname')?.value = (c.customer_name ?? c.fname ?? '') || '';
  $('lname')?.value = c.lname ?? '';
  $('personid')?.value = c.personid ?? '';

  // ใช้คีย์ cf_* ตามฟอร์มใน HTML
  $('cf_taxid')?.value = getTaxId(c);
  $('cf_personaddress')?.value = c.cf_personaddress ?? '';
  $('cf_personzipcode')?.value = c.cf_personzipcode ?? '';
  $('cf_provincename')?.value = getProvince(c);
  $('cf_personaddress_tel')?.value = c.tel ?? '';
  $('cf_personaddress_mobile')?.value = c.mobile ?? '';

  $('fmlpaymentcreditday')?.value = c.fmlpaymentcreditday ?? '';

  // แสดงปุ่มลบเมื่อกำลังแก้ไข
  $('btnDelete')?.classList.remove('hidden');
}

function resetForm(){
  $('customerForm')?.reset();
  $('idx')?.value = '';
  editingIdx = null;
  $('btnDelete')?.classList.add('hidden');
  $('dupWarn')?.classList.add('hidden');
}

// ===== Edit row (click from table) =====
function editRowByIdx(idx){
  const c = all.find(it => String(it.idx) === String(idx));
  if(!c) return;
  editingIdx = c.idx;
  fillForm(c);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Save (PUT when editing, POST when creating) =====
async function saveCustomer(e){
  e?.preventDefault();
  const f = new FormData($('customerForm'));
  const payload = Object.fromEntries(f.entries());

  const isEditing = !!payload.idx;

  // ไม่ตรวจ duplicate เวลาแก้ไข (ตามที่ตกลง)
  $('dupWarn')?.classList.add('hidden');

  try{
    if (isEditing) {
      // --- UPDATE via JSON -> PUT /api/customers/{idx}
      const idx = payload.idx;
      const body = {
        prename: payload.prename || null,
        fname: payload.fname || null,
        lname: payload.lname || null,
        personid: payload.personid || null,
        cf_taxid: payload.cf_taxid || null,
        cf_personaddress: payload.cf_personaddress || null,
        cf_personzipcode: payload.cf_personzipcode || null,
        cf_provincename: payload.cf_provincename || null,
        tel: payload.cf_personaddress_tel || null,
        mobile: payload.cf_personaddress_mobile || null,
        fmlpaymentcreditday: payload.fmlpaymentcreditday ? Number(payload.fmlpaymentcreditday) : null,
      };

      const res = await fetch(`/api/customers/${idx}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('อัปเดตไม่สำเร็จ');
      alert('บันทึกการแก้ไขเรียบร้อย');
    } else {
      // --- CREATE (ถ้ามี) : POST /api/customers (ใช้ form-data เดิมไว้)
      const fd = new FormData();
      for (const [k,v] of Object.entries(payload)) fd.append(k, v);
      const res = await fetch('/api/customers', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('เพิ่มลูกค้าไม่สำเร็จ');
      alert('เพิ่มลูกค้าเรียบร้อย');
    }

    await loadAll();
    // ถ้าเป็นสร้างใหม่ → รีเซ็ตฟอร์ม, ถ้าเป็นแก้ไข → คงค่าไว้
    if (!isEditing) resetForm();
  }catch(e){
    console.error('[customer_form] save error:', e);
    alert('บันทึกล้มเหลว');
  }
}

// ===== Delete (DELETE /api/customers/{idx}) =====
async function deleteCustomer(){
  const idx = $('idx')?.value;
  if (!idx) { alert('ยังไม่ได้เลือกแถวที่จะแก้ไข/ลบ'); return; }
  if (!confirm('ยืนยันลบลูกค้ารายนี้?')) return;
  try{
    const res = await fetch(`/api/customers/${idx}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('ลบไม่สำเร็จ');
    alert('ลบเรียบร้อย');
    await loadAll();
    resetForm();
  }catch(e){
    console.error('[customer_form] delete error:', e);
    alert('ลบไม่สำเร็จ');
  }
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
  $('btnDelete')?.addEventListener('click', deleteCustomer);

  $('search')?.addEventListener('input', doSearch);
  $('prevPage')?.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; renderPage(); } });
  $('nextPage')?.addEventListener('click', ()=>{ currentPage++; renderPage(); });

  // ปุ่ม "แก้ไข" ในตาราง — ใช้ delegation
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomerForm, { once: true });
} else {
  initCustomerForm();
}
