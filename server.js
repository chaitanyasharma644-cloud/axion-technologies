require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Hindustan Group <onboarding@resend.dev>';
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CONSULTATION_PRICE_CENTS = parseInt(process.env.CONSULTATION_PRICE_CENTS || '19900', 10);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'inquiries.json');

// ---------- tiny JSON-file "database" ----------
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf-8');
}
ensureDb();

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

function validateContact(body) {
  const errors = {};
  const name = (body.name || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const company = (body.company || '').toString().trim();
  const service = (body.service || '').toString().trim();
  const message = (body.message || '').toString().trim();

  if (!name || name.length < 2) errors.name = 'Please enter your name.';
  if (!email || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email.';
  if (!message || message.length < 10) errors.message = 'Message should be at least 10 characters.';
  if (name.length > 120) errors.name = 'Name is too long.';
  if (message.length > 4000) errors.message = 'Message is too long.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    clean: { name, email, company, service, message }
  };
}

// ---------- email notifications ----------
async function notifyNewInquiry(inquiry) {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) return;

  const serviceLabel = inquiry.service || 'General inquiry';
  const body = `
    <h2>New project inquiry</h2>
    <p><strong>Name:</strong> ${escapeHtml(inquiry.name)}</p>
    <p><strong>Email:</strong> <a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a></p>
    <p><strong>Company:</strong> ${escapeHtml(inquiry.company || '—')}</p>
    <p><strong>Service:</strong> ${escapeHtml(serviceLabel)}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(inquiry.message).replace(/\n/g, '<br>')}</p>
    <hr>
    <p style="color:#666;font-size:12px;">Submitted ${inquiry.createdAt} · Reply within one business day to convert this lead.</p>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [NOTIFY_EMAIL],
        subject: `New lead: ${inquiry.name} — ${serviceLabel}`,
        html: body
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Resend notification failed:', err);
    }
  } catch (err) {
    console.error('Failed to send lead notification:', err);
  }
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
  res.json({
    ok: true,
    services: [
      { id: 'cloud', code: '01', title: 'Cloud Infrastructure & Migration', desc: 'Architecture, provisioning, and migration across AWS, Azure, and GCP — sized to your traffic, not oversold.' },
      { id: 'security', code: '02', title: 'Cybersecurity & Compliance', desc: 'Threat monitoring, penetration testing, and audit-ready compliance for SOC 2, ISO 27001, and GDPR.' },
      { id: 'software', code: '03', title: 'Custom Software Development', desc: 'Web, mobile, and internal tooling — designed with your workflows in mind, shipped in weeks not quarters.' },
      { id: 'ai', code: '04', title: 'AI & Data Engineering', desc: 'Pipelines, model integration, and analytics infrastructure that turn raw data into working decisions.' },
      { id: 'support', code: '05', title: 'Managed IT Support', desc: 'Round-the-clock helpdesk, endpoint management, and network monitoring so nothing waits till Monday.' },
      { id: 'consulting', code: '06', title: 'IT Consulting & Strategy', desc: 'Roadmaps, vendor audits, and technical due diligence for teams deciding what to build next.' }
    ]
  });
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
    createdAt: new Date().toISOString(),
    ip: req.ip
  };

  try {
    const list = readInquiries();
    list.unshift(inquiry);
    await writeInquiries(list);
    notifyNewInquiry(inquiry).catch(err => console.error('Notification error:', err));
    res.json({ ok: true, message: "Thanks — we've got it. We'll reply within one business day." });
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
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

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
  console.log(`Hindustan Group server running on http://localhost:${PORT}`);
  if (ADMIN_KEY === 'changeme') {
    console.warn('WARNING: ADMIN_KEY is using the default value. Set a real one in your .env before deploying.');
  }
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    console.warn('TIP: Set RESEND_API_KEY + NOTIFY_EMAIL to get instant email alerts when leads submit the contact form.');
  }
  if (!stripe) {
    console.warn('TIP: Set STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY to enable paid $' + (CONSULTATION_PRICE_CENTS / 100) + ' strategy sessions.');
  }
});
