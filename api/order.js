// ============================================================
// /api/order.js — Vercel Serverless Function
// Tasty Restaurant & Takeaway — Bestellsystem
//
// Was diese Funktion macht:
//   1. Empfängt die Bestellung vom Frontend (POST JSON)
//   2. Validiert die Daten nochmals serverseitig
//   3. Sendet den Bon an den Epson TM-T20III via PrintNode
//   4. Sendet eine Bestätigungs-Mail via Resend (Backup)
//   5. Antwortet dem Frontend mit Erfolg oder Fehler
//
// Benötigte Environment Variables in Vercel:
//   PRINTNODE_API_KEY   → von printnode.com (API Keys)
//   PRINTNODE_PRINTER_ID → Drucker-ID aus PrintNode Dashboard
//   RESEND_API_KEY      → von resend.com
//   RESEND_FROM         → z.B. bestellung@tasty-widnau.ch
//   RESEND_TO           → z.B. restaurant@tasty-widnau.ch
//   ORDER_SECRET        → beliebiges zufälliges Passwort als Sicherheit
// ============================================================

import { kv } from '@vercel/kv';
import { DEFAULT_MENU } from './_defaultMenu.js';

// Preise werden aus Vercel KV geladen (vom Admin gepflegt)
// Fallback: hardcoded falls KV nicht verfügbar
async function getMenuPrices() {
  try {
    const prices = await kv.get('tasty:menu_prices');
    if (prices && typeof prices === 'object') return prices;
  } catch (e) {
    console.warn('KV nicht verfügbar, nutze Default-Preise');
  }
  // Fallback: aus DEFAULT_MENU
  const prices = {};
  for (const item of DEFAULT_MENU) prices[item.id] = item.price;
  return prices;
}

// LEGACY FALLBACK — wird nur genutzt falls KV komplett ausfällt
const MENU_PRICES_FALLBACK = {
  cs1: 25.90, cs2: 25.90, cs3: 25.90, cs4: 25.90,
  k1: 13.90, k2: 21.00, k3: 13.90, k4: 21.00, k5: 18.90,
  k6: 24.90, k7: 28.90, k8: 13.90, k9: 13.90, k10: 18.90,
  k11: 20.00, k12: 15.90, k13: 16.90, k14: 18.90, k15: 13.90,
  k16: 15.90, k17: 20.00, k18: 22.00, k19: 12.90, k20: 20.00,
  k21: 17.00, k22: 20.00, k23: 18.90, k24: 16.00, k25: 14.90,
  k26: 15.00, k27: 15.00, k28: 15.00,
  ta1: 24.00, ta2: 16.00, ta3: 16.00, ta4: 18.00, ta5: 16.00,
  ta6: 18.00, ta7: 16.00, ta8: 16.90, ta9: 17.00,
  pz1: 14.00, pz2: 14.00, pz3: 18.00, pz4: 18.00, pz5: 18.00,
  pz6: 16.00, pz7: 17.00, pz8: 18.00, pz9: 17.00, pz10: 16.00,
  pz11: 17.00, pz12: 18.00, pz13: 19.00, pz14: 17.00, pz15: 17.00,
  pz16: 17.00, pz17: 15.00, pz18: 18.00, pz19: 19.00, pz20: 21.00,
  pz21: 21.00, pz22: 21.00, pz23: 19.00, pz24: 21.00, pz25: 19.00,
  pz26: 20.00, pz27: 18.00, pz28: 19.00,
  pi1: 23.00, pi2: 16.00, pi3: 16.00, pi4: 16.00,
  pi5: 13.00, pi6: 19.00, pi7: 19.00,
  bu1: 16.00, bu2: 15.00, bu3: 18.00, bu4: 16.90,
  sn1: 9.00, sn2: 15.00, sn3: 9.90, sn4: 14.00, sn5: 16.00,
  sn6: 9.00, sn7: 15.00, sn8: 11.00, sn9: 11.00, sn10: 11.00,
  sn11: 9.00, sn12: 15.90, sn13: 15.90, sn14: 18.00, sn15: 13.00,
  sn16: 13.00, sn17: 13.00, sn18: 16.00, sn19: 12.50,
  sa1: 7.00, sa2: 11.00, sa3: 13.00, sa4: 13.00, sa5: 19.00,
  tb1: 13.00, tb2: 13.50, tb3: 14.00, tb4: 13.00, tb5: 15.90,
  tg1: 18.00, tg2: 17.50, tg3: 25.00, tg4: 20.00, tg5: 20.00,
  tg6: 20.00, tg7: 16.00, tg8: 23.00, tg9: 16.00, tg10: 14.90,
  d1: 8.00, d2: 10.00, d3: 9.90, d4: 8.50,
  d5: 15.00, d6: 15.00, d7: 8.00, d8: 10.00,
  g1: 3.50, g2: 4.00, g3: 3.50, g4: 4.00, g5: 3.50,
  g6: 4.00, g7: 3.50, g8: 4.00, g9: 3.50, g10: 4.00,
  g11: 4.00, g12: 4.00, g13: 5.00, g14: 3.50, g15: 4.00,
  g16: 4.00, g17: 5.00, g18: 6.00,
  al1: 6.00, al2: 5.00, al3: 25.00, al4: 6.00,
};

