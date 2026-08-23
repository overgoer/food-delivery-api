const express = require('express');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');
const { identifyUser } = require('./middleware/auth');
const { getDb } = require('./db/database');

const storesRouter = require('./routes/stores');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const deliveryRouter = require('./routes/delivery');

// Swagger
const openapiPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const swaggerDocument = yaml.parse(fs.readFileSync(openapiPath, 'utf8'));

const app = express();
const PORT = process.env.PORT || 3003;

// Инициализация БД при старте
getDb();

app.use(express.json());
app.use(cookieParser());

// Swagger UI (без авторизации)
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Идентификация пользователя
app.use(identifyUser);

// Вход по логину/паролю → сессионная кука user_token.
// B17: кука без httpOnly — доступна из JavaScript (XSS-риск).
// B19: logout чистит куку, но НЕ удаляет сессию из БД.
app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username и password обязательны' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = require('crypto').randomUUID();
  db.prepare('INSERT INTO sessions (user_token) VALUES (?)').run(token);
  res.cookie('user_token', token, { httpOnly: false, maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ success: true, user: user.username, message: 'Кука user_token установлена. Проверь DevTools → Application → Cookies' });
});

app.post('/logout', (req, res) => {
  res.clearCookie('user_token');
  res.json({ success: true, message: 'Кука удалена. Но сессия в БД осталась (B19)' });
});

// Страница входа (для демо в браузере)
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Login — Food Delivery API</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:0 16px">
  <h2>Food Delivery API — вход</h2>
  <p>Демо-пользователи: <code>alice / password123</code>, <code>bob / password123</code></p>
  <form id="f">
    <p><input id="u" placeholder="username" style="width:100%;padding:8px"></p>
    <p><input id="p" type="password" placeholder="password" style="width:100%;padding:8px"></p>
    <p><button type="submit" style="padding:10px 24px">Войти</button></p>
  </form>
  <pre id="out"></pre>
  <p><small>После входа открой DevTools → Application → Cookies — увидишь user_token. Теперь браузер шлёт его сам, а Interceptor может утащить его в Postman.</small></p>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: document.getElementById('u').value, password: document.getElementById('p').value})
  });
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
});
</script>
</body></html>`);
});

// Корень
app.get('/', (req, res) => {
  res.json({
    name: 'Food Delivery API',
    version: '1.0.0',
    docs: '/docs',
    your_token: req.userToken,
  });
});

// Простейшая документация
app.get('/docs', (req, res) => {
  res.json({
    version: 'v1 (with bugs)',
    base_url: `http://localhost:${PORT}`,
    auth: 'Header: X-API-Key (auto-created if missing) | Cookie: user_token (via POST /login)',
    login: 'POST /login {username,password} → Set-Cookie: user_token | GET /login — страница входа | POST /logout',
    endpoints: {
      stores: {
        list: 'GET /stores?type=&city=',
        detail: 'GET /stores/:id',
        create: 'POST /stores {name,type,city,phone}',
        update: 'PATCH /stores/:id {name,type,city,phone,rating}',
        delete: 'DELETE /stores/:id',
      },
      products: {
        list: 'GET /stores/:id/products?category=',
        create: 'POST /stores/:id/products {name,price,category,stock}',
        update: 'PATCH /products/:id {name,price,category,stock}',
        delete: 'DELETE /products/:id',
      },
      cart: {
        list: 'GET /cart',
        add: 'POST /cart {product_id,quantity}',
        update: 'PATCH /cart/:item {quantity}',
        remove: 'DELETE /cart/:item',
      },
      orders: {
        create: 'POST /orders {delivery_address}',
        list: 'GET /orders?status=',
        detail: 'GET /orders/:id',
        cancel: 'PATCH /orders/:id/cancel',
      },
      delivery: {
        status: 'GET /orders/:id/delivery',
        assign: 'PATCH /orders/:id/delivery/assign {courier_id}',
      },
    },
  });
});

// Подключаем роуты
app.use('/stores', storesRouter);
app.use('/', productsRouter);  // /stores/:storeId/products и /products/:id
app.use('/cart', cartRouter);
app.use('/orders', ordersRouter);
app.use('/orders', deliveryRouter);

app.listen(PORT, () => {
  console.log(`🍔 Food Delivery API v1 (with bugs) running on http://localhost:${PORT}`);
  console.log(`📄 Docs: http://localhost:${PORT}/docs`);
});
