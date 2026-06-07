const express = require('express');
const { identifyUser } = require('./middleware/auth');
const { getDb } = require('./db/database');

const storesRouter = require('./routes/stores');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const deliveryRouter = require('./routes/delivery');

const app = express();
const PORT = process.env.PORT || 3003;

// Инициализация БД при старте
getDb();

app.use(express.json());

// Идентификация пользователя
app.use(identifyUser);

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
  console.log(`🍔 Food Delivery API v1 (with bugs) running on http://localhost:${PORT}`);
  console.log(`📄 Docs: http://localhost:${PORT}/docs`);
});
