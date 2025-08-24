// === CONFIG ===
const API_URL = "/api/invoices/summary";
const API_LIST = "/api/invoices";
const API_ITEMS = (id) => `/api/invoices/${id}/items`;
const API_DETAIL = (id) => `/api/invoices/${id}/detail`;
const API_SAVE = (id) => `/api/invoices/${id}`;


// === Utilities ===
const fmtNum = (n) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => (Number.isFinite(n) ? n : 0).toLocaleString();

function ymd(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
function firstDayOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

// === State ===
let state = {
    granularity: "day",
    dayFrom: null, dayTo: null,
    monthPick: null,
    yearPick: null,
    rows: [],

    // all invoices
    allRows: [],
};

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
    const today = new Date();
    document.getElementById("dayFrom").value = ymd(firstDayOfMonth(today));
    document.getElementById("dayTo").value = ymd(lastDayOfMonth(today));
    document.getElementById("monthPick").value = ymd(today).slice(0, 7);
    document.getElementById("yearPick").value = String(today.getFullYear());

    // default filters for ALL tab
    const allFrom = document.getElementById("allFrom");
    const allTo = document.getElementById("allTo");
    if (allFrom && allTo) {
        allFrom.value = ymd(firstDayOfMonth(today));
        allTo.value = ymd(lastDayOfMonth(today));
    }

    // granularity buttons
    document.querySelectorAll(".btn-gran").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".btn-gran").forEach(b => b.classList.remove("bg-blue-600", "text-white"));
            btn.classList.add("bg-blue-600", "text-white");
            state.granularity = btn.dataset.granularity;
            toggleFilterGroup();
        });
    });

    // Summary actions
    document.getElementById("btnApply").addEventListener("click", applyFilter);
    document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

    // Tabs
    document.getElementById("tabSummary").addEventListener("click", () => switchTab("summary"));
    document.getElementById("tabAll").addEventListener("click", () => switchTab("all"));

    // All invoices actions
    document.getElementById("btnAllApply").addEventListener("click", loadAllInvoices);

    // Modal handlers
    document.getElementById("modalClose").addEventListener("click", () => toggleModal(false));
    document.getElementById("itemsModal").addEventListener("click", (e) => {
        if (e.target.id === "itemsModal") toggleModal(false);
    });

    toggleFilterGroup();
    applyFilter();       // load summary
    loadAllInvoices();   // load all invoices
});

function switchTab(which) {
    const tabSummary = document.getElementById("tabSummary");
    const tabAll = document.getElementById("tabAll");
    const panelSummary = document.getElementById("panelSummary");
    const panelAll = document.getElementById("panelAll");

    if (which === "summary") {
        tabSummary.classList.add("bg-blue-600", "text-white");
        tabAll.classList.remove("bg-blue-600", "text-white");
        panelSummary.classList.remove("hidden");
        panelAll.classList.add("hidden");
    } else {
        tabAll.classList.add("bg-blue-600", "text-white");
        tabSummary.classList.remove("bg-blue-600", "text-white");
        panelAll.classList.remove("hidden");
        panelSummary.classList.add("hidden");
    }
}

function toggleFilterGroup() {
    const g = state.granularity;
    document.getElementById("filter-day").classList.toggle("hidden", g !== "day");
    document.getElementById("filter-month").classList.toggle("hidden", g !== "month");
    document.getElementById("filter-year").classList.toggle("hidden", g !== "year");
}

