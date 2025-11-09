// /static/js/credit_note.js
document.addEventListener('DOMContentLoaded', () => {
    const cnDateEl = document.getElementById('cn_date');
    const cnNoEl = document.getElementById('creditnote_number');
    const btnGenNo = document.getElementById('btnGenNo');
    const btnSave = document.getElementById('btnSave');
    const btnPDF = document.getElementById('btnPDF');
    const btnPreview = document.getElementById('btnPreview');

    const todayISO = new Date().toISOString().slice(0, 10);
    if (cnDateEl && !cnDateEl.value) cnDateEl.value = todayISO;

    btnGenNo?.addEventListener('click', async () => {
        const d = cnDateEl.value || todayISO;
        const res = await fetch(`/api/credit-notes/generate-number?date=${encodeURIComponent(d)}`);
        const data = await res.json();
        if (data && data.number) cnNoEl.value = data.number;
    });

    btnSave?.addEventListener('click', async () => {
        const payload = buildPayload();
        if (!payload.creditnote_number) { alert('กรุณาสร้างเลขที่ใบลดหนี้ก่อนบันทึก'); return; }
        if (!payload.items.length) { alert('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ'); return; }
        const res = await fetch('/api/credit-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.detail || 'บันทึกไม่สำเร็จ'); return; }
        alert(`บันทึกสำเร็จ เลขที่เอกสาร: ${data.creditnote_number}`);
    });

    btnPreview?.addEventListener('click', async () => {
        const payload = buildPayload();
        const res = await fetch('/api/credit-notes/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const html = await res.text();
        const view = document.getElementById('preview');
        view.classList.remove('hidden');
        view.innerHTML = html;
        window.scrollTo({ top: view.offsetTop - 10, behavior: 'smooth' });
    });

    btnPDF?.addEventListener('click', async () => {
        const payload = buildPayload();
        const res = await fetch('/export-creditnote-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) { const t = await res.text(); alert(t || 'สร้าง PDF ไม่สำเร็จ'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `credit_note_${payload.creditnote_number || 'document'}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    });
});

function addItem() {
    const wrap = document.getElementById('items');
    const div = document.createElement('div');
    div.className = "flex flex-wrap gap-3 md:gap-4 item-row items-end";
    div.innerHTML = `
    <input name="grn_number" placeholder="GRN No"
      class="grn_number flex-1 min-w-[120px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
    <input name="invoice_number" placeholder="เลขที่ใบกำกับ"
      class="invoice_number flex-1 min-w-[140px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
    <input name="product_code" placeholder="รหัสสินค้า"
      class="product_code w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
    <input name="description" placeholder="รายละเอียด"
      class="description flex-1 min-w-[140px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
    <input name="quantity" type="number" step="0.01" placeholder="จำนวน" oninput="updateTotal()"
      class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
    <input name="unit_price" type="number" step="0.01" placeholder="ราคาต่อหน่วย" oninput="updateTotal()"
      class="unit_price w-28 md:w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
    <button type="button" onclick="removeItem(this)" class="text-red-600 hover:text-red-800 font-semibold px-2">🗑️</button>
  `;
    wrap.appendChild(div);
}
window.addItem = addItem;

function removeItem(btn) { btn.closest('.item-row')?.remove(); updateTotal(); }
window.removeItem = removeItem;

function updateTotal() {
    let sum = 0;
    document.querySelectorAll('#items .item-row').forEach(row => {
        const q = parseFloat(row.querySelector('.quantity')?.value || 0);
        const p = parseFloat(row.querySelector('.unit_price')?.value || 0);
        sum += q * p;
    });
    const el = document.getElementById('total_amount');
    if (el) el.textContent = '฿ ' + sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
window.updateTotal = updateTotal;

function buildPayload() {
    const d = document.getElementById('cn_date')?.value || new Date().toISOString().slice(0, 10);
    const cn = document.getElementById('creditnote_number')?.value || '';
    const items = [];
    document.querySelectorAll('#items .item-row').forEach(row => {
        const grn = row.querySelector('.grn_number')?.value || '';
        const inv = row.querySelector('.invoice_number')?.value || '';
        const code = row.querySelector('.product_code')?.value || '';
        const name = row.querySelector('.description')?.value || '';
        const q = parseFloat(row.querySelector('.quantity')?.value || 0);
        const price = parseFloat(row.querySelector('.unit_price')?.value || 0);
        if (grn || inv || code || name) items.push({ grn_number: grn, invoice_number: inv, cf_itemid: code, cf_itemname: name, quantity: q, unit_price: price });
    });
    return { creditnote_date: d, creditnote_number: cn, items };
}
