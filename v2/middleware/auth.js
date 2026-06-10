const { getDb } = require('../db/database');
const crypto = require('crypto');

/**
 * Извлекает user_token из заголовка X-API-Key.
 * Если токена нет — создаёт новую сессию (анонимно).
 * В v2 поведение сохранено (для контента нужен анонимный доступ),
 * но это известная особенность, а не баг.
 */
function identifyUser(req, res, next) {
  let token = req.headers['x-api-key'];

  if (!token) {
    token = crypto.randomUUID();
    const db = getDb();
    try {
      db.prepare('INSERT INTO sessions (user_token) VALUES (?)').run(token);
    } catch {
      // токен мог уже существовать (race condition маловероятен)
    }
  } else {
    const db = getDb();
    const session = db.prepare('SELECT id FROM sessions WHERE user_token = ?').get(token);
    if (!session) {
      try {
        db.prepare('INSERT INTO sessions (user_token) VALUES (?)').run(token);
      } catch {
        // ignore duplicate
      }
    }
  }

  req.userToken = token;
  next();
}

module.exports = { identifyUser };
