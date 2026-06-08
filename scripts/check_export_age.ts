import fs from 'fs/promises';
import path from 'path';

async function main() {
  const p = path.join(process.cwd(), 'members_export.json');
  const raw = await fs.readFile(p, 'utf8');
  const arr = JSON.parse(raw);
  let total = 0, withAge = 0, nullAge = 0;
  for (const r of arr) {
    total++;
    if (r.age === null || r.age === undefined) nullAge++; else withAge++;
  }
  console.log({ total, withAge, nullAge });
}
main();
