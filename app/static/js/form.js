/* /static/js/form.js  — unified products (master + suggest), iOS-friendly clicks, and bug fixes */

/* ===========================
   Edit mode (show Update/Save)
   =========================== */
document.addEventListener("DOMContentLoaded", async () => {
  const url = new URL(location.href);
  const editId = url.searchParams.get("edit");

  const btnUpdate = document.getElementById('btnUpdate');
  const btnSave = document.getElementById('btnSave');
  if (btnUpdate) btnUpdate.classList.toggle('hidden', !editId);
  if (btnSave) btnSave.classList.toggle('hidden', !!editId);

  if (!editId) return;

  let data = null;
  try { data = JSON.parse(sessionStorage.getItem("invoice_edit_data") || "null"); } catch {}
  if (!data) {
    try {
      const res = await fetch(`/api/invoices/${editId}/detail`);
      if (!res.ok) throw new Error();
      data = await res.json();
    } catch {
      alert("โหลดรายละเอียดบิลไม่สำเร็จ");
      return;
    }
  }
  fillInvoiceForm(data.invoice);
  fillInvoiceItems(data.items);
});

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ""; }

function fillInvoiceForm(h) {
  setVal("invoice_number", h.invoice_number);
  setVal("invoice_date", h.invoice_date);
  setVal("personid", h.personid);
  setVal("customer_name", h.customer_name);
  setVal("customer_taxid", h.customer_taxid);
  setVal("customer_address", h.customer_address);
  setVal("cf_personzipcode", h.cf_personzipcode);
  setVal("cf_provincename", h.cf_provincename);
  setVal("tel", h.tel);
  setVal("mobile", h.mobile);
  setVal("po_number", h.po_number);
  setVal("grn_number", h.grn_number);
  setVal("dn_number", h.dn_number);
  setVal("fmlpaymentcreditday", h.fmlpaymentcreditday);
  setVal("due_date", h.due_date);
  setVal("car_numberplate", h.car_numberplate);
  computeAndFillDueDate();
}

function fillInvoiceItems(items) {
  const wrap = document.getElementById("items");
  if (!wrap) return;
  wrap.innerHTML = "";
  (items || []).forEach(it => {
    const div = document.createElement("div");
    div.className = "item-row flex gap-2 items-center mb-2";
    div.innerHTML = `
      <input name="product_code" class="product_code w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.cf_itemid ?? ""}" readonly>
      <input name="description" class="description flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.cf_itemname ?? ""}" readonly>
      <input name="quantity" type="number" step="0.01" class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.quantity ?? 0}" oninput="updateTotal()">
      <input name="unit_price" type="number" step="0.01" class="unit_price w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.unit_price ?? 0}" oninput="updateTotal()">
      <button type="button" class="btn-find text-sm text-blue-600 hover:text-blue-800 px-2">🔍 ค้นหา</button>
      <button type="button" class="btn-remove text-red-600 hover:text-red-800 font-semibold px-2">🗑️</button>
    `;
    wrap.appendChild(div);
  });
  if (typeof updateTotal === "function") updateTotal();
}

/* ===========================
   Customer autocomplete
   =========================== */
let customers = [];
fetch('/api/customers/all')
  .then(res => res.json())
  .then(data => {
    customers = data || [];
    const dl = document.getElementById("customerList");
    if (dl) dl.innerHTML = customers
      .map(c => `<option value="${(c.customer_name || c.fname || '').trim()}">`)
      .join('');
  });

const _customerCache = new Map(); // label => object จาก /suggest

