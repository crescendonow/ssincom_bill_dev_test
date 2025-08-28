//------------- check edit -------------------//
document.addEventListener("DOMContentLoaded", async () => {
  const url = new URL(location.href);
  const editId = url.searchParams.get("edit");

  // toggle ปุ่ม
  const btnUpdate = document.getElementById('btnUpdate');
  const btnSave = document.getElementById('btnSave');
  if (btnUpdate) btnUpdate.classList.toggle('hidden', !editId);
  if (btnSave) btnSave.classList.toggle('hidden', !!editId);

  if (!editId) return;

  // พยายามอ่านจาก sessionStorage ก่อน (เร็วกว่า)
  let data = null;
  try { data = JSON.parse(sessionStorage.getItem("invoice_edit_data") || "null"); } catch { }
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
  setVal("invoice_date", h.invoice_date);           // YYYY-MM-DD
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

// โหลดรายชื่อลูกค้าสำหรับ datalist (ใช้เป็น fallback หา credit day)
fetch('/api/customers/all')
  .then(res => res.json())
  .then(data => {
    customers = data || [];
    const html = customers.map(c => `<option value="${c.fname}">`).join('');
    const dl = document.getElementById("customerList");
    if (dl) dl.innerHTML = html;
  });

function normalize(str) {
  return (str || '').normalize("NFC").trim();
}

const _customerCache = new Map(); // label => object เต็มจาก suggest

// ---- APIs รวบยอด ----
async function searchCustomers(q) {
  const res = await fetch(`/api/customers/suggest?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return await res.json(); // server ควรส่ง {personid, customer_name, taxid, province, address, tel, mobile, fmlpaymentcreditday?}
}

// ---- Autocomplete ลูกค้า ----
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
      const label = `${c.customer_name}${c.personid ? ' ('+c.personid+')' : ''}`;
      const opt = document.createElement('option');
      opt.value = label;
      list.appendChild(opt);
      _customerCache.set(label, c);
    });
  }

  input.addEventListener('input', deb(suggest, 250));
  input.addEventListener('change', () => fillCustomerFromSelected(input.value));
}

// ติดให้ input ทำงานตั้งแต่โหลด
document.addEventListener('DOMContentLoaded', bindCustomerAutocomplete);

// ให้เข้ากับ oninput="selectCustomer()" ใน HTML เดิม
function selectCustomer() {
  const el = document.getElementById('customer_name');
  if (el) fillCustomerFromSelected(el.value);
}

// เติมข้อมูลลูกค้า + เครดิตวัน + คำนวณ due date
function fillCustomerFromSelected(label) {
  let c = _customerCache.get(label);

  // ถ้าใน suggest ไม่มีเครดิต ให้ลองแมตช์จากรายการ all
  if (c && (c.fmlpaymentcreditday == null || c.fmlpaymentcreditday === '')) {
    const byPid = customers.find(x => x.personid && c.personid && x.personid === c.personid);
    const byName = customers.find(x => !byPid && x.fname === c.customer_name);
    const src = byPid || byName;
    if (src) c = { ...c, fmlpaymentcreditday: src.fmlpaymentcreditday ?? c.fmlpaymentcreditday };
  }

  // ถ้า cache ไม่มี แปลว่าเลือกจาก datalist ตรง ๆ → หาใน all ตามชื่อ
  if (!c) {
    const name = (label || '').replace(/\s*\([^)]*\)\s*$/, ''); // ตัด (PCxxxx)
    c = customers.find(x => x.fname === name) || null;
    if (!c) return;
    // ปรับรูปแบบให้ฟิลด์สอดคล้อง
    c = {
      personid: c.personid,
      customer_name: c.fname,
      taxid: c.cf_taxid,
      address: c.cf_personaddress,
      province: c.cf_provincename,
      tel: c.tel,
      mobile: c.mobile,
      fmlpaymentcreditday: c.fmlpaymentcreditday
    };
  }

  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.value = v ?? ''; };
  set('personid', c.personid);
  set('customer_name', c.customer_name);
  set('customer_taxid', c.taxid);
  set('customer_address', c.address);
  set('cf_provincename', c.province);
  set('tel', c.tel);
  set('mobile', c.mobile);

  // ✅ เติมเครดิตวัน (ถ้ามี)
  if (c.fmlpaymentcreditday != null && c.fmlpaymentcreditday !== '') {
    set('fmlpaymentcreditday', c.fmlpaymentcreditday);
  }
  computeAndFillDueDate();
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

function removeItem(btn) {
  btn.parentElement.remove();
  updateTotal();
}

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

// ---- API ค้นหาสินค้า ----
async function searchProducts(q) {
  const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return await res.json(); // [{product_code, description, avg_unit_price, used}]
}

// ---- แสดงผลรายการให้เลือก (เวอร์ชันเดียว) ----
async function filterProducts() {
  const keyword = (document.getElementById("productSearch").value || "").trim();
  const listDiv = document.getElementById("productList");
  listDiv.innerHTML = '<div class="p-2 text-gray-500">กำลังค้นหา...</div>';

  const items = await searchProducts(keyword);
  if (!items.length) {
    listDiv.innerHTML = `<div class="p-2 text-gray-500">ไม่พบสินค้า</div>`;
    return;
  }

  listDiv.innerHTML = '';
  items.forEach(p => {
    const div = document.createElement("div");
    div.className = "p-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between";
    div.innerHTML = `
      <div><strong>${p.product_code}</strong> - ${p.description}</div>
      <div class="text-gray-600">฿${(p.avg_unit_price||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    `;
    div.onclick = () => selectProduct({
      code: p.product_code,
      name: p.description,
      price: p.avg_unit_price || 0
    });
    listDiv.appendChild(div);
  });
}

// ✅ ฟังก์ชันเลือกสินค้า — เติมค่าเข้าแถวที่กำลังแก้
function selectProduct(p) {
  if (!selectedRow) return;
  const codeEl = selectedRow.querySelector('.product_code');
  const nameEl = selectedRow.querySelector('.description');
  const qtyEl  = selectedRow.querySelector('.quantity');
  const priceEl= selectedRow.querySelector('.unit_price');

  if (codeEl) codeEl.value = p.code || '';
  if (nameEl) nameEl.value = p.name || '';
  if (priceEl) priceEl.value = (p.price || 0);
  if (qtyEl && !parseFloat(qtyEl.value || 0)) qtyEl.value = 1;

  updateTotal();
  closeProductModal();
}

// ------- Duplicate check: invoice number -------
function debounce(fn, ms = 400) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const invInput = document.getElementById('invoice_number');
const help = document.getElementById('invNoHelp');
const form = document.getElementById('invoice_form');
let invDup = false;

async function checkDup(num) {
  if (!num) {
    invDup = false;
    if (help) help.classList.add('hidden');
    invInput?.classList?.remove('border-red-500');
    return;
  }
  const res = await fetch(`/api/invoices/check-number?number=${encodeURIComponent(num)}`);
  const data = await res.json();
  invDup = !!data.exists;
  if (help) {
    if (invDup) {
      help.classList.remove('hidden');
      invInput?.classList?.add('border-red-500');
    } else {
      help.classList.add('hidden');
      invInput?.classList?.remove('border-red-500');
    }
  }
}

if (invInput) invInput.addEventListener('input', debounce(() => checkDup(invInput.value.trim()), 400));

if (form) {
  form.addEventListener('submit', (e) => {
    if (invDup) { e.preventDefault(); invInput?.focus(); }
  });
}

// เรียกเมื่อแก้จำนวน/ราคาแต่ละแถว
function updateTotal() {
  let sum = 0;
  document.querySelectorAll('#items .item-row').forEach(row => {
    const q = parseFloat(row.querySelector('.quantity').value || 0);
    const p = parseFloat(row.querySelector('.unit_price').value || 0);
    sum += q * p;
  });
  const totalEl = document.getElementById('total_amount');
  totalEl.textContent = '฿ ' + sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  totalEl.dataset.value = String(sum);
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#items .item-row').forEach(row => {
    items.push({
      product_code: row.querySelector('.product_code').value || '',
      description: row.querySelector('.description').value || '',
      quantity: parseFloat(row.querySelector('.quantity').value || 0),
      unit_price: parseFloat(row.querySelector('.unit_price').value || 0),
    });
  });
  return items;
}

function collectFormData() {
  const v = id => document.getElementById(id)?.value ?? '';
  const totalRaw = parseFloat(document.getElementById('total_amount')?.dataset.value || 0);

  return {
    invoice_number: v('invoice_number'),
    invoice_date: v('invoice_date'),
    grn_number: v('grn_number'),
    dn_number: v('dn_number'),
    po_number: v('po_number'),

    customer_name: v('customer_name'),
    customer_taxid: v('customer_taxid'),
    customer_address: v('customer_address'),
    personid: v('personid'),
    tel: v('tel'),
    mobile: v('mobile'),
    cf_personzipcode: v('cf_personzipcode'),
    cf_provincename: v('cf_provincename'),
    fmlpaymentcreditday: v('fmlpaymentcreditday'),
    due_date: v('due_date'),
    car_numberplate: v('car_numberplate'),

    total_amount: totalRaw,
    items: collectItems(),
  };
}

function previewInvoice(evt) {
  if (evt) evt.preventDefault();
  computeAndFillDueDate();

  const formEl = document.getElementById("invoice_form");
  const fd = new FormData(formEl);

  let dateStr = fd.get("invoice_date");
  if (dateStr) dateStr = formatDateToISO(dateStr);

  const invoice = {
    invoice_number: fd.get("invoice_number"),
    invoice_date: dateStr,
    personid: fd.get("personid"),
    grn_number: fd.get("grn_number"),
    dn_number: fd.get("dn_number"),
    po_number: fd.get("po_number"),
    tel: fd.get("tel"),
    mobile: fd.get("mobile"),
    customer_name: fd.get("customer_name"),
    customer_taxid: fd.get("customer_taxid"),
    customer_address: fd.get("customer_address"),
    fmlpaymentcreditday: fd.get("fmlpaymentcreditday"),
    due_date: document.getElementById("due_date")?.value || fd.get("due_date"),
    car_numberplate: fd.get("car_numberplate"),
    variant: document.getElementById("variant")?.value || "invoice_original",
    items: []
  };

  document.querySelectorAll("#items .item-row").forEach(row => {
    const product_code = row.querySelector('[name="product_code"]').value;
    const description = row.querySelector('[name="description"]').value;
    const quantity = parseFloat(row.querySelector('[name="quantity"]').value || 0);
    const unit_price = parseFloat(row.querySelector('[name="unit_price"]').value || 0);
    if (product_code || description) {
      invoice.items.push({ product_code, description, quantity, unit_price });
    }
  });

  const popup = window.open('about:blank', '_blank');
  fetch("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invoice)
  })
    .then(r => r.text())
    .then(html => {
      if (!popup) return;
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
    })
    .catch(err => {
      console.error(err);
      if (popup) popup.close();
      alert("พรีวิวไม่สำเร็จ");
    });
}

async function saveInvoice() {
  const formEl = document.getElementById("invoice_form");
  const fd = new FormData(formEl);

  const _d = fd.get("invoice_date");
  if (_d) fd.set("invoice_date", formatDateToISO(_d));

  const pay = fd.get("fm_payment") || "cash";
  fd.set("fm_payment", pay);

  if (!fd.get("due_date")) {
    computeAndFillDueDate();
    fd.set("due_date", document.getElementById("due_date")?.value || "");
  }

  const res = await fetch("/submit", { method: "POST", body: fd });
  if (!res.ok) {
    const t = await res.text();
    alert("บันทึกล้มเหลว: " + t);
    return;
  }
  const data = await res.json();
  alert("บันทึกสำเร็จ เลขที่: " + data.invoice_number);
}

//-----------------------edit invoice function --------------------//
function buildUpdatePayload() {
  const v = id => document.getElementById(id)?.value ?? '';

  computeAndFillDueDate();

  const payload = {
    invoice_number: v('invoice_number'),
    fname: v('customer_name'),
    personid: v('personid'),
    tel: v('tel'),
    mobile: v('mobile'),
    cf_personaddress: v('customer_address'),
    cf_personzipcode: v('cf_personzipcode'),
    cf_provincename: v('cf_provincename'),
    cf_taxid: v('customer_taxid'),
    po_number: v('po_number'),
    grn_number: v('grn_number'),
    dn_number: v('dn_number'),
    fmlpaymentcreditday: (v('fmlpaymentcreditday') ? parseInt(v('fmlpaymentcreditday'), 10) : null),
    car_numberplate: v('car_numberplate'),
    items: []
  };
  const idISO = normalizeDateInputValue('invoice_date');
  const ddISO = normalizeDateInputValue('due_date');

  if (idISO) payload.invoice_date = idISO;
  if (ddISO) payload.due_date = ddISO;

  document.querySelectorAll('#items .item-row').forEach(row => {
    const product_code = row.querySelector('.product_code')?.value || '';
    const description = row.querySelector('.description')?.value || '';
    const quantity = parseFloat(row.querySelector('.quantity')?.value || 0);
    const unit_price = parseFloat(row.querySelector('.unit_price')?.value || 0);

    if (product_code || description) {
      payload.items.push({ cf_itemid: product_code, cf_itemname: description, quantity, unit_price });
    }
  });

  return payload;
}

async function updateInvoice() {
  const editId = new URL(location.href).searchParams.get("edit");
  if (!editId) { alert('ไม่พบรหัสสำหรับแก้ไข'); return; }

  const payload = buildUpdatePayload();

  try {
    const res = await fetch(`/api/invoices/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'อัปเดตไม่สำเร็จ');
    }
    sessionStorage.removeItem('invoice_edit_data');
    alert('อัปเดตเรียบร้อย');
  } catch (e) {
    console.error(e);
    alert('ผิดพลาด: ' + e.message);
  }
}

// ====== Utilities: วันที่ / Due date ======
function formatDateToISO(dateStr) {
  if (!dateStr) return "";
  const TH_MONTHS = {
    "มกราคม":0,"กุมภาพันธ์":1,"มีนาคม":2,"เมษายน":3,"พฤษภาคม":4,"มิถุนายน":5,
    "กรกฎาคม":6,"สิงหาคม":7,"กันยายน":8,"ตุลาคม":9,"พฤศจิกายน":10,"ธันวาคม":11
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const p = dateStr.trim().split(/\s+/);
  if (p.length === 3 && TH_MONTHS[p[1]] !== undefined) {
    const d = parseInt(p[0], 10);
    const m = TH_MONTHS[p[1]];
    let y = parseInt(p[2], 10);
    if (y > 2400) y -= 543;
    const js = new Date(Date.UTC(y, m, d));
    if (!isNaN(js)) return js.toISOString().slice(0, 10);
    return "";
  }

  const m1 = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const [, a, b, c] = m1;
    const try1 = new Date(`${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(try1)) return try1.toISOString().slice(0, 10);
    const try2 = new Date(`${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(try2)) return try2.toISOString().slice(0, 10);
  }
  return "";
}

function normalizeDateInputValue(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return "";
  const iso = formatDateToISO((el.value || "").trim());
  if (iso) el.value = iso;
  return iso;
}

function computeAndFillDueDate() {
  const invISO = normalizeDateInputValue('invoice_date');
  const credit = parseInt(document.getElementById('fmlpaymentcreditday')?.value || '0', 10) || 0;
  if (!invISO) return;
  const base = new Date(invISO + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + credit);
  const dueISO = base.toISOString().slice(0, 10);
  const dueEl = document.getElementById('due_date');
  if (dueEl) dueEl.value = dueISO;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('invoice_date')?.addEventListener('change', computeAndFillDueDate);
  document.getElementById('fmlpaymentcreditday')?.addEventListener('input', computeAndFillDueDate);
});
window.addEventListener("load", computeAndFillDueDate);

// ===== Autocomplete: ทะเบียนรถ =====
async function searchCarPlates(q) {
  const res = await fetch(`/api/suggest/number_plate?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return await res.json();
}
(function setupCarPlateAutocomplete() {
  const input = document.getElementById('car_numberplate');
  const list  = document.getElementById('car_plate_datalist');
  const msg   = document.getElementById('car_plate_msg');
  if (!input || !list) return;
  const deb = (fn, t=200)=>{ let h; return (...a)=>{clearTimeout(h); h=setTimeout(()=>fn(...a),t)}};
  async function suggest() {
    const q = (input.value || '').trim();
    list.innerHTML = ''; if (msg) msg.textContent = '';
    if (!q) return;
    const items = await searchCarPlates(q);
    items.forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.number_plate;
      list.appendChild(opt);
    });
    if (msg) msg.textContent = `พบ ${items.length} รายการ`;
  }
  input.addEventListener('input', deb(suggest, 200));
  input.addEventListener('focus', () => input.value && suggest());
})();

// ===== Align TAX ID with company email on invoice header (safe on all pages) =====
(function alignTaxIdWithEmail() {
  function run() {
    const emailEl = document.getElementById('company-email');
    const rightCol = document.getElementById('header-right');
    const taxIdEl = document.getElementById('tax-id');
    if (!emailEl || !rightCol || !taxIdEl) return;
    const taxLabel = document.getElementById('tax-label');
    if (taxLabel && parseFloat(getComputedStyle(taxLabel).marginTop || 0) < 8) {
      taxLabel.style.marginTop = '12px';
    }
    const rightTop = rightCol.getBoundingClientRect().top + window.scrollY;
    const emailTop = emailEl.getBoundingClientRect().top + window.scrollY;
    const taxTop = taxIdEl.getBoundingClientRect().top + window.scrollY;
    const delta = (emailTop - rightTop) - (taxTop - rightTop);
    const currentMt = parseFloat(getComputedStyle(taxIdEl).marginTop || 0);
    taxIdEl.style.marginTop = (currentMt + delta) + 'px';
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 0);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 0));
  }
  window.addEventListener('load', run);
  window.addEventListener('resize', run);
})();

// expose for inline handlers in HTML
window.addItem = addItem;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.removeItem = removeItem;
window.updateTotal = updateTotal;
window.selectCustomer = selectCustomer;
window.previewInvoice = previewInvoice;
window.saveInvoice = saveInvoice;
window.filterProducts = filterProducts;
