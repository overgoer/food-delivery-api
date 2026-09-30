const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../db/database');

// ETag для If-Match-демо: хэш бизнес-полей (updated_at не входит — ETag меняется только при изменении данных)
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

// Утилита: выбрать пользовательские данные + опционально все (для просмотра чужих — баг B9)
function whereClause(req) {
  return { user_token: req.userToken };
}

// GET /stores — список магазинов (+ фильтры)
// БАГ B14: фильтр type нечувствителен к регистру (должен быть точным match)
// БАГ B14.2: фильтр city работает, но city = '' в базе тоже подходит
router.get('/', (req, res) => {
  const db = getDb();
  let sql = 'SELECT * FROM stores WHERE user_token = ?';
  const params = [req.userToken];

  if (req.query.type) {
    sql += ' AND LOWER(type) = LOWER(?)';
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
// БАГ B13: для несуществующего id возвращаем 200 с пустым объектом вместо 404
router.get('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    // БАГ: пустой объект вместо 404
    return res.json({});
  }

  const products = db.prepare('SELECT * FROM products WHERE store_id = ? AND user_token = ?').all(req.params.id, req.userToken);
  store.products = products;
  store.meta = parseMeta(store.meta);

  // v1 отдаёт ETag (для If-Match-демо), но сам If-Match игнорирует (B23)
  res.setHeader('ETag', etagOf(store));
  res.json(store);
});

// POST /stores — добавить магазин
// БАГ B3: пустое название проходит валидацию
router.post('/', (req, res) => {
  const db = getDb();
  const { name, type, city, phone } = req.body || {};

  const result = db.prepare(`
    INSERT INTO stores (user_token, name, type, city, phone)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.userToken, name || '', type || 'restaurant', city || '', phone || '');

  // Возвращаем созданный магазин
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(store);
});

// PATCH /stores/:id — обновить магазин
// БАГ B20: PATCH реализован как PUT — непереданные плоские поля обнуляются (должны оставаться нетронутыми)
// БАГ B21: null-мина — null в meta молча удаляет ключ из JSON (RFC 7386 без защиты)
// БАГ B12: возвращаем старые данные до обновления
// БАГ B23: If-Match игнорируется — перетирает чужие правки без 412
router.patch('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // БАГ B23: заголовок If-Match читается, но НЕ проверяется
  void req.headers['if-match'];

  const body = req.body || {};

  // БАГ B20: непереданные (и null) поля обнуляем до дефолтов — как PUT
  const name = (body.name === undefined || body.name === null) ? '' : body.name;
  const type = (body.type === undefined || body.type === null) ? 'restaurant' : body.type;
  const city = (body.city === undefined || body.city === null) ? '' : body.city;
  const phone = (body.phone === undefined || body.phone === null) ? '' : body.phone;
  const rating = (body.rating === undefined || body.rating === null) ? 0 : body.rating;

  // БАГ B21: meta мержится по RFC 7386 — null в патче молча удаляет ключ (мина)
  let meta = parseMeta(store.meta);
  if (body.meta === null) {
    meta = {};
  } else if (body.meta && typeof body.meta === 'object') {
    const mergePatch = (target, patch) => {
      for (const key of Object.keys(patch)) {
        if (patch[key] === null) {
          delete target[key]; // мина: ключ исчезает без предупреждения
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

  db.prepare('UPDATE stores SET name = ?, type = ?, city = ?, phone = ?, rating = ?, meta = ?, updated_at = ? WHERE id = ? AND user_token = ?')
    .run(name, type, city, phone, rating, JSON.stringify(meta), new Date().toISOString(), req.params.id, req.userToken);

  // БАГ B12: возвращаем store (данные ДО обновления), а не обновлённую запись
  store.meta = parseMeta(store.meta);
  res.json(store);
});

// PUT /stores/:id — полная замена
// БАГ B22: PUT реализован как PATCH — непереданные поля НЕ затираются (должна быть полная замена)
// БАГ B23: If-Match игнорируется
router.put('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // БАГ B23: If-Match не проверяется
  void req.headers['if-match'];

  const body = req.body || {};
  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.city !== undefined) updates.city = body.city;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.rating !== undefined) updates.rating = body.rating;
  if (body.meta !== undefined) updates.meta = JSON.stringify(body.meta);
  updates.updated_at = new Date().toISOString();

  // БАГ B22: обновляем только переданные поля — остальные переживают PUT
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE stores SET ${setClauses} WHERE id = ? AND user_token = ?`).run(...Object.values(updates), req.params.id, req.userToken);

  const updated = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);
  updated.meta = parseMeta(updated.meta);
  res.json(updated);
});

// DELETE /stores/:id — удалить магазин (и каскадно товары)
// БАГ B5: удаляет даже если есть активные заказы, привязанные к товарам этого магазина
router.delete('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // БАГ: Нет проверки на активные заказы. Должна быть:
  // SELECT COUNT(*) FROM orders o
  // JOIN order_items oi ON oi.order_id = o.id
  // JOIN products p ON p.id = oi.product_id
  // WHERE p.store_id = ? AND o.status IN ('pending','preparing')
  db.prepare('DELETE FROM stores WHERE id = ? AND user_token = ?').run(req.params.id, req.userToken);
  res.json({ success: true });
});

module.exports = router;
