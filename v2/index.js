const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3004;

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

app.get('/', (req, res) => {
  res.redirect('/docs');
});

app.listen(PORT, () => {
  console.log(`📖 Food Delivery API v2 Docs running on http://localhost:${PORT}`);
  console.log(`📄 Swagger UI: http://localhost:${PORT}/docs`);
});
