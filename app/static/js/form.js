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
    <input name="product_code" placeholder="Product Code"
      class="flex-1 min-w-[120px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="description" placeholder="Description"
      class="flex-1 min-w-[120px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5">
    <input name="quantity" type="number" step="0.01" placeholder="Qty" oninput="updateTotal()"
      class="w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5 quantity">
    <input name="unit_price" type="number" step="0.01" placeholder="Unit Price" oninput="updateTotal()"
      class="w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5 unit_price">
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

