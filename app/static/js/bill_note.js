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
        document.getElementById('summary-total').textContent = data.summary.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 });

        // --- ส่วนแปลงตัวเลขเป็นคำอ่าน (Thai Baht Text) ---
        // (ส่วนนี้อาจจะต้องใช้ไลบรารีหรือฟังก์ชันที่ซับซ้อนกว่านี้ ถ้าต้องการความแม่นยำสูง)
        document.getElementById('total-in-words').textContent = `(ตัวอักษร: ยอดเงินสุทธิ...บาทถ้วน)`; // Placeholder

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