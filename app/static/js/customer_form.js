// /static/js/customer_form.js  (REPLACE ALL)

const ENDPOINT_PROV_SUGGEST = '/api/suggest/province';

let all = [];
let filtered = [];
let editing = null;
let currentPage = 1;
const PAGE_SIZE = 20;

const $ = (id) => document.getElementById(id);
const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const esc = (s) => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function displayName(c){
  const primary = (c.customer_name || '').trim();
  if (primary) return primary;
  const combo = [c.prename, c.fname, c.lname].filter(Boolean).join(' ').trim();
  return combo || c.fname || '';
}
function displayPhone(c){ return c.mobile || c.tel || c.cf_personaddress_mobile || ''; }
function getTaxId(c){ return c.cf_taxid ?? c.tax_id ?? c.taxid ?? ''; }
function getProvince(c){ return c.cf_provincename ?? c.province ?? ''; }

// ===== load all =====
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

// ===== paging =====
function renderPage(){
  const total = filtered.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(currentPage > maxPage) currentPage = maxPage;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx   = Math.min(total, startIdx + PAGE_SIZE);
  const pageRows = filtered.slice(startIdx, endIdx);

  renderTable(pageRows);

  const resultInfo = $('resultInfo');
  if(resultInfo){
    const from = total === 0 ? 0 : startIdx + 1;
    resultInfo.textContent = `แสดง ${from}-${endIdx} จากทั้งหมด ${total} รายการ`;
  }
  const pageInfo = $('pageInfo');
  if(pageInfo) pageInfo.textContent = `หน้า ${currentPage} / ${maxPage}`;

  const prevBtn = $('prevPage'), nextBtn = $('nextPage');
  if(prevBtn) prevBtn.disabled = currentPage <= 1;
  if(nextBtn) nextBtn.disabled = currentPage >= maxPage;
}

// ===== table render (match HTML: <tbody id="tbody"> & button.btn-edit data-idx) =====
function renderTable(rows){
  const tb = $('tbody'); // HTML uses id="tbody"
  if(!tb) return;
  tb.innerHTML = '';

  if(!rows || rows.length === 0){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="p-2 text-center text-gray-500" colspan="6">ไม่พบข้อมูล</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach(c=>{
    const tr = document.createElement('tr');
    tr.className = 'row border-b';
    tr.innerHTML = `
      <td class="p-2">${esc(displayName(c))}</td>
      <td class="p-2 hidden sm:table-cell">${esc(c.personid || '')}</td>
      <td class="p-2 hidden lg:table-cell">${esc(getTaxId(c))}</td>
      <td class="p-2">${esc(displayPhone(c))}</td>
      <td class="p-2 hidden md:table-cell">${esc(getProvince(c))}</td>
      <td class="p-2 w-24">
        <button type="button" class="text-blue-600 hover:underline btn-edit" data-idx="${c.idx}">แก้ไข</button>
      </td>
    `;
    tb.appendChild(tr);
  });
}

// ===== event delegation for edit buttons =====
(function bindEditDelegation(){
  const tb = $('tbody'); // id="tbody" in HTML
  if(!tb) return;
  tb.addEventListener('click', (ev)=>{
    const btn = ev.target.closest('.btn-edit');
    if(!btn) return;
    const idx = Number(btn.dataset.idx);
    const item = all.find(x => x.idx === idx);
    if(item) openEdit(item);
  });
})();

// ===== search =====
function doSearch(){
  const q = norm($('search')?.value);
  if(!q){
    filtered = all.slice();
  }else{
    filtered = all.filter(c =>
      (c.customer_name || '').toLowerCase().includes(q) ||
      displayName(c).toLowerCase().includes(q) ||
      (c.personid || '').toLowerCase().includes(q) ||
      String(getTaxId(c)).toLowerCase().includes(q) ||
      displayPhone(c).toLowerCase().includes(q) ||
      String(getProvince(c)).toLowerCase().includes(q)
    );
  }
  currentPage = 1;
  renderPage();
}

// ===== open/close modal (ids must exist on page) =====
function openEdit(c){
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
  document.getElementById('editModal')?.classList.remove('hidden');
}
function closeEdit(){
  document.getElementById('editModal')?.classList.add('hidden');
  editing = null;
}
window.closeEdit = closeEdit;

// ===== save (no duplicate check on update) =====
async function saveEdit(){
  if(!editing){ alert('ไม่พบรายการที่จะแก้ไข'); return; }
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

  try{
    const res = await fetch(`/api/customers/${idx}`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok){
      const t = await res.text();
      throw new Error(t || 'บันทึกล้มเหลว');
    }
    await loadAll();
    closeEdit();
    alert('บันทึกสำเร็จ');
  }catch(e){
    console.error(e);
    alert('บันทึกล้มเหลว');
  }
}
window.saveEdit = saveEdit;

// ===== province autocomplete (unchanged) =====
async function suggestProvinces(){
  const input = $('cf_provincename');
  const list  = $('province_datalist');
  if(!input || !list) return;
  const q = (input.value || '').trim();
  list.innerHTML = '';
  if(q.length < 1) return;
  try{
    const url = new URL(ENDPOINT_PROV_SUGGEST, location.origin);
    url.searchParams.set('q', q);
    const res = await fetch(url);
    if(!res.ok) throw new Error('โหลดจังหวัดไม่สำเร็จ');
    const data = await res.json(); // [{prov_nam_t}]
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

// ===== wireup =====
document.addEventListener('DOMContentLoaded', ()=>{
  loadAll();

  $('search')?.addEventListener('input', doSearch);
  $('prevPage')?.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; renderPage(); } });
  $('nextPage')?.addEventListener('click', ()=>{ currentPage++; renderPage(); });

  $('cf_provincename')?.addEventListener('input', suggestProvinces);
});
