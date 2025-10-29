// /static/js/saletax_report.js
const API_LIST = "/api/saletax/list";
const API_SUMMARY = "/api/saletax/summary";

const state = {
    granularity: "day",
    mode: "detail",     // detail | summary
    split: false,
    dayFrom: null, dayTo: null, month: null, year: null,
    rows: []
};

const $$ = sel => document.querySelector(sel);

document.addEventListener("DOMContentLoaded", () => {
    // toggle granularity buttons
    document.querySelectorAll(".rg").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelector('.rg[data-gran="day"]')?.classList.add("bg-white/20");
            // ให้แสดงชุดฟิลเตอร์ตรงกับโหมดเริ่มต้น
            toggleFilters();
            buildReport();
        });
    });

    // init default range (this month)
    const today = new Date();
    $$("#dayFrom").value = ymd(firstDayOfMonth(today));
    $$("#dayTo").value = ymd(lastDayOfMonth(today));
    $$("#monthPick").value = ymd(today).slice(0, 7);
    $$("#yearPick").value = String(today.getFullYear());

    // controls
    $$("#apply").addEventListener("click", buildReport);
    $$("#btnPrint").addEventListener("click", () => window.print());
    const btnExcel = document.getElementById("btnExcel");
    if (btnExcel) btnExcel.addEventListener("click", exportExcel);


    // mode/split
    $$("#mode").addEventListener("change", () => state.mode = $$("#mode").value);
    $$("#splitCompany").addEventListener("change", () => state.split = $$("#splitCompany").checked);
});

function toggleFilters() {
    const g = state.granularity;
    $$("#f-day").classList.toggle("hidden", g !== "day");
    $$("#f-month").classList.toggle("hidden", g !== "month");
    $$("#f-year").classList.toggle("hidden", g !== "year");
}

function readFilters() {
    state.mode = $$("#mode").value;
    state.split = $$("#splitCompany").checked;
    if (state.granularity === "day") {
        state.dayFrom = $$("#dayFrom").value || null;
        state.dayTo = $$("#dayTo").value || null;
    } else if (state.granularity === "month") {
        state.month = $$("#monthPick").value || null;
    } else {
        state.year = parseInt($$("#yearPick").value || "", 10) || null;
    }
}

// === util แปลงเดือน-ปีแบบไทย ===
function thaiMonthYear({ granularity, dayFrom, month, year }) {
    const thMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

    const toBE = y => (y + 543);
    if (granularity === "month" && month) {
        // month รูปแบบ YYYY-MM
        const [y, m] = month.split("-").map(x => parseInt(x, 10));
        return `${thMonths[(m || 1) - 1]} ปี ${toBE(y || new Date().getFullYear())}`;
    }
    if (granularity === "day" && dayFrom) {
        const d = new Date(dayFrom);
        return `${thMonths[d.getMonth()]} ปี ${toBE(d.getFullYear())}`;
    }
    // year หรือกรณีไม่ครบข้อมูล
    const y = year || new Date().getFullYear();
    return `ปี ${toBE(y)}`;
}


