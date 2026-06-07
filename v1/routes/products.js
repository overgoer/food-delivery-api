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
// БАГ (отсутствие валидации): можно создать товар с name = '' и price = 0
router.post('/stores/:storeId/products', (req, res) => {
  const db = getDb();
  const { name, description, price, category, stock } = req.body || {};

  // Проверка: магазин принадлежит пользователю
  const store = db.prepare('SELECT id FROM stores WHERE id = ? AND user_token = ?').get(req.params.storeId, req.userToken);
  if (!store) {
    return res.status(404).json({ error: 'Магазин не найден' });
  }

  const result = db.prepare(`
    INSERT INTO products (user_token, store_id, name, description, price, category, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.userToken, req.params.storeId, name || '', description || '', price ?? 0, category || 'main', stock ?? 0);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(product);
});

// PATCH /products/:id — изменить товар
// БАГ B4: цена 0 проходит без ошибки
router.patch('/products/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!product) {
    return res.status(404).json({ error: 'Товар не найден' });
  }

  const { name, description, price, category, stock } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  // БАГ: price = 0 > 0 — false, поэтому 0 считается ложным и не обновляется
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
