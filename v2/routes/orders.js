const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// POST /orders — оформить заказ (из корзины, адрес доставки)
// v2: проверка delivery_address (B1 исправлен)
// v2: проверка пустой корзины (B7 исправлен)
// v2: проверка user_token (B8 оставлен как особенность, но total_cost фикс)
router.post('/', (req, res) => {
  const db = getDb();
  const { delivery_address } = req.body || {};

  // v2: адрес доставки обязателен (B1 исправлен)
  if (!delivery_address || typeof delivery_address !== 'string' || delivery_address.trim().length === 0) {
    return res.status(400).json({ error: 'Адрес доставки обязателен' });
  }

  // Берём корзину пользователя
  const cartItems = db.prepare(`
    SELECT ci.product_id, ci.quantity, p.name, p.price
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.user_token = ?
  `).all(req.userToken);

  // v2: пустая корзина — ошибка (B7 исправлен)
  if (cartItems.length === 0) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  // v2: total_cost = 0 вместо null (B10 исправлен)
  const totalCost = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const result = db.prepare(`
    INSERT INTO orders (user_token, status, delivery_address, total_cost)
    VALUES (?, 'pending', ?, ?)
  `).run(req.userToken, delivery_address.trim(), totalCost);

  const orderId = result.lastInsertRowid;

  // Переносим товары из корзины в order_items
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, user_token, product_id, product_name, quantity, unit_price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const item of cartItems) {
    insertOrderItem.run(orderId, req.userToken, item.product_id, item.name, item.quantity, item.price);
  }

  // Очищаем корзину
  db.prepare('DELETE FROM cart_items WHERE user_token = ?').run(req.userToken);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json(order);
});

// GET /orders — мои заказы (+ статус)
// v2: фильтр по статусу работает (B15 исправлен)
// v2: total_cost = 0 вместо null (B10 исправлен — в БД сохраняется 0)
router.get('/', (req, res) => {
  const db = getDb();
  let sql = 'SELECT * FROM orders WHERE user_token = ?';
  const params = [req.userToken];

  // v2: фильтр по статусу (B15 исправлен)
  if (req.query.status) {
    sql += ' AND status = ?';
    params.push(req.query.status);
  }

  sql += ' ORDER BY created_at DESC';

  const orders = db.prepare(sql).all(...params);
  res.json(orders);
});

// GET /orders/:id — детали заказа
// v2: проверка user_token (B9 исправлен)
router.get('/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  order.items = items;

  res.json(order);
});

// PATCH /orders/:id/cancel — отменить заказ
// v2: проверка статуса — только pending (B16 исправлен)
router.patch('/:id/cancel', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  // v2: проверка статуса — отменить можно только pending (B16 исправлен)
  if (order.status !== 'pending') {
    return res.status(409).json({ error: `Нельзя отменить заказ в статусе "${order.status}"` });
  }

  db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
