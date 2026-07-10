// ---------- mobile nav ----------
(function () {
  const toggle = document.getElementById('nav-toggle');
  const mobile = document.getElementById('nav-mobile');
  if (!toggle || !mobile) return;
  toggle.addEventListener('click', () => {
    const open = toggle.classList.toggle('open');
    mobile.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mobile.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      toggle.classList.remove('open');
      mobile.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
})();

// ---------- icons per service id ----------
const ICONS = {
  cloud: '<path d="M17.5 19H8.5A5.5 5.5 0 1 1 9.7 8.1 6 6 0 0 1 21 11.5a4 4 0 0 1-3.5 7.5Z"/>',
  security: '<path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-4Z"/>',
  software: '<path d="m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16"/>',
  ai: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  support: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  consulting: '<path d="M3 3v18h18M7 15l4-6 4 4 4-8"/>'
};

// ---------- fetch services from backend and render ----------
async function loadServices() {
  const grid = document.getElementById('services-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.services)) throw new Error('bad payload');

    grid.innerHTML = data.services.map(s => `
      <div class="service-card" data-tilt>
        <span class="tag mono">${s.code}</span>
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[s.id] || ''}</svg></div>
        <h3>${escapeHtml(s.title)}</h3>
        <p>${escapeHtml(s.desc)}</p>
      </div>
    `).join('');

    attachTilt();
  } catch (err) {
    grid.innerHTML = '<div class="services-loading mono">Couldn\'t load services right now — refresh to try again.</div>';
    console.error('Failed to load services:', err);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- 3D tilt for service cards ----------
function attachTilt() {
  document.querySelectorAll('[data-tilt]').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateZ(4px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'rotateY(0deg) rotateX(0deg)';
    });
  });
}

// ---------- contact form: real submission to backend ----------
(function () {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const submitBtn = document.getElementById('submit-btn');
  const submitLabel = document.getElementById('submit-label');
  const status = document.getElementById('form-status');
  const toast = document.getElementById('toast');

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function clearErrors() {
    ['name', 'email', 'message'].forEach(field => {
      const errEl = document.getElementById('err-' + field);
      const input = document.getElementById(field);
      if (errEl) errEl.textContent = '';
      if (input) input.closest('.field')?.classList.remove('invalid');
    });
    status.textContent = '';
    status.className = 'form-status';
  }

  function showErrors(errors) {
    Object.entries(errors).forEach(([field, msg]) => {
      const errEl = document.getElementById('err-' + field);
      const input = document.getElementById(field);
      if (errEl) errEl.textContent = msg;
      if (input) input.closest('.field')?.classList.add('invalid');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const payload = {
      name: document.getElementById('name').value,
      email: document.getElementById('email').value,
      company: document.getElementById('company').value,
      service: document.getElementById('service').value,
      message: document.getElementById('message').value
    };

    submitBtn.disabled = true;
    submitLabel.textContent = 'Sending…';

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.errors) {
          showErrors(data.errors);
          status.textContent = 'Please fix the fields above.';
          status.classList.add('error');
        } else {
          status.textContent = data.error || 'Something went wrong. Please try again.';
          status.classList.add('error');
        }
        return;
      }

      status.textContent = data.message || 'Thanks — your message is in.';
      status.classList.add('success');
      showToast('Message sent — we\'ll be in touch shortly.');
      form.reset();
    } catch (err) {
      status.textContent = 'Network error — please check your connection and try again.';
      status.classList.add('error');
      console.error('Contact submit failed:', err);
    } finally {
      submitBtn.disabled = false;
      submitLabel.textContent = 'Send message';
    }
  });
})();

