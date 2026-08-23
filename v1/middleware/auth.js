const { getDb } = require('../db/database');

/**
 * Извлекает user_token из куки user_token или заголовка X-API-Key.
 * Если токена нет — создаёт новую сессию (анонимно).
 * Автоматически подмешивает user_token во все запросы.
 *
 * БАГ (B8): Аноним может создавать заказы — токен создаётся автоматически,
 * без всякой авторизации. Формально всё привязано к токену, но получить
 * его может кто угодно.
 */
function identifyUser(req, res, next) {
  let token = (req.cookies && req.cookies.user_token) || req.headers['x-api-key'];

  if (!token) {
    // Создаём новую сессию для анонима (намеренно — часть B8)
    token = require('crypto').randomUUID();
    const db = getDb();
    try {
      db.prepare('INSERT INTO sessions (user_token) VALUES (?)').run(token);
    } catch {
      // fallback — токен уже мог существовать (race condition маловероятен)
    }
  } else {
    // Убеждаемся, что токен существует в БД
    const db = getDb();
    const session = db.prepare('SELECT id FROM sessions WHERE user_token = ?').get(token);
    if (!session) {
      try {
        db.prepare('INSERT INTO sessions (user_token) VALUES (?)').run(token);
      } catch {
        // игнорируем дубликат
      }
    }
  }

  req.userToken = token;
  next();
}

module.exports = { identifyUser };
