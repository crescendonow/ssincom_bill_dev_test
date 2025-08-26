// /static/js/product_form.js
let allProducts = [];         // ข้อมูลทั้งหมดจากเซิร์ฟเวอร์
let filteredProducts = [];    // ผลหลังค้นหา
let prodEditing = null;       // idx ที่กำลังแก้ไข
let currentPage = 1;
const PAGE_SIZE = 20;

const $ = (id) => document.getElementById(id);
const norm = (s) => (s ?? '').toString().trim().toLowerCase();

// ===== โหลดทั้งหมด =====
async function loadAllProducts() {
  try {
    const res = await fetch('/api/products/all');
    if (!res.ok) throw new Error('โหลดรายการสินค้าไม่สำเร็จ');
    allProducts = await res.json();
    filteredProducts = allProducts.slice();
    currentPage = 1;
    renderPage();
  } catch (e) {
    console.error(e);
    allProducts = []; filteredProducts = [];
    renderPage();
  }
}

// ===== แสดงหน้าปัจจุบัน =====
function renderPage() {
  const total = filteredProducts.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > maxPage) currentPage = maxPage;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(total, startIdx + PAGE_SIZE);
  const pageRows = filteredProducts.slice(startIdx, endIdx);

  renderProducts(pageRows);

  // footer info + ปุ่มเปลี่ยนหน้า
  const resultInfo = $('resultInfo');
  if (resultInfo) {
    const from = total === 0 ? 0 : startIdx + 1;
    resultInfo.textContent = `แสดง ${from}-${endIdx} จากทั้งหมด ${total} รายการ`;
  }
  const pageInfo = $('pageInfo');
  if (pageInfo) pageInfo.textContent = `หน้า ${currentPage} / ${maxPage}`;

  const prevBtn = $('prevPage');
  const nextBtn = $('nextPage');
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= maxPage;
}

// ===== เรนเดอร์ตารางของหน้า =====
function renderProducts(rows) {
  const tb = $('tbody');
  if (!tb) return;
  tb.innerHTML = '';

  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.innerHTML = `<td class="p-2 text-center text-gray-500" colspan="6">ไม่พบข้อมูล</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'row border-b';
    const price = (p.cf_itempricelevel_price ?? 0);
    tr.innerHTML = `
      <td class="p-2">${p.cf_itemid || ''}</td>
      <td class="p-2">${p.cf_itemname || ''}</td>
      <td class="p-2 hidden sm:table-cell">${p.cf_unitname || ''}</td>
      <td class="p-2">${Number(price).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td class="p-2 hidden md:table-cell">${p.cf_items_ordinary ?? ''}</td>
      <td class="p-2">
        <button class="text-blue-600 hover:underline" onclick='editProduct(${JSON.stringify(p).replace(/'/g,"&#39;")})'>แก้ไข</button>
      </td>
    `;
    tb.appendChild(tr);
  });
}

// ===== ค้นหา (รหัส / ชื่อ / หน่วย) =====
function searchProduct() {
  const q = norm($('search')?.value);
  if (!q) {
    filteredProducts = allProducts.slice();
  } else {
    filteredProducts = allProducts.filter(p =>
      (p.cf_itemid || '').toLowerCase().includes(q) ||
      (p.cf_itemname || '').toLowerCase().includes(q) ||
      (p.cf_unitname || '').toLowerCase().includes(q)
    );
  }
  currentPage = 1;
  renderPage();
}

// ===== ฟอร์ม =====
function resetProductForm() {
  prodEditing = null;
  $('productForm')?.reset();
  const idxEl = $('idx'); if (idxEl) idxEl.value = '';
  $('dupWarn')?.classList.add('hidden');
  $('btnDelete')?.classList.add('hidden');
}
function fillProductForm(p) {
  const map = ['idx','cf_itemid','cf_itemname','cf_unitname','cf_itempricelevel_price','cf_items_ordinary'];
  map.forEach(k => { const el = $(k); if (el) el.value = p[k] ?? ''; });
}
async function isProductDuplicate(payload, ignoreIdx=null) {
  const fd = new FormData();
  fd.append('cf_itemid', payload.cf_itemid || '');
  fd.append('cf_itemname', payload.cf_itemname || '');
  if (ignoreIdx) fd.append('ignore_idx', ignoreIdx);
  const res = await fetch('/api/products/check-duplicate', { method:'POST', body: fd });
  const data = await res.json().catch(()=>({duplicate:false}));
  return !!data.duplicate;
}
async function saveProduct(e) {
  e.preventDefault();
  const f = new FormData($('productForm'));
  const payload = Object.fromEntries(f.entries());

  const duplicate = await isProductDuplicate(payload, payload.idx || null);
  const warn = $('dupWarn');
  if (duplicate) { warn?.classList.remove('hidden'); return; }
  else { warn?.classList.add('hidden'); }

  const toDash = $('redirectDash')?.checked ? '1' : null;

  let url = '/api/products';
  let method = 'POST';
  if (payload.idx) { url = `/api/products/${payload.idx}`; method = 'POST'; }

  const fd = new FormData();
  for (const [k, v] of Object.entries(payload)) if (k !== 'idx') fd.append(k, v);
  if (toDash) fd.append('redirect_to_dashboard', '1');

  const res = await fetch(url, { method, body: fd });
  if (res.redirected) { window.location.href = res.url; return; }
  if (!res.ok) { const t = await res.text(); alert('บันทึกล้มเหลว: ' + t); return; }

  await loadAllProducts();
  if (!payload.idx) resetProductForm();
  alert('บันทึกเรียบร้อย');
}
function editProduct(p) {
  prodEditing = p.idx;
  fillProductForm(p);
  const idxEl = $('idx'); if (idxEl) idxEl.value = p.idx;
  $('btnDelete')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function deleteProduct() {
  if (!prodEditing) return;
  if (!confirm('ยืนยันลบสินค้านี้?')) return;
  const res = await fetch(`/api/products/${prodEditing}`, { method: 'DELETE' });
  if (!res.ok) { alert('ลบไม่สำเร็จ'); return; }
  await loadAllProducts();
  resetProductForm();
  alert('ลบเรียบร้อย');
}

// ===== Events =====
function initProductForm() {
  $('productForm')?.addEventListener('submit', saveProduct);
  $('btnReset')?.addEventListener('click', resetProductForm);
  $('btnDelete')?.addEventListener('click', deleteProduct);

  $('search')?.addEventListener('input', searchProduct);

  $('prevPage')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderPage(); } });
  $('nextPage')?.addEventListener('click', () => { currentPage++; renderPage(); });

  loadAllProducts();
}
document.addEventListener('DOMContentLoaded', initProductForm);
