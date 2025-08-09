let customers = [];

fetch('/api/customers')
  .then(res => res.json())
  .then(data => {
    customers = data;
    let html = "";
    data.forEach(c => {
      html += `<option value="${c.fname}">`;
    });
    document.getElementById("customerList").innerHTML = html;
  });

function normalize(str) {
  return str.normalize("NFC").trim();
}

function selectCustomer() {
  const name = normalize(document.getElementById("customer_name").value);
  const match = customers.find(c => normalize(c.fname) === name);
  if (match) {
    document.getElementById("customer_address").value = match.address;
    document.getElementById("customer_taxid").value = match.taxid;
  }
}

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

let selectedRow = null;

function openProductModal(btn) {
  selectedRow = btn.closest('.item-row');
  filterProducts(); // load all products initially
  document.getElementById("productModal").classList.remove("hidden");
}

function closeProductModal() {
  document.getElementById("productModal").classList.add("hidden");
  selectedRow = null;
}

function filterProducts() {
  const keyword = document.getElementById("productSearch").value.toLowerCase().trim();
  const listDiv = document.getElementById("productList");
  listDiv.innerHTML = "";

  const filtered = products.filter(p =>
    p.code?.toLowerCase().startsWith(keyword) ||
    p.name?.toLowerCase().startsWith(keyword) ||
    p.name?.includes(keyword) ||
    p.code?.includes(keyword)
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

function updateProductDatalists() {
  const codeList = document.getElementById("productCodes");
  const nameList = document.getElementById("productNames");

  codeList.innerHTML = products.map(p => `<option value="${p.code}">`).join("");
  nameList.innerHTML = products.map(p => `<option value="${p.name}">`).join("");
}

fetch('/api/products')
  .then(res => res.json())
  .then(data => {
    products = data;
    updateProductDatalists();
  });

function fillProduct(input) {
  const row = input.closest('.item-row');
  const codeInput = row.querySelector('.product_code');
  const nameInput = row.querySelector('.description');
  const priceInput = row.querySelector('.unit_price');

  const keyword = input.value.trim();
  const match = products.find(p =>
    p.code === keyword || p.name === keyword
  );

  if (match) {
    codeInput.value = match.code;
    nameInput.value = match.name;
    priceInput.value = match.price;
    updateTotal();
  }
}

function removeItem(btn) {
  btn.parentElement.remove();
  updateTotal();
}

function updateTotal() {
  let total = 0;
  document.querySelectorAll("#items .item-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".quantity")?.value || 0);
    const price = parseFloat(row.querySelector(".unit_price")?.value || 0);
    total += qty * price;
  });
  document.getElementById("total_amount").innerText = `฿ ${total.toFixed(2)}`;
}

function previewInvoice(event) {
  event.preventDefault(); // cancel old submit

  const form = document.getElementById("invoice_form");
  const formData = new FormData(form);

  const invoice = {
    invoice_number: formData.get("invoice_number"),
    invoice_date: formData.get("invoice_date"),
    grn_number: formData.get("grn_number"),   // NEW
    dn_number: formData.get("dn_number"),     // NEW
    customer_name: formData.get("customer_name"),
    customer_taxid: formData.get("customer_taxid"),
    customer_address: formData.get("customer_address"),
    items: [],
  };

  // get produt value
  document.querySelectorAll("#items .item-row").forEach(row => {
    const product_code = row.querySelector('[name="product_code"]').value;
    const description = row.querySelector('[name="description"]').value;
    const quantity = parseFloat(row.querySelector('[name="quantity"]').value || 0);
    const unit_price = parseFloat(row.querySelector('[name="unit_price"]').value || 0);

    if (product_code || description) {
      invoice.items.push({ product_code, description, quantity, unit_price });
    }
  });

  // send to preview
  fetch("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invoice),
  })
    .then(res => res.text())
    .then(html => {
      const previewWin = window.open("", "_blank");
      previewWin.document.open();
      previewWin.document.write(html);
      previewWin.document.close();
    });

  return false;
}

