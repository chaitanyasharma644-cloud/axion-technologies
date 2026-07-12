// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href === '#') return;
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Pricing buttons → contact form with plan pre-selected
document.querySelectorAll('[data-plan]').forEach(btn => {
  btn.addEventListener('click', () => {
    const planInput = document.getElementById('plan');
    if (planInput) planInput.value = btn.dataset.plan || '';
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('company')?.focus();
  });
});

// Load industries into form dropdown from backend
async function loadIndustries() {
  const select = document.getElementById('service');
  if (!select) return;
  try {
    const res = await fetch('/api/services');
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.services)) throw new Error('bad payload');
    select.innerHTML = data.services.map(s =>
      `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`
    ).join('');
  } catch (err) {
    console.error('Failed to load industries:', err);
    select.innerHTML = `
      <option value="clinic">Clinic / Healthcare</option>
      <option value="car-dealer">Car Dealership</option>
      <option value="gym">Gym / Fitness</option>
      <option value="restaurant">Restaurant / Cafe</option>
      <option value="real-estate">Real Estate Agency</option>
      <option value="other">Other</option>
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showFormStatus(msg, isError) {
  const el = document.getElementById('form-status');
  if (!el) return;
  el.textContent = msg;
  el.className = isError
    ? 'text-sm text-center text-red-400'
    : 'text-sm text-center text-cyan-400';
}

// Demo booking form → backend
(function () {
  const form = document.getElementById('demo-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const btnLabel = document.getElementById('submit-label');

    const payload = {
      source: 'ai-employee-demo',
      company: document.getElementById('company').value.trim(),
      service: document.getElementById('service').value,
      phone: document.getElementById('phone').value.trim(),
      email: document.getElementById('email')?.value.trim() || '',
      plan: document.getElementById('plan')?.value || ''
    };

    if (btn) btn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Sending…';
    showFormStatus('', false);

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        const errMsg = data.errors
          ? Object.values(data.errors).join(' ')
          : (data.error || 'Something went wrong. Please try again.');
        showFormStatus(errMsg, true);
        return;
      }

      showFormStatus(data.message || "Thanks! We'll call you within 24 hours.", false);
      form.reset();
      const planInput = document.getElementById('plan');
      if (planInput) planInput.value = '';
    } catch (err) {
      showFormStatus('Network error — please check your connection and try again.', true);
      console.error('Demo form failed:', err);
    } finally {
      if (btn) btn.disabled = false;
      if (btnLabel) btnLabel.textContent = 'Book Free Demo';
    }
  });
})();

document.addEventListener('DOMContentLoaded', loadIndustries);
