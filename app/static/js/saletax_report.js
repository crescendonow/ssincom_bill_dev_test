const API_LIST = "/api/saletax/list";

document.addEventListener("DOMContentLoaded", () => {
  const $ = s => document.querySelector(s);

  let rows = [];

  // โหลดรายงานทันที
  buildReport();

  async function buildReport() {
    try {
      const res = await fetch(API_LIST + "?month=" + new Date().toISOString().slice(0,7));
      if (!res.ok) throw new Error(await res.text());
      rows = await res.json();
      renderTable(rows);
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถดึงข้อมูลได้");
    }
  }

  function renderTable(data) {
    const tbody = $("#reportBody");
    tbody.innerHTML = "";
    let totalBefore = 0, totalVat = 0, totalGrand = 0;

    data.forEach((r, i) => {
      const vat = r.vat ?? r.before_vat * 0.07;
      const grand = r.grand ?? r.before_vat + vat;
      totalBefore += r.before_vat;
      totalVat += vat;
      totalGrand += grand;
      const branchText = r.cf_hq==1?"สำนักงานใหญ่":(r.cf_branch?`สาขาที่ ${r.cf_branch}`:"-");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${i+1}</td>
        <td class="text-center">${fmtThaiDate(r.invoice_date)}</td>
        <td class="text-center">-</td>
        <td class="text-center">${r.invoice_number||"-"}</td>
        <td class="text-center">${r.personid||"-"}</td>
        <td>${r.company||"-"}</td>
        <td class="text-center">${r.cf_taxid||"-"}</td>
        <td class="text-center">${branchText}</td>
        <td class="text-right">${fmtNum(r.before_vat)}</td>
        <td class="text-right">${fmtNum(vat)}</td>
        <td class="text-right">${fmtNum(grand)}</td>`;
      tbody.appendChild(tr);
    });

    // summary
    const trSum = document.createElement("tr");
    trSum.className="font-bold bg-gray-50";
    trSum.innerHTML = `
      <td colspan="8" class="text-right">รวม</td>
      <td class="text-right">${fmtNum(totalBefore)}</td>
      <td class="text-right">${fmtNum(totalVat)}</td>
      <td class="text-right">${fmtNum(totalGrand)}</td>`;
    tbody.appendChild(trSum);

    $("#kCount").textContent = data.length;
    $("#kBefore").textContent = fmtNum(totalBefore);
    $("#kGrand").textContent = fmtNum(totalGrand);
  }

  function fmtNum(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2});}
  function fmtThaiDate(iso){
    if(!iso) return "-";
    const d=new Date(iso);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()+543}`;
  }

  // ปุ่มพิมพ์
  $("#btnPrint").addEventListener("click",()=>window.print());

  // ปุ่มส่งออก Excel
  $("#btnExcel").addEventListener("click",()=>{
    if(!rows.length){alert("ไม่มีข้อมูลส่งออก");return;}
    let csv="ลำดับ,วันเดือนปี,เล่มที่,เลขที่ใบกำกับ,รหัสลูกค้า,ชื่อบริษัท,เลขผู้เสียภาษี,สถานประกอบการ,ก่อนVAT,VAT,รวม\n";
    rows.forEach((r,i)=>{
      const vat=r.vat??r.before_vat*0.07;
      const grand=r.grand??r.before_vat+vat;
      csv+=`${i+1},${fmtThaiDate(r.invoice_date)},-,"${r.invoice_number||"-"}","${r.personid||"-"}","${r.company||"-"}","${r.cf_taxid||"-"}","${r.cf_branch||"-"}",${r.before_vat},${vat},${grand}\n`;
    });
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="saletax_report.csv";
    a.click();
  });
});
