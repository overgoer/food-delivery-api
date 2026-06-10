const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

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

// PATCH /stores/:id — обновить магазин
// v2: возвращаем обновлённые данные (B12 исправлен)
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

  // v2: возвращаем обновлённую запись
  const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
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
