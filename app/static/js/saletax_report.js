const API_LIST = "/api/saletax/list";
document.addEventListener("DOMContentLoaded", () => {
    const $ = s => document.querySelector(s);
    let rows = [], granularity = "day";

    // ปุ่มกรานูลาริตี้
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

    $("#btnGenerate").addEventListener("click", () => buildReport());
    $("#btnPrint").addEventListener("click", () => window.print());
    $("#btnExcel").addEventListener("click", () => exportExcel());

    async function buildReport() {
        let params = new URLSearchParams();
        if (granularity === "day") {
            if ($("#dayFrom").value) params.set("start", $("#dayFrom").value);
            if ($("#dayTo").value) params.set("end", $("#dayTo").value);
        } else if (granularity === "month") {
            if ($("#monthPick").value) params.set("month", $("#monthPick").value);
        } else if (granularity === "year") {
            if ($("#yearPick").value) params.set("year", $("#yearPick").value);
        }
        try {
            const res = await fetch(`${API_LIST}?${params}`);
            if (!res.ok) throw new Error(await res.text());
            rows = await res.json();
            render(rows);
        } catch (e) { console.error(e); alert("โหลดข้อมูลล้มเหลว"); }
    }

    function render(data) {
        const tb = $("#reportBody"); tb.innerHTML = "";
        let totalBefore = 0, totalVat = 0, totalGrand = 0;
        data.forEach((r, i) => {
            const vat = r.vat ?? r.before_vat * 0.07;
            const grand = r.grand ?? r.before_vat + vat;
            totalBefore += r.before_vat; totalVat += vat; totalGrand += grand;
            const branch = r.cf_hq == 1 ? "สำนักงานใหญ่" : (r.cf_branch ? `สาขาที่ ${r.cf_branch}` : "-");
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td class="text-center">${i + 1}</td>
        <td class="text-center">${fmtThaiDate(r.invoice_date)}</td>
        <td class="text-center">-</td>
        <td class="text-center">${r.invoice_number || "-"}</td>
        <td class="text-center">${r.personid || "-"}</td>
        <td>${r.company || "-"}</td>
        <td class="text-center">${r.cf_taxid || "-"}</td>
        <td class="text-center">${branch}</td>
        <td class="text-right">${fmtNum(r.before_vat)}</td>
        <td class="text-right">${fmtNum(vat)}</td>
        <td class="text-right">${fmtNum(grand)}</td>`;
            tb.appendChild(tr);
        });
        const trSum = document.createElement("tr");
        trSum.className = "font-bold bg-gray-50";
        trSum.innerHTML = `<td colspan="8" class="text-right">รวม</td>
      <td class="text-right">${fmtNum(totalBefore)}</td>
      <td class="text-right">${fmtNum(totalVat)}</td>
      <td class="text-right">${fmtNum(totalGrand)}</td>`;
        tb.appendChild(trSum);

        $("#kCount").textContent = data.length;
        $("#kBefore").textContent = fmtNum(totalBefore);
        $("#kGrand").textContent = fmtNum(totalGrand);

        // month-year สำหรับหัวพิมพ์
        $(".month-year").textContent = thaiMonthYear();
        $("#subtitle").textContent = `${thaiMonthYear()} (${data.length} รายการ)`;
    }

    function exportExcel() {
        if (!rows.length) { alert("ไม่มีข้อมูลส่งออก"); return; }
        let csv = "ลำดับ,วันเดือนปี,เล่มที่,เลขที่ใบกำกับ,รหัสลูกค้า,ชื่อบริษัท,เลขผู้เสียภาษี,สถานประกอบการ,ก่อนVAT,VAT,รวม\n";
        rows.forEach((r, i) => {
            const vat = r.vat ?? r.before_vat * 0.07, grand = r.grand ?? r.before_vat + vat;
            csv += `${i + 1},${fmtThaiDate(r.invoice_date)},-,"${r.invoice_number}","${r.personid}","${r.company}","${r.cf_taxid}","${r.cf_branch}",${r.before_vat},${vat},${grand}\n`;
        });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "saletax_report.csv";
        a.click();
    }

    // utils
    function fmtNum(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }
    function fmtThaiDate(iso) { if (!iso) return "-"; const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear() + 543}`; }
    function thaiMonthYear() {
        const thMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        let now = new Date(), y = now.getFullYear() + 543, m = thMonths[now.getMonth()];
        if (granularity === "month" && $("#monthPick").value) {
            const [yy, mm] = $("#monthPick").value.split("-");
            y = parseInt(yy) + 543; m = thMonths[parseInt(mm) - 1];
        } else if (granularity === "year" && $("#yearPick").value) {
            y = parseInt($("#yearPick").value) + 543; m = "";
        }
        return m ? `${m} ปี ${y}` : `ปี ${y}`;
    }
});

function thaiMonthYear() {
    const thMonths = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];
    let now = new Date();
    let y = now.getFullYear() + 543;
    let m = thMonths[now.getMonth()];

    if (granularity === "month" && $("#monthPick").value) {
        const [yy, mm] = $("#monthPick").value.split("-");
        y = parseInt(yy) + 543;
        m = thMonths[parseInt(mm) - 1];
    } else if (granularity === "year" && $("#yearPick").value) {
        y = parseInt($("#yearPick").value) + 543;
        m = "";
    }
    return m ? `${m} ปี ${y}` : `ปี ${y}`;
}

