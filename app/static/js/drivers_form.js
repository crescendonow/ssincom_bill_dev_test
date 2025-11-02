// /static/js/drivers_form.js
const ENDPOINT_DRIVERS = '/api/drivers';

let currentPage = 1;
const PAGE_SIZE = 10;
let editingId = null;

function $(id) { return document.getElementById(id); }
function escapeHtml(s = '') { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function setFormMsg(msg, isError = false) {
    const el = $('formMsg'); if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-sm ml-2 ' + (isError ? 'text-red-600' : 'text-green-600');
}

async function loadDrivers(isNextAttempt = false) {
    try {
        const q = ($('searchText')?.value || '').trim();
        const url = new URL(ENDPOINT_DRIVERS, location.origin);
        url.searchParams.set('search', q);
        url.searchParams.set('page', currentPage);
        url.searchParams.set('page_size', PAGE_SIZE);

        const res = await fetch(url);
        if (!res.ok) throw new Error('โหลดรายการไม่สำเร็จ');
        const { items, page, page_size, total } = await res.json();
        renderTable(items, page, page_size, total);
    } catch (err) {
        if (isNextAttempt) currentPage = Math.max(1, currentPage - 1);
        console.error(err);
        renderTable([], 1, PAGE_SIZE, 0);
    }
}

function renderTable(rows, page, page_size, total) {
    const tbody = $('driversTableBody'); if (!tbody) return;
    tbody.innerHTML = '';

    if (!rows || rows.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6" class="px-3 py-3 border text-center text-gray-500">ไม่พบข้อมูล</td>`;
        tbody.appendChild(tr);
    } else {
        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.dataset.id = r.driver_id;
            tr.dataset.prefix = r.prefix || '';
            tr.dataset.first = r.first_name || '';
            tr.dataset.last = r.last_name || '';
            tr.dataset.cid = r.citizen_id || '';
            tr.innerHTML = `
        <td class="px-3 py-2 border">${escapeHtml(r.driver_id)}</td>
        <td class="px-3 py-2 border cell-prefix">${escapeHtml(r.prefix || '')}</td>
        <td class="px-3 py-2 border cell-first">${escapeHtml(r.first_name || '')}</td>
        <td class="px-3 py-2 border cell-last">${escapeHtml(r.last_name || '')}</td>
        <td class="px-3 py-2 border cell-cid">${escapeHtml(r.citizen_id || '')}</td>
        <td class="px-3 py-2 border cell-actions">
          <button class="btn-edit bg-white border px-2 py-1 rounded hover:bg-gray-50">แก้ไข</button>
          <button class="btn-delete bg-white border px-2 py-1 rounded hover:bg-gray-50 ml-2 text-red-700">ลบ</button>
        </td>
      `;
            tbody.appendChild(tr);
        });
    }

    if ($('pageInfo')) $('pageInfo').textContent = `หน้า ${page}`;
    const start = total === 0 ? 0 : (page - 1) * page_size + 1;
    const end = Math.min(total, page * page_size);
    if ($('resultInfo')) $('resultInfo').textContent = `แสดง ${start}-${end} จากทั้งหมด ${total} รายการ`;
}

async function onCreateSubmit(e) {
    e.preventDefault(); setFormMsg('');
    const prefix = ($('prefix')?.value || '').trim();
    const first_name = ($('first_name')?.value || '').trim();
    const last_name = ($('last_name')?.value || '').trim();
    const citizen_id = ($('citizen_id')?.value || '').trim().replace(/\D+/g, '');

    if (!first_name || !last_name) { setFormMsg('กรุณากรอกชื่อและนามสกุล', true); return; }
    if (!citizen_id || (citizen_id.length !== 13)) { setFormMsg('กรุณากรอกเลขบัตรประชาชน 13 หลัก', true); return; }

    try {
        const res = await fetch(ENDPOINT_DRIVERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, first_name, last_name, citizen_id })
        });
        if (!res.ok) throw new Error(await res.text() || 'บันทึกไม่สำเร็จ');
        setFormMsg('บันทึกสำเร็จ ✅');
        resetForm(); currentPage = 1; loadDrivers();
    } catch (err) {
        console.error(err); setFormMsg(`ผิดพลาด: ${err.message}`, true);
    }
}

function resetForm() {
    ['prefix', 'first_name', 'last_name', 'citizen_id'].forEach(id => { const el = $(id); if (el) el.value = ''; });
}

