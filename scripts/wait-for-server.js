require('dotenv').config();
const { execSync } = require('child_process');
const host = process.env.DEV_HOST || 'localhost';
const url = `http://${host}:5180`;
console.log(`[wait-for-server] Waiting for ${url}...`);
execSync(`npx wait-on ${url}`, { stdio: 'inherit' });