// ===== Summary =====
async function applyFilter() {
    readFilters();

    const params = new URLSearchParams();
    params.set("granularity", state.granularity);

    let filterText = "";
    if (state.granularity === "day") {
        params.set("start", state.dayFrom);
        params.set("end", state.dayTo);
        filterText = `รายวัน: ${state.dayFrom} ถึง ${state.dayTo}`;
    } else if (state.granularity === "month") {
        params.set("month", state.monthPick);
        filterText = `รายเดือน: ${state.monthPick}`;
    } else {
        params.set("year", state.yearPick);
        filterText = `รายปี: ${state.yearPick}`;
    }
    document.getElementById("currentFilter").textContent = filterText;

    try {
        const res = await fetch(`${API_URL}?${params.toString()}`, { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        state.rows = Array.isArray(data) ? data : [];
        renderSummaryTable();
    } catch (err) {
        console.error(err);
        state.rows = [];
        renderSummaryTable();
        alert("ดึงข้อมูลสรุปไม่สำเร็จ");
    }
}

function readFilters() {
    const g = state.granularity;
    if (g === "day") {
        state.dayFrom = document.getElementById("dayFrom").value || null;
        state.dayTo = document.getElementById("dayTo").value || null;
    } else if (g === "month") {
        state.monthPick = document.getElementById("monthPick").value || null;
    } else {
        state.yearPick = document.getElementById("yearPick").value || null;
    }
}

function renderSummaryTable() {
    const body = document.getElementById("summaryBody");
    body.innerHTML = "";

    let sumCount = 0, sumAmount = 0, sumDiscount = 0, sumBeforeVat = 0, sumVat = 0, sumGrand = 0;

    for (const r of state.rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td class="px-3 py-2 text-sm border-b">${r.period ?? "-"}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtInt(r.count)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.amount)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.discount)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.before_vat)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.vat)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.grand)}</td>
    `;
        body.appendChild(tr);

        sumCount += Number(r.count) || 0;
        sumAmount += Number(r.amount) || 0;
        sumDiscount += Number(r.discount) || 0;
        sumBeforeVat += Number(r.before_vat) || 0;
        sumVat += Number(r.vat) || 0;
        sumGrand += Number(r.grand) || 0;
    }

    document.getElementById("sum_count").textContent = fmtInt(sumCount);
    document.getElementById("sum_amount").textContent = fmtNum(sumAmount);
    document.getElementById("sum_discount").textContent = fmtNum(sumDiscount);
    document.getElementById("sum_before_vat").textContent = fmtNum(sumBeforeVat);
    document.getElementById("sum_vat").textContent = fmtNum(sumVat);
    document.getElementById("sum_grand").textContent = fmtNum(sumGrand);
}

function exportCsv() {
    const header = ["period", "count", "amount", "discount", "before_vat", "vat", "grand"];
    const lines = [header.join(",")];
    for (const r of state.rows) {
        lines.push([
            r.period ?? "",
            Number(r.count) || 0,
            Number(r.amount) || 0,
            Number(r.discount) || 0,
            Number(r.before_vat) || 0,
            Number(r.vat) || 0,
            Number(r.grand) || 0
        ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "invoice_summary.csv";
    a.click();
    URL.revokeObjectURL(a.href);
}

// ===== All invoices =====
async function loadAllInvoices() {
    const params = new URLSearchParams();
    const f = document.getElementById("allFrom")?.value;
    const t = document.getElementById("allTo")?.value;
    const q = document.getElementById("allQ")?.value?.trim();

    if (f) params.set("start", f);
    if (t) params.set("end", t);
    if (q) params.set("q", q);

    try {
        const res = await fetch(`${API_LIST}?${params.toString()}`, { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        state.allRows = Array.isArray(data) ? data : [];
        renderAllTable();
    } catch (err) {
        console.error(err);
        state.allRows = [];
        renderAllTable();
        alert("ดึงรายการใบกำกับไม่สำเร็จ");
    }
}

function renderAllTable() {
    const body = document.getElementById("allBody");
    body.innerHTML = "";

    for (const r of state.allRows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td class="px-3 py-2 text-sm border-b">${r.invoice_date ?? "-"}</td>
      <td class="px-3 py-2 text-sm border-b">${r.invoice_number ?? "-"}</td>
      <td class="px-3 py-2 text-sm border-b">${r.fname ?? "-"}</td>
      <td class="px-3 py-2 text-sm border-b">${r.po_number ?? "-"}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.amount)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.vat)}</td>
      <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(r.grand)}</td>
      <td class="px-3 py-2 text-sm text-center border-b">
        <div class="inline-flex gap-2">
          <button class="px-3 py-1 rounded bg-white border hover:bg-green-50" data-edit="${r.idx}">ดู/แก้ไข</button>
          <button class="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700" data-items="${r.idx}">สินค้า</button>
        </div>
      </td>
    `;
        body.appendChild(tr);
    }

    body.querySelectorAll("button[data-items]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-items");
            await openItemsModal(id);
        });
    });

    body.querySelectorAll("button[data-edit]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-edit");
            // โหลดรายละเอียดบิล
            const res = await fetch(API_DETAIL(id), { headers: { "Accept": "application/json" } });
            if (!res.ok) { alert("โหลดรายละเอียดบิลไม่สำเร็จ"); return; }
            const detail = await res.json(); // {invoice:{...}, items:[...]}
            // เก็บลง sessionStorage แล้วไปหน้า form.html
            sessionStorage.setItem("invoice_edit_data", JSON.stringify(detail));
            window.location.href = `/form.html?edit=${id}`;
        });
    });
}

