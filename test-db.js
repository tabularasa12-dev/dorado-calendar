require('dotenv').config();
const { Pool } = require('pg');
console.log('Using URL:', process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
pool.query('SELECT NOW()').then(r=>{ console.log('DB OK:', r.rows[0].now); process.exit(0); })
.catch(e=>{ console.error('DB ERROR:', e); process.exit(1); });