const DELIVERY_ZONES = {
  '9443': { name: 'Widnau',     zone: 1, fee: 0.00 },
  '9434': { name: 'Au SG',      zone: 2, fee: 3.00 },
  '9442': { name: 'Berneck',    zone: 2, fee: 3.00 },
  '9444': { name: 'Diepoldsau', zone: 3, fee: 5.00 },
  '9436': { name: 'Balgach',    zone: 3, fee: 5.00 },
};
const FREE_DELIVERY_FROM = 40.00;

function chf(val) {
  return 'CHF ' + Number(val).toFixed(2);
}

// ── Serverseitige Preisberechnung (aus KV) ─────────────────
async function recalcOrder(items) {
  const MENU_PRICES = await getMenuPrices();
  let subtotal = 0;
  const verified = [];
  for (const item of items) {
    const serverPrice = MENU_PRICES[item.id];
    if (!serverPrice) continue; // Unbekannte ID ignorieren
    const qty = Math.min(Math.max(1, parseInt(item.qty) || 1), 20);
    subtotal += serverPrice * qty;
    verified.push({ ...item, price: serverPrice, qty });
  }
  return { verified, subtotal: Math.round(subtotal * 100) / 100 };
}

function getDeliveryFee(orderType, plz, subtotal) {
  if (orderType !== 'Lieferung') return 0;
  const zone = DELIVERY_ZONES[plz];
  if (!zone) return null;
  return subtotal >= FREE_DELIVERY_FROM ? 0 : zone.fee;
}

