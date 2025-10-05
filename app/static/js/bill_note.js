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
    const billDocument = document.getElementById('bill-note-document');
    const saveBtn = document.getElementById('saveBillBtn');

    let customersCache = [];
    let currentBillData = null;

    // --- Functions ---

    // โหลดรายชื่อลูกค้าทั้งหมดสำหรับ Autocomplete
    async function loadAllCustomers() {
        try {
            const res = await fetch('/api/customers/all');
            if (!res.ok) throw new Error('Cannot load customers');
            customersCache = await res.json();

            customerList.innerHTML = customersCache
                .map(c => `<option value="${c.customer_name}" data-id="${c.idx}"></option>`)
                .join('');
        } catch (error) {
            console.error(error);
        }
    }

    // เมื่อเลือกลูกค้าจาก Datalist
    function onCustomerSelect() {
        const selectedOption = Array.from(customerList.options).find(
            option => option.value === customerSearch.value
        );
        if (selectedOption) {
            customerIdInput.value = selectedOption.dataset.id;
        } else {
            customerIdInput.value = '';
        }
    }

    // สร้างใบวางบิล
    async function generateBill() {
        const custId = customerIdInput.value;
        const start = startDateInput.value;
        const end = endDateInput.value;

        if (!custId || !start || !end) {
            alert('กรุณาเลือกลูกค้าและช่วงวันที่ให้ครบถ้วน');
            return;
        }

        loadingDiv.style.display = 'block';
        generateBtn.disabled = true;
        billDocument.style.display = 'none';

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

            currentBillData = data;
            renderBillDocument(data);

        } catch (error) {
            console.error(error);
            alert('เกิดข้อผิดพลาดในการสร้างใบวางบิล: ' + error.message);
        } finally {
            loadingDiv.style.display = 'none';
            generateBtn.disabled = false;
        }
    }

    async function saveBillNote() {
        if (!currentBillData) {
            alert('ไม่มีข้อมูลใบวางบิลสำหรับบันทึก');
            return;
        }

        // 1. เตรียมข้อมูลที่จะส่งไป Backend
        const payload = {
            customer_id: parseInt(document.getElementById('customerId').value, 10),
            bill_date: new Date().toISOString().split('T')[0], // ใช้วันที่ปัจจุบัน
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
            document.getElementById('bill-number').textContent = result.billnote_number;
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
        // Customer Info
        document.getElementById('cust-person-id').textContent = data.customer.person_id || '-';
        document.getElementById('cust-name').textContent = data.customer.name || '-';
        document.getElementById('cust-address').textContent = data.customer.address || '-';
        document.getElementById('cust-tax-id').textContent = data.customer.tax_id || '-';
        document.getElementById('cust-branch').textContent = data.customer.branch || '-';

        // Bill Info
        document.getElementById('bill-date').textContent = new Date().toLocaleDateString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Invoice Table
        const tableBody = document.getElementById('invoice-table-body');
        tableBody.innerHTML = '';
        data.invoices.forEach((inv, index) => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-300';
            tr.innerHTML = `
                <td class="p-2 text-center">${index + 1}</td>
                <td class="p-2 text-left">${inv.invoice_number}</td>
                <td class="p-2 text-center">${formatDate(inv.invoice_date)}</td>
                <td class="p-2 text-center">${formatDate(inv.due_date)}</td>
                <td class="p-2 text-right">${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            `;
            tableBody.appendChild(tr);
        });

        // Summary
        const totalAmount = data.summary.total_amount;
        document.getElementById('summary-total').textContent = totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 });

        // Convert number to Thai Baht text
        document.getElementById('total-in-words').textContent = `(ตัวอักษร: ${thaiBahtText(totalAmount)})`;


        billDocument.style.display = 'block';
        printBtn.style.display = 'inline-block';
        saveBtn.style.display = 'inline-block';
    }

    function formatDate(isoDate) {
        if (!isoDate) return '-';
        const d = new Date(isoDate);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear() + 543;
        return `${day}/${month}/${String(year).slice(-2)}`;
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

    // --- Event Listeners ---
    customerSearch.addEventListener('change', onCustomerSelect);
    generateBtn.addEventListener('click', generateBill);
    printBtn.addEventListener('click', () => window.print());
    saveBtn.addEventListener('click', saveBillNote);

    // --- Initial Load ---
    const today = new Date();
    endDateInput.value = today.toISOString().split('T')[0];
    today.setDate(1);
    startDateInput.value = today.toISOString().split('T')[0];
    loadAllCustomers();
});