const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../db/database');

// ETag для If-Match: хэш бизнес-полей (updated_at не входит — ETag меняется только при изменении данных)
function parseMeta(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}

function etagOf(store) {
  const payload = JSON.stringify({
    name: store.name, type: store.type, city: store.city,
    phone: store.phone, rating: store.rating, is_active: store.is_active,
    meta: JSON.stringify(parseMeta(store.meta))
  });
  return '"' + crypto.createHash('sha1').update(payload).digest('hex').slice(0, 12) + '"';
}

// GET /stores — список магазинов (+ фильтры)
// v2: фильтры чувствительны к регистру (B14 исправлен)
router.get('/', (req, res) => {
  const db = getDb();
  let sql = 'SELECT * FROM stores WHERE user_token = ?';
  const params = [req.userToken];

  if (req.query.type) {
    sql += ' AND type = ?';
    params.push(req.query.type);
  }

  if (req.query.city) {
    sql += ' AND city = ?';
    params.push(req.query.city);
  }

  const stores = db.prepare(sql).all(...params);
  res.json(stores);
});

// GET /stores/:id — детально магазин + меню
// v2: 404 для несуществующего id (B13 исправлен)
router.get('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  const products = db.prepare('SELECT * FROM products WHERE store_id = ? AND user_token = ?').all(req.params.id, req.userToken);
  store.products = products;
  store.meta = parseMeta(store.meta);

  // v2: отдаём ETag — версию ресурса для If-Match (B23 исправлен)
  res.setHeader('ETag', etagOf(store));
  res.json(store);
});

// POST /stores — добавить магазин
// v2: валидация названия (B3 исправлен)
router.post('/', (req, res) => {
  const db = getDb();
  const { name, type, city, phone } = req.body || {};

  // v2: название магазина обязательно
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Название магазина обязательно' });
  }

  const result = db.prepare(`
    INSERT INTO stores (user_token, name, type, city, phone)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.userToken, name.trim(), type || 'restaurant', city || '', phone || '');

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(store);
});

// PATCH /stores/:id — частичное обновление по RFC 7386
// v2: непереданные поля остаются нетронутыми (B20 исправлен)
// v2: null в name → 400 (защита обязательных полей); null в meta → осознанное удаление ключа (RFC 7386)
// v2: If-Match не совпал → 412 (B23 исправлен); возвращаем обновлённую запись (B12 исправлен)
router.patch('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // v2: If-Match — примени патч, только если версия та же (B23 исправлен)
  const ifMatch = req.headers['if-match'];
  if (ifMatch && ifMatch !== etagOf(store)) {
    return res.status(412).json({
      error: 'Precondition Failed: данные изменились, твоя копия устарела. Сделай GET заново и реши конфликт.'
    });
  }

  const body = req.body || {};

  // v2: name обязателен — null и пустая строка не разрешены
  if (body.name === null || (typeof body.name === 'string' && body.name.trim() === '')) {
    return res.status(400).json({ error: 'name обязателен: null и пустая строка не разрешены' });
  }

  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  // v2: null для необязательных плоских полей = осознанный сброс к дефолту (задокументировано)
  if (body.type !== undefined) updates.type = body.type === null ? 'restaurant' : body.type;
  if (body.city !== undefined) updates.city = body.city === null ? '' : body.city;
  if (body.phone !== undefined) updates.phone = body.phone === null ? '' : body.phone;
  if (body.rating !== undefined) updates.rating = body.rating === null ? 0 : body.rating;

  // v2: meta — честный RFC 7386: null-ключи удаляются осознанно (задокументировано в openapi)
  let meta = parseMeta(store.meta);
  if (body.meta === null) {
    meta = {};
  } else if (body.meta && typeof body.meta === 'object') {
    const mergePatch = (target, patch) => {
      for (const key of Object.keys(patch)) {
        if (patch[key] === null) {
          delete target[key]; // RFC 7386: null = удалить поле
        } else if (typeof patch[key] === 'object' && !Array.isArray(patch[key]) &&
                   typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
          mergePatch(target[key], patch[key]);
        } else {
          target[key] = patch[key];
        }
      }
      return target;
    };
    meta = mergePatch(meta, body.meta);
  }
  if (body.meta !== undefined) updates.meta = JSON.stringify(meta);

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE stores SET ${setClauses} WHERE id = ? AND user_token = ?`).run(...Object.values(updates), req.params.id, req.userToken);
  }

  // v2: возвращаем обновлённую запись (B12 исправлен)
  const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  updated.meta = parseMeta(updated.meta);
  res.json(updated);
});

// PUT /stores/:id — полная замена (B22 исправлен)
// v2: непереданные поля затираются до дефолтов — это спека PUT, не баг
// v2: If-Match не совпал → 412
router.put('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // v2: If-Match (B23 исправлен)
  const ifMatch = req.headers['if-match'];
  if (ifMatch && ifMatch !== etagOf(store)) {
    return res.status(412).json({
      error: 'Precondition Failed: данные изменились, твоя копия устарела. Сделай GET заново и реши конфликт.'
    });
  }

  const body = req.body || {};

  // v2: PUT требует полный ресурс — name обязателен
  if (body.name === null || body.name === undefined || (typeof body.name === 'string' && body.name.trim() === '')) {
    return res.status(400).json({ error: 'PUT требует полный ресурс: name обязателен' });
  }

  // Полная замена: непереданные поля — в дефолт
  const name = body.name;
  const type = (body.type === undefined || body.type === null) ? 'restaurant' : body.type;
  const city = (body.city === undefined || body.city === null) ? '' : body.city;
  const phone = (body.phone === undefined || body.phone === null) ? '' : body.phone;
  const rating = (body.rating === undefined || body.rating === null) ? 0 : body.rating;
  const meta = (body.meta === undefined || body.meta === null) ? {} : body.meta;

  db.prepare('UPDATE stores SET name = ?, type = ?, city = ?, phone = ?, rating = ?, meta = ?, updated_at = ? WHERE id = ? AND user_token = ?')
    .run(name, type, city, phone, rating, JSON.stringify(meta), new Date().toISOString(), req.params.id, req.userToken);

  const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  updated.meta = parseMeta(updated.meta);
  res.json(updated);
});

// DELETE /stores/:id — удалить магазин
// v2: проверка на активные заказы (B5 исправлен)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // v2: проверяем, есть ли активные заказы с товарами этого магазина
  const activeOrders = db.prepare(`
    SELECT COUNT(*) as cnt FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE p.store_id = ? AND o.status IN ('pending', 'confirmed', 'preparing')
  `).get(req.params.id);

  if (activeOrders.cnt > 0) {
    return res.status(409).json({ error: 'Нельзя удалить магазин с активными заказами' });
  }

  db.prepare('DELETE FROM stores WHERE id = ? AND user_token = ?').run(req.params.id, req.userToken);
  res.json({ success: true });
});

module.exports = router;
