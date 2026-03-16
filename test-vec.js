const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const db = new Database(':memory:');
db.loadExtension(sqliteVec.getLoadablePath().replace(/\.(dylib|so|dll)$/, ''));

try { db.exec(`CREATE VIRTUAL TABLE vec_test USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float);`); console.log('float works'); } catch(e) { console.error('float:', e.message); }
try { db.exec(`CREATE VIRTUAL TABLE vec_test2 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[]);`); console.log('float[] works'); } catch(e) { console.error('float[]:', e.message); }