// ---------- Three.js hero: axion particle orbit ----------
(function () {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || !window.THREE) return;
  const scene = new THREE.Scene();
  let width = canvas.clientWidth || window.innerWidth * 0.56;
  let height = canvas.clientHeight || window.innerHeight;

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 0, 9);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);

  const coreGeo = new THREE.IcosahedronGeometry(0.9, 2);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x4ce0d2, wireframe: true, transparent: true, opacity: 0.85 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  const coreSolidMat = new THREE.MeshBasicMaterial({ color: 0x0f1220, transparent: true, opacity: 0.5 });
  const coreSolid = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 2), coreSolidMat);
  scene.add(coreSolid);

  const ringGroup = new THREE.Group();
  scene.add(ringGroup);
  const ringColors = [0x4ce0d2, 0xffb86b, 0x8a8fa3];
  const rings = [];

  ringColors.forEach((color, i) => {
    const ringGeo = new THREE.TorusGeometry(2.6 + i * 0.05, 0.006, 8, 128);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.4 + i * 1.05;
    ring.rotation.y = i * 0.7;
    ringGroup.add(ring);

    const pGeo = new THREE.SphereGeometry(0.055, 16, 16);
    const pMat = new THREE.MeshBasicMaterial({ color });
    const particle = new THREE.Mesh(pGeo, pMat);
    ringGroup.add(particle);
    rings.push({ ring, particle, radius: 2.6 + i * 0.05, speed: 0.006 + i * 0.003, angle: i * 2, tiltX: ring.rotation.x, tiltY: ring.rotation.y });
  });

  const dustGeo = new THREE.BufferGeometry();
  const dustCount = 180;
  const positions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0x8a8fa3, size: 0.02, transparent: true, opacity: 0.5 });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  let mouseX = 0, mouseY = 0;
  window.addEventListener('mousemove', e => {
    mouseX = (e.clientX / window.innerWidth - 0.5);
    mouseY = (e.clientY / window.innerHeight - 0.5);
  });

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);

  function animate() {
    requestAnimationFrame(animate);
    core.rotation.x += 0.0015;
    core.rotation.y += 0.0022;
    coreSolid.rotation.x = core.rotation.x;
    coreSolid.rotation.y = core.rotation.y;

    rings.forEach(r => {
      r.angle += r.speed;
      const x = Math.cos(r.angle) * r.radius;
      const y = Math.sin(r.angle) * r.radius;
      const vec = new THREE.Vector3(x, y, 0);
      vec.applyEuler(new THREE.Euler(r.tiltX, r.tiltY, 0));
      r.particle.position.copy(vec);
    });

    dust.rotation.y += 0.0003;

    ringGroup.rotation.y += (mouseX * 0.4 - ringGroup.rotation.y) * 0.02;
    ringGroup.rotation.x += (mouseY * 0.3 - ringGroup.rotation.x) * 0.02;

    renderer.render(scene, camera);
  }
  resize();
  animate();
  requestAnimationFrame(() => { canvas.style.opacity = 1; });
})();

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', () => {
  loadServices();
  loadSiteConfig();
});

// ---------- paid consultation (Stripe Checkout) ----------
async function loadSiteConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.stripeEnabled) return;

    const price = data.consultationPrice;
    const priceEl = document.getElementById('consult-price');
    if (priceEl) priceEl.textContent = '$' + (Number.isInteger(price) ? price : price.toFixed(2));

    const paidBlock = document.getElementById('paid-consult');
    const heroBtn = document.getElementById('hero-consult-btn');
    if (paidBlock) paidBlock.hidden = false;
    if (heroBtn) {
      heroBtn.hidden = false;
      heroBtn.textContent = 'Book Strategy Session — $' + (Number.isInteger(price) ? price : price.toFixed(0));
    }

    const checkoutBtn = document.getElementById('consult-checkout-btn');
    if (checkoutBtn) checkoutBtn.addEventListener('click', startConsultationCheckout);
    if (heroBtn) heroBtn.addEventListener('click', () => {
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
      document.getElementById('email')?.focus();
    });
  } catch (err) {
    console.error('Failed to load site config:', err);
  }
}

async function startConsultationCheckout() {
  const btn = document.getElementById('consult-checkout-btn');
  const emailInput = document.getElementById('email');
  const nameInput = document.getElementById('name');
  const email = emailInput?.value?.trim() || '';
  const name = nameInput?.value?.trim() || '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailInput?.focus();
    emailInput?.closest('.field')?.classList.add('invalid');
    const errEl = document.getElementById('err-email');
    if (errEl) errEl.textContent = 'Enter your work email above to book a session.';
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Redirecting to checkout…';
  }

  try {
    const res = await fetch('/api/checkout/consultation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });
    const data = await res.json();
    if (data.ok && data.url) {
      window.location.href = data.url;
      return;
    }
    alert(data.error || 'Could not start checkout. Please try again.');
  } catch (err) {
    alert('Network error — please try again.');
    console.error('Checkout failed:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Book & Pay Now';
    }
  }
}
