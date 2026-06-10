const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /stores/:storeId/products — товары магазина (+ фильтр по category)
router.get('/stores/:storeId/products', (req, res) => {
  const db = getDb();
  let sql = 'SELECT * FROM products WHERE store_id = ? AND user_token = ?';
  const params = [req.params.storeId, req.userToken];

  if (req.query.category) {
    sql += ' AND category = ?';
    params.push(req.query.category);
  }

  const products = db.prepare(sql).all(...params);
  res.json(products);
});

// POST /stores/:storeId/products — добавить товар
// v2: валидация названия и цены > 0 (B4 исправлен частично)
router.post('/stores/:storeId/products', (req, res) => {
  const db = getDb();
  const { name, description, price, category, stock } = req.body || {};

  // Проверка: магазин принадлежит пользователю
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_token = ?').get(req.params.storeId, req.userToken);
  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  // v2: название товара обязательно
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Название товара обязательно' });
  }

  // v2: цена должна быть > 0 (B4 исправлен — цена 0 не пропускается)
  const validatedPrice = price !== undefined ? Number(price) : 0;
  if (validatedPrice <= 0) {
    return res.status(400).json({ error: 'Цена должна быть положительным числом' });
  }

  const result = db.prepare(`
    INSERT INTO products (user_token, store_id, name, description, price, category, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.userToken, req.params.storeId, name.trim(), description || '', validatedPrice, category || 'main', stock ?? 0);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(product);
});

// PATCH /products/:id — изменить товар
// v2: price = 0 отклоняется (B4 исправлен)
router.patch('/products/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!product) {
    return res.status(404).json({ error: 'Товар не найден' });
  }

  const { name, description, price, category, stock } = req.body || {};

  // v2: price = 0 или отрицательное отклоняем (B4 исправлен)
  if (price !== undefined && (Number(price) <= 0)) {
    return res.status(400).json({ error: 'Цена должна быть положительным числом' });
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = price;
  if (category !== undefined) updates.category = category;
  if (stock !== undefined) updates.stock = stock;

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(`UPDATE products SET ${setClauses} WHERE id = ? AND user_token = ?`).run(...values, req.params.id, req.userToken);
  }

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /products/:id — удалить товар
router.delete('/products/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!product) {
    return res.status(404).json({ error: 'Товар не найден' });
  }

  db.prepare('DELETE FROM products WHERE id = ? AND user_token = ?').run(req.params.id, req.userToken);
  res.json({ success: true });
});

module.exports = router;
