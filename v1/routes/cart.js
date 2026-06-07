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
// БАГ B2: quantity = -1 добавляет отрицательное количество (сумма уходит в минус)
// БАГ B6: quantity > stock проходит (нет проверки остатка)
// БАГ B11: не возвращаем id созданной позиции (возвращаем массив вместо конкретной строки)
router.post('/', (req, res) => {
  const db = getDb();
  const { product_id, quantity } = req.body || {};
  const qty = quantity ?? 1;

  // Проверка существует ли товар (но не проверяем принадлежность пользователю — баг?)
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) {
    return res.status(404).json({ error: 'Товар не найден' });
  }

  // БАГ: нет проверки product.user_token — можно добавить товар из чужого магазина
  // БАГ B6: нет проверки quantity <= stock
  // БАГ B2: quantity может быть отрицательным

  // Добавляем или обновляем
  const existing = db.prepare('SELECT * FROM cart_items WHERE user_token = ? AND product_id = ?').get(req.userToken, product_id);
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_token, product_id, quantity) VALUES (?, ?, ?)').run(req.userToken, product_id, qty);
  }

  // БАГ B11: возвращаем всю корзину вместо созданной записи с id
  const items = db.prepare(`
    SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.stock, (ci.quantity * p.price) AS line_total
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.user_token = ?
  `).all(req.userToken);

  res.json(items);
});

// PATCH /cart/:item — изменить количество
// БАГ B6: quantity может быть больше stock
// БАГ: можно установить quantity = 0 (должно удалять позицию)
router.patch('/:item', (req, res) => {
  const db = getDb();
  const { quantity } = req.body || {};

  const cartItem = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_token = ?').get(req.params.item, req.userToken);
  if (!cartItem) {
    return res.status(404).json({ error: 'Позиция в корзине не найдена' });
  }

  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ? AND user_token = ?').run(quantity ?? 0, req.params.item, req.userToken);

  res.json({ success: true, quantity: quantity ?? 0 });
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
