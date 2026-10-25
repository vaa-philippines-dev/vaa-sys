// Applies a hand-reviewed SQL file to the shared database in one transaction.
// Deliberately not `prisma migrate`/`db push`: va-management shares this
// database and manages its own schema history by hand, so this project only
// ever runs the SQL in prisma/sql/ that touches the client_entry schema.
//
//   npm run db:apply -- prisma/sql/001_client_entry_init.sql
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: npm run db:apply -- <path/to/file.sql>')
  const sql = readFileSync(file, 'utf8')

  const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log(`Applied ${file}`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
