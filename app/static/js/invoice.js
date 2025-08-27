// ===== จัดตำแหน่ง TAX ID ให้ตรงกับบรรทัดอีเมลฝั่งซ้าย =====
(function alignTaxIdWithEmail() {
  function run() {
    const emailEl = document.getElementById('company-email');
    const rightCol = document.getElementById('header-right');
    const taxIdEl = document.getElementById('tax-id');
    if (!emailEl || !rightCol || !taxIdEl) return;

    // เผื่อ margin label น้อยเกินไป
    const taxLabel = document.getElementById('tax-label');
    if (taxLabel && parseFloat(getComputedStyle(taxLabel).marginTop || 0) < 8) {
      taxLabel.style.marginTop = '12px';
    }

    // ปรับระยะให้เลขภาษีตรงบรรทัดเดียวกับอีเมล
    const rightTop = rightCol.getBoundingClientRect().top + window.scrollY;
    const emailTop = emailEl.getBoundingClientRect().top + window.scrollY;
    const taxTop = taxIdEl.getBoundingClientRect().top + window.scrollY;

    const delta = (emailTop - rightTop) - (taxTop - rightTop);
    const currentMt = parseFloat(getComputedStyle(taxIdEl).marginTop || 0);
    taxIdEl.style.marginTop = (currentMt + delta) + 'px';
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 0);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 0));
  }
  window.addEventListener('load', run);
  window.addEventListener('resize', run);
})();

// ===== ปรับสเกลให้พอดี A4 ก่อนพิมพ์ (กันเนื้อหาเลยหน้า) =====
(function fitToA4() {
  const mmToPx = mm => (mm / 25.4) * 96;

  function fitToA4Once() {
    const doc = document.querySelector('.doc');
    if (!doc) return;

    // @page margin: 8mm (บน+ล่าง = 16mm)
    const printableHeightPx = mmToPx(297 - 16); // ความสูง A4 - margin

    const actual = doc.getBoundingClientRect().height;
    const scale = Math.min(1, printableHeightPx / actual);

    if (scale < 1) {
      doc.style.transform = `scale(${scale})`;
      const scaledHeight = actual * scale;
      const spare = printableHeightPx - scaledHeight;
      doc.style.marginBottom = spare > 0 ? `${spare}px` : '0';
      doc.style.transformOrigin = 'top left';
    } else {
      doc.style.transform = '';
      doc.style.marginBottom = '';
    }
  }

  (function () {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  if (isIOS) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/static/css/invoice_ios.css';
    document.head.appendChild(link);
  }
})();

  window.addEventListener('beforeprint', fitToA4Once);
  window.addEventListener('afterprint', () => {
    const doc = document.querySelector('.doc');
    if (doc) { doc.style.transform = ''; doc.style.marginBottom = ''; }
  });

  // อยากลองให้ scale บนหน้าจอก่อนพิมพ์ เปิดบรรทัดนี้ได้
  // window.addEventListener('load', fitToA4Once);
})();
