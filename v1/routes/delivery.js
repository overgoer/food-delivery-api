const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /orders/:id/delivery — статус доставки (+ курьер)
// БАГ: не проверяем user_token — можно смотреть чужую доставку (B9 распространяется)
router.get('/:id/delivery', (req, res) => {
  const db = getDb();
  // БАГ: без user_token — просмотр чужих данных
  const order = db.prepare('SELECT id, status, courier_id, delivery_address FROM orders WHERE id = ?').get(req.params.id);

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
// БАГ: можно назначить курьера на чужой заказ
// БАГ: courier_id не валидируется (можно '')
router.patch('/:id/delivery/assign', (req, res) => {
  const db = getDb();
  const { courier_id } = req.body || {};

  // БАГ: не проверяем user_token
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }

  // БАГ: не проверяем статус — можно назначить курьера на отменённый заказ
  // БАГ: courier_id может быть пустой строкой или не указан
  const courier = courier_id || '';
  db.prepare("UPDATE orders SET courier_id = ?, status = 'delivering', updated_at = datetime('now') WHERE id = ?").run(courier, req.params.id);

  res.json({ success: true, courier_id: courier });
});

module.exports = router;
