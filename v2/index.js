const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const fs = require('fs');
const path = require('path');

const { identifyUser } = require('./middleware/auth');
const { getDb } = require('./db/database');

const storesRouter = require('./routes/stores');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const deliveryRouter = require('./routes/delivery');

const app = express();
const PORT = process.env.PORT || 3004;

// Инициализация БД при старте
getDb();

// Загружаем OpenAPI спецификацию
const specPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const specRaw = fs.readFileSync(specPath, 'utf8');
const spec = YAML.parse(specRaw);

// Swagger UI — красивая документация
app.use('/docs', (req, res, next) => {
  if (req.originalUrl === '/docs') return res.redirect(301, './docs/');
  next();
}, swaggerUi.serveWithOptions({ redirect: false }), swaggerUi.setup(spec, {
  customSiteTitle: 'Food Delivery API — Документация',
  customCss: `
    .topbar { display: none; }
    .swagger-ui .info .title small.version-stamp,
    .swagger-ui .info .title pre.version { background: #7d8492 !important; color: #fff !important; }
    .swagger-ui .info .title { font-size: 28px; }
    .swagger-ui .info { margin: 30px 0; }
    .swagger-ui .opblock-tag { font-size: 18px; }
    .swagger-ui .opblock .opblock-summary-description { font-size: 14px; }
    .swagger-ui .model-box { font-size: 13px; }
    pre { background: #f5f5f5; border-radius: 4px; padding: 10px; }
    code { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
  `,
  customJs: [],
}));

// JSON-версия спецификации (для машин)
app.get('/openapi.json', (req, res) => {
  res.json(spec);
});

// Middleware
app.use(express.json());

// ─── Signup (вебинар): токен + демо-магазин с meta ────────
// Служебная ручка: бот выдаёт зрителям токен с готовыми данными,
// чтобы сразу было с чем работать. В свагер не попадает.
app.post('/signup', (req, res) => {
  const db = getDb();
  const crypto = require('crypto');
  const token = crypto.randomUUID();
  const demoMeta = JSON.stringify({
    contacts: { telegram: "@demo_pizza", email: "hi@margherita.ru" },
    settings: { notifications: true, theme: "light" },
    certifications: [
      { type: "ISO", id: "RU-2026-001" },
      { type: "HACCP", id: "RU-2026-002" }
    ]
  });
  try {
    db.prepare('INSERT INTO sessions (user_token) VALUES (?)').run(token);
    const st = db.prepare(
      'INSERT INTO stores (user_token, name, type, city, phone, rating, is_active, meta) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(token, 'Пиццерия Маргарита', 'pizza', 'Москва', '+7 900 000-00-00', 4.5, demoMeta);
    const storeId = st.lastInsertRowid;
    const insP = db.prepare(
      'INSERT INTO products (user_token, store_id, name, description, price, category, stock, is_available) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
    );
    insP.run(token, storeId, 'Маргарита 30 см', 'Томаты, моцарелла, базилик', 550, 'pizza', 20);
    insP.run(token, storeId, 'Пепперони 30 см', 'Пепперони, моцарелла, томатный соус', 650, 'pizza', 15);
    res.status(201).json({
      token,
      message: 'Демо-магазин создан: Пиццерия Маргарита',
      store_id: storeId,
      docs: '/docs'
    });
  } catch (err) {
    console.error('signup error:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка стенда' });
  }
});

app.use(identifyUser);

// Корень
app.get('/', (req, res) => {
  res.json({
    name: 'Food Delivery API',
    version: '2.0.0',
    docs: '/docs',
    your_token: req.userToken,
  });
});

// Простейшая документация API
app.get('/api/docs', (req, res) => {
  res.json({
    version: 'v2 (fixed)',
    base_url: `http://localhost:${PORT}`,
    auth: 'Header: X-API-Key (auto-created if missing)',
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
  console.log(`🍔 Food Delivery API v2 (fixed) running on http://localhost:${PORT}`);
  console.log(`📄 Docs: http://localhost:${PORT}/docs`);
  console.log(`📄 API Docs: http://localhost:${PORT}/api/docs`);
});
