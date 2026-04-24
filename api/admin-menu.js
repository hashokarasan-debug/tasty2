// /api/admin-menu.js — POST: Menü speichern (nur Admin)

import crypto from 'crypto';
import { kv } from '@vercel/kv';

function verifyToken(token) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    const decoded  = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    const { payload, sig } = decoded;
    // Ablauf prüfen
    const expires = parseInt(payload.split(':')[1]);
    if (Date.now() > expires) return false;
    // Signatur prüfen
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// Bekannte Produkt-IDs und Kategorien für Validierung
const VALID_CATEGORIES = [
  'Cheese Steak','Kebab','Tacos','Pizza','Pide','Burger',
  'Snacks','Salate','Taschenbrot','Teller','Desserts',
  'Getränke','Alkohol (18+)',
];
const VALID_LABELS = ['beliebt','vegan','scharf','neu'];

function validateMenu(menu) {
  if (!Array.isArray(menu)) return false;
  if (menu.length > 500) return false; // Sanity check
  for (const item of menu) {
    if (typeof item.id !== 'string' || item.id.length > 50) return false;
    if (typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 100) return false;
    const price = Number(item.price);
    if (!Number.isFinite(price) || price < 0.5 || price > 999) return false;
    if (!VALID_CATEGORIES.includes(item.cat)) return false;
    if (!Array.isArray(item.labels)) return false;
    for (const l of item.labels) {
      if (!VALID_LABELS.includes(l)) return false;
    }
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Token aus Authorization Header
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  const { menu } = req.body || {};

  if (!validateMenu(menu)) {
    return res.status(400).json({ error: 'Ungültiges Menü-Format' });
  }

  try {
    // Menü in KV speichern (das VOLLE Menü inkl. deaktivierte)
    await kv.set('tasty:menu', menu);

    // Auch MENU_PRICES für order.js aktualisieren
    const prices = {};
    for (const item of menu) {
      prices[item.id] = Number(item.price);
    }
    await kv.set('tasty:menu_prices', prices);

    return res.status(200).json({ ok: true, count: menu.length });
  } catch (err) {
    console.error('Admin menu save error:', err);
    return res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
  }
}
