const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// POST /orders — оформить заказ (из корзины, адрес доставки)
// БАГ B1: пустой delivery_address проходит
// БАГ B7: пустая корзина → 201 (заказ без товаров)
// БАГ B8: без авторизации → 201 (токен создаётся в мидлвари автоматом)
router.post('/', (req, res) => {
  const db = getDb();
  const { delivery_address } = req.body || {};

  // БАГ B1: адрес не проверяется, пустая строка сохраняется
  const address = delivery_address || '';

  // Берём корзину пользователя
  const cartItems = db.prepare(`
    SELECT ci.product_id, ci.quantity, p.name, p.price
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.user_token = ?
  `).all(req.userToken);

  // БАГ B7: если корзина пуста — создаём заказ с пустым списком (сумма = null)
  let totalCost = null; // B10: null вместо 0
  if (cartItems.length > 0) {
    totalCost = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  const result = db.prepare(`
    INSERT INTO orders (user_token, status, delivery_address, total_cost)
    VALUES (?, 'pending', ?, ?)
  `).run(req.userToken, address, totalCost);

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
  // БАГ B8: order.user_token не сверяется — любой с токеном может создавать
  res.status(201).json(order);
});

// GET /orders — мои заказы (+ статус)
// БАГ B15: параметр status игнорируется — возвращаются все заказы пользователя
// БАГ B10: total_cost = null в БД отдаётся как null (не 0)
router.get('/', (req, res) => {
  const db = getDb();
  let sql = 'SELECT * FROM orders WHERE user_token = ?';
  const params = [req.userToken];

  // БАГ B15: статус игнорируется — параметр передан, но не используется
  if (req.query.status) {
    // Хотя параметр есть, WHERE условие не добавляется (сознательно)
    // sql += ' AND status = ?';
    // params.push(req.query.status);
    void req.query.status; // заглушка, чтобы eslint не ругался
  }

  const orders = db.prepare(sql).all(...params);
  res.json(orders);
});

// GET /orders/:id — детали заказа
// БАГ B9: не проверяем user_token — можно смотреть чужие заказы
router.get('/:id', (req, res) => {
  const db = getDb();
  // БАГ B9: нет user_token в WHERE — любой может посмотреть любой заказ
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  order.items = items;

  res.json(order);
});

// PATCH /orders/:id/cancel — отменить заказ
// БАГ B16: можно отменить уже отменённый заказ (всегда success:true)
router.patch('/:id/cancel', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  // БАГ B16: всегда success, даже если статус не pending
  // Должно быть: if (order.status !== 'pending') return ошибка
  if (order.status === 'pending' || order.status === 'confirmed' || order.status === 'preparing') {
    // Но мы всё равно обновляем — можно отменить без проверки
    void order.status;
  }

  db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
