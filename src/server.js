// Local server: `npm start`. On Vercel the same app is served by api/index.js.

import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n  Prayer Calendar`);
  console.log(`  Settings : http://localhost:${PORT}`);
  console.log(`  Feed     : http://localhost:${PORT}/prayers.ics`);
  console.log('');
});
