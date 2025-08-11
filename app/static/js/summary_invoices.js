// === CONFIG ===
const API_URL = "/api/invoices/summary";

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
};

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
    const today = new Date();
    document.getElementById("dayFrom").value = ymd(firstDayOfMonth(today));
    document.getElementById("dayTo").value = ymd(lastDayOfMonth(today));
    document.getElementById("monthPick").value = ymd(today).slice(0, 7);
    document.getElementById("yearPick").value = String(today.getFullYear());

    document.querySelectorAll(".btn-gran").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".btn-gran").forEach(b => b.classList.remove("bg-blue-600", "text-white"));
            btn.classList.add("bg-blue-600", "text-white");
            state.granularity = btn.dataset.granularity;
            toggleFilterGroup();
        });
    });

    document.getElementById("btnApply").addEventListener("click", applyFilter);
    document.getElementById("btnExportCsv").addEventListener("click", exportCsv);

    toggleFilterGroup();
    applyFilter();
});

function toggleFilterGroup() {
    const g = state.granularity;
    document.getElementById("filter-day").classList.toggle("hidden", g !== "day");
    document.getElementById("filter-month").classList.toggle("hidden", g !== "month");
    document.getElementById("filter-year").classList.toggle("hidden", g !== "year");
}

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
        renderTable();
    } catch (err) {
        console.error(err);
        state.rows = [];
        renderTable();
        alert("ดึงข้อมูลสรุปไม่สำเร็จ");
    }
}

function readFilters() {
    const g = state.granularity;
    if (g === "day") {
        state.dayFrom = document.getElementById("dayFrom").value || null;
        state.dayTo = document.getElementById("dayTo").value || null;
    } else if (g === "month") {
        state.monthPick = document.getElementById("monthPick").value || null; // 'YYYY-MM'
    } else {
        state.yearPick = document.getElementById("yearPick").value || null;
    }
}

function renderTable() {
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