async function searchCustomers(q) {
  const res = await fetch(`/api/customers/suggest?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return await res.json();
}

function bindCustomerAutocomplete() {
  const input = document.getElementById('customer_name');
  const list  = document.getElementById('customerList');
  if (!input || !list) return;

  const deb = (fn, t=250)=>{ let h; return (...a)=>{clearTimeout(h); h=setTimeout(()=>fn(...a),t)} };

  async function suggest() {
    const q = (input.value || '').trim();
    list.innerHTML = '';
    _customerCache.clear();
    if (!q) return;
    const items = await searchCustomers(q);
    items.forEach(c => {
      const label = `${(c.customer_name || '').trim()}${c.personid ? ' ('+c.personid+')' : ''}`;
      const opt = document.createElement('option');
      opt.value = label;
      list.appendChild(opt);
      _customerCache.set(label, c);
    });
  }

  input.addEventListener('input', deb(suggest, 250));
  input.addEventListener('change', () => fillCustomerFromSelected(input.value));
}
document.addEventListener('DOMContentLoaded', bindCustomerAutocomplete);

function selectCustomer() {
  const el = document.getElementById('customer_name');
  if (el) fillCustomerFromSelected(el.value);
}

async function fillCustomerFromSelected(label) {
  let c = _customerCache.get(label);

  // ตัด (PCxxxx) และ trim
  const bareName = (label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

  // fallback หาใน /all
  if (!c) {
    const found = customers.find(x => ((x.customer_name || x.fname || '').trim() === bareName));
    if (found) c = found;
  }

  if (!c) return;

  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.value = v ?? ''; };
  set('personid', c.personid);
  set('customer_name', c.customer_name || bareName);
  set('customer_taxid', c.taxid);
  set('customer_address', c.address);
  set('cf_provincename', c.province);
  set('cf_personzipcode', c.zipcode);
  set('tel', c.tel);
  set('mobile', c.mobile);

  // เติมเครดิตวันถ้ามี
  if (c.fmlpaymentcreditday != null && c.fmlpaymentcreditday !== '') {
    set('fmlpaymentcreditday', c.fmlpaymentcreditday);
    computeAndFillDueDate();
  } else if (c.personid) {
    try {
      const res = await fetch(`/api/customers/detail?personid=${encodeURIComponent(c.personid)}`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.fmlpaymentcreditday != null) {
          set('fmlpaymentcreditday', d.fmlpaymentcreditday);
          computeAndFillDueDate();
        }
      }
    } catch {}
  }
}

/* ===========================
   Items / Products
   - Unified search (master + suggest)
   - iPhone/iPad Safari click-friendly
   =========================== */

let selectedRow = null;

function addItem() {
  const div = document.createElement('div');
  div.className = "flex flex-wrap gap-4 item-row items-end";
  div.innerHTML = `
    <input name="product_code" readonly placeholder="รหัสสินค้า"
      class="product_code flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="description" readonly placeholder="รายละเอียด"
      class="description flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="quantity" type="number" step="0.01" placeholder="จำนวน" oninput="updateTotal()"
      class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="unit_price" type="number" step="0.01" placeholder="ราคาต่อหน่วย" oninput="updateTotal()"
      class="unit_price w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5">
    <button type="button" class="btn-find text-sm text-blue-600 hover:text-blue-800 px-2">🔍 ค้นหา</button>
    <button type="button" class="btn-remove text-red-600 hover:text-red-800 font-semibold px-2">🗑️</button>
  `;
  document.getElementById('items')?.appendChild(div);
  if (typeof updateTotal === "function") updateTotal();
}
window.addItem = addItem;

function removeItem(btn) {
  btn.closest('.item-row')?.remove();
  if (typeof updateTotal === "function") updateTotal();
}
window.removeItem = removeItem;

// ---------- Unified product search (master + suggest) ----------
let _allProductsCache = null; // [{cf_itemid, cf_itemname, cf_itempricelevel_price, ...}]

async function loadAllProductsOnce() {
  if (Array.isArray(_allProductsCache)) return _allProductsCache;
  try {
    const res = await fetch('/api/products/all'); // master list
    if (!res.ok) throw new Error('load all products failed');
    _allProductsCache = await res.json();
  } catch (e) {
    console.error(e);
    _allProductsCache = [];
  }
  return _allProductsCache;
}

async function fetchSuggest(q) {
  const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(q || '')}`);
  if (!res.ok) return [];
  // format: {product_code, description, avg_unit_price, used?}
  return await res.json();
}

function _norm(s) { return (s ?? '').toString().trim().toLowerCase(); }

async function searchProductsUnified(q) {
  const [all, sug] = await Promise.all([loadAllProductsOnce(), fetchSuggest(q)]);
  const kw = _norm(q);

  // from master (filter by id or name)
  const fromMaster = (all || []).filter(p => {
    const code = _norm(p.cf_itemid);
    const name = _norm(p.cf_itemname);
    // แค่ช่องค้นหาว่างก็ให้ขึ้นครบ (เพื่อครอบคลุม cf_itemid แบบ 1-2066 ด้วย)
    return !kw || code.includes(kw) || name.includes(kw);
  }).map(p => ({
    product_code: p.cf_itemid,
    description: p.cf_itemname,
    avg_unit_price: p.cf_itempricelevel_price ?? 0,
    source: 'master'
  }));

  // from suggest (same shape)
  const fromSuggest = (sug || []).map(r => ({
    product_code: r.product_code,
    description: r.description,
    avg_unit_price: r.avg_unit_price ?? 0,
    source: 'suggest',
    used: r.used ?? 0
  }));

  // merge, prefer suggest for duplicates
  const byCode = new Map();
  fromSuggest.forEach(x => { if (x.product_code) byCode.set(x.product_code, x); });
  fromMaster.forEach(x => { if (x.product_code && !byCode.has(x.product_code)) byCode.set(x.product_code, x); });

  const arr = Array.from(byCode.values());
  arr.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'suggest' ? -1 : 1;
    if (a.source === 'suggest' && b.source === 'suggest') return (b.used||0) - (a.used||0);
    return (a.product_code || '').localeCompare(b.product_code || '');
  });

  return arr.slice(0, 200); // แสดงได้มากขึ้น
}

