const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

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
// БАГ B12: возвращаем старые данные до обновления
router.patch('/:id', (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  const { name, type, city, phone, rating } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (type !== undefined) updates.type = type;
  if (city !== undefined) updates.city = city;
  if (phone !== undefined) updates.phone = phone;
  if (rating !== undefined) updates.rating = rating;
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(`UPDATE stores SET ${setClauses} WHERE id = ? AND user_token = ?`).run(...values, req.params.id, req.userToken);
  }

  // БАГ: возвращаем store (данные ДО обновления), а не обновлённую запись
  res.json(store);
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
