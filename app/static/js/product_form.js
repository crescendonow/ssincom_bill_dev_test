
// static/js/product_form.js
let productsAll = [];
let prodEditing = null;

async function loadAllProducts() {
  const res = await fetch('/api/products/all');
  productsAll = await res.json();
  renderProducts(productsAll);
}

function renderProducts(rows) {
  const tb = document.getElementById('tbody');
  if (!tb) return;
  tb.innerHTML = '';
  rows.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'row border-b';
    tr.innerHTML = `
      <td class="p-2">${p.cf_itemid || ''}</td>
      <td class="p-2">${p.cf_itemname || ''}</td>
      <td class="p-2">${p.cf_unitname || ''}</td>
      <td class="p-2">${p.cf_itempricelevel_price ?? ''}</td>
      <td class="p-2">${p.cf_items_ordinary ?? ''}</td>
      <td class="p-2"><button class="text-blue-600 hover:underline" onclick='editProduct(${JSON.stringify(p).replace(/'/g,"&#39;")})'>แก้ไข</button></td>
    `;
    tb.appendChild(tr);
  });
}

function resetProductForm() {
  prodEditing = null;
  const form = document.getElementById('productForm');
  if (form) form.reset();
  const idxEl = document.getElementById('idx');
  if (idxEl) idxEl.value = '';
  const warn = document.getElementById('dupWarn');
  if (warn) warn.classList.add('hidden');
  const del = document.getElementById('btnDelete');
  if (del) del.classList.add('hidden');
}

function fillProductForm(p) {
  const map = ['idx','cf_itemid','cf_itemname','cf_unitname','cf_itempricelevel_price','cf_items_ordinary'];
  map.forEach(k => {
    const el = document.getElementById(k);
    if (el) el.value = p[k] ?? '';
  });
}

async function isProductDuplicate(payload, ignoreIdx=null) {
  const fd = new FormData();
  fd.append('cf_itemid', payload.cf_itemid || '');
  fd.append('cf_itemname', payload.cf_itemname || '');
  if (ignoreIdx) fd.append('ignore_idx', ignoreIdx);
  const res = await fetch('/api/products/check-duplicate', { method:'POST', body: fd });
  const data = await res.json();
  return !!data.duplicate;
}

async function saveProduct(e) {
  e.preventDefault();
  const form = document.getElementById('productForm');
  const f = new FormData(form);
  const payload = Object.fromEntries(f.entries());

  const duplicate = await isProductDuplicate(payload, payload.idx || null);
  const warn = document.getElementById('dupWarn');
  if (duplicate) {
    if (warn) warn.classList.remove('hidden');
    return;
  } else {
    if (warn) warn.classList.add('hidden');
  }

  const toDash = document.getElementById('redirectDash')?.checked ? '1' : null;

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
  const idxEl = document.getElementById('idx');
  if (idxEl) idxEl.value = p.idx;
  const del = document.getElementById('btnDelete');
  if (del) del.classList.remove('hidden');
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

function searchProduct() {
  const qEl = document.getElementById('search');
  const q = (qEl?.value || '').toLowerCase().trim();
  const filtered = productsAll.filter(p =>
    (p.cf_itemid||'').toLowerCase().includes(q) ||
    (p.cf_itemname||'').toLowerCase().includes(q) ||
    (p.cf_unitname||'').toLowerCase().includes(q)
  );
  renderProducts(filtered);
}

function initProductForm() {
  document.getElementById('productForm')?.addEventListener('submit', saveProduct);
  document.getElementById('btnReset')?.addEventListener('click', resetProductForm);
  document.getElementById('btnDelete')?.addEventListener('click', deleteProduct);
  document.getElementById('search')?.addEventListener('input', searchProduct);
  loadAllProducts();
}

document.addEventListener('DOMContentLoaded', initProductForm);
