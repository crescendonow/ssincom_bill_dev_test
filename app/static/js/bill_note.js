// /static/js/bill_note.js

document.addEventListener('DOMContentLoaded', () => {
    const customerSearch = document.getElementById('customerSearch');
    const customerIdInput = document.getElementById('customerId');
    const customerList = document.getElementById('customerList');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const generateBtn = document.getElementById('generateBillBtn');
    const printBtn = document.getElementById('printPdfBtn');
    const loadingDiv = document.getElementById('loading');
    const saveBtn = document.getElementById('saveBillBtn');
    const tabCreate = document.getElementById('tab-create');
    const tabSearch = document.getElementById('tab-search');
    const panelCreate = document.getElementById('panel-create');
    const panelSearch = document.getElementById('panel-search');
    const searchBillBtn = document.getElementById('searchBillBtn');
    const searchResultsBody = document.getElementById('searchResultsBody');
    const searchQueryInput = document.getElementById('searchQuery');
    const billNoteList = document.getElementById('billNoteList');
    const billDateInput = document.getElementById('billDate');

    const updateBtn = document.createElement('button');
    updateBtn.id = 'updateBillBtn';
    updateBtn.className = 'bg-amber-600 text-white px-6 py-2 rounded-md hover:bg-amber-700 hidden';
    updateBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> อัปเดตใบวางบิล';

    let currentEditingBillNumber = null;
    let customersCache = [];
    let currentBillData = null;

    const debounce = (fn, delay = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; };

    async function loadAllCustomers() {
        try {
            const res = await fetch('/api/customers/all');
            if (!res.ok) throw new Error('Cannot load customers');
            customersCache = await res.json();
            customerList.innerHTML = customersCache.slice(0, 5000).map(c => {
                const code = (c.personid ?? '').trim();
                const name = (c.fname ?? c.customer_name ?? '').trim();
                const label = `${code}${code && name ? ' | ' : (name ? ' | ' : '')}${name}`;
                return `<option value="${label}"></option>`;
            }).join('');
        } catch (err) { console.error(err); }
    }

    function resolveCustomerSelection() {
        const raw = (customerSearch.value || '').trim();
        const val = raw.replace(/\s*\|\s*/g, ' | ');
        const opt = Array.from(customerList.options).find(o => o.value === val);
        if (!opt) { customerIdInput.value = ''; return; }
        const label = opt.value;
        const code = label.split(' | ')[0] || '';
        const found = customersCache.find(c => (c.personid || '').trim() === code.trim());
        if (found) {
            customerIdInput.value = found.idx;
            const fixedLabel = `${(found.personid ?? '').trim()} | ${(found.fname ?? found.customer_name ?? '').trim()}`;
            if (label !== fixedLabel) customerSearch.value = fixedLabel;
        } else {
            customerIdInput.value = '';
        }
    }

    async function generateBill() {
        const billContainer = document.getElementById('bill-note-container');
        const custId = customerIdInput.value;
        const start = startDateInput.value;
        const end = endDateInput.value;

        if (!custId || !start || !end) { alert('กรุณาเลือกลูกค้าและช่วงวันที่ให้ครบถ้วน'); return; }

        loadingDiv.classList.remove('hidden');
        generateBtn.disabled = true; saveBtn.disabled = true; printBtn.disabled = true;
        if (billContainer) billContainer.style.display = 'none';

        try {
            const params = new URLSearchParams({ customer_id: custId, start, end });
            const res = await fetch(`/api/billing-note-invoices?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch invoice data');
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            data.bill_date = new Date().toISOString().split('T')[0];
            if (data.invoices && data.invoices.length > 0) {
                const latestInvoiceDate = data.invoices.reduce((max, inv) => inv.due_date > max ? inv.due_date : max, data.invoices[0].due_date);
                data.payment_duedate = latestInvoiceDate;
            } else { data.payment_duedate = null; }

            currentBillData = data;
            const billDateInput = document.getElementById('billDate');
            if (billDateInput) billDateInput.value = (data.bill_date || '').slice(0, 10) || new Date().toISOString().split('T')[0];

            await renderBillDocument(data);
            if (!data.invoices || data.invoices.length === 0) {
                alert('ไม่มีใบกำกับภาษีให้เลือกในช่วงวันที่นี้ หรือถูกใช้ในใบวางบิลอื่นแล้ว');
            }
        } catch (error) {
            console.error(error); alert('เกิดข้อผิดพลาดในการสร้างใบวางบิล: ' + error.message);
        } finally {
            loadingDiv.classList.add('hidden');
            generateBtn.disabled = false; saveBtn.disabled = false; printBtn.disabled = false;
            if (billContainer) billContainer.style.display = 'block';
        }
    }

    async function saveBillNote() {
        if (!currentBillData) { alert('ไม่มีข้อมูลใบวางบิลสำหรับบันทึก'); return; }
        const payload = {
            customer_id: parseInt(document.getElementById('customerId').value, 10),
            bill_date: new Date().toISOString().split('T')[0],
            items: (currentBillData.invoices || []).map(inv => ({
                invoice_number: inv.invoice_number,
                invoice_date: inv.invoice_date,
                due_date: inv.due_date,
                amount: inv.amount,
            })),
            total_amount: currentBillData.summary.total_amount,
        };

        saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
        try {
            const res = await fetch('/api/billing-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && result && result.duplicates) {
                    alert('บางใบกำกับถูกใช้ในใบวางบิลอื่นแล้ว:\n' + result.duplicates.join(', '));
                } else { alert('การบันทึกล้มเหลว: ' + (result.detail || result.message || res.statusText)); }
                return;
            }
            document.querySelectorAll('.bill-number').forEach(el => { el.textContent = result.billnote_number; });
            alert(`บันทึกใบวางบิลสำเร็จ!\nเลขที่เอกสาร: ${result.billnote_number}`);
            saveBtn.classList.add('hidden');
        } catch (error) {
            console.error(error); alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกใบวางบิล';
        }
    }

    function renderBillDocument(data) {
        const container = document.getElementById('bill-note-container');
        const template = document.getElementById('bill-note-template');
        container.innerHTML = '';

        const ITEMS_PER_PAGE = 12;
        const totalPages = Math.ceil((data.invoices || []).length / ITEMS_PER_PAGE) || 1;

        for (let i = 0; i < totalPages; i++) {
            const pageNode = template.content.cloneNode(true);
            const pageElement = pageNode.querySelector('.A4-page');

            const startIdx = i * ITEMS_PER_PAGE;
            const pageInvoices = (data.invoices || []).slice(startIdx, startIdx + ITEMS_PER_PAGE);

            pageElement.querySelector('.cust-person-id').textContent = data.customer.person_id || '-';
            pageElement.querySelector('.cust-name').textContent = data.customer.name || '-';
            pageElement.querySelector('.cust-address').textContent = data.customer.address || '-';
            pageElement.querySelector('.cust-tax-id').textContent = data.customer.tax_id || '-';
            pageElement.querySelector('.cust-branch').textContent = data.customer.branch || '-';

            pageElement.querySelector('.bill-number').textContent = data.bill_note_number || '(ยังไม่ได้บันทึก)';
            pageElement.querySelector('.bill-date').textContent = new Date(data.bill_date || Date.now()).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
            const signatureDate = pageElement.querySelector('.signature-date');
            if (signatureDate) signatureDate.textContent = new Date(data.bill_date || Date.now()).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

            pageElement.querySelector('.page-number').textContent = `${i + 1} / ${totalPages}`;
            pageElement.querySelector('.payment-due-date').textContent = formatLongThaiDate(data.payment_duedate) || '-';

            const tableBody = pageElement.querySelector('.invoice-table-body');
            tableBody.innerHTML = '';
            pageInvoices.forEach((inv, index) => {
                const tr = document.createElement('tr');
                tr.className = 'border-b border-gray-300';
                tr.dataset.invNumber = inv.invoice_number;
                tr.innerHTML = `
          <td class="p-2 text-center">${startIdx + index + 1}</td>
          <td class="p-2 text-left">${inv.invoice_number}</td>
          <td class="p-2 text-center">${formatDate(inv.invoice_date)}</td>
          <td class="p-2 text-center">${formatDate(inv.due_date)}</td>
          <td class="p-2 text-right">${Number(inv.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>`;
                tableBody.appendChild(tr);
            });

            if (i === totalPages - 1) {
                pageElement.querySelector('.summary-footer').classList.remove('hidden');
                pageElement.querySelector('.summary-total').textContent = Number(data.summary.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
                const totalInWordsEl = pageElement.querySelector('.total-in-words');
                totalInWordsEl.classList.remove('hidden');
                totalInWordsEl.textContent = `(ตัวอักษร: ${thaiBahtText(data.summary.total_amount)})`;
            }

            container.appendChild(pageElement);
        }

        const printBtnEl = document.getElementById('printPdfBtn');
        const saveBtnEl = document.getElementById('saveBillBtn');
        if (printBtnEl) { printBtnEl.classList.remove('hidden'); printBtnEl.style.display = 'inline-block'; }
        if (saveBtnEl) { saveBtnEl.classList.remove('hidden'); saveBtnEl.style.display = 'inline-block'; }
    }

    function formatDate(iso) { if (!iso) return '-'; const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String((d.getFullYear() + 543)).slice(-2)}`; }
    function formatLongThaiDate(iso) { if (!iso) return null; const d = new Date(iso); const ad = d.getFullYear(); const be = ad + 543; return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(String(ad), String(be)); }

    function thaiBahtText(num) { /* เดิม */ num = Number(num).toFixed(2); let [i, f] = num.split('.'); const TH = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']; const U = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน']; const read = (s) => { let r = ''; const L = s.length; for (let k = 0; k < L; k++) { const d = parseInt(s[k]); if (!d) continue; const p = L - k - 1; if (p === 1 && d === 2) { r += 'ยี่'; } else if (p === 1 && d === 1) {/*skip*/ } else if (p === 0 && d === 1 && L > 1) { r += 'เอ็ด'; } else { r += TH[d]; } r += U[p]; } return r; }; let it = ''; if (i === '0') it = 'ศูนย์'; else { const m = Math.floor(i.length / 6); const r = i.length % 6; let s = 0; if (r > 0) { it += read(i.substring(0, r)) + (m > 0 ? 'ล้าน' : ''); s = r; } for (let a = 0; a < m; a++) { it += read(i.substring(s + a * 6, s + (a + 1) * 6)) + (a < m - 1 ? 'ล้าน' : ''); } } it += 'บาท'; let ft = ''; ft = (f === '00') ? 'ถ้วน' : read(f) + 'สตางค์'; return it + ft; }

    function switchTab(target) { if (target === 'create') { tabCreate.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600'; tabSearch.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'; panelCreate.style.display = 'block'; panelSearch.style.display = 'none'; } else { tabSearch.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600'; tabCreate.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'; panelSearch.style.display = 'block'; panelCreate.style.display = 'none'; document.getElementById('bill-note-container').innerHTML = ''; } }

    async function searchBillNotes() { const start = document.getElementById('searchStartDate').value; const end = document.getElementById('searchEndDate').value; const q = document.getElementById('searchQuery').value; const params = new URLSearchParams({ start, end, q }); const res = await fetch(`/api/search-billing-notes?${params.toString()}`); const results = await res.json(); searchResultsBody.innerHTML = ''; if (results.length === 0) { searchResultsBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">ไม่พบข้อมูล</td></tr>'; return; } results.forEach(bill => { const tr = document.createElement('tr'); tr.className = 'border-b'; 
        tr.innerHTML = `<td class="p-2">${formatDate(bill.bill_date)}</td><td class="p-2">${bill.billnote_number}</td><td class="p-2">${bill.fname}</td><td class="p-2 text-center"><button class="btn-view-edit text-blue-600 hover:underline text-sm" data-bill-number="${bill.billnote_number}">ดู/แก้ไข</button><button class="btn-delete text-red-600 hover:underline text-sm ml-2" data-bill-number="${bill.billnote_number}">ลบ</button></td>`; searchResultsBody.appendChild(tr); }); }

    async function loadBillForEditing(billNumber) { currentEditingBillNumber = billNumber; const res = await fetch(`/api/billing-notes/${billNumber}`); if (!res.ok) { alert('ไม่สามารถโหลดข้อมูลใบวางบิลได้'); return; } const data = await res.json(); currentBillData = data; renderBillDocument(data); saveBtn.classList.add('hidden'); updateBtn.classList.remove('hidden'); printBtn.classList.remove('hidden'); switchTab('create'); document.querySelectorAll('.invoice-table-body tr').forEach(tr => { const td = document.createElement('td'); td.className = 'p-2 text-center noprint'; td.innerHTML = '<button class="btn-remove-item text-red-500"><i class="fa-solid fa-xmark"></i></button>'; tr.appendChild(td); }); }

    async function updateBillNote() {
        if (!currentEditingBillNumber) return; const items = []; document.querySelectorAll('.invoice-table-body tr').forEach(tr => { const inv = currentBillData.invoices.find(i => i.invoice_number === tr.dataset.invNumber); if (inv) { items.push({ invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, due_date: inv.due_date, amount: inv.amount }); } }); const total_amount = items.reduce((s, it) => s + Number(it.amount || 0), 0); const billDateInput = document.getElementById('billDate'); const bill_date = billDateInput && billDateInput.value ? billDateInput.value : new Date().toISOString().split('T')[0]; const cid = parseInt(document.getElementById('customerId')?.value, 10); const customer_id = Number.isFinite(cid) ? cid : undefined; const payload = { items, total_amount, bill_date, customer_id };

        const res = await fetch(`/api/billing-notes/${currentEditingBillNumber}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) { if (res.status === 409 && result && result.duplicates) { alert('บางใบกำกับถูกใช้ในใบวางบิลอื่นแล้ว:\n' + result.duplicates.join(', ')); } else { alert('การอัปเดตล้มเหลว: ' + (result.detail || result.message || res.statusText)); } return; }
        alert('อัปเดตใบวางบิลสำเร็จ!');
        loadBillForEditing(currentEditingBillNumber);
    }

    // Events
    const debounceSuggest = (q) => { /* optional: implement if needed */ };
    customerSearch.addEventListener('change', resolveCustomerSelection);
    customerSearch.addEventListener('blur', resolveCustomerSelection);
    customerSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') resolveCustomerSelection(); });
    generateBtn.addEventListener('click', generateBill);
    printBtn.addEventListener('click', () => window.print());
    saveBtn.addEventListener('click', saveBillNote);
    tabCreate.addEventListener('click', () => switchTab('create'));
    tabSearch.addEventListener('click', () => switchTab('search'));
    searchBillBtn.addEventListener('click', searchBillNotes);
    // รองรับคลิก "ดู/แก้ไข" และ "ลบ" จากผลลัพธ์ค้นหา (event delegation)
    searchResultsBody.addEventListener('click', async (e) => {
        const viewBtn = e.target.closest('.btn-view-edit');
        const delBtn = e.target.closest('.btn-delete');

        // ดู/แก้ไข
        if (viewBtn) {
            const billNo = viewBtn.getAttribute('data-bill-number');
            if (!billNo) return;
            await loadBillForEditing(billNo);  // <-- ใช้ฟังก์ชันที่มีอยู่แล้ว
            return;
        }

        // ลบ
        if (delBtn) {
            const billNo = delBtn.getAttribute('data-bill-number');
            if (!billNo) return;
            if (!confirm(`ต้องการลบใบวางบิลเลขที่ ${billNo} ใช่หรือไม่?`)) return;

            try {
                const res = await fetch(`/api/billing-notes/${billNo}`, { method: 'DELETE' });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    alert('ลบไม่สำเร็จ: ' + (j.detail || res.statusText));
                    return;
                }
                alert('ลบสำเร็จ');
                searchBillNotes(); // รีโหลดผลลัพธ์
            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาดในการลบ: ' + err.message);
            }
        }
    });

    updateBtn.addEventListener('click', updateBillNote);
    searchQueryInput.addEventListener('input', (/* debounce if needed */) => { });
    document.getElementById('bill-note-container').addEventListener('click', (e) => { if (e.target.closest('.btn-remove-item')) e.target.closest('tr').remove(); });

    // Init
    const now = new Date(); const todayISO = now.toISOString().split('T')[0]; if (billDateInput) billDateInput.value = todayISO; if (endDateInput) endDateInput.value = todayISO; const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); if (startDateInput) startDateInput.value = firstOfMonth.toISOString().split('T')[0];
    loadAllCustomers();
    saveBtn.parentElement.appendChild(updateBtn);
});