function beginEditRow(tr) {
    if (!tr) return;
    editingId = tr.dataset.id;
    tr.querySelector('.cell-prefix').innerHTML = `<input data-field="prefix" class="w-full border rounded px-2 py-1" value="${escapeHtml(tr.dataset.prefix)}">`;
    tr.querySelector('.cell-first').innerHTML = `<input data-field="first_name" class="w-full border rounded px-2 py-1" value="${escapeHtml(tr.dataset.first)}">`;
    tr.querySelector('.cell-last').innerHTML = `<input data-field="last_name" class="w-full border rounded px-2 py-1" value="${escapeHtml(tr.dataset.last)}">`;
    tr.querySelector('.cell-cid').innerHTML = `<input data-field="citizen_id" class="w-full border rounded px-2 py-1" value="${escapeHtml(tr.dataset.cid)}">`;
    tr.querySelector('.cell-actions').innerHTML = `
    <button class="btn-save bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 mr-1">บันทึก</button>
    <button class="btn-cancel bg-gray-100 border px-3 py-1 rounded hover:bg-gray-200">ยกเลิก</button>
  `;
}

function cancelEditRow(tr) {
    if (!tr) return;
    editingId = null;
    tr.querySelector('.cell-prefix').textContent = tr.dataset.prefix || '';
    tr.querySelector('.cell-first').textContent = tr.dataset.first || '';
    tr.querySelector('.cell-last').textContent = tr.dataset.last || '';
    tr.querySelector('.cell-cid').textContent = tr.dataset.cid || '';
    tr.querySelector('.cell-actions').innerHTML = `
    <button class="btn-edit bg-white border px-2 py-1 rounded hover:bg-gray-50">แก้ไข</button>
    <button class="btn-delete bg-white border px-2 py-1 rounded hover:bg-gray-50 ml-2 text-red-700">ลบ</button>
  `;
}

async function onSaveRow(tr) {
    const data = {
        prefix: tr.querySelector('input[data-field="prefix"]')?.value.trim() || '',
        first_name: tr.querySelector('input[data-field="first_name"]')?.value.trim() || '',
        last_name: tr.querySelector('input[data-field="last_name"]')?.value.trim() || '',
        citizen_id: (tr.querySelector('input[data-field="citizen_id"]')?.value.trim() || '').replace(/\D+/g, ''),
    };
    if (!data.first_name || !data.last_name) { alert('กรุณากรอกชื่อ/นามสกุล'); return; }
    if (!data.citizen_id || data.citizen_id.length !== 13) { alert('เลขบัตรประชาชนต้องมี 13 หลัก'); return; }

    try {
        const res = await fetch(`${ENDPOINT_DRIVERS}/${encodeURIComponent(tr.dataset.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text() || 'บันทึกไม่สำเร็จ');

        tr.dataset.prefix = data.prefix;
        tr.dataset.first = data.first_name;
        tr.dataset.last = data.last_name;
        tr.dataset.cid = data.citizen_id;
        cancelEditRow(tr);
    } catch (err) {
        console.error(err); alert('เกิดข้อผิดพลาดระหว่างบันทึก');
    }
}

async function onDeleteRow(tr) {
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    try {
        const res = await fetch(`${ENDPOINT_DRIVERS}/${encodeURIComponent(tr.dataset.id)}`, { method: 'DELETE' });
        if (!(res.ok || res.status === 204)) throw new Error('ลบไม่สำเร็จ');
        if (editingId === tr.dataset.id) editingId = null;
        loadDrivers();
    } catch (err) { console.error(err); alert('เกิดข้อผิดพลาดระหว่างลบ'); }
}

function onTableClick(e) {
    const btn = e.target.closest('button'); if (!btn) return;
    const tr = e.target.closest('tr'); if (!tr) return;

    if (btn.classList.contains('btn-edit')) {
        const eid = tr.dataset.id;
        if (editingId && editingId !== eid) {
            const editingRow = document.querySelector(`tr[data-id="${editingId}"]`);
            if (editingRow) cancelEditRow(editingRow);
        }
        beginEditRow(tr);
    } else if (btn.classList.contains('btn-cancel')) {
        cancelEditRow(tr);
    } else if (btn.classList.contains('btn-save')) {
        onSaveRow(tr);
    } else if (btn.classList.contains('btn-delete')) {
        onDeleteRow(tr);
    }
}

function bindEvents() {
    const form = $('driverForm');
    const btnReset = $('btnReset');
    const btnSearch = $('btnSearch');
    const btnReload = $('btnReload');
    const prevPage = $('prevPage');
    const nextPage = $('nextPage');
    const tbody = $('driversTableBody');
    const searchInp = $('searchText');

    if (form) form.addEventListener('submit', onCreateSubmit);
    if (btnReset) btnReset.addEventListener('click', resetForm);

    if (btnSearch) btnSearch.addEventListener('click', () => { currentPage = 1; loadDrivers(); });
    if (btnReload) btnReload.addEventListener('click', () => { if (searchInp) searchInp.value = ''; currentPage = 1; loadDrivers(); });
    if (prevPage) prevPage.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadDrivers(); } });
    if (nextPage) nextPage.addEventListener('click', () => { currentPage++; loadDrivers(true); });

    if (tbody) tbody.addEventListener('click', onTableClick);
}

document.addEventListener('DOMContentLoaded', () => { bindEvents(); loadDrivers(); });
