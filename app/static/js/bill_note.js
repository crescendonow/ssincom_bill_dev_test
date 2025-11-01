// /static/js/bill_note.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const customerSearch = document.getElementById('customerSearch');
    const customerIdInput = document.getElementById('customerId');
    const customerList = document.getElementById('customerList');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const generateBtn = document.getElementById('generateBillBtn');
    const printBtn = document.getElementById('printPdfBtn');
    const loadingDiv = document.getElementById('loading');
    const billDocument = document.getElementById('bill-note-container');
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

    // Mapping ช่วยกันชนกันชื่อซ้ำ 
    const labelToId = new Map();   // "PC650004 | ชื่อ" -> idx
    const idToCustomer = new Map(); // idx -> object { idx, personid, fname, ... }


    const debounce = (fn, delay = 300) => {
        let t;
        return (...a) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...a), delay);
        };
    };

    if (billDateInput) {
        billDateInput.addEventListener('change', (e) => {
            const iso = e.target.value; // YYYY-MM-DD
            if (!currentBillData) currentBillData = {};
            currentBillData.bill_date = iso;
            // อัปเดตข้อความที่แสดงในเอกสาร
            document.querySelectorAll('.bill-date')
                .forEach(el => el.textContent = formatLongThaiDate(iso) || '-');
            document.querySelectorAll('.signature-date')
                .forEach(el => el.textContent = formatLongThaiDate(iso) || '-');
        });
    }

    const updateBtn = document.createElement('button'); // สร้างปุ่ม Update เตรียมไว้
    updateBtn.id = 'updateBillBtn';
    updateBtn.className = 'bg-amber-600 text-white px-6 py-2 rounded-md hover:bg-amber-700 hidden';
    updateBtn.textContent = '🔄 อัปเดตใบวางบิล';

    let currentEditingBillNumber = null;

    let customersCache = [];
    let currentBillData = null;

    // --- Functions ---

    // load all customer list Autocomplete
    async function loadAllCustomers() {
        try {
            const res = await fetch('/api/customers/all');
            if (!res.ok) throw new Error('Cannot load customers');
            customersCache = await res.json();

            labelToId.clear(); idToCustomer.clear();

            const toLabel = (c) => {
                const code = (c.personid ?? '').trim();
                const name = (c.fname ?? c.customer_name ?? '').trim();
                return `${code}${code && name ? ' | ' : (name ? ' | ' : '')}${name}`;
            };

            customerList.innerHTML = customersCache.map(c => {
                const label = toLabel(c);
                labelToId.set(label, c.idx);
                idToCustomer.set(c.idx, c);
                return `<option value="${label}"></option>`;
            }).join('');
        } catch (err) { console.error(err); }
    }
    // ตัวช่วย: หา customer จากค่าที่ผู้ใช้พิมพ์ (รองรับทั้ง “รหัส”, “ชื่อ”, หรือ “รหัส | ชื่อ”)
    function resolveCustomerSelection() {
        const raw = (customerSearch.value || '').trim();
        // normalize ช่องว่างรอบเครื่องหมาย | ให้เหมือนกับ label ใน datalist
        const val = raw.replace(/\s*\|\s*/g, ' | ');

        if (labelToId.has(val)) {
            const idx = labelToId.get(val);
            customerIdInput.value = idx;

            const c = idToCustomer.get(idx);
            const fixedLabel = `${(c.personid ?? '').trim()} | ${(c.fname ?? c.customer_name ?? '').trim()}`;
            if (val !== fixedLabel) customerSearch.value = fixedLabel; // แสดงรูปแบบมาตรฐาน
        } else {
            customerIdInput.value = ''; // ไม่ตรง = บังคับให้เลือกใหม่
        }
    }

    // แนะนำข้อความในช่องหมายเหตุใบวางบิล
    async function suggestBillNotes() {
        const query = searchQueryInput.value.trim();
        if (query.length < 2) {
            billNoteList.innerHTML = '';
            return;
        }

        try {
            const res = await fetch(`/api/suggest/bill-notes?q=${encodeURIComponent(query)}`);
            if (!res.ok) return;
            const suggestions = await res.json();

            billNoteList.innerHTML = suggestions
                .map(s => `<option value="${s}"></option>`)
                .join('');
        } catch (error) {
            console.error('Suggestion fetch error:', error);
        }
    }

    // สร้างใบวางบิล
    async function generateBill() {
        const billContainer = document.getElementById('bill-note-container');
        const custId = customerIdInput.value;
        const start = startDateInput.value;
        const end = endDateInput.value;

        if (!custId || !start || !end) {
            alert('กรุณาเลือกลูกค้าและช่วงวันที่ให้ครบถ้วน');
            return;
        }

        loadingDiv.style.display = 'block';
        generateBtn.disabled = true;
        if (billContainer) billContainer.style.display = 'none';

        try {
            const params = new URLSearchParams({
                customer_id: custId,
                start: start,
                end: end
            });
            const res = await fetch(`/api/billing-note-invoices?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch invoice data');
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            // 1. อ่านวันที่ที่ผู้ใช้เลือก (จากตัวแปร billDateInput ที่ประกาศไว้บนสุดของไฟล์)
            const selectedBillDate = (billDateInput && billDateInput.value)
                ? billDateInput.value
                : new Date().toISOString().split('T')[0]; // ถ้าไม่มี ให้ใช้วันนี้

            // 2. กำหนดวันที่นี้ให้กับ object 'data' ที่จะใช้แสดงผล
            data.bill_date = selectedBillDate;

            // 3. (โค้ดเดิม) คำนวณ payment_duedate
            if (data.invoices && data.invoices.length > 0) {
                const latestInvoiceDate = data.invoices.reduce((max, inv) =>
                    inv.due_date > max ? inv.due_date : max,
                    data.invoices[0].due_date
                );
                data.payment_duedate = latestInvoiceDate;
            } else {
                data.payment_duedate = null;
            }

            currentBillData = data;

            await renderBillDocument(data);

            document.querySelectorAll('.bill-date')
                .forEach(el => el.textContent = formatLongThaiDate(billDateInput.value) || '-');


        } catch (error) {
            console.error(error);
            alert('เกิดข้อผิดพลาดในการสร้างใบวางบิล: ' + error.message);
        } finally {
            loadingDiv.style.display = 'none';
            generateBtn.disabled = false;
        }
        if (billContainer) billContainer.style.display = 'block';
    }

    async function saveBillNote() {
        const billDateInput = document.getElementById('billDate');
        const billISO = (billDateInput && billDateInput.value)
            ? billDateInput.value
            : new Date().toISOString().split('T')[0];
        if (!currentBillData) { alert('ไม่มีข้อมูลใบวางบิลสำหรับบันทึก'); return; }

        // 1. เตรียมข้อมูลที่จะส่งไป Backend
        const payload = {
            customer_id: parseInt(document.getElementById('customerId').value, 10),
            bill_date: billISO,
            items: currentBillData.invoices.map(inv => ({
                invoice_number: inv.invoice_number,
                invoice_date: inv.invoice_date,
                due_date: inv.due_date,
                amount: inv.amount
            })),
            total_amount: currentBillData.summary.total_amount
        };

        saveBtn.disabled = true;
        saveBtn.textContent = 'กำลังบันทึก...';

        try {
            const res = await fetch('/api/billing-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || 'การบันทึกล้มเหลว');
            }

            const result = await res.json();
            document.querySelectorAll('.bill-number').forEach(el => {
                el.textContent = result.billnote_number;
            });
            alert(`บันทึกใบวางบิลสำเร็จ!\nเลขที่เอกสาร: ${result.billnote_number}`);

            // ซ่อนปุ่มบันทึกหลังบันทึกสำเร็จ เพื่อป้องกันการบันทึกซ้ำ
            saveBtn.style.display = 'none';

        } catch (error) {
            console.error(error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 บันทึกใบวางบิล';
        }
    }

    // แสดงผลข้อมูลลงใน Template
    function renderBillDocument(data) {
        const container = document.getElementById('bill-note-container');
        const template = document.getElementById('bill-note-template');
        container.innerHTML = ''; // ล้างข้อมูลเก่า

        const ITEMS_PER_PAGE = 12;
        const totalPages = Math.ceil(data.invoices.length / ITEMS_PER_PAGE) || 1;

        const billDateInputEl = document.getElementById('billDate');
        const billISO = (billDateInputEl && billDateInputEl.value)
            ? billDateInputEl.value
            : (data.bill_date || new Date().toISOString().slice(0, 10));

        for (let i = 0; i < totalPages; i++) {
            const pageNode = template.content.cloneNode(true);
            const pageElement = pageNode.querySelector('.A4-page');

            const startIdx = i * ITEMS_PER_PAGE;
            const endIdx = startIdx + ITEMS_PER_PAGE;
            const pageInvoices = data.invoices.slice(startIdx, endIdx);

            // --- เติมข้อมูล Header และ Customer (เหมือนกันทุกหน้า) ---
            pageElement.querySelector('.cust-person-id').textContent = data.customer.person_id || '-';
            pageElement.querySelector('.cust-name').textContent = data.customer.name || '-';
            pageElement.querySelector('.cust-address').textContent = data.customer.address || '-';
            pageElement.querySelector('.cust-tax-id').textContent = data.customer.tax_id || '-';
            pageElement.querySelector('.cust-branch').textContent = data.customer.branch || '-';

            // --- เติมข้อมูลเฉพาะของแต่ละหน้า ---
            pageElement.querySelector('.bill-number').textContent = data.bill_note_number || '(ยังไม่ได้บันทึก)';
            pageElement.querySelector('.bill-date').textContent = formatLongThaiDate(billISO) || '-';

            // ใส่วันที่ลงใน <span class="signature-date">
            const signatureDate = pageElement.querySelector('.signature-date');
            if (signatureDate) {
                signatureDate.textContent = formatLongThaiDate(billISO) || '-';
            }

            pageElement.querySelector('.page-number').textContent = `${i + 1} / ${totalPages}`;
            pageElement.querySelector('.payment-due-date').textContent = formatLongThaiDate(data.payment_duedate) || '-';

            // --- เติมรายการ Invoice ในตาราง ---
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
                    <td class="p-2 text-right">${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                `;
                tableBody.appendChild(tr);
            });

            // --- แสดงยอดรวมและตัวอักษรเฉพาะหน้าสุดท้าย ---
            if (i === totalPages - 1) {
                pageElement.querySelector('.summary-footer').classList.remove('hidden');
                pageElement.querySelector('.summary-total').textContent = data.summary.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 });

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

    function formatDate(isoDate) {
        if (!isoDate) return '-';
        const d = new Date(isoDate);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear() + 543;
        return `${day}/${month}/${String(year).slice(-2)}`;
    }

    function formatLongThaiDate(isoDate) {
        if (!isoDate) return null;
        const d = new Date(isoDate);

        // ใช้ toLocaleDateString ของ Browser เพื่อแปลงเป็นรูปแบบภาษาไทย
        // จะได้ผลลัพธ์เช่น "6 ตุลาคม 2025"
        const formattedDate = d.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC' // ป้องกันปัญหา Timezone ทำให้วันที่ผิดเพี้ยน
        });

        // แปลงปี ค.ศ. เป็น พ.ศ. โดยการแทนที่ตัวเลขปี
        const adYear = d.getFullYear();
        const beYear = adYear + 543;

        return formattedDate.replace(String(adYear), String(beYear));
    }

    function thaiBahtText(num) {
        num = Number(num).toFixed(2);
        let [integerPart, fractionalPart] = num.split('.');

        const THAI_NUMBERS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
        const UNIT_MAP = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

        const readChunk = (chunk) => {
            let result = '';
            const len = chunk.length;
            for (let i = 0; i < len; i++) {
                const digit = parseInt(chunk[i]);
                if (digit === 0) continue;

                const position = len - i - 1;
                if (position === 1 && digit === 2) {
                    result += 'ยี่';
                } else if (position === 1 && digit === 1) {
                    // No number needed for ten
                } else if (position === 0 && digit === 1 && len > 1) {
                    result += 'เอ็ด';
                } else {
                    result += THAI_NUMBERS[digit];
                }
                result += UNIT_MAP[position];
            }
            return result;
        };

        let integerText = '';
        if (integerPart === '0') {
            integerText = 'ศูนย์';
        } else {
            const millions = Math.floor(integerPart.length / 6);
            const remainder = integerPart.length % 6;
            let start = 0;
            if (remainder > 0) {
                integerText += readChunk(integerPart.substring(0, remainder)) + (millions > 0 ? 'ล้าน' : '');
                start = remainder;
            }
            for (let i = 0; i < millions; i++) {
                integerText += readChunk(integerPart.substring(start + i * 6, start + (i + 1) * 6)) + (i < millions - 1 ? 'ล้าน' : '');
            }
        }
        integerText += 'บาท';

        let fractionalText = '';
        if (fractionalPart === '00') {
            fractionalText = 'ถ้วน';
        } else {
            fractionalText = readChunk(fractionalPart) + 'สตางค์';
        }

        return integerText + fractionalText;
    }
    function switchTab(target) {
        if (target === 'create') {
            tabCreate.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600';
            tabSearch.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
            panelCreate.style.display = 'block';
            panelSearch.style.display = 'none';
        } else {
            tabSearch.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600';
            tabCreate.className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
            panelSearch.style.display = 'block';
            panelCreate.style.display = 'none';
            document.getElementById('bill-note-container').innerHTML = ''; // ล้างเอกสารเมื่อสลับไปหน้าค้นหา
        }
    }

    // vvvvvv เพิ่มฟังก์ชันค้นหาใบวางบิล vvvvvv
    async function searchBillNotes() {
        const start = document.getElementById('searchStartDate').value;
        const end = document.getElementById('searchEndDate').value;
        const q = document.getElementById('searchQuery').value;

        const params = new URLSearchParams({ start, end, q });
        const res = await fetch(`/api/search-billing-notes?${params.toString()}`);
        const results = await res.json();

        searchResultsBody.innerHTML = '';
        if (results.length === 0) {
            searchResultsBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">ไม่พบข้อมูล</td></tr>';
            return;
        }

        results.forEach(bill => {
            const tr = document.createElement('tr');
            tr.className = 'border-b';
            tr.innerHTML = `
                <td class="p-2">${formatDate(bill.bill_date)}</td>
                <td class="p-2">${bill.billnote_number}</td>
                <td class="p-2">${bill.fname}</td>
                <td class="p-2 text-center">
                    <button class="btn-view-edit text-blue-600 hover:underline text-sm" data-bill-number="${bill.billnote_number}">ดู/แก้ไข</button>
                    <button class="btn-delete text-red-600 hover:underline text-sm ml-2" data-bill-number="${bill.billnote_number}">ลบ</button>
                </td>
            `;
            searchResultsBody.appendChild(tr);
        });
    }

    // vvvvvv เพิ่มฟังก์ชันโหลดใบวางบิลมาแสดงเพื่อแก้ไข vvvvvv
    async function loadBillForEditing(billNumber) {
        currentEditingBillNumber = billNumber;
        const res = await fetch(`/api/billing-notes/${billNumber}`);
        if (!res.ok) {
            alert('ไม่สามารถโหลดข้อมูลใบวางบิลได้');
            return;
        }
        const data = await res.json();
        currentBillData = data;

        renderBillDocument(data);

        // sync input
        const selectedBillDate = (billDateInput && billDateInput.value)
            ? billDateInput.value
            : new Date().toISOString().split('T')[0];
        data.bill_date = selectedBillDate;

        // สลับปุ่มเป็นโหมดแก้ไข
        saveBtn.style.display = 'none';
        updateBtn.style.display = 'inline-block';
        printBtn.style.display = 'inline-block';

        switchTab('create');

        // เพิ่มปุ่มลบรายการในตาราง
        document.querySelectorAll('.invoice-table-body tr').forEach(tr => {
            const deleteCell = document.createElement('td');
            deleteCell.className = 'p-2 text-center noprint';
            deleteCell.innerHTML = '<button class="btn-remove-item text-red-500">✖</button>';
            tr.appendChild(deleteCell);
        });
    }

    // add function update bill note data 
    async function updateBillNote() {
        if (!currentEditingBillNumber) return;

        // เก็บรายการที่ยังอยู่ในตาราง
        const items = [];
        document.querySelectorAll('.invoice-table-body tr').forEach(tr => {
            const inv = currentBillData.invoices.find(i => i.invoice_number === tr.dataset.invNumber);
            if (inv) {
                items.push({
                    invoice_number: inv.invoice_number,
                    invoice_date: inv.invoice_date,
                    due_date: inv.due_date,
                    amount: inv.amount
                });
            }
        });

        // รวมยอดใหม่ หลังแก้ไข
        const total_amount = items.reduce((sum, it) => sum + Number(it.amount || 0), 0);

        // อ่านวันจาก input (YYYY-MM-DD)
        const billDateInput = document.getElementById('billDate');
        const bill_date = billDateInput && billDateInput.value ? billDateInput.value : new Date().toISOString().split('T')[0];

        // ไม่บังคับ customer_id/total_amount 
        const cid = parseInt(document.getElementById('customerId')?.value, 10);
        const customer_id = Number.isFinite(cid) ? cid : undefined;

        const payload = { items, total_amount, bill_date, customer_id };

        const res = await fetch(`/api/billing-notes/${currentEditingBillNumber}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert('อัปเดตใบวางบิลสำเร็จ!');
            loadBillForEditing(currentEditingBillNumber);
        } else {
            const err = await res.json().catch(() => ({}));
            alert('การอัปเดตล้มเหลว: ' + (err.detail || res.statusText));
        }
    }

    // --- Event Listeners ---
    // กรองรายการใน datalist ขณะพิมพ์ ให้เจอทั้ง prefix ของรหัสและบางส่วนของชื่อ
    customerSearch.addEventListener('input', () => {
        const q = (customerSearch.value || '').toLowerCase().trim();
        if (!q) return;
        const filtered = customersCache.filter(c => {
            const pid = (c.personid ?? '').toLowerCase();
            const name = (c.fname ?? c.customer_name ?? '').toLowerCase();
            return pid.startsWith(q) || name.includes(q);
        }).slice(0, 50);
        customerList.innerHTML = filtered.map(c => {
            const label = `${(c.personid ?? '').trim()} | ${(c.fname ?? c.customer_name ?? '').trim()}`;
            return `<option value="${label}"></option>`;
        }).join('');
    });


    // ให้ทำงานทั้งตอน change/blur/กด Enter
    customerSearch.addEventListener('change', resolveCustomerSelection);
    customerSearch.addEventListener('blur', resolveCustomerSelection);
    customerSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') resolveCustomerSelection();
    });

    generateBtn.addEventListener('click', generateBill);
    printBtn.addEventListener('click', () => window.print());
    saveBtn.addEventListener('click', saveBillNote);
    tabCreate.addEventListener('click', () => switchTab('create'));
    tabSearch.addEventListener('click', () => switchTab('search'));
    searchBillBtn.addEventListener('click', searchBillNotes);
    updateBtn.addEventListener('click', updateBillNote);

    searchQueryInput.addEventListener('input', debounce(suggestBillNotes, 300));

    searchResultsBody.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-view-edit')) {
            const billNumber = e.target.dataset.billNumber;
            await loadBillForEditing(billNumber);
        }
        if (e.target.classList.contains('btn-delete')) {
            const billNumber = e.target.dataset.billNumber;
            if (confirm(`คุณต้องการลบใบวางบิลเลขที่ ${billNumber} ใช่หรือไม่?`)) {
                const res = await fetch(`/api/billing-notes/${billNumber}`, { method: 'DELETE' });
                if (res.ok) {
                    alert('ลบสำเร็จ!');
                    searchBillNotes(); // โหลดผลลัพธ์ใหม่
                } else {
                    alert('การลบล้มเหลว');
                }
            }
        }
    });

    document.getElementById('bill-note-container').addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove-item')) {
            e.target.closest('tr').remove();
        }
    });

    // --- Initial Load ---
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];

    // กัน null
    if (billDateInput) billDateInput.value = todayISO;
    if (endDateInput) endDateInput.value = todayISO;

    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (startDateInput) startDateInput.value = firstOfMonth.toISOString().split('T')[0];

    loadAllCustomers();
    saveBtn.parentElement.appendChild(updateBtn);
});