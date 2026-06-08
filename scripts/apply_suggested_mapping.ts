import fs from 'fs/promises';
import path from 'path';

async function main() {
  const base = process.cwd();
  const suggestedPath = path.join(base, 'src', 'data', 'constituency_to_county.suggested.json');
  const countiesPath = path.join(base, 'src', 'data', 'counties_constituencies.json');
  const reversePath = path.join(base, 'src', 'data', 'constituency_to_county.json');

  try {
    const raw = await fs.readFile(suggestedPath, 'utf8');
    const suggestions = JSON.parse(raw) as Record<string, string | null>;

    // Load existing counties map
    let countiesMap: Record<string, string[]> = {};
    try {
      const cRaw = await fs.readFile(countiesPath, 'utf8');
      countiesMap = JSON.parse(cRaw);
    } catch (err) {
      // start fresh
      countiesMap = {};
    }

    const reverseMap: Record<string, string> = {};

    for (const [constituency, county] of Object.entries(suggestions)) {
      if (!county) continue;
      reverseMap[constituency] = county;
      if (!countiesMap[county]) countiesMap[county] = [];
      if (!countiesMap[county].includes(constituency)) countiesMap[county].push(constituency);
    }

    // Sort constituency lists
    for (const k of Object.keys(countiesMap)) {
      countiesMap[k].sort((a,b) => a.localeCompare(b));
    }

    await fs.writeFile(countiesPath, JSON.stringify(countiesMap, null, 2), 'utf8');
    await fs.writeFile(reversePath, JSON.stringify(reverseMap, null, 2), 'utf8');

    console.log('✅ Applied suggested mappings.');
    console.log(' - Updated', countiesPath);
    console.log(' - Updated', reversePath);
  } catch (err) {
    console.error('Failed to apply suggestions:', err);
    process.exit(1);
  }
}

main();
