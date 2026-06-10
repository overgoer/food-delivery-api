const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /orders/:id/delivery — статус доставки (+ курьер)
// v2: проверка user_token (B9 исправлен)
router.get('/:id/delivery', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT id, status, courier_id, delivery_address FROM orders WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  res.json({
    order_id: order.id,
    status: order.status,
    courier_id: order.courier_id || null,
    delivery_address: order.delivery_address,
    estimated_minutes: order.courier_id ? 30 : null,
  });
});

// PATCH /orders/:id/delivery/assign — назначить курьера
// v2: проверка user_token (B9 исправлен)
// v2: проверка статуса — только confirmed
// v2: валидация courier_id
router.patch('/:id/delivery/assign', (req, res) => {
  const db = getDb();
  const { courier_id } = req.body || {};

  // v2: проверка user_token (B9 исправлен)
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_token = ?').get(req.params.id, req.userToken);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  // v2: проверка статуса — только confirmed (или pending) может быть назначен курьер
  if (order.status !== 'confirmed' && order.status !== 'pending') {
    return res.status(409).json({ error: `Нельзя назначить курьера на заказ в статусе "${order.status}"` });
  }

  // v2: courier_id обязателен и не может быть пустым
  if (!courier_id || typeof courier_id !== 'string' || courier_id.trim().length === 0) {
    return res.status(400).json({ error: 'courier_id обязателен' });
  }

  db.prepare("UPDATE orders SET courier_id = ?, status = 'delivering', updated_at = datetime('now') WHERE id = ?").run(courier_id.trim(), req.params.id);

  res.json({ success: true, courier_id: courier_id.trim() });
});

module.exports = router;
