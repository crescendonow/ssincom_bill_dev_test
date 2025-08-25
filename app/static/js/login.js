// toggle แสดง/ซ่อนรหัสผ่าน + submit แบบ POST form-encoded
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const toggle = document.getElementById('togglePw');
  const pw = document.getElementById('password');

  toggle?.addEventListener('click', () => {
    if (!pw) return;
    const visible = pw.type === 'text';
    pw.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? 'แสดง' : 'ซ่อน';
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const next = fd.get('next') || '/dashboard';

    try {
      const res = await fetch('/login', {
        method: 'POST',
        body: fd
      });
      // FastAPI redirect 303 → follow
      if (res.redirected) {
        window.location.href = res.url;
      } else if (res.ok) {
        // เผื่อ backend คืน 200 พร้อม url
        const data = await res.json().catch(() => ({}));
        window.location.href = data?.next || next;
      } else {
        window.location.href = `/login?error=1&next=${encodeURIComponent(next)}`;
      }
    } catch (err) {
      window.location.href = `/login?error=1&next=${encodeURIComponent(next)}`;
    }
  });
});
