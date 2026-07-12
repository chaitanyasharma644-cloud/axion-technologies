require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hindustangroupjammu@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Hindustan Group <onboarding@resend.dev>';
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CONSULTATION_PRICE_CENTS = parseInt(process.env.CONSULTATION_PRICE_CENTS || '19900', 10);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'inquiries.json');
const SERVICES_FILE = path.join(DATA_DIR, 'services.json');

// ---------- tiny JSON-file "database" ----------
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf-8');
}
ensureDb();

function readServices() {
  try {
    const raw = fs.readFileSync(SERVICES_FILE, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Failed to read services.json:', err.message);
    return [];
  }
}

function serviceLabel(id) {
  if (!id) return 'General inquiry';
  const match = readServices().find(s => s.id === id);
  return match ? match.title : id;
}

let writeQueue = Promise.resolve();
function readInquiries() {
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try { return JSON.parse(raw); } catch { return []; }
}
function writeInquiries(list) {
  // serialize writes so concurrent submissions can't clobber each other
  writeQueue = writeQueue.then(() =>
    fsp.writeFile(DB_FILE, JSON.stringify(list, null, 2), 'utf-8')
  );
  return writeQueue;
}

// ---------- middleware ----------
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// very small in-memory rate limiter: 5 submissions / 15 min / IP
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  hits.set(ip, entry);
  if (entry.count > 5) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  }
  next();
}

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ---------- validation ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  return String(raw || '').trim();
}

function validateContact(body) {
  const isDemo = body.source === 'ai-employee-demo';
  const errors = {};
  let name = (body.name || '').toString().trim();
  let email = (body.email || '').toString().trim();
  const phone = normalizePhone(body.phone);
  let company = (body.company || '').toString().trim();
  const service = (body.service || '').toString().trim();
  const plan = (body.plan || '').toString().trim();
  let message = (body.message || '').toString().trim();
  const services = readServices();
  const validServiceIds = new Set(services.map(s => s.id));

  if (isDemo) {
    company = company || name;
    name = name || company;
    if (!company || company.length < 2) errors.company = 'Please enter your business name.';
    if (!phone || !PHONE_RE.test(phone.replace(/\s/g, ''))) errors.phone = 'Please enter a valid 10-digit mobile number.';
    if (email && !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email.';
    if (service && !validServiceIds.has(service)) errors.service = 'Please choose a valid industry.';
    if (!message) {
      message = `Free AI Employee demo request${plan ? ` (${plan} plan)` : ''}. Industry: ${serviceLabel(service)}. Callback requested within 24 hours.`;
    }
  } else {
    if (!name || name.length < 2) errors.name = 'Please enter your name.';
    if (!email || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email.';
    if (phone && !PHONE_RE.test(phone.replace(/\s/g, ''))) errors.phone = 'Please enter a valid 10-digit mobile number.';
    if (service && !validServiceIds.has(service)) errors.service = 'Please choose a valid service.';
    if (!message || message.length < 10) errors.message = 'Message should be at least 10 characters.';
    if (name.length > 120) errors.name = 'Name is too long.';
    if (message.length > 4000) errors.message = 'Message is too long.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    clean: {
      name: name || company,
      email,
      phone,
      company: company || name,
      service,
      message,
      plan,
      source: isDemo ? 'ai-employee-demo' : 'contact'
    }
  };
}

// ---------- email notifications ----------
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  if (!res.ok) {
    console.error('Email send failed:', await res.text());
    return false;
  }
  return true;
}

