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
  }
}

function addItem() {
  const div = document.createElement('div');
  div.className = "item-row";
  div.innerHTML = `<input name="product_code" placeholder="Product Code">
                   <input name="description" placeholder="Description">
                   <input name="quantity" type="number" step="0.01" placeholder="Qty">
                   <input name="unit_price" type="number" step="0.01" placeholder="Unit Price">`;
  document.getElementById('items').appendChild(div);
}
