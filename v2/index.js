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
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: 'Food Delivery API — Документация',
  customCss: `
    .topbar { display: none; }
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