// ── ESC/POS Bon für Epson TM-T20III ───────────────────────
// Epson TM-T20III: 80mm Papier = 42 Zeichen pro Zeile
function buildEscPos(data, items, subtotal, deliveryFee, total) {
  const ESC = '\x1B';
  const GS  = '\x1D';
  const LF  = '\x0A';
  const BOLD_ON   = ESC + 'E\x01';
  const BOLD_OFF  = ESC + 'E\x00';
  const CENTER     = ESC + 'a\x01';
  const LEFT       = ESC + 'a\x00';
  const DOUBLE_ON  = GS  + '!\x11'; // Doppelte Höhe + Breite
  const DOUBLE_OFF = GS  + '!\x00';
  const CUT        = GS  + 'V\x41\x03'; // Teilschnitt
  const LINE       = '─'.repeat(42);

  function pad(left, right, width = 42) {
    const space = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, space)) + right;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('de-CH');
  const timeStr = now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

  let bon = '';

  // Header
  bon += CENTER;
  bon += DOUBLE_ON;
  bon += BOLD_ON;
  bon += 'TASTY' + LF;
  bon += DOUBLE_OFF;
  bon += 'Restaurant & Takeaway' + LF;
  bon += 'Bahnhofstrasse 28, 9443 Widnau' + LF;
  bon += 'Tel: +41 71 750 02 02' + LF;
  bon += BOLD_OFF;
  bon += LF;

  // Bestellinfo
  bon += LEFT;
  bon += BOLD_ON + LINE + LF + BOLD_OFF;
  bon += BOLD_ON;
  bon += pad('NEUE BESTELLUNG', dateStr + ' ' + timeStr) + LF;
  bon += BOLD_OFF;
  bon += BOLD_ON + LINE + LF + BOLD_OFF;
  bon += LF;

  // Bestellart gross
  bon += CENTER;
  bon += DOUBLE_ON + BOLD_ON;
  bon += (data.orderType === 'Lieferung' ? '🛵  LIEFERUNG' : '🏃  ABHOLUNG') + LF;
  bon += DOUBLE_OFF + BOLD_OFF;
  bon += LEFT;
  bon += LF;

  // Kundendaten
  bon += BOLD_ON + 'KUNDE:' + LF + BOLD_OFF;
  bon += 'Name:    ' + data.name + LF;
  bon += 'Tel:     ' + data.phone + LF;
  if (data.email && data.email !== '—') {
    bon += 'E-Mail:  ' + data.email + LF;
  }
  if (data.orderType === 'Lieferung') {
    bon += 'Adresse: ' + data.address + LF;
    bon += '         ' + data.plz + ' ' + data.ort + LF;
  }
  bon += LF;

  // Zeit & Zahlung
  bon += pad('Zeit:', data.time) + LF;
  bon += pad('Zahlung:', data.payment) + LF;
  bon += LF;

  // Artikel
  bon += BOLD_ON + LINE + LF + BOLD_OFF;
  bon += BOLD_ON + 'BESTELLUNG:' + LF + BOLD_OFF;
  bon += BOLD_ON + LINE + LF + BOLD_OFF;

  for (const item of items) {
    const lineTotal = chf(item.price * item.qty);
    const nameStr = item.qty + 'x ' + item.name;
    // Langer Name → umbrechen
    if (nameStr.length > 30) {
      bon += nameStr + LF;
      bon += pad('  ' + chf(item.price) + ' / Stk', lineTotal) + LF;
    } else {
      bon += pad(nameStr, lineTotal) + LF;
    }
  }

  bon += BOLD_ON + LINE + LF + BOLD_OFF;

  // Totals
  bon += pad('Zwischensumme:', chf(subtotal)) + LF;
  if (data.orderType === 'Lieferung') {
    bon += pad('Lieferkosten:', deliveryFee === 0 ? 'Gratis' : chf(deliveryFee)) + LF;
  }
  bon += BOLD_ON;
  bon += pad('TOTAL:', chf(total)) + LF;
  bon += BOLD_OFF;
  bon += LF;

  // Bemerkungen
  if (data.note && data.note !== '—') {
    bon += BOLD_ON + 'BEMERKUNGEN:' + LF + BOLD_OFF;
    // Zeilen umbrechen bei 42 Zeichen
    const words = data.note.split(' ');
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > 42) {
        bon += line.trim() + LF;
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) bon += line + LF;
    bon += LF;
  }

  // Footer
  bon += CENTER;
  bon += BOLD_ON + LINE + LF + BOLD_OFF;
  bon += 'Danke für Ihre Bestellung!' + LF;
  bon += 'www.tasty-widnau.ch' + LF;
  bon += LF + LF + LF;
  bon += CUT;

  return bon;
}

