import fs from 'fs/promises';
import path from 'path';
import { resolveCounty } from '../src/utils/constituencyCountyMap';

async function main() {
  const exportPath = path.join(process.cwd(), 'members_export.json');
  try {
    const raw = await fs.readFile(exportPath, 'utf8');
    const members = JSON.parse(raw);
    const constituencies = new Set<string>();
    for (const m of members) {
      if (m.constituency) constituencies.add(m.constituency.trim());
    }

    const suggestions: Record<string, string | null> = {};
    for (const c of Array.from(constituencies).sort()) {
      const inferred = resolveCounty(c) || null;
      suggestions[c] = inferred;
    }

    const outPath = path.join(process.cwd(), 'src', 'data', 'constituency_to_county.suggested.json');
    await fs.writeFile(outPath, JSON.stringify(suggestions, null, 2), 'utf8');
    console.log('✅ Wrote suggestions to', outPath);
    const unmapped = Object.entries(suggestions).filter(([,v]) => v === null).map(([k]) => k);
    console.log(`Found ${unmapped.length} unmapped constituencies. See the suggested file to review.`);
  } catch (err) {
    console.error('Failed to generate suggestions:', err);
  }
}

main();
