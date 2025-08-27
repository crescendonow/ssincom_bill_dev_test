// static/js/invoice.js

(() => {
  // จัดตำแหน่งเลขประจำตัวผู้เสียภาษีให้ตรงบรรทัดเดียวกับอีเมลฝั่งซ้าย
  function alignTaxIdWithEmail() {
    const emailEl = document.getElementById('company-email');
    const rightCol = document.getElementById('header-right');
    const taxIdEl  = document.getElementById('tax-id');
    if (!emailEl || !rightCol || !taxIdEl) return;

    const taxLabel = document.getElementById('tax-label');
    if (taxLabel) {
      const mt = parseFloat(getComputedStyle(taxLabel).marginTop || '0');
      if (mt < 12) taxLabel.style.marginTop = '12px';
    }

    const rightTop = rightCol.getBoundingClientRect().top + window.scrollY;
    const emailTop = emailEl.getBoundingClientRect().top + window.scrollY;
    const taxTop   = taxIdEl.getBoundingClientRect().top + window.scrollY;

    const delta = (emailTop - rightTop) - (taxTop - rightTop);
    const currentMt = parseFloat(getComputedStyle(taxIdEl).marginTop || '0');
    taxIdEl.style.marginTop = (currentMt + delta) + 'px';
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(() => {
    alignTaxIdWithEmail();
    window.addEventListener('load', alignTaxIdWithEmail);
    window.addEventListener('resize', alignTaxIdWithEmail);
  });

  // ----- PRINT LOCK -----
  function addPrintLock() {
    document.documentElement.classList.add('printing');
    document.body.classList.add('printing');
  }
  function removePrintLock() {
    document.documentElement.classList.remove('printing');
    document.body.classList.remove('printing');
  }

  // ให้ iOS บางเวอร์ชันที่ไม่ยิง afterprint ก็ยังถอดล็อกได้
  function removeLockWithFallback() {
    removePrintLock();
    // Fallback ถ้า afterprint ไม่มา ให้ถอดซ้ำหลัง 3 วิ
    setTimeout(removePrintLock, 3000);
  }

  // เรียกใช้จากปุ่มพิมพ์
  window.startPrint = function () {
    addPrintLock();
    // เว้นจังหวะสั้น ๆ ให้ reflow ตามกฎ printing ก่อน
    setTimeout(() => {
      window.print();
      // ถอดล็อกด้วย afterprint + เผื่อ fallback
      // (บาง iOS จะไม่ยิง afterprint จากปุ่มแชร์)
      setTimeout(removePrintLock, 1500);
    }, 50);
  };

  // เผื่อเบราว์เซอร์ที่รองรับอีเวนต์เหล่านี้
  window.addEventListener('beforeprint', addPrintLock);
  window.addEventListener('afterprint', removeLockWithFallback);
})();