async function buildReport() {
    readFilters();
    // ตั้งหัวข้อย่อยและ month-year
    const monthYearText = thaiMonthYear({
        granularity: state.granularity,
        dayFrom: state.dayFrom,
        month: state.month,
        year: state.year
    });
    document.querySelector(".month-year").textContent = monthYearText;

    const g = state.granularity, mode = state.mode, split = state.split;

    // subtitle
    let sub = g === "day"
        ? `รายวัน: ${state.dayFrom || "-"} ถึง ${state.dayTo || "-"}`
        : (g === "month" ? `รายเดือน: ${state.month || "-"}` : `รายปี: ${state.year || "-"}`);
    if (split) sub += " • แยกรายบริษัท";
    $$("#subtitle").textContent = sub;

    // fetch
    try {
        let url, params = new URLSearchParams();
        if (g === "day") { if (state.dayFrom) params.set("start", state.dayFrom); if (state.dayTo) params.set("end", state.dayTo); }
        if (g === "month") { if (state.month) params.set("month", state.month); }
        if (g === "year") { if (state.year) params.set("year", state.year); }

        if (mode === "summary") {
            params.set("granularity", g);
            if (split) params.set("split_by_company", "true");
            url = `${API_SUMMARY}?${params}`;
        } else {
            url = `${API_LIST}?${params}`;
        }

        const res = await fetch(url, { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error(await res.text());
        const rows = await res.json();
        state.rows = Array.isArray(rows) ? rows : [];
        renderReport();
    } catch (e) {
        console.error(e);
        state.rows = [];
        renderReport();
        alert("ดึงข้อมูลรายงานไม่สำเร็จ");
    }
}

function renderReport() {
    const body = $$("#reportBody");
    body.innerHTML = "";
    let count = 0, before = 0, grand = 0;

    if (state.mode === "summary") {
        // ตารางสรุป: ไม่แยก / แยกบริษัท
        if (!state.split) {
            const table = makeTable(["ช่วงเวลา", "จำนวนใบกำกับ", "ก่อน VAT", "VAT", "รวมสุทธิ"]);
            state.rows.forEach(r => {
                count += +r.count || 0;
                before += +r.before_vat || 0;
                grand += +r.grand || 0;
                addRow(table.tbody, [
                    r.period || "-",
                    fmtInt(r.count),
                    fmtNum(r.before_vat),
                    fmtNum(r.vat),
                    fmtNum(r.grand)
                ]);
            });
            body.appendChild(table.wrap);
        } else {
            // แยกรายบริษัท -> กลุ่ม by period
            const groups = groupBy(state.rows, r => r.period || "-");
            Object.keys(groups).forEach(period => {
                const h = document.createElement("h3");
                h.className = "text-lg font-bold mb-2";
                h.textContent = `ช่วง: ${period}`;
                body.appendChild(h);

                const table = makeTable(["บริษัท", "จำนวนใบกำกับ", "ก่อน VAT", "VAT", "รวมสุทธิ"]);
                groups[period].forEach(r => {
                    count += +r.count || 0;
                    before += +r.before_vat || 0;
                    grand += +r.grand || 0;
                    addRow(table.tbody, [
                        r.company || "-",
                        fmtInt(r.count),
                        fmtNum(r.before_vat),
                        fmtNum(r.vat),
                        fmtNum(r.grand)
                    ]);
                });
                body.appendChild(table.wrap);
            });
        }
    } else {
        // รายงานละเอียด
        const g = state.granularity;
        // เติมคีย์ period ให้ใช้ grouping เหมือน summary
        state.rows.forEach(r => {
            const d = (r.invoice_date || "").slice(0, 10);
            if (g === "day") r.period = d;
            else if (g === "month") r.period = d.slice(0, 7);
            else r.period = d.slice(0, 4);
            r.vat = (r.before_vat || 0) * 0.07;
            r.grand = (r.before_vat || 0) + r.vat;
        });

        const keyFn = r => state.split ? `${r.period}||${r.company || "-"}` : (r.period || "-");
        const groups = groupBy(state.rows, keyFn);

        Object.keys(groups).forEach(k => {
            const [period, company] = state.split ? k.split("||") : [k, null];
            const head = document.createElement("div");
            head.className = "mb-2";
            head.innerHTML = `<div class="text-sm text-gray-500">${period}</div>` +
                (state.split ? `<h3 class="text-lg font-bold">${company}</h3>` : `<h3 class="text-lg font-bold">รายละเอียดใบกำกับ</h3>`);
            body.appendChild(head);

            const table = makeTable(["วันที่", "เลขที่", state.split ? null : "ลูกค้า", "ก่อน VAT", "VAT", "รวมสุทธิ"].filter(Boolean));
            groups[k].forEach(r => {
                count += 1; before += +r.before_vat || 0; grand += +r.grand || 0;
                addRow(table.tbody, [
                    r.invoice_date || "-",
                    r.invoice_number || "-",
                    state.split ? null : (r.company || "-"),
                    fmtNum(r.before_vat),
                    fmtNum(r.vat),
                    fmtNum(r.grand)
                ].filter(v => v !== null));
            });
            body.appendChild(table.wrap);
        });
    }

    $$("#kCount").textContent = fmtInt(count);
    $$("#kBefore").textContent = fmtNum(before);
    $$("#kGrand").textContent = fmtNum(grand);
}

/* helpers */
function makeTable(headers) {
    const wrap = document.createElement("div");
    wrap.className = "overflow-auto";
    const table = document.createElement("table");
    table.className = "table";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    headers.forEach(h => {
        const th = document.createElement("th");
        th.textContent = h;
        trh.appendChild(th);
    });
    thead.appendChild(trh);
    const tbody = document.createElement("tbody");
    table.appendChild(thead); table.appendChild(tbody); wrap.appendChild(table);
    return { wrap, tbody };
}
function addRow(tbody, cells) {
    const tr = document.createElement("tr");
    cells.forEach((c, i) => {
        const td = document.createElement("td");
        td.textContent = c;
        if (i >= cells.length - 3) td.className = "text-right";
        tr.appendChild(td);
    });
    tbody.appendChild(tr);
}
function groupBy(arr, keyFn) { return arr.reduce((m, x) => { const k = keyFn(x); (m[k] ||= []).push(x); return m; }, {}); }
function ymd(d) { return d.toISOString().slice(0, 10); }
function firstDayOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function fmtNum(n) { n = Number(n || 0); return n.toLocaleString('en-US', { minimumFractionDigits: 2 }); }
function fmtInt(n) { n = Number(n || 0); return n.toLocaleString('en-US'); }


document.getElementById("btnExcel").addEventListener("click", exportExcel);

function exportExcel() {
    // รวมทุกตารางใน #reportBody เข้าเป็นชุดข้อมูลเดียว
    const tables = Array.from(document.querySelectorAll("#reportBody table"));
    if (!tables.length) { alert("ไม่มีข้อมูลให้ส่งออก"); return; }

    // ดึง caption หรือตัวหัวแต่ละบล็อกเป็นหัวชีต
    const sheets = [];
    tables.forEach((tbl, i) => {
        const headers = Array.from(tbl.querySelectorAll("thead th")).map(th => th.textContent.trim());
        const rows = Array.from(tbl.querySelectorAll("tbody tr")).map(tr =>
            Array.from(tr.children).map(td => td.textContent.trim())
        );
        sheets.push({ name: `Sheet${i + 1}`, headers, rows });
    });

    // สร้าง Excel (XLS) ด้วย HTML-Table (Excel รองรับ)
    const wb = sheets.map(s => {
        const head = `<tr>${s.headers.map(h => `<th>${escapeXml(h)}</th>`).join("")}</tr>`;
        const body = s.rows.map(r => `<tr>${r.map(c => `<td>${escapeXml(c)}</td>`).join("")}</tr>`).join("");
        return `<table>${head}${body}</table>`;
    }).join("<br/>");

    const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>${sheets.map((s, i) => `<x:ExcelWorksheet><x:Name>${"Sheet" + (i + 1)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>`).join("")
        }</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
    <body>${wb}</body></html>
  `.trim();

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "saletax_report.xls";
    a.click();
}

function escapeXml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

