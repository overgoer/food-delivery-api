const { getDb } = require('./database');

function seed() {
  const db = getDb();

  // Проверка — если уже есть данные, не сидируем
  const count = db.prepare('SELECT COUNT(*) as cnt FROM stores').get();
  if (count.cnt > 0) {
    console.log('• Данные уже есть, пропускаю сидирование');
    return;
  }

  // Сессия-владелец демо-данных
  const sessionToken = 'demo-session-00000000-0000-0000-0000-000000000000';
  db.prepare('INSERT OR IGNORE INTO sessions (user_token) VALUES (?)').run(sessionToken);

  // Рестораны
  const stores = [
    { name: 'Бургерная №1', type: 'fast_food', city: 'Москва', phone: '+7-495-111-1111', rating: 4.2 },
    { name: 'Пицца Italia', type: 'pizzeria', city: 'Москва', phone: '+7-495-222-2222', rating: 4.5 },
    { name: 'Суши Wok', type: 'asian', city: 'СПб', phone: '+7-812-333-3333', rating: 4.0 },
    { name: 'Узбечка', type: 'restaurant', city: 'СПб', phone: '+7-812-444-4444', rating: 4.8 },
    { name: 'Кофе To Go', type: 'cafe', city: 'Москва', phone: '+7-495-555-5555', rating: 3.9 },
  ];

  const insertStore = db.prepare(`
    INSERT INTO stores (user_token, name, type, city, phone, rating)
    VALUES (@user_token, @name, @type, @city, @phone, @rating)
  `);

  const storeIds = [];
  for (const s of stores) {
    const result = insertStore.run({ user_token: sessionToken, ...s });
    storeIds.push(result.lastInsertRowid);
  }

  // Товары
  const products = [
    { store_id: storeIds[0], name: 'Чизбургер', price: 199, category: 'main', stock: 50 },
    { store_id: storeIds[0], name: 'Картошка фри', price: 99, category: 'side', stock: 100 },
    { store_id: storeIds[0], name: 'Кола 0.5', price: 79, category: 'drink', stock: 200 },
    { store_id: storeIds[1], name: 'Маргарита', price: 450, category: 'pizza', stock: 20 },
    { store_id: storeIds[1], name: 'Пепперони', price: 550, category: 'pizza', stock: 15 },
    { store_id: storeIds[1], name: 'Чай зелёный', price: 100, category: 'drink', stock: 50 },
    { store_id: storeIds[2], name: 'Филадельфия', price: 350, category: 'rolls', stock: 30 },
    { store_id: storeIds[2], name: 'Калифорния', price: 320, category: 'rolls', stock: 25 },
    { store_id: storeIds[2], name: 'Сет на двоих', price: 1200, category: 'sets', stock: 10 },
    { store_id: storeIds[3], name: 'Плов', price: 400, category: 'main', stock: 30 },
    { store_id: storeIds[3], name: 'Самса', price: 80, category: 'appetizer', stock: 40 },
    { store_id: storeIds[3], name: 'Чай чёрный', price: 50, category: 'drink', stock: 100 },
    { store_id: storeIds[4], name: 'Капучино', price: 150, category: 'coffee', stock: 100 },
    { store_id: storeIds[4], name: 'Латте', price: 170, category: 'coffee', stock: 80 },
    { store_id: storeIds[4], name: 'Круассан', price: 120, category: 'food', stock: 20 },
  ];

  const insertProduct = db.prepare(`
    INSERT INTO products (user_token, store_id, name, price, category, stock)
    VALUES (@user_token, @store_id, @name, @price, @category, @stock)
  `);

  for (const p of products) {
    insertProduct.run({ user_token: sessionToken, ...p });
  }

  console.log(`• Сидировано: ${stores.length} магазинов, ${products.length} товаров`);
  console.log(`• Демо-токен: ${sessionToken}`);
}

seed();