// ---------- Modal open/close + render ----------
function openProductModal(btn) {
  selectedRow = btn.closest('.item-row');
  const search = document.getElementById("productSearch");
  const modal  = document.getElementById("productModal");
  if (search) search.value = "";
  filterProducts(); // initial render
  modal?.classList.remove("hidden");
}
window.openProductModal = openProductModal;

function closeProductModal() {
  document.getElementById("productModal")?.classList.add("hidden");
  selectedRow = null;
}
window.closeProductModal = closeProductModal;

async function filterProducts() {
  const keyword = (document.getElementById("productSearch")?.value || "").trim();
  const listDiv = document.getElementById("productList");
  if (!listDiv) return;
  listDiv.innerHTML = '<div class="p-2 text-gray-500">กำลังค้นหา...</div>';

  const items = await searchProductsUnified(keyword);
  if (!items.length) { listDiv.innerHTML = `<div class="p-2 text-gray-500">ไม่พบสินค้า</div>`; return; }

  listDiv.innerHTML = items.map(p => `
    <div class="p-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between product-option"
         data-code="${p.product_code || ''}" data-name="${p.description || ''}" data-price="${p.avg_unit_price || 0}">
      <div><strong>${p.product_code || ''}</strong> - ${p.description || ''}</div>
      <div class="text-gray-600">฿${(p.avg_unit_price||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    </div>
  `).join('');
}
window.filterProducts = filterProducts;

// iOS Safari sometimes needs touchstart; use delegation for both
document.addEventListener('click', onPickProduct, { passive: true });
document.addEventListener('touchstart', onPickProduct, { passive: true });

function onPickProduct(ev) {
  const opt = ev.target && ev.target.closest ? ev.target.closest('.product-option') : null;
  if (!opt) return;
  ev.preventDefault();
  selectProduct({
    code: opt.dataset.code,
    name: opt.dataset.name,
    price: parseFloat(opt.dataset.price || 0),
  });
}

function selectProduct(p) {
  if (!selectedRow) return;
  const codeEl  = selectedRow.querySelector('.product_code');
  const nameEl  = selectedRow.querySelector('.description');
  const qtyEl   = selectedRow.querySelector('.quantity');
  const priceEl = selectedRow.querySelector('.unit_price');

  if (codeEl)  codeEl.value  = p.code || '';
  if (nameEl)  nameEl.value  = p.name || '';
  if (priceEl) priceEl.value = (p.price || 0);
  if (qtyEl && !parseFloat(qtyEl.value || 0)) qtyEl.value = 1;

  if (typeof updateTotal === "function") updateTotal();
  closeProductModal();
}
window.selectProduct = selectProduct;

/* ===========================
   Duplicate check: invoice number
   =========================== */
function debounce(fn, ms = 400) { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }
const invInput = document.getElementById('invoice_number');
const help = document.getElementById('invNoHelp');
const form = document.getElementById('invoice_form');
let invDup = false;
async function checkDup(num) {
  if (!num) { invDup=false; help?.classList.add('hidden'); invInput?.classList?.remove('border-red-500'); return; }
  const res = await fetch(`/api/invoices/check-number?number=${encodeURIComponent(num)}`);
  const data = await res.json();
  invDup = !!data.exists;
  if (help) {
    if (invDup) { help.classList.remove('hidden'); invInput?.classList?.add('border-red-500'); }
    else { help.classList.add('hidden'); invInput?.classList?.remove('border-red-500'); }
  }
}
if (invInput) invInput.addEventListener('input', debounce(() => checkDup(invInput.value.trim()), 400));
if (form) form.addEventListener('submit', (e)=>{ if (invDup) { e.preventDefault(); invInput?.focus(); } });

/* ===========================
   Due date helper (already in page)
   =========================== */
window.addEventListener("load", computeAndFillDueDate);
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('invoice_date')?.addEventListener('change', computeAndFillDueDate);
  document.getElementById('fmlpaymentcreditday')?.addEventListener('input', computeAndFillDueDate);
});
