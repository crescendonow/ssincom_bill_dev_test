const API_LIST = "/api/saletax/list";

document.addEventListener("DOMContentLoaded", () => {
    const $ = s => document.querySelector(s);
    let rows = [], granularity = "day", currentPage = 1;
    const PAGE_SIZE = 30;

    // ====== INIT FLATPICKR (TH) ======
    if (window.flatpickr) {
        flatpickr.localize(flatpickr.l10ns.th);

        // รายวัน: from/to (altInput ไทย, value เป็น YYYY-MM-DD)
        const commonDay = {
            locale: "th",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d F Y",
            allowInput: true
        };
        flatpickr("#dayFrom", commonDay);
        flatpickr("#dayTo", commonDay);

        // รายเดือน: monthSelect plugin (alt เป็น "F Y" ไทย, value เป็น "YYYY-MM")
        flatpickr("#monthPick", {
            locale: "th",
            plugins: [new monthSelectPlugin({
                shorthand: false,        // ชื่อเดือนไทยแบบเต็ม
                dateFormat: "Y-m",       // <-- ค่านี้จะถูกส่งไป API
                altFormat: "F Y",        // <-- แสดงไทยสวยงาม
                theme: "light"
            })],
            allowInput: false
        });

        // รายปี: ใช้ flatpickr แต่เราอ่านเฉพาะปีจากตัวเลือก (value เป็น "YYYY")
        flatpickr("#yearPick", {
            locale: "th",
            dateFormat: "Y",    // <-- ค่านี้จะถูกส่งไป API
            altInput: true,
            altFormat: "Y",
            allowInput: true,
            // เลือกวันไหนก็ได้ เราจะใช้เฉพาะปีจากผลลัพธ์
            onReady: (sel) => {
                // ใส่ปีปัจจุบันเริ่มต้น
                if (!sel.input.value) {
                    const y = new Date().getFullYear();
                    sel.setDate(`${y}-01-01`, true, "Y-m-d");
                }
            }
        });
    }

    // ====== สลับกรานูลาริตี้ ======
    document.querySelectorAll(".gran-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".gran-btn").forEach(b => b.classList.remove("bg-blue-600", "text-white"));
            btn.classList.add("bg-blue-600", "text-white");
            granularity = btn.dataset.type;
            toggleFilter();
        });
    });
    function toggleFilter() {
        $("#filter-day").classList.add("hidden");
        $("#filter-month").classList.add("hidden");
        $("#filter-year").classList.add("hidden");
        if (granularity === "day") $("#filter-day").classList.remove("hidden");
        if (granularity === "month") $("#filter-month").classList.remove("hidden");
        if (granularity === "year") $("#filter-year").classList.remove("hidden");
    }
    toggleFilter();

    // ====== ปุ่มหลัก ======
    $("#btnGenerate").addEventListener("click", () => buildReport());
    $("#btnPrint").addEventListener("click", () => window.print());
    $("#btnExcel").addEventListener("click", () => exportExcel());

    async function buildReport() {
        let params = new URLSearchParams();
        if (granularity === "day") {
            if ($("#dayFrom").value) params.set("start", $("#dayFrom").value); // YYYY-MM-DD
            if ($("#dayTo").value) params.set("end", $("#dayTo").value);
        } else if (granularity === "month") {
            if ($("#monthPick").value) params.set("month", $("#monthPick").value); // YYYY-MM
        } else if (granularity === "year") {
            const y = ($("#yearPick").value || "").trim(); // YYYY
            if (y) params.set("year", y);
        }

        try {
            const res = await fetch(`${API_LIST}?${params}`);
            if (!res.ok) throw new Error(await res.text());
            rows = await res.json();
            currentPage = 1;
            render(rows);
        } catch (e) { console.error(e); alert("โหลดข้อมูลล้มเหลว"); }
    }

    function render(data) {
        const tb = $("#reportBody"); tb.innerHTML = "";
        let totalBefore = 0, totalTon = 0, totalVat = 0, totalGrand = 0;

        // Compute totals from ALL data
        data.forEach(r => {
            const vat = r.vat ?? r.before_vat * 0.07;
            const grand = r.grand ?? r.before_vat + vat;
            totalBefore += r.before_vat; totalTon += r.sum_qty; totalVat += vat; totalGrand += grand;
        });

        // Pagination
        const totalRows = data.length;
        const maxPage = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
        if (currentPage > maxPage) currentPage = maxPage;
        const startIdx = (currentPage - 1) * PAGE_SIZE;
        const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE);
        const pageData = data.slice(startIdx, endIdx);

        pageData.forEach((r, pi) => {
            const i = startIdx + pi;
            const vat = r.vat ?? r.before_vat * 0.07;
            const grand = r.grand ?? r.before_vat + vat;
            const branch = r.cf_hq == 1 ? "สำนักงานใหญ่" : (r.cf_branch ? `สาขาที่ ${r.cf_branch}` : "-");

            const items = r.items || [];
            const itemIds = items.map(it => it.cf_itemid || "").filter(Boolean).join(", ") || "-";
            const itemNames = items.map(it => it.cf_itemname || "").filter(Boolean).join(", ") || "-";
            const driverName = r.driver_name || "-";

            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td class="text-center">${i + 1}</td>
        <td class="text-center">${fmtThaiDate(r.invoice_date)}</td>
        <td class="text-center">${r.invoice_number || "-"}</td>
        <td class="text-center">${r.personid || "-"}</td>
        <td>${r.company || "-"}</td>
        <td class="text-center">${r.cf_taxid || "-"}</td>
        <td class="text-center">${branch}</td>
        <td class="text-center">${driverName}</td>
        <td class="text-center">${itemIds}</td>
        <td>${itemNames}</td>
        <td class="text-center">${fmtNum(r.sum_qty || 0)}</td>
        <td class="text-right">${fmtNum(r.before_vat)}</td>
        <td class="text-right">${fmtNum(vat)}</td>
        <td class="text-right">${fmtNum(grand)}</td>`;
            tb.appendChild(tr);
        });

        const trSum = document.createElement("tr");
        trSum.className = "font-bold bg-gray-50";
        trSum.innerHTML = `
      <td colspan="10" class="text-right">รวม</td>
      <td class="text-right">${fmtNum(totalTon)}</td>
      <td class="text-right">${fmtNum(totalBefore)}</td>
      <td class="text-right">${fmtNum(totalVat)}</td>
      <td class="text-right">${fmtNum(totalGrand)}</td>`;
        tb.appendChild(trSum);

        // Pagination info
        updatePagination(totalRows, maxPage);

        // อัปเดต KPI + หัวรายงาน
        $("#kCount").textContent = data.length;
        $("#kBefore").textContent = fmtNum(totalBefore);
        $("#kGrand").textContent = fmtNum(totalGrand);
        $(".month-year").textContent = thaiMonthYear();
        $("#subtitle").textContent = `${thaiMonthYear()} (${data.length} รายการ)`;
        $("#kTon").textContent = Number(totalTon || 0).toLocaleString("en-US", { minimumFractionDigits: 3 });
    }

    function updatePagination(total, maxPage) {
        let pag = document.getElementById("pagination-controls");
        if (!pag) {
            pag = document.createElement("div");
            pag.id = "pagination-controls";
            pag.className = "flex items-center justify-between mt-4 px-2";
            const tableParent = document.getElementById("sale-tax-table")?.parentElement;
            if (tableParent) tableParent.after(pag);
        }
        const from = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
        const to = Math.min(total, currentPage * PAGE_SIZE);
        pag.innerHTML = `
            <div class="text-xs text-gray-500">แสดง ${from}-${to} จากทั้งหมด ${total} รายการ</div>
            <div class="flex items-center gap-2">
                <button id="pagePrev" class="px-3 py-1 border rounded text-xs hover:bg-gray-50" ${currentPage <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
                <span class="text-xs text-gray-700">หน้า ${currentPage} / ${maxPage}</span>
                <button id="pageNext" class="px-3 py-1 border rounded text-xs hover:bg-gray-50" ${currentPage >= maxPage ? 'disabled' : ''}>ถัดไป</button>
            </div>`;
        document.getElementById("pagePrev")?.addEventListener("click", () => { if (currentPage > 1) { currentPage--; render(rows); } });
        document.getElementById("pageNext")?.addEventListener("click", () => { if (currentPage < maxPage) { currentPage++; render(rows); } });
    }

    function exportExcel() {
        if (!rows || !rows.length) { alert("ไม่มีข้อมูลส่งออก"); return; }
        // ตรวจสอบว่า XLSX พร้อมใช้งาน และมี .utils.aoa_to_sheet จริงๆ
        if (typeof XLSX === "undefined" || !XLSX || !XLSX.utils || !XLSX.utils.aoa_to_sheet) {
            alert("ไม่พบไลบรารี XLSX (aoa_to_sheet) — กรุณาตรวจสอบว่าสคริปต์ xlsx.full.min.js โหลดสำเร็จ และไม่ได้ถูกบล็อค");
            return;
        }

        const header = [
            "ลำดับ", "วันเดือนปี", "เลขที่ใบกำกับ",
            "รหัสลูกค้า", "ชื่อผู้ขายสินค้า/บริการ",
            "เลขประจำตัวผู้เสียภาษี", "สถานประกอบการ",
            "พนักงานขับรถ", "รหัสสินค้า", "รายการสินค้า",
            "จำนวนตัน",
            "มูลค่าสินค้า/บริการ", "VAT", "รวม"
        ];


        const data = [header];
        rows.forEach((r, i) => {
            const before = Number(r.before_vat || 0);
            const vat = Number((r.vat ?? before * 0.07).toFixed(2));
            const grand = Number((r.grand ?? before + vat).toFixed(2));
            const branch = (r.cf_hq == 1) ? "สำนักงานใหญ่"
                : (r.cf_branch ? `สาขาที่ ${r.cf_branch}` : "-");

            const items = r.items || [];
            const itemIds = items.map(it => it.cf_itemid || "").filter(Boolean).join(", ") || "-";
            const itemNames = items.map(it => it.cf_itemname || "").filter(Boolean).join(", ") || "-";
            const driverName = r.driver_name || "-";

            data.push([
                i + 1,
                fmtThaiDate(r.invoice_date),
                r.invoice_number || "-",
                r.personid || "-",
                r.company || "-",
                r.cf_taxid || "-",
                branch,
                driverName,
                itemIds,
                itemNames,
                Number(r.sum_qty || 0),
                before, vat, grand
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);

        // ความกว้างคอลัมน์
        ws['!cols'] = [
            { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 14 },
            { wch: 36 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 40 },
            { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 16 }
        ];

        // จัดรูปแบบตัวเลขให้คอลัมน์เงิน
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = 1; R <= range.e.r; R++) {
            [11, 12, 13].forEach(C => {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[addr];
                if (cell && typeof cell.v === 'number') {
                    cell.t = 'n';
                    cell.z = '#,##0.00';
                }
            });
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "SaleTax");

        // ตั้งชื่อไฟล์ .xlsx จริง
        XLSX.writeFile(wb, "saletax_report.xlsx");
    }


    // ===== Utilities =====
    function fmtNum(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }
    function fmtThaiDate(iso) {
        if (!iso) return "-";
        const d = new Date(iso);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yy = d.getFullYear() + 543;
        return `${dd}/${mm}/${yy}`;
    }
    function thaiMonthYear() {
        const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        if (granularity === "month" && $("#monthPick").value) {
            const [y, m] = $("#monthPick").value.split("-"); // YYYY-MM
            return `${TH_MONTHS[parseInt(m, 10) - 1]} ปี ${parseInt(y, 10) + 543}`;
        }
        if (granularity === "year" && $("#yearPick").value) {
            return `ปี ${parseInt($("#yearPick").value, 10) + 543}`;
        }
        // day → ใช้เดือนจาก dayFrom (หรือวันนี้ถ้าไม่มี)
        const base = $("#dayFrom").value || new Date().toISOString().slice(0, 10);
        const d = new Date(base);
        return `${TH_MONTHS[d.getMonth()]} ปี ${d.getFullYear() + 543}`;
    }
});