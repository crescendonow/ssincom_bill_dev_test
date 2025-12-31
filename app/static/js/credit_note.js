// /static/js/credit_note.js

let currentEditingCreditNoteNumber = null;

document.addEventListener('DOMContentLoaded', () => {
    const cnDateEl = document.getElementById('cn_date');
    const cnNoEl = document.getElementById('creditnote_number');
    const btnGenNo = document.getElementById('btnGenNo');
    const btnSave = document.getElementById('btnSave');
    const btnUpdate = document.getElementById('btnUpdate');
    const btnPDF = document.getElementById('btnPDF');
    const btnPreview = document.getElementById('btnPreview');
    const btnNew = document.getElementById('btnNew');

    const tabCreate = document.getElementById('tab-create');
    const tabSearch = document.getElementById('tab-search');
    const panelCreate = document.getElementById('panel-create');
    const panelSearch = document.getElementById('panel-search');
    const searchBtn = document.getElementById('searchBtn');
    const searchResultsBody = document.getElementById('searchResultsBody');

    const todayISO = new Date().toISOString().slice(0, 10);
    if (cnDateEl && !cnDateEl.value) cnDateEl.value = todayISO;

    // ===== TAB SWITCHING =====
    function switchTab(target) {
        if (target === 'create') {
            tabCreate.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600';
            tabSearch.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
            panelCreate.classList.remove('hidden');
            panelSearch.classList.add('hidden');
        } else {
            tabSearch.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600';
            tabCreate.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
            panelSearch.classList.remove('hidden');
            panelCreate.classList.add('hidden');
            document.getElementById('preview').classList.add('hidden');
        }
    }

    tabCreate?.addEventListener('click', () => switchTab('create'));
    tabSearch?.addEventListener('click', () => switchTab('search'));

    // ===== GENERATE NUMBER =====
    btnGenNo?.addEventListener("click", async () => {
        const d = cnDateEl.value;
        if (!d) { alert("กรุณาเลือกวันที่เอกสารก่อนสร้างเลขเอกสาร"); return; }

        try {
            const url = `/api/credit-notes/generate-number/?date=${encodeURIComponent(d)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const text = await res.text();
                console.error("generate-number error", res.status, text);
                alert("ไม่สามารถสร้างเลขเอกสารได้\nรหัสผิดพลาด: " + res.status);
                return;
            }
            const data = await res.json();
            cnNoEl.value = data.number || "";
        } catch (err) {
            console.error("fetch /generate-number failed:", err);
            alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
        }
    });

    // ===== SAVE =====
    btnSave?.addEventListener('click', async () => {
        const payload = buildPayload();
        if (!payload.creditnote_number) { alert('กรุณาสร้างเลขที่ใบลดหนี้ก่อนบันทึก'); return; }
        if (!payload.items.length) { alert('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ'); return; }
        const res = await fetch('/api/credit-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.detail || 'บันทึกไม่สำเร็จ'); return; }
        alert(`บันทึกสำเร็จ เลขที่เอกสาร: ${data.creditnote_number}`);
        btnSave.classList.add('hidden');
    });

    // ===== UPDATE =====
    btnUpdate?.addEventListener('click', async () => {
        if (!currentEditingCreditNoteNumber) return;
        const payload = buildPayload();
        payload.creditnote_number = currentEditingCreditNoteNumber;

        const res = await fetch(`/api/credit-notes/update?no=${encodeURIComponent(currentEditingCreditNoteNumber)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.detail || 'อัปเดตไม่สำเร็จ'); return; }
        alert('อัปเดตใบลดหนี้สำเร็จ!');
    });

    // ===== PREVIEW =====
    btnPreview?.addEventListener('click', async () => {
        const payload = buildPayload();
        const res = await fetch('/api/credit-notes/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const html = await res.text();
        const view = document.getElementById('preview');
        view.classList.remove('hidden');
        view.innerHTML = html;
    });

    // ===== PDF =====
    btnPDF?.addEventListener('click', async () => {
        const payload = buildPayload();
        const res = await fetch('/export-creditnote-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const t = await res.text();
            alert(t || 'สร้าง PDF ไม่สำเร็จ');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `credit_note_${payload.creditnote_number || 'document'}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });

    // ===== NEW =====
    btnNew?.addEventListener('click', () => {
        resetForm();
    });

    // ===== SEARCH =====
    searchBtn?.addEventListener('click', searchCreditNotes);

    async function searchCreditNotes() {
        const start = document.getElementById('searchStartDate').value;
        const end = document.getElementById('searchEndDate').value;
        const q = document.getElementById('searchQuery').value;
        const params = new URLSearchParams({ start, end, q });

        try {
            const res = await fetch(`/api/search-credit-notes?${params.toString()}`);
            const results = await res.json();

            searchResultsBody.innerHTML = '';
            if (results.length === 0) {
                searchResultsBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">ไม่พบข้อมูล</td></tr>';
                return;
            }

            results.forEach(cn => {
                const tr = document.createElement('tr');
                tr.className = 'border-b';
                tr.innerHTML = `
                    <td class="p-2">${formatDate(cn.created_at)}</td>
                    <td class="p-2">${cn.creditnote_number}</td>
                    <td class="p-2">${cn.customer_name || '-'}</td>
                    <td class="p-2 text-right">${Number(cn.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td class="p-2 text-center">
                        <button class="btn-view-edit text-blue-600 hover:underline text-sm" data-cn-number="${cn.creditnote_number}">ดู/แก้ไข</button>
                        <button class="btn-delete text-red-600 hover:underline text-sm ml-2" data-cn-number="${cn.creditnote_number}">ลบ</button>
                    </td>
                `;
                searchResultsBody.appendChild(tr);
            });
        } catch (err) {
            console.error(err);
            alert('เกิดข้อผิดพลาดในการค้นหา');
        }
    }

    // ===== SEARCH RESULTS CLICK HANDLER =====
    searchResultsBody?.addEventListener('click', async (e) => {
        const viewBtn = e.target.closest('.btn-view-edit');
        const delBtn = e.target.closest('.btn-delete');

        if (viewBtn) {
            const cnNo = viewBtn.getAttribute('data-cn-number');
            if (cnNo) await loadCreditNoteForEditing(cnNo);
            return;
        }

        if (delBtn) {
            const cnNo = delBtn.getAttribute('data-cn-number');
            if (!cnNo) return;
            if (!confirm(`ต้องการลบใบลดหนี้เลขที่ ${cnNo} ใช่หรือไม่?`)) return;

            try {
                const res = await fetch(`/api/credit-notes/${encodeURIComponent(cnNo)}`, { method: 'DELETE' });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    alert('ลบไม่สำเร็จ: ' + (j.detail || res.statusText));
                    return;
                }
                alert('ลบสำเร็จ');
                searchCreditNotes();
            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาดในการลบ: ' + err.message);
            }
        }
    });

    // ===== LOAD FOR EDITING =====
    async function loadCreditNoteForEditing(cnNumber) {
        try {
            const res = await fetch(`/api/credit-notes/${encodeURIComponent(cnNumber)}`);
            if (!res.ok) { alert('ไม่สามารถโหลดข้อมูลใบลดหนี้ได้'); return; }
            const data = await res.json();

            currentEditingCreditNoteNumber = cnNumber;

            // Fill header
            cnNoEl.value = data.head.creditnote_number;
            cnDateEl.value = data.head.created_at || todayISO;

            // Clear existing items
            const itemsContainer = document.getElementById('items');
            itemsContainer.innerHTML = '';

            // Add items
            if (data.items && data.items.length > 0) {
                data.items.forEach((item, idx) => {
                    if (idx === 0) {
                        // Use existing first row structure
                        addItem();
                    } else {
                        addItem();
                    }
                    const rows = itemsContainer.querySelectorAll('.item-row');
                    const row = rows[rows.length - 1];

                    row.querySelector('.grn_number').value = item.grn_number || '';
                    row.querySelector('.invoice_number').value = item.invoice_number || '';
                    row.querySelector('.product_code').value = item.cf_itemid || '';
                    row.querySelector('.description').value = item.cf_itemname || '';
                    row.querySelector('.quantity').value = item.sum_quantity ?? item.quantity ?? 0;
                    row.querySelector('.old_total_vat').value = to2((item.sum_quantity ?? item.quantity ?? 0) * ((item.price_after_fine || 0) * 1.07));
                    row.querySelector('.fine').value = item.fine || 0;

                    const basePrice = (item.price_after_fine || 0) + (item.fine || 0);
                    row.querySelector('.base_price').value = basePrice;
                    row.querySelector('.unit_price').value = basePrice;
                });
            }

            // Fill customer info
            if (data.buyer) {
                document.getElementById('personid').value = data.buyer.personid || '';
                document.getElementById('customer_name').value = data.buyer.name || '';
                document.getElementById('customer_address').value = data.buyer.addr || '';
                document.getElementById('customer_taxid').value = data.buyer.tax || '';
                document.getElementById('tel').value = data.buyer.tel || '';
                document.getElementById('mobile').value = data.buyer.mobile || '';
                document.getElementById('cf_personzipcode').value = data.buyer.zipcode || '';
                document.getElementById('cf_provincename').value = data.buyer.prov || '';
            }

            // Show update button, hide save
            btnSave.classList.add('hidden');
            btnUpdate.classList.remove('hidden');
            btnNew.classList.remove('hidden');

            updateTotal();
            switchTab('create');
            window.scrollTo({ top: 0, behavior: 'smooth' });

        } catch (err) {
            console.error(err);
            alert('เกิดข้อผิดพลาด: ' + err.message);
        }
    }

    // ===== RESET FORM =====
    function resetForm() {
        currentEditingCreditNoteNumber = null;
        cnNoEl.value = '';
        cnDateEl.value = todayISO;

        // Clear items - keep one empty row
        const itemsContainer = document.getElementById('items');
        itemsContainer.innerHTML = `
            <div class="flex flex-wrap gap-3 md:gap-4 item-row items-end">
                <input name="grn_number" placeholder="เลขที่ใบรับสินค้า"
                    class="grn_number flex-1 min-w-[120px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
                <input name="invoice_number" placeholder="เลขที่ใบกำกับ"
                    class="invoice_number flex-1 min-w-[140px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
                <input name="product_code" placeholder="รหัสสินค้า"
                    class="product_code w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
                <input name="description" placeholder="รายละเอียด"
                    class="description flex-1 min-w-[140px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />
                <input name="unit_price" type="number" step="0.01" placeholder="ราคา/หน่วย"
                    class="unit_price w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" oninput="updateTotal()" />
                <input name="quantity" type="number" step="0.01" placeholder="จำนวน"
                    class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" oninput="updateTotal()" />
                <input name="fine" type="number" step="0.01" placeholder="บทปรับ/หน่วย (บาท)"
                    class="fine w-28 md:w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" oninput="updateTotal()" />
                <input name="old_total_vat" placeholder="มูลค่าเดิม (รวม VAT)" readonly
                    class="old_total_vat w-40 bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5 text-right" />
                <input name="new_total_vat" placeholder="มูลค่าใหม่ (รวม VAT)" readonly
                    class="new_total_vat w-40 bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5 text-right" />
                <input type="hidden" class="base_price" value="0" />
                <button type="button" onclick="removeItem(this)"
                    class="text-red-600 hover:text-blue-800 font-semibold"><i class="fas fa-trash"></i></button>
            </div>
        `;

        // Clear customer
        document.getElementById('personid').value = '';
        document.getElementById('customer_name').value = '';
        document.getElementById('customer_address').value = '';
        document.getElementById('customer_taxid').value = '';
        document.getElementById('tel').value = '';
        document.getElementById('mobile').value = '';
        document.getElementById('cf_personzipcode').value = '';
        document.getElementById('cf_provincename').value = '';

        // Show save, hide update
        btnSave.classList.remove('hidden');
        btnUpdate.classList.add('hidden');
        btnNew.classList.add('hidden');

        updateTotal();
        wireAutocompleteForAllRows();
    }

    // Wire autocomplete on load
    wireAutocompleteForAllRows();
});

// ===== HELPER: Format date =====
function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String((d.getFullYear() + 543)).slice(-2)}`;
}

// ===== ADD ITEM =====
function addItem() {
    const wrap = document.getElementById('items');
    if (!wrap) return;

    const div = document.createElement('div');
    div.className = "flex flex-wrap gap-3 md:gap-4 item-row items-end";
    div.innerHTML = `
    <input name="grn_number" placeholder="เลขที่ใบรับสินค้า"
      class="grn_number flex-1 min-w-[120px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />

    <input name="invoice_number" placeholder="เลขที่ใบกำกับ"
      class="invoice_number flex-1 min-w-[140px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />

    <input name="product_code" placeholder="รหัสสินค้า"
      class="product_code w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />

    <input name="description" placeholder="รายละเอียด"
      class="description flex-1 min-w-[140px] bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" />

    <!-- ราคา/หน่วย (จะ autofill จากรหัสสินค้า) -->
    <input name="unit_price" type="number" step="0.01" placeholder="ราคา/หน่วย"
      class="unit_price w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" oninput="updateTotal()" />

    <input name="quantity" type="number" step="0.01" placeholder="จำนวน"
      class="quantity w-24 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" oninput="updateTotal()" />

    <input name="fine" type="number" step="0.01" placeholder="บทปรับ/หน่วย (บาท)"
      class="fine w-28 md:w-32 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5" oninput="updateTotal()" />

    <!-- แสดงผลรวม VAT 7% -->
    <input name="old_total_vat" placeholder="มูลค่าเดิม (รวม VAT)" readonly
      class="old_total_vat w-40 bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5 text-right" />

    <input name="new_total_vat" placeholder="มูลค่าใหม่ (รวม VAT)" readonly
      class="new_total_vat w-40 bg-gray-100 border border-gray-300 text-sm rounded-lg p-2.5 text-right" />

    <!-- เก็บราคาฐาน -->
    <input type="hidden" class="base_price" value="0" />

    <button type="button" onclick="removeItem(this)" class="text-red-600 hover:text-red-800 font-semibold px-2"><i
                            class="fas fa-trash"></i></button>
  `;

    wrap.appendChild(div);

    // ผูก autocomplete + summary + ดึงราคา + คำนวณ
    wireRow(div);
    updateTotal();
}
window.addItem = addItem;

// ผูก autocomplete + lookup ให้ทุกแถวที่มีอยู่ตอนโหลดหน้า
function wireAutocompleteForAllRows() {
    document.querySelectorAll('#items .item-row').forEach(row => {
        wireRow(row);
    });
}

function removeItem(btn) { btn.closest('.item-row')?.remove(); updateTotal(); }
window.removeItem = removeItem;

// ===== buildPayload: แนบข้อมูลลูกค้า + variant =====
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
        const fine = parseFloat(row.querySelector('.fine')?.value || 0);

        const base = parseFloat(
            row.querySelector('.base_price')?.value ||
            row.querySelector('.unit_price')?.value || 0
        );
        const price_after_fine = (base - (isNaN(fine) ? 0 : fine));

        if (grn || inv || code || name) {
            items.push({
                grn_number: grn,
                invoice_number: inv,
                cf_itemid: code,
                cf_itemname: name,
                quantity: q,
                fine: fine,
                price_after_fine: price_after_fine
            });
        }
    });

    // เก็บหัวลูกค้า
    const buyer = {
        name: document.getElementById('customer_name')?.value || '',
        addr: document.getElementById('customer_address')?.value || '',
        tax: document.getElementById('customer_taxid')?.value || '',
        tel: document.getElementById('tel')?.value || '',
        mobile: document.getElementById('mobile')?.value || '',
        zipcode: document.getElementById('cf_personzipcode')?.value || '',
        prov: document.getElementById('cf_provincename')?.value || '',
        personid: document.getElementById('personid')?.value || '',
    };

    // รูปแบบสำหรับ Preview
    const variant = document.getElementById('cn_variant')?.value || 'creditnote_original';

    return { creditnote_date: d, creditnote_number: cn, items, buyer, variant };
}

// ===== Helper ราคา/จำนวน/VAT =====
const VAT_RATE = 0.07;
function to2(n) { return (isNaN(n) ? 0 : n).toFixed(2); }

async function setBasePriceFromCode(row) {
    const codeInput = row.querySelector('.product_code');
    if (!codeInput) return;
    const code = (codeInput.value || '').trim();
    if (!code) return;

    const grn = (row.querySelector('.grn_number')?.value || '').trim();
    const url = `/api/products/price?code=${encodeURIComponent(code)}${grn ? `&grn=${encodeURIComponent(grn)}` : ''}`;

    try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const price = parseFloat(data?.price || 0);

        row.querySelector('.base_price').value = isNaN(price) ? 0 : price;
        const unitEl = row.querySelector('.unit_price');
        if (unitEl && !unitEl.value) unitEl.value = (isNaN(price) ? 0 : price).toFixed(2);

        updateTotal();
    } catch (e) {
        console.error('fetch price error:', e);
    }
}

function wireProductPriceLookup(row) {
    const codeInput = row.querySelector('.product_code');
    const unitInput = row.querySelector('.unit_price');

    codeInput?.addEventListener('change', () => setBasePriceFromCode(row));
    codeInput?.addEventListener('blur', () => setBasePriceFromCode(row));

    // เมื่อกรอก/แก้ unit_price ให้ sync ไป base_price
    unitInput?.addEventListener('input', () => {
        const v = parseFloat(unitInput.value || 0);
        row.querySelector('.base_price').value = isNaN(v) ? 0 : v;
        updateTotal();
    });
}

// ===== wireRow ให้ผูก lookup เพิ่มเติม =====
function wireRow(row) {
    const grnInput = row.querySelector('.grn_number');
    const invoiceInput = row.querySelector('.invoice_number');
    const codeInput = row.querySelector('.product_code');
    const descInput = row.querySelector('.description');
    const qtyInput = row.querySelector('.quantity');

    const dlGRN = document.createElement('datalist');
    const dlCode = document.createElement('datalist');
    const dlDesc = document.createElement('datalist');
    dlGRN.id = `dl-grn-${crypto.randomUUID()}`;
    dlCode.id = `dl-code-${crypto.randomUUID()}`;
    dlDesc.id = `dl-desc-${crypto.randomUUID()}`;
    document.body.append(dlGRN, dlCode, dlDesc);

    grnInput?.setAttribute('list', dlGRN.id);
    codeInput?.setAttribute('list', dlCode.id);
    descInput?.setAttribute('list', dlDesc.id);

    // suggest GRN
    let t = null;
    grnInput?.addEventListener('input', () => {
        clearTimeout(t);
        const q = grnInput.value.trim();
        t = setTimeout(async () => {
            const r = await fetch(`/api/grn/suggest?q=${encodeURIComponent(q)}`);
            const d = await r.json().catch(() => ({ items: [] }));
            dlGRN.innerHTML = (d.items || []).map(v => `<option value="${v}">`).join('');
        }, 180);
    });

    // เมื่อเลือก/blur -> ดึงสรุป
    const ctx = { invoiceInput, codeInput, descInput, qtyInput, dlCode, dlDesc };
    grnInput?.addEventListener('change', () => fetchAndFillGRNSummary(grnInput.value, ctx));
    grnInput?.addEventListener('blur', () => fetchAndFillGRNSummary(grnInput.value, ctx));

    // lookup price จากรหัสสินค้า (ถ้าผู้ใช้เปลี่ยนเอง)
    wireProductPriceLookup(row);
}

async function fetchAndFillGRNSummary(grn, ctx) {
    const { invoiceInput, codeInput, descInput, qtyInput, dlCode, dlDesc } = ctx;
    if (!grn) return;

    const res = await fetch(`/api/grn/summary?grn=${encodeURIComponent(grn)}`);
    const data = await res.json().catch(() => null);
    if (!data) return;

    // 1) ใบกำกับใบแรก
    if (invoiceInput && data.invoice_number) {
        invoiceInput.value = data.invoice_number;
        invoiceInput.readOnly = true;
    }

    // 2) เติม datalist + auto เลือกค่าแรก
    if (Array.isArray(data.product_codes)) {
        dlCode.innerHTML = data.product_codes.map(v => `<option value="${v}">`).join('');
        if (codeInput && !codeInput.value && data.product_codes.length) codeInput.value = data.product_codes[0];
        if (codeInput) codeInput.readOnly = true;
    }
    if (Array.isArray(data.descriptions)) {
        dlDesc.innerHTML = data.descriptions.map(v => `<option value="${v}">`).join('');
        if (descInput && !descInput.value && data.descriptions.length) descInput.value = data.descriptions[0];
        if (descInput) descInput.readOnly = true;
    }

    // 3) จำนวนรวมจาก invoice_items
    if (qtyInput) {
        qtyInput.value = Number(data.quantity_sum || 0).toFixed(2);
        qtyInput.readOnly = true;
    }

    // 4) ดึงราคาหน่วยอัตโนมัติจาก code
    const row = qtyInput?.closest('.item-row');
    if (row) {
        await setBasePriceFromCode(row);
        const unitEl = row.querySelector('.unit_price');
        if (unitEl) unitEl.readOnly = true;

        const grnEl = row.querySelector('.grn_number');
        if (grnEl) grnEl.readOnly = true;
    }

    // 5) เติมลูกค้าจาก personid ของ invoice แรก
    if (data.personid) {
        const pidEl = document.getElementById('personid');
        if (pidEl) {
            pidEl.value = data.personid;
            pidEl.dispatchEvent(new Event('input'));
            await selectCustomerByPersonid();
        }
    }

    updateTotal();
}

// ===== คำนวณผลรวม + มูลค่าเดิม/ใหม่ (รวม VAT) ต่อแถว =====
function updateTotal() {
    let sum = 0;
    document.querySelectorAll('#items .item-row').forEach(row => {
        const base = parseFloat(row.querySelector('.base_price')?.value || row.querySelector('.unit_price')?.value || 0);
        const fine = parseFloat(row.querySelector('.fine')?.value || 0);
        const qty = parseFloat(row.querySelector('.quantity')?.value || 0);

        // ราคาใหม่ต่อหน่วย = base - fine (ไม่ต่ำกว่า 0)
        let newUnit = base - (isNaN(fine) ? 0 : fine);
        if (newUnit < 0) newUnit = 0;

        // (1) มูลค่าเดิมรวม VAT = qty * base * (1+VAT)
        const oldTotalVat = (qty * base) * (1 + VAT_RATE);
        // (2) มูลค่าใหม่รวม VAT = qty * newUnit * (1+VAT)
        const newTotalVat = (qty * newUnit) * (1 + VAT_RATE);

        // แสดงผลแถว (ปัดทศนิยม 2)
        const oldEl = row.querySelector('.old_total_vat');
        const newEl = row.querySelector('.new_total_vat');
        if (oldEl) oldEl.value = to2(oldTotalVat);
        if (newEl) newEl.value = to2(newTotalVat);

        // รวมไว้ให้ผู้ใช้เห็นด้านบน (รวมเฉพาะ "ราคาใหม่" เหมือนยอดชำระจริง)
        sum += (qty * newUnit);
    });

    const el = document.getElementById('total_amount');
    if (el) el.textContent = '฿ ' + (sum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
window.updateTotal = updateTotal;

// ===== ลูกค้า (ORM API) =====
async function loadPersonidSuggest(q) {
    const res = await fetch(`/api/customers/suggest-personid?q=${encodeURIComponent(q || '')}`);
    const data = await res.json().catch(() => ({ items: [] }));
    const dl = document.getElementById('personidList');
    if (dl) dl.innerHTML = (data.items || []).map(v => `<option value="${v}">`).join('');
}
async function loadCustomerNameSuggest(q) {
    const res = await fetch(`/api/customers/suggest-name?q=${encodeURIComponent(q || '')}`);
    const data = await res.json().catch(() => ({ items: [] }));
    const dl = document.getElementById('customerList');
    if (dl) dl.innerHTML = (data.items || []).map(v => `<option value="${v}">`).join('');
}

// เรียกเมื่อพิมพ์ personid
async function selectCustomerByPersonid() {
    const pid = (document.getElementById('personid')?.value || '').trim();
    loadPersonidSuggest(pid);
    if (!pid) return;
    const res = await fetch(`/api/customers/by-personid?personid=${encodeURIComponent(pid)}`);
    const c = await res.json().catch(() => null);
    if (!c) return;

    // เติมฟิลด์
    (document.getElementById('customer_name') || {}).value = c.fname || '';
    (document.getElementById('customer_address') || {}).value = c.cf_personaddress || '';
    (document.getElementById('customer_taxid') || {}).value = c.cf_taxid || '';
    (document.getElementById('tel') || {}).value = c.tel || '';
    (document.getElementById('mobile') || {}).value = c.mobile || '';
    (document.getElementById('cf_personzipcode') || {}).value = c.cf_personzipcode || '';
    (document.getElementById('cf_provincename') || {}).value = c.cf_provincename || '';
}
window.selectCustomerByPersonid = selectCustomerByPersonid;

// เรียกเมื่อพิมพ์ชื่อลูกค้า
async function selectCustomer() {
    const name = (document.getElementById('customer_name')?.value || '').trim();
    loadCustomerNameSuggest(name);
    if (!name) return;
    const res = await fetch(`/api/customers/by-name?name=${encodeURIComponent(name)}`);
    const c = await res.json().catch(() => null);
    if (!c) return;

    (document.getElementById('personid') || {}).value = c.personid || '';
    (document.getElementById('customer_address') || {}).value = c.cf_personaddress || '';
    (document.getElementById('customer_taxid') || {}).value = c.cf_taxid || '';
    (document.getElementById('tel') || {}).value = c.tel || '';
    (document.getElementById('mobile') || {}).value = c.mobile || '';
    (document.getElementById('cf_personzipcode') || {}).value = c.cf_personzipcode || '';
    (document.getElementById('cf_provincename') || {}).value = c.cf_provincename || '';
}
window.selectCustomer = selectCustomer;