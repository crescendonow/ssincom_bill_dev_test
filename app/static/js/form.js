//------------- check edit -------------------//
document.addEventListener("DOMContentLoaded", async () => {
  const url = new URL(location.href);
  const editId = url.searchParams.get("edit");

  // toggle ปุ่ม
  const btnUpdate = document.getElementById('btnUpdate');
  const btnSave   = document.getElementById('btnSave');
  if (btnUpdate) btnUpdate.classList.toggle('hidden', !editId);
  if (btnSave)   btnSave.classList.toggle('hidden', !!editId);

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
}

function fillInvoiceItems(items) {
  const wrap = document.getElementById("items");
  wrap.innerHTML = "";
  (items || []).forEach(it => {
    const div = document.createElement("div");
    div.className = "item-row flex gap-2 items-center mb-2";
    div.innerHTML = `
      <input name="product_code" class="product_code w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.cf_itemid ?? ""}">
      <input name="description" class="description flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.cf_itemname ?? ""}">
      <input name="quantity" type="number" step="0.01" class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.quantity ?? 0}">
      <input name="unit_price" type="number" step="0.01" class="unit_price w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" value="${it.unit_price ?? 0}">
      <button type="button" onclick="openProductModal(this)" class="text-sm text-blue-600 hover:text-blue-800 px-2">🔍 ค้นหา</button>
      <button type="button" onclick="removeItem(this)" class="text-red-600 hover:text-red-800 font-semibold px-2">🗑️</button>
    `;
    wrap.appendChild(div);
  });
  updateTotal && updateTotal();
}

let customers = [];

// Load customers (for autofill)
fetch('/api/customers/all')
  .then(res => res.json())
  .then(data => {
    customers = data;
    const html = data.map(c => `<option value="${c.fname}">`).join('');
    document.getElementById("customerList").innerHTML = html;
  });

function normalize(str) {
  return (str || '').normalize("NFC").trim();
}

function selectCustomer() {
  const name = normalize(document.getElementById("customer_name").value);
  const match = customers.find(c => normalize(c.fname) === name);
  if (!match) return;

  // Basic fields
  document.getElementById("customer_address").value = match.cf_personaddress || '';
  document.getElementById("customer_taxid").value = match.cf_taxid || '';

  // Extra customer details (if your form.html has these inputs)
  const fill = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  fill("personid", match.personid);
  fill("tel", match.cf_personaddress_tel || match.tel);
  fill("mobile", match.cf_personaddress_mobile || match.mobile);
  fill("cf_personzipcode", match.cf_personzipcode);
  fill("cf_provincename", match.cf_provincename);
  fill("fmlpaymentcreditday", match.fmlpaymentcreditday);
}

// ------- Items / Products -------
let selectedRow = null;
let products = [];

function addItem() {
  const div = document.createElement('div');
  div.className = "flex flex-wrap gap-4 item-row items-end";
  div.innerHTML = `
    <input name="product_code" readonly placeholder="Product Code"
      class="product_code flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="description" readonly placeholder="Description"
      class="description flex-1 min-w-[120px] bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="quantity" type="number" step="0.01" placeholder="Qty" oninput="updateTotal()"
      class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="unit_price" type="number" step="0.01" placeholder="Unit Price"
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
  filterProducts();
  document.getElementById("productModal").classList.remove("hidden");
}

function closeProductModal() {
  document.getElementById("productModal").classList.add("hidden");
  selectedRow = null;
}

function filterProducts() {
  const keyword = (document.getElementById("productSearch").value || "").toLowerCase().trim();
  const listDiv = document.getElementById("productList");
  listDiv.innerHTML = "";

  const filtered = products.filter(p =>
    p.code?.toLowerCase().startsWith(keyword) ||
    p.name?.toLowerCase().startsWith(keyword) ||
    p.name?.toLowerCase().includes(keyword) ||
    p.code?.toLowerCase().includes(keyword)
  );

  if (filtered.length === 0) {
    listDiv.innerHTML = `<div class="p-2 text-gray-500">ไม่พบสินค้า</div>`;
    return;
  }

  filtered.forEach(p => {
    const div = document.createElement("div");
    div.className = "p-2 hover:bg-blue-50 cursor-pointer";
    div.innerHTML = `<strong>${p.code}</strong> - ${p.name} <span class="float-right text-gray-600">฿${p.price}</span>`;
    div.onclick = () => selectProduct(p);
    listDiv.appendChild(div);
  });
}

function selectProduct(p) {
  if (!selectedRow) return;
  selectedRow.querySelector('.product_code').value = p.code;
  selectedRow.querySelector('.description').value = p.name;
  selectedRow.querySelector('.unit_price').value = p.price;
  updateTotal();
  closeProductModal();
}

// preload products
fetch('/api/products')
  .then(res => res.json())
  .then(data => { products = data; });

// ------- Duplicate check: invoice number -------
function debounce(fn, ms = 400) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const invInput = document.getElementById('invoice_number');
const help = document.getElementById('invNoHelp'); // <p id="invNoHelp" ...> in form.html
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

if (invInput) {
  invInput.addEventListener('input', debounce(() => checkDup(invInput.value.trim()), 400));
}

if (form) {
  form.addEventListener('submit', (e) => {
    if (invDup) {
      e.preventDefault();
      invInput?.focus();
    }
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
  totalEl.dataset.value = String(sum);  // <-- เก็บค่าเลขดิบไว้ที่นี่
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
    // หัวเอกสาร
    invoice_number: v('invoice_number'),
    invoice_date: v('invoice_date'),
    grn_number: v('grn_number'),
    dn_number: v('dn_number'),
    po_number: v('po_number'),

    // ลูกค้า
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

    // ยอดรวมจากฟอร์ม (optional, ที่ template ก็คำนวณได้เองอยู่แล้ว)
    total_amount: totalRaw,

    // สินค้า
    items: collectItems(),

    // เผื่ออนาคต
    // discount: 0,
    // vat_rate: 7
  };
}

function previewInvoice(evt) {
  if (evt) evt.preventDefault();

  // คำนวณ due_date ให้เรียบร้อยก่อน
  computeAndFillDueDate();

  const formEl = document.getElementById("invoice_form");
  const fd = new FormData(formEl);

  // แปลงวันที่ → YYYY-MM-DD
  let dateStr = fd.get("invoice_date");
  if (dateStr) {
    dateStr = formatDateToISO(dateStr);
  }

  // รวบรวมหัวเอกสาร
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
    // ✅ ใส่ชนิดเอกสาร
    variant: document.getElementById("variant")?.value || "invoice_original",
    items: []
  };

  // รายการสินค้า
  document.querySelectorAll("#items .item-row").forEach(row => {
    const product_code = row.querySelector('[name="product_code"]').value;
    const description = row.querySelector('[name="description"]').value;
    const quantity = parseFloat(row.querySelector('[name="quantity"]').value || 0);
    const unit_price = parseFloat(row.querySelector('[name="unit_price"]').value || 0);
    if (product_code || description) {
      invoice.items.push({ product_code, description, quantity, unit_price });
    }
  });

  // เปิดหน้าต่างไว้ก่อน กัน popup blocker
  const popup = window.open('about:blank', '_blank');

  // ส่งไปเรนเดอร์ invoice.html (ใช้ endpoint /preview ที่มีอยู่แล้ว)
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

// ------- Preview & Save (with GRN/DN included in preview) -------
async function saveInvoice() {
  const formEl = document.getElementById("invoice_form");
  const fd = new FormData(formEl);

  // แปลงวันที่จาก datepicker → YYYY-MM-DD
  const _d = fd.get("invoice_date");
  if (_d) fd.set("invoice_date", formatDateToISO(_d));

  // แน่ใจว่าแนบวิธีชำระและกำหนดชำระ
  const pay = fd.get("fm_payment") || "cash";
  fd.set("fm_payment", pay);

  // ถ้ายังไม่มี due_date ให้คำนวณและอัปเดตลงฟอร์ม/FD
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
  // รวบรวมค่าจากฟอร์ม (ใช้ตัวช่วยเดิมก็ได้)
  const v = id => document.getElementById(id)?.value ?? '';

  // ให้แน่ใจว่า due_date ถูกคำนวณแล้ว
  computeAndFillDueDate();

  // map -> schema ของ InvoiceUpdate ใน backend
  const payload = {
    invoice_number: v('invoice_number'),
    invoice_date: formatDateToISO(v('invoice_date')) || v('invoice_date') || null,

    // ชื่อฟิลด์ฝั่ง DB คือ fname (ชื่อลูกค้า)
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
    due_date: v('due_date') || null,
    car_numberplate: v('car_numberplate'),

    // สินค้า: map เป็น {cf_itemid, cf_itemname, quantity, unit_price}
    items: []
  };

  document.querySelectorAll('#items .item-row').forEach(row => {
    const product_code = row.querySelector('.product_code')?.value || '';
    const description  = row.querySelector('.description')?.value || '';
    const quantity     = parseFloat(row.querySelector('.quantity')?.value || 0);
    const unit_price   = parseFloat(row.querySelector('.unit_price')?.value || 0);

    // เพิ่มเฉพาะแถวที่มีข้อมูล
    if (product_code || description) {
      payload.items.push({
        cf_itemid:   product_code,
        cf_itemname: description,
        quantity,
        unit_price
      });
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
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'อัปเดตไม่สำเร็จ');
    }
    // เคลียร์ cache ที่อาจเก็บจากหน้า summary
    sessionStorage.removeItem('invoice_edit_data');
    alert('อัปเดตเรียบร้อย');
  } catch (e) {
    console.error(e);
    alert('ผิดพลาด: ' + e.message);
  }
}

// export ให้เรียกจากปุ่ม
window.updateInvoice = updateInvoice;

(function () {
  // mm -> px (อิง 96dpi)
  const mmToPx = mm => (mm / 25.4) * 96;

  function fitToA4Once() {
    const doc = document.querySelector('.doc');
    if (!doc) return;

    // ต้องสอดคล้องกับ @page margin: 10mm (บน+ล่าง รวม 20mm)
    const printableHeightPx = mmToPx(297 - 20); // 297mm คือความสูง A4

    // วัดความสูงเนื้อหา
    const actual = doc.getBoundingClientRect().height;

    // ถ้าสูงเกินพื้นที่พิมพ์ ให้ scale ลง (ไม่เกิน 1)
    const scale = Math.min(1, printableHeightPx / actual);
    if (scale < 1) {
      doc.style.transform = `scale(${scale})`;
      // พอสเกลลง ความกว้างก็เล็กลง → อาจเหลือด้านขวา ให้ชดเชยด้วย margin-bottom
      // เพื่อกันไม่ให้โดนตัดท้ายหน้า
      const scaledHeight = actual * scale;
      const spare = printableHeightPx - scaledHeight;
      doc.style.marginBottom = spare > 0 ? `${spare}px` : '0';
    } else {
      doc.style.transform = '';
      doc.style.marginBottom = '';
    }
  }

  // ปรับสเกลเฉพาะก่อนพิมพ์และคืนค่าหลังพิมพ์
  window.addEventListener('beforeprint', fitToA4Once);
  window.addEventListener('afterprint', () => {
    const doc = document.querySelector('.doc');
    if (doc) {
      doc.style.transform = '';
      doc.style.marginBottom = '';
    }
  });

  // เผื่อปุ่มพิมพ์ในหน้าเรียก window.print() ทันทีหลังเรนเดอร์
  // ให้หน่วงเล็กน้อยเพื่อให้ layout คำนวณเสร็จก่อน
  setTimeout(() => {
    // ถ้าต้องการลองสเกลบนจอก่อนพิมพ์ ให้ uncomment บรรทัดนี้
    // fitToA4Once();
  }, 50);
})();

function formatDateToISO(dateStr) {
  if (!dateStr) return "";
  const months = {
    "มกราคม": 0, "กุมภาพันธ์": 1, "มีนาคม": 2,
    "เมษายน": 3, "พฤษภาคม": 4, "มิถุนายน": 5,
    "กรกฎาคม": 6, "สิงหาคม": 7, "กันยายน": 8,
    "ตุลาคม": 9, "พฤศจิกายน": 10, "ธันวาคม": 11
  };
  try {
    // case: dd Month yyyy (ไทย)
    const parts = dateStr.trim().split(" ");
    if (parts.length === 3 && months.hasOwnProperty(parts[1])) {
      const d = parseInt(parts[0], 10);
      const m = months[parts[1]];
      let y = parseInt(parts[2], 10);
      if (y > 2400) y -= 543;  // แปลง พ.ศ. → ค.ศ.
      return new Date(y, m, d).toISOString().slice(0, 10);
    }
    // case: dd/mm/yyyy หรือ yyyy-mm-dd
    const jsDate = new Date(dateStr);
    if (!isNaN(jsDate)) return jsDate.toISOString().slice(0, 10);
  } catch (e) {
    console.warn("Date parse failed:", dateStr);
  }
  return dateStr;
}

function parseInvoiceDateToDate(dateStr) {
  if (!dateStr) return null;
  const months = {
    "มกราคม": 0, "กุมภาพันธ์": 1, "มีนาคม": 2,
    "เมษายน": 3, "พฤษภาคม": 4, "มิถุนายน": 5,
    "กรกฎาคม": 6, "สิงหาคม": 7, "กันยายน": 8,
    "ตุลาคม": 9, "พฤศจิกายน": 10, "ธันวาคม": 11
  };
  const parts = String(dateStr).trim().split(" ");
  if (parts.length === 3 && months.hasOwnProperty(parts[1])) {
    const d = parseInt(parts[0], 10);
    const m = months[parts[1]];
    let y = parseInt(parts[2], 10);
    if (y > 2400) y -= 543; // พ.ศ. -> ค.ศ.
    return new Date(y, m, d);
  }
  const jsDate = new Date(dateStr);
  return isNaN(jsDate) ? null : jsDate;
}

function computeAndFillDueDate() {
  const dateInput = document.getElementById("invoice_date")?.value || "";
  const pay = document.getElementById("fm_payment")?.value || "cash";
  const creditDays = parseInt(document.getElementById("fmlpaymentcreditday")?.value || "0", 10) || 0;
  const out = document.getElementById("due_date");
  if (!out) return;

  const base = parseInvoiceDateToDate(dateInput);
  if (!base) { out.value = ""; return; }

  let due = new Date(base);
  if (pay === "credit" && creditDays > 0) {
    due.setDate(due.getDate() + creditDays);
  }
  // แสดงเป็น YYYY-MM-DD (ส่งให้ backend ก็เข้าใจง่าย)
  out.value = due.toISOString().slice(0, 10);
}

// ผูก event
["invoice_date", "fm_payment", "fmlpaymentcreditday"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", computeAndFillDueDate);
  if (el) el.addEventListener("input", computeAndFillDueDate);
});

// คำนวณครั้งแรกตอนโหลดหน้า (เผื่อมีค่า default)
window.addEventListener("load", computeAndFillDueDate);

// ===== Autocomplete: ทะเบียนรถจาก products.ss_car =====
(function setupCarPlateAutocomplete() {
  const plateInput = document.getElementById('car_numberplate');
  const plateMsg = document.getElementById('car_plate_msg');
  const datalist = document.getElementById('car_plate_datalist');

  if (!plateInput || !datalist) return;

  const debounce = (fn, delay = 250) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  };

  const suggest = async () => {
    const q = (plateInput.value || '').trim();

    datalist.innerHTML = '';
    if (plateMsg) plateMsg.textContent = '';

    if (q.length < 1) return;

    try {
      const url = new URL('/api/suggest/number_plate', window.location.origin);
      url.searchParams.set('q', q);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('โหลดคำแนะนำไม่สำเร็จ');
      const data = await res.json(); // [{number_plate:'1กก 1234'}, ...]
      data.forEach(row => {
        const opt = document.createElement('option');
        opt.value = row.number_plate;
        datalist.appendChild(opt);
      });
      if (plateMsg) plateMsg.textContent = `พบ ${data.length} รายการ`;
    } catch (e) {
      console.error(e);
      if (plateMsg) plateMsg.textContent = 'โหลดคำแนะนำล้มเหลว';
    }
  };

  const debouncedSuggest = debounce(suggest, 250);
  plateInput.addEventListener('input', debouncedSuggest);
  plateInput.addEventListener('focus', () => plateInput.value && suggest());
})();

// ===== Align TAX ID with company email on invoice header =====
(function alignTaxIdWithEmail() {
  function run() {
    const emailEl = document.getElementById('company-email');
    const rightCol = document.getElementById('header-right');
    const taxIdEl = document.getElementById('tax-id');

    // ทำงานเฉพาะหน้า invoice.html ที่มี element เหล่านี้
    if (!emailEl || !rightCol || !taxIdEl) return;

    // เว้นระยะ label จาก "TAX INVOICE/..." (ถ้ายังไม่ได้ตั้งไว้ใน HTML)
    const taxLabel = document.getElementById('tax-label');
    if (taxLabel && parseFloat(getComputedStyle(taxLabel).marginTop || 0) < 8) {
      taxLabel.style.marginTop = '12px';
    }

    // จัดให้ตัวเลขภาษีอยู่ระดับเดียวกับบรรทัดอีเมล (ซ้าย)
    const rightTop = rightCol.getBoundingClientRect().top + window.scrollY;
    const emailTop = emailEl.getBoundingClientRect().top + window.scrollY;
    const taxTop = taxIdEl.getBoundingClientRect().top + window.scrollY;

    const delta = (emailTop - rightTop) - (taxTop - rightTop);
    const currentMt = parseFloat(getComputedStyle(taxIdEl).marginTop || 0);
    taxIdEl.style.marginTop = (currentMt + delta) + 'px';
  }

  // รันหลัง DOM พร้อม และอีกรอบหลังโหลดฟอนต์/รูปครบ
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
window.location.href = '/summary_invoices.html';


