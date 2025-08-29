//------------- check edit -------------------//
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
    const res = await fetch(`/api/invoices/${editId}/detail`);
    if (!res.ok) { alert("โหลดรายละเอียดบิลไม่สำเร็จ"); return; }
    data = await res.json();
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
  wrap.innerHTML = "";
  (items || []).forEach(it => {
    const div = document.createElement("div");
    div.className = "item-row flex gap-2 items-center mb-2";
    div.innerHTML = `
      <input name="product_code" class="product_code w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.cf_itemid ?? ""}" readonly>
      <input name="description" class="description flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.cf_itemname ?? ""}" readonly>
      <input name="quantity" type="number" step="0.01" class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.quantity ?? 0}" oninput="updateTotal()">
      <input name="unit_price" type="number" step="0.01" class="unit_price w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.unit_price ?? 0}" oninput="updateTotal()">
      <button type="button" onclick="openProductModal(this)" class="text-sm text-blue-600 hover:text-blue-800 px-2">🔍 ค้นหา</button>
      <button type="button" onclick="removeItem(this)" class="text-red-600 hover:text-red-800 font-semibold px-2">🗑️</button>
    `;
    wrap.appendChild(div);
  });
  updateTotal && updateTotal();
}

let customers = [];
fetch('/api/customers/all')
  .then(res => res.json())
  .then(data => {
    customers = data || [];
    const dl = document.getElementById("customerList");
    if (dl) dl.innerHTML = customers.map(c => `<option value="${(c.customer_name || c.fname || '').trim()}">`).join('');
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

  const deb = (fn, t=250)=>{ let h; return (...a)=>{clearTimeout(h); h=setTimeout(()=>fn(...a),t)}};

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
    // ✅ เรียก detail เพื่อดึงเครดิตวันให้ชัวร์
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

// ------- Items / Products -------
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
    <button type="button" onclick="openProductModal(this)"
      class="text-sm text-blue-600 hover:text-blue-800 px-2">🔍 ค้นหา</button>
    <button type="button" onclick="removeItem(this)"
      class="text-red-600 hover:text-red-800 font-semibold px-2">🗑️</button>
  `;
  document.getElementById('items').appendChild(div);
  updateTotal();
}

function removeItem(btn) { btn.parentElement.remove(); updateTotal(); }

function openProductModal(btn) {
  selectedRow = btn.closest('.item-row');
  document.getElementById("productSearch").value = "";
  filterProducts();
  document.getElementById("productModal").classList.remove("hidden");
}
function closeProductModal() {
  document.getElementById("productModal").classList.add("hidden");
  selectedRow = null;
}

async function searchProducts(q) {
  const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(q)}`);