// ── PrintNode: Bon an Drucker senden ──────────────────────
async function printViaPrintNode(escPosContent) {
  const apiKey  = process.env.PRINTNODE_API_KEY;
  const printer = process.env.PRINTNODE_PRINTER_ID;

  if (!apiKey || !printer) {
    throw new Error('PrintNode nicht konfiguriert (PRINTNODE_API_KEY / PRINTNODE_PRINTER_ID fehlen)');
  }

  // ESC/POS als Base64
  const base64 = Buffer.from(escPosContent, 'binary').toString('base64');

  const payload = {
    printerId: parseInt(printer),
    title:     'Bestellung — Tasty Restaurant',
    contentType: 'raw_base64',
    content:   base64,
    source:    'Tasty Bestellsystem',
  };

  const res = await fetch('https://api.printnode.com/printjobs', {
    method:  'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('PrintNode Fehler: ' + res.status + ' — ' + text);
  }

  return await res.json(); // PrintJob-ID
}

// ── Resend: Bestätigungs-Mail senden ──────────────────────
async function sendMailViaResend(data, items, subtotal, deliveryFee, total) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.RESEND_FROM;
  const to     = process.env.RESEND_TO;

  if (!apiKey || !from || !to) {
    console.warn('Resend nicht konfiguriert — Mail wird übersprungen');
    return;
  }

  const itemsText = items
    .map(i => `${i.qty}× ${i.name} à ${chf(i.price)} = ${chf(i.price * i.qty)}`)
    .join('\n');

  const now = new Date();
  const dateStr = now.toLocaleDateString('de-CH') + ' ' + now.toLocaleTimeString('de-CH');

  const text = `
NEUE BESTELLUNG — TASTY RESTAURANT & TAKEAWAY
==============================================
Eingegangen: ${dateStr}

KUNDENDATEN:
Name:       ${data.name}
Telefon:    ${data.phone}
E-Mail:     ${data.email}

LIEFERART:  ${data.orderType}${data.zone && data.zone !== '—' ? ' · ' + data.zone : ''}
Adresse:    ${data.address}
PLZ / Ort:  ${data.plz} ${data.ort}

Zeit:       ${data.time}
Zahlung:    ${data.payment}

BESTELLUNG:
${itemsText}

Zwischensumme: ${chf(subtotal)}
Lieferkosten:  ${data.orderType === 'Lieferung' ? (deliveryFee === 0 ? 'Gratis' : chf(deliveryFee)) : 'Keine'}
TOTAL:         ${chf(total)}

BEMERKUNGEN: ${data.note}
`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: `🍕 Neue Bestellung: ${data.name} — ${data.orderType} — ${chf(total)}`,
      text,
    }),
  });

  if (!res.ok) {
    const text2 = await res.text();
    console.error('Resend Fehler:', res.status, text2);
    // Mail-Fehler wirft keinen Error — Druck ist wichtiger
  }
}

// ── Haupt-Handler ──────────────────────────────────────────
export default async function handler(req, res) {
  // Nur POST erlauben
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // CORS-Header (nur eigene Domain erlauben in Produktion)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  try {
    const data = req.body;

    // ── 1. Basis-Validierung ────────────────────────────
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Ungültige Anfrage' });
    }
    if (!data.name || !data.phone) {
      return res.status(400).json({ error: 'Name und Telefon sind erforderlich' });
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return res.status(400).json({ error: 'Warenkorb ist leer' });
    }
    if (!['Abholung', 'Lieferung'].includes(data.orderType)) {
      return res.status(400).json({ error: 'Ungültige Bestellart' });
    }
    if (!['Barzahlung', 'TWINT'].includes(data.payment)) {
      return res.status(400).json({ error: 'Ungültige Zahlungsart' });
    }

    // ── 2. Preise serverseitig neu berechnen ────────────
    const { verified, subtotal } = await recalcOrder(data.items);
    if (verified.length === 0) {
      return res.status(400).json({ error: 'Keine gültigen Produkte in der Bestellung' });
    }

    // ── 3. Liefergebühr serverseitig berechnen ──────────
    const deliveryFee = getDeliveryFee(data.orderType, data.plz, subtotal);
    if (data.orderType === 'Lieferung' && deliveryFee === null) {
      return res.status(400).json({ error: 'Lieferung in dieses Gebiet nicht möglich' });
    }
    const total = subtotal + (deliveryFee || 0);

    // ── 4. Bon drucken (Epson TM-T20III via PrintNode) ──
    const escPos = buildEscPos(data, verified, subtotal, deliveryFee, total);
    await printViaPrintNode(escPos);

    // ── 5. Bestätigungs-Mail senden (Backup) ────────────
    await sendMailViaResend(data, verified, subtotal, deliveryFee, total);

    // ── 6. Erfolg zurückmelden ───────────────────────────
    return res.status(200).json({
      ok:    true,
      total: chf(total),
    });

  } catch (err) {
    console.error('Order API Error:', err);
    return res.status(500).json({
      error: 'Interner Fehler: ' + err.message,
    });
  }
}
