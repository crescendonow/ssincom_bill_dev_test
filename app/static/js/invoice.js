// static/js/invoice.js

(() => {
  // 1) จัดตำแหน่งเลขประจำตัวผู้เสียภาษีให้ตรงบรรทัดเดียวกับอีเมลฝั่งซ้าย
  function alignTaxIdWithEmail() {
    const emailEl = document.getElementById('company-email');
    const rightCol = document.getElementById('header-right');
    const taxIdEl  = document.getElementById('tax-id');
    if (!emailEl || !rightCol || !taxIdEl) return;

    // เผื่อ margin ของ label น้อยเกินไป ให้ดันลงเล็กน้อย
    const taxLabel = document.getElementById('tax-label');
    if (taxLabel) {
      const mt = parseFloat(getComputedStyle(taxLabel).marginTop || '0');
      if (mt < 12) taxLabel.style.marginTop = '12px';
    }

    // คำนวณระยะต่างจากยอดบนคอลัมน์ขวา
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
    // เรียกเมื่อ DOM พร้อม และซ้ำเมื่อโหลดรูป/รีไซส์ (โลโก้มีผลกับความสูง)
    alignTaxIdWithEmail();
    window.addEventListener('load', alignTaxIdWithEmail);
    window.addEventListener('resize', alignTaxIdWithEmail);
  });

  // 2) โหมดพิมพ์: เคลียร์ transform/margin เผื่อมีสไตล์ค้าง
  //    (CSS @media print ใน invoice.css จะเป็นตัวคุมหลัก)
  function clearTransforms() {
    const doc = document.querySelector('.doc');
    if (!doc) return;
    doc.style.transform = '';
    doc.style.marginBottom = '';
  }
  window.addEventListener('beforeprint', clearTransforms);
  window.addEventListener('afterprint', clearTransforms);

  // *** หมายเหตุ ***
  // เดิมมีโค้ด fitToA4 ที่ทำ transform:scale(...) ตอน beforeprint
  // ได้เอาออกแล้วเพื่อไม่ให้ผลเพี้ยนตามขนาดหน้าจอ/อุปกรณ์
})();