async function notifyNewInquiry(inquiry) {
  if (!NOTIFY_EMAIL) return;

  const label = serviceLabel(inquiry.service);
  const brand = inquiry.source === 'ai-employee-demo' ? 'AI Employee' : 'Hindustan Group';
  const planLine = inquiry.plan ? `<p><strong>Plan:</strong> ${escapeHtml(inquiry.plan)}</p>` : '';
  const staffBody = `
    <h2>New inquiry — ${brand}</h2>
    <p><strong>Name:</strong> ${escapeHtml(inquiry.name)}</p>
    <p><strong>Email:</strong> ${inquiry.email ? `<a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a>` : '—'}</p>
    <p><strong>Phone:</strong> ${escapeHtml(inquiry.phone || '—')}</p>
    <p><strong>Company:</strong> ${escapeHtml(inquiry.company || '—')}</p>
    <p><strong>Industry:</strong> ${escapeHtml(label)}</p>
    ${planLine}
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(inquiry.message).replace(/\n/g, '<br>')}</p>
    <hr>
    <p style="color:#666;font-size:12px;">Submitted ${inquiry.createdAt} · Reply promptly to convert this lead.</p>
  `;

  await sendEmail({
    to: [NOTIFY_EMAIL],
    subject: inquiry.source === 'ai-employee-demo'
      ? `AI Employee demo: ${inquiry.company || inquiry.name} — ${label}`
      : `New lead: ${inquiry.name} — ${label}`,
    html: staffBody
  });

  if (!inquiry.email) return;

  const customerBody = `
    <h2>We received your request</h2>
    <p>Hi ${escapeHtml(inquiry.name)},</p>
    <p>Thank you for contacting ${brand}. We received your inquiry about <strong>${escapeHtml(label)}</strong> and will reply within one business day.</p>
    <p><strong>Your message:</strong><br>${escapeHtml(inquiry.message).replace(/\n/g, '<br>')}</p>
    <hr>
    <p style="color:#666;font-size:12px;">
      A unit of Hindustan Group · A Block, Bahu Plaza, Jammu<br>
      +91 60053 93770 · hindustangroupjammu@gmail.com
    </p>
  `;

  await sendEmail({
    to: [inquiry.email],
    subject: `We received your request — ${brand}`,
    html: customerBody
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- API routes ----------

// list of services the frontend renders dynamically
app.get('/api/services', (req, res) => {
  const services = readServices();
  if (!services.length) {
    return res.status(500).json({ ok: false, error: 'Services unavailable right now.' });
  }
  res.json({ ok: true, services });
});

// submit contact / project inquiry -> stored in DB
app.post('/api/contact', rateLimit, async (req, res) => {
  const { valid, errors, clean } = validateContact(req.body);
  if (!valid) {
    return res.status(400).json({ ok: false, errors });
  }

  const inquiry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    ...clean,
    serviceLabel: serviceLabel(clean.service),
    createdAt: new Date().toISOString(),
    ip: req.ip
  };

  try {
    const list = readInquiries();
    list.unshift(inquiry);
    await writeInquiries(list);
    notifyNewInquiry(inquiry).catch(err => console.error('Notification error:', err));
    const reply = inquiry.source === 'ai-employee-demo'
      ? "Thanks! We'll call you within 24 hours to schedule your free demo."
      : "Thanks — we've got it. We'll reply within one business day.";
    res.json({ ok: true, message: reply });
  } catch (err) {
    console.error('Failed to save inquiry:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong on our end. Please try again shortly.' });
  }
});

// admin: list inquiries (requires x-admin-key header or ?key=)
app.get('/api/admin/inquiries', adminAuth, (req, res) => {
  const list = readInquiries();
  res.json({ ok: true, count: list.length, inquiries: list });
});

// admin: delete a single inquiry
app.delete('/api/admin/inquiries/:id', adminAuth, async (req, res) => {
  const list = readInquiries();
  const next = list.filter(i => i.id !== req.params.id);
  await writeInquiries(next);
  res.json({ ok: true, count: next.length });
});

// health check for deploy platforms
app.get('/api/health', (req, res) => {
  const services = readServices();
  res.json({
    ok: true,
    uptime: process.uptime(),
    services: services.length,
    emailAlerts: Boolean(RESEND_API_KEY && NOTIFY_EMAIL)
  });
});

// public config for frontend (no secrets)
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    stripeEnabled: Boolean(stripe && STRIPE_PUBLISHABLE_KEY),
    stripePublishableKey: STRIPE_PUBLISHABLE_KEY || null,
    consultationPrice: CONSULTATION_PRICE_CENTS / 100
  });
});

// paid strategy session — Stripe Checkout (direct revenue)
app.post('/api/checkout/consultation', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      ok: false,
      error: 'Paid consultations are not configured yet. Use the contact form or email us directly.'
    });
  }

  const email = (req.body.email || '').toString().trim();
  const name = (req.body.name || '').toString().trim();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please provide a valid email.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: CONSULTATION_PRICE_CENTS,
          product_data: {
            name: '60-Minute IT Strategy Session',
            description: 'One-on-one consultation with a Hindustan Group engineer — architecture review, roadmap, or vendor audit.',
          }
        },
        quantity: 1
      }],
      metadata: { name: name || 'Guest', type: 'consultation' },
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#contact`
    });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('Stripe checkout failed:', err);
    res.status(500).json({ ok: false, error: 'Could not start checkout. Please try again.' });
  }
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`AI Employee server running on http://localhost:${PORT}`);
  if (ADMIN_KEY === 'changeme') {
    console.warn('WARNING: ADMIN_KEY is using the default value. Set a real one in your .env before deploying.');
  }
  if (!RESEND_API_KEY) {
    console.warn('TIP: Set RESEND_API_KEY to email leads to ' + NOTIFY_EMAIL + ' automatically.');
  }
  if (!stripe) {
    console.warn('TIP: Set STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY to enable paid $' + (CONSULTATION_PRICE_CENTS / 100) + ' strategy sessions.');
  }
});
