const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /cart — моя корзина
router.get('/', (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.stock, p.store_id,
           (ci.quantity * p.price) AS line_total
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.user_token = ?
  `).all(req.userToken);

  res.json(items);
});

// POST /cart — добавить товар (+ quantity)
// v2: проверка quantity > 0 (B2 исправлен)
// v2: проверка quantity <= stock (B6 исправлен)
// v2: возвращаем созданную запись с id (B11 исправлен)
router.post('/', (req, res) => {
  const db = getDb();
  const { product_id, quantity } = req.body || {};
  const qty = quantity !== undefined ? Number(quantity) : 1;

  // Валидация product_id
  if (!product_id) {
    return res.status(400).json({ error: 'product_id обязателен' });
  }

  // v2: quantity должно быть положительным числом (B2 исправлен)
  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Количество должно быть положительным целым числом' });
  }

  // Проверка существует ли товар
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) {
    return res.status(404).json({ error: 'Товар не найден' });
  }

  // v2: проверка остатка на складе (B6 исправлен)
  if (qty > product.stock) {
    return res.status(400).json({ error: 'Запрошенное количество превышает остаток на складе' });
  }

  // Добавляем или обновляем
  const existing = db.prepare('SELECT * FROM cart_items WHERE user_token = ? AND product_id = ?').get(req.userToken, product_id);
  let cartItem;

  if (existing) {
    const newQty = existing.quantity + qty;
    // v2: проверка остатка при увеличении
    if (newQty > product.stock) {
      return res.status(400).json({ error: 'Общее количество в корзине превышает остаток на складе' });
    }
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
    cartItem = db.prepare('SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.stock, (ci.quantity * p.price) AS line_total FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.id = ?').get(existing.id);
  } else {
    const result = db.prepare('INSERT INTO cart_items (user_token, product_id, quantity) VALUES (?, ?, ?)').run(req.userToken, product_id, qty);
    // v2: возвращаем конкретную созданную запись с id (B11 исправлен)
    cartItem = db.prepare('SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.stock, (ci.quantity * p.price) AS line_total FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.id = ?').get(result.lastInsertRowid);
  }

  res.status(201).json(cartItem);
});

// PATCH /cart/:item — изменить количество
// v2: проверка quantity <= stock (B6 исправлен)
// v2: quantity = 0 удаляет позицию
router.patch('/:item', (req, res) => {
  const db = getDb();
  const { quantity } = req.body || {};

  const cartItem = db.prepare('SELECT ci.*, p.stock, p.name FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.id = ? AND ci.user_token = ?').get(req.params.item, req.userToken);
  if (!cartItem) {
    return res.status(404).json({ error: 'Позиция в корзине не найдена' });
  }

  const qty = quantity !== undefined ? Number(quantity) : 0;

  // v2: quantity = 0 — удаляем позицию
  if (qty <= 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ? AND user_token = ?').run(req.params.item, req.userToken);
    return res.json({ success: true, deleted: true });
  }

  // v2: проверка остатка на складе (B6 исправлен)
  if (qty > cartItem.stock) {
    return res.status(400).json({ error: 'Запрошенное количество превышает остаток на складе' });
  }

  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ? AND user_token = ?').run(qty, req.params.item, req.userToken);

  res.json({ success: true, quantity: qty });
});

// DELETE /cart/:item — удалить позицию
router.delete('/:item', (req, res) => {
  const db = getDb();
  const cartItem = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_token = ?').get(req.params.item, req.userToken);

  if (!cartItem) {
    return res.status(404).json({ error: 'Позиция не найдена' });
  }

  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_token = ?').run(req.params.item, req.userToken);
  res.json({ success: true });
});

module.exports = router;
