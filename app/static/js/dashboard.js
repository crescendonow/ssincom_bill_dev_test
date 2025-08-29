// ===== Utils =====
const fmtBaht = (n) =>
  (Number(n || 0)).toLocaleString("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  });

const fmtDateTH = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`); // ป้องกัน timezone
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const toISO = (dateObj) => {
  // ใช้ UTC เพื่อเลี่ยงคลาดเคลื่อน
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// ===== Renderers =====
function renderMobileList(rows) {
  const wrap = document.getElementById("mobileInvoiceList");
  wrap.innerHTML = "";
  if (!rows.length) {
    wrap.innerHTML =
      '<div class="text-center text-gray-500 py-6">ยังไม่มีข้อมูล</div>';
    return;
  }
  rows.forEach((r) => {
    const card = document.createElement("div");
    card.className = "rounded-lg border p-3 flex flex-col gap-1";
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="font-semibold">${r.invoice_number || "—"}</div>
        <div class="text-sm text-gray-500">${fmtDateTH(r.invoice_date)}</div>
      </div>
      <div class="text-sm text-gray-600 truncate">${r.fname || "—"}</div>
      <div class="flex items-center justify-between mt-1">
        <div class="text-sm text-gray-500">สุทธิ</div>
        <div class="font-semibold">${fmtBaht(r.grand)}</div>
      </div>
      <div class="flex gap-2 mt-2">
        <a href="/form?edit=${encodeURIComponent(
          r.idx
        )}" class="px-3 py-1.5 rounded bg-amber-500 text-white text-sm">แก้ไข</a>
        <a href="/summary_invoices.html" class="px-3 py-1.5 rounded border text-sm">รายละเอียด</a>
      </div>
    `;
    wrap.appendChild(card);
  });
}

function renderTable(rows) {
  const tbody = document.getElementById("latestInvoicesTbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `
      <tr class="border-b last:border-b-0">
        <td class="px-3 py-3 text-center text-gray-500" colspan="7">ยังไม่มีข้อมูล</td>
      </tr>`;
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "border-b last:border-b-0";
    tr.innerHTML = `
      <td class="px-3 py-2 whitespace-nowrap">${r.invoice_number || "—"}</td>
      <td class="px-3 py-2 whitespace-nowrap">${fmtDateTH(r.invoice_date)}</td>
      <td class="px-3 py-2 truncate max-w-[280px]">${r.fname || "—"}</td>
      <td class="px-3 py-2 text-right">${fmtBaht(r.amount)}</td>
      <td class="px-3 py-2 text-right">${fmtBaht(r.vat)}</td>
      <td class="px-3 py-2 text-right font-semibold">${fmtBaht(r.grand)}</td>
      <td class="px-3 py-2 text-right">
        <a href="/form?edit=${encodeURIComponent(
          r.idx
        )}" class="inline-flex items-center px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 text-sm">แก้ไข</a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderStats(rows) {
  const totalInvoices = rows.length;
  const sumBeforeVat = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const sumVat = rows.reduce((a, r) => a + Number(r.vat || 0), 0);
  const sumGrand = rows.reduce((a, r) => a + Number(r.grand || 0), 0);

  document.getElementById("stat_total_invoices").textContent =
    totalInvoices.toString();
  document.getElementById("stat_before_vat").textContent = fmtBaht(sumBeforeVat);
  document.getElementById("stat_vat").textContent = fmtBaht(sumVat);
  document.getElementById("stat_grand").textContent = fmtBaht(sumGrand);
}

// ===== Fetch: Last 7 days =====
async function loadRecentInvoices() {
  const loading = document.getElementById("latest_invoices_loading");
  const error = document.getElementById("latest_invoices_error");

  loading.classList.remove("hidden");
  error.classList.add("hidden");

  try {
    // วันนี้ (UTC) และย้อนหลัง 6 วัน = รวม 7 วันล่าสุด
    const end = new Date();
    const endUTC = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));
    const startUTC = new Date(endUTC);
    startUTC.setUTCDate(endUTC.getUTCDate() - 6);

    const url = `/api/invoices?start=${toISO(startUTC)}&end=${toISO(endUTC)}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    let data = await res.json();

    // เรียงใหม่→เก่า (วันที่/idx) และแสดง 10 แถวบนสุด
    data.sort((a, b) => {
      const da = a.invoice_date || "";
      const db = b.invoice_date || "";
      if (da < db) return 1;
      if (da > db) return -1;
      return (b.idx || 0) - (a.idx || 0);
    });
    const top = data.slice(0, 10);

    renderMobileList(top);
    renderTable(top);
    renderStats(top);
  } catch (e) {
    console.error(e);
    error.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", loadRecentInvoices);
