// /api/admin-auth.js
// Prüft das Admin-Passwort und gibt einen Session-Token zurück
//
// Environment Variable:
//   ADMIN_PASSWORD  → das Passwort das du dem Restaurant gibst
//   ADMIN_SECRET    → beliebiger zufälliger String für Token-Signierung
//                     z.B. in Terminal: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};

  const correctPassword = process.env.ADMIN_PASSWORD;
  const secret          = process.env.ADMIN_SECRET;

  if (!correctPassword || !secret) {
    return res.status(500).json({ error: 'Admin nicht konfiguriert (ADMIN_PASSWORD / ADMIN_SECRET fehlen)' });
  }

  if (!password || password !== correctPassword) {
    // Kurze Verzögerung gegen Brute-Force
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ error: 'Falsches Passwort' });
  }

  // Einfacher HMAC-Token: timestamp + signature
  // Gültig für 12 Stunden
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const payload = `admin:${expires}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const token   = Buffer.from(JSON.stringify({ payload, sig })).toString('base64');

  return res.status(200).json({ token });
}
