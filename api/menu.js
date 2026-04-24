// /api/menu.js  — GET: gibt das aktuelle Menü zurück (public)
// /api/admin-menu.js — POST: speichert das Menü (nur mit Admin-Token)
//
// Menü wird in Vercel KV gespeichert (kostenlos bis 30'000 req/Monat)
//
// Environment Variables:
//   KV_REST_API_URL   → automatisch von Vercel KV gesetzt
//   KV_REST_API_TOKEN → automatisch von Vercel KV gesetzt

// Dieses File ist /api/menu.js — nur GET (öffentlich)

import { kv } from '@vercel/kv';

// Fallback: das original Menü falls KV noch leer ist
// (wird beim ersten Start verwendet, danach überschrieben)
import { DEFAULT_MENU } from './_defaultMenu.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Cache-Header: 10 Sekunden — damit Änderungen schnell sichtbar sind
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');

  try {
    let menu = await kv.get('tasty:menu');

    // Noch kein Menü gespeichert → Default laden und einmalig speichern
    if (!menu) {
      menu = DEFAULT_MENU;
      await kv.set('tasty:menu', menu);
    }

    // Nur aktive Produkte für die Website zurückgeben
    const activeMenu = menu.filter(item => item.active !== false);

    return res.status(200).json({ menu: activeMenu });
  } catch (err) {
    console.error('Menu GET error:', err);
    // Fallback: Default-Menü falls KV nicht verfügbar
    return res.status(200).json({ menu: DEFAULT_MENU.filter(i => i.active !== false) });
  }
}