async function openItemsModal(invId) {
    try {
        const res = await fetch(API_ITEMS(invId), { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error(await res.text());
        const items = await res.json();

        const tbody = document.getElementById("modalItemsBody");
        tbody.innerHTML = "";
        for (const it of items) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td class="px-3 py-2 text-sm border-b">${it.cf_itemid ?? ""}</td>
        <td class="px-3 py-2 text-sm border-b">${it.cf_itemname ?? ""}</td>
        <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(it.quantity)}</td>
        <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(it.unit_price)}</td>
        <td class="px-3 py-2 text-sm text-right border-b">${fmtNum(it.amount)}</td>
      `;
            tbody.appendChild(tr);
        }
        toggleModal(true);
    } catch (err) {
        console.error(err);
        alert("ดึงรายการสินค้าไม่สำเร็จ");
    }
}

function toggleModal(show) {
    const m = document.getElementById("itemsModal");
    m.classList.toggle("hidden", !show);
}

// ====== Edit Modal for summary invoice ======
let currentEditId = null;

document.getElementById("editClose").addEventListener("click", () => toggleEdit(false));
document.getElementById("em_close2").addEventListener("click", () => toggleEdit(false));
document.getElementById("em_save").addEventListener("click", saveEdit);
document.getElementById("em_addItem").addEventListener("click", () => addItemRow());

function toggleEdit(show) {
    document.getElementById("editModal").classList.toggle("hidden", !show);
    if (show) {
        document.getElementById("editModal").classList.add("flex");
    } else {
        document.getElementById("em_itemsBody").innerHTML = "";
        currentEditId = null;
    }
}

async function openEditModal(invId) {
    try {
        const res = await fetch(API_DETAIL(invId), { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        currentEditId = invId;
        fillEditHead(data.invoice || {});
        fillEditItems(data.items || []);
        toggleEdit(true);
    } catch (err) {
        console.error(err);
        alert("ดึงรายละเอียดใบกำกับไม่สำเร็จ");
    }
}

function fillEditHead(h) {
    document.getElementById("em_invoice_number").value = h.invoice_number ?? "";
    document.getElementById("em_invoice_date").value = (h.invoice_date ?? "").slice(0, 10);
    document.getElementById("em_po_number").value = h.po_number ?? "";
    document.getElementById("em_fname").value = h.fname ?? "";
    document.getElementById("em_personid").value = h.personid ?? "";
    document.getElementById("em_taxid").value = h.cf_taxid ?? "";
    document.getElementById("em_address").value = h.cf_personaddress ?? "";
    document.getElementById("em_zipcode").value = h.cf_personzipcode ?? "";
    document.getElementById("em_province").value = h.cf_provincename ?? "";
    document.getElementById("em_tel").value = h.tel ?? "";
    document.getElementById("em_mobile").value = h.mobile ?? "";
    document.getElementById("em_creditday").value = h.fmlpaymentcreditday ?? "";
    document.getElementById("em_due_date").value = (h.due_date ?? "").slice(0, 10);
    document.getElementById("em_car_plate").value = h.car_numberplate ?? "";
}

function fillEditItems(items) {
    const body = document.getElementById("em_itemsBody");
    body.innerHTML = "";
    for (const it of items) {
        addItemRow(it);
    }
}

function addItemRow(it = {}) {
    const body = document.getElementById("em_itemsBody");
    const tr = document.createElement("tr");

    tr.innerHTML = `
    <td class="px-2 py-1 border-b"><input class="w-full border rounded px-2 py-1" value="${it.cf_itemid ?? ''}"></td>
    <td class="px-2 py-1 border-b"><input class="w-full border rounded px-2 py-1" value="${it.cf_itemname ?? ''}"></td>
    <td class="px-2 py-1 border-b text-right"><input class="w-24 text-right border rounded px-2 py-1" value="${Number(it.quantity ?? 0)}"></td>
    <td class="px-2 py-1 border-b text-right"><input class="w-28 text-right border rounded px-2 py-1" value="${Number(it.unit_price ?? 0)}"></td>
    <td class="px-2 py-1 border-b text-right amount-cell">${fmtNum(Number(it.amount ?? (Number(it.quantity || 0) * Number(it.unit_price || 0))))}</td>
    <td class="px-2 py-1 border-b text-center">
      <button class="px-2 py-1 rounded bg-white border hover:bg-gray-50 btn-row-del">ลบ</button>
    </td>
  `;
    body.appendChild(tr);

    const qty = tr.children[2].querySelector("input");
    const price = tr.children[3].querySelector("input");
    const amtCell = tr.querySelector(".amount-cell");
    function recalc() {
        const q = parseFloat(qty.value || 0);
        const p = parseFloat(price.value || 0);
        amtCell.textContent = fmtNum(q * p);
    }
    qty.addEventListener("input", recalc);
    price.addEventListener("input", recalc);

    tr.querySelector(".btn-row-del").addEventListener("click", () => tr.remove());
}

async function saveEdit() {
    if (!currentEditId) return;

    // เก็บหัวบิล
    const head = {
        invoice_number: document.getElementById("em_invoice_number").value?.trim() || null,
        invoice_date: document.getElementById("em_invoice_date").value || null,
        po_number: document.getElementById("em_po_number").value?.trim() || null,
        fname: document.getElementById("em_fname").value?.trim() || null,
        personid: document.getElementById("em_personid").value?.trim() || null,
        cf_taxid: document.getElementById("em_taxid").value?.trim() || null,
        cf_personaddress: document.getElementById("em_address").value?.trim() || null,
        cf_personzipcode: document.getElementById("em_zipcode").value?.trim() || null,
        cf_provincename: document.getElementById("em_province").value?.trim() || null,
        tel: document.getElementById("em_tel").value?.trim() || null,
        mobile: document.getElementById("em_mobile").value?.trim() || null,
        fmlpaymentcreditday: parseInt(document.getElementById("em_creditday").value || 0) || null,
        due_date: document.getElementById("em_due_date").value || null,
        car_numberplate: document.getElementById("em_car_plate").value?.trim() || null,
    };

    // เก็บรายการสินค้า
    const items = [];
    document.querySelectorAll("#em_itemsBody tr").forEach(tr => {
        const tds = tr.querySelectorAll("td");
        const cf_itemid = tds[0].querySelector("input").value.trim();
        const cf_itemname = tds[1].querySelector("input").value.trim();
        const quantity = parseFloat(tds[2].querySelector("input").value || 0);
        const unit_price = parseFloat(tds[3].querySelector("input").value || 0);
        items.push({ cf_itemid, cf_itemname, quantity, unit_price });
    });

    try {
        const res = await fetch(API_SAVE(currentEditId), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...head, items })
        });
        if (!res.ok) throw new Error(await res.text());
        toggleEdit(false);
        await loadAllInvoices();   // รีโหลดตาราง
        alert("บันทึกเรียบร้อย");
    } catch (err) {
        console.error(err);
        alert("บันทึกไม่สำเร็จ: " + err.message);
    }
}

payload.variant = document.getElementById('variant')?.value || 'invoice_original'; 
// หรือกำหนดเป็น 'invoice_original' ไปเลยถ้าไม่มีตัวเลือกบนหน้านั้น
window.location.href = `/form?edit=${id}`;
