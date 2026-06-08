import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type MapObj = { [constituency: string]: string };

const mapPath = path.join(__dirname, '..', 'data', 'constituency_to_county.json');

let hardMap: MapObj = {};
try {
  if (fs.existsSync(mapPath)) {
    const raw = fs.readFileSync(mapPath, 'utf8');
    hardMap = JSON.parse(raw || '{}');
  }
} catch (err) {
  console.warn('Could not load constituency->county map:', err);
  hardMap = {};
}

const KNOWN_COUNTIES = [
  'Mombasa','Kwale','Kilifi','Tana River','Lamu','Taita Taveta','Garissa','Wajir','Mandera',
  'Marsabit','Isiolo','Meru','Tharaka Nithi','Embu','Kitui','Machakos','Makueni','Nyandarua',
  'Nyeri','Kirinyaga','Muranga','Kiambu','Turkana','West Pokot','Samburu','Trans Nzoia','Uasin Gishu',
  'Elgeyo Marakwet','Nandi','Baringo','Laikipia','Nakuru','Narok','Kajiado','Kericho','Bomet',
  'Kakamega','Vihiga','Bungoma','Busia','Siaya','Kisumu','Homa Bay','Migori','Kisii','Nyamira','Nairobi'
];

// Load county->constituencies nested map if present (for exact lookups)
const countiesMapPath = path.join(__dirname, '..', 'data', 'counties_constituencies.json');
let countiesMap: { [county: string]: string[] } = {};
try {
  if (fs.existsSync(countiesMapPath)) {
    const raw = fs.readFileSync(countiesMapPath, 'utf8');
    countiesMap = JSON.parse(raw || '{}');
  }
} catch (err) {
  console.warn('Could not load counties->constituencies map:', err);
  countiesMap = {};
}

function normalize(s: string) {
  return s ? s.trim().toLowerCase().replace(/[\u2019'`]/g, '') : '';
}

export function resolveCounty(constituency: string | null | undefined): string | null {
  if (!constituency) return null;
  const key = normalize(constituency);

  // 1) hard map exact match
  for (const cKey of Object.keys(hardMap)) {
    if (normalize(cKey) === key) return hardMap[cKey];
  }

  // 1.5) check countiesMap for exact constituency membership
  if (countiesMap && Object.keys(countiesMap).length > 0) {
    for (const county of Object.keys(countiesMap)) {
      const constituencies = countiesMap[county] || [];
      for (const cons of constituencies) {
        if (normalize(cons) === key) return county;
      }
    }
  }

  // 2) if constituency already contains a known county name
  for (const county of KNOWN_COUNTIES) {
    const nCounty = normalize(county);
    if (key.includes(nCounty)) return county;
  }

  // 3) some constituency names are like "X, County" or "X (County)" — try extract
  const countyMatch = constituency.match(/,?\s*([A-Za-z\s]+) County$/i) || constituency.match(/\(([^)]+) County\)/i);
  if (countyMatch && countyMatch[1]) {
    const candidate = countyMatch[1].trim();
    if (KNOWN_COUNTIES.find(c => normalize(c) === normalize(candidate))) return candidate;
  }

  // 4) last resort: try splitting on space and match tokens to county names
  const tokens = key.split(/[^a-zA-Z]+/).filter(Boolean);
  for (const county of KNOWN_COUNTIES) {
    const nCounty = normalize(county);
    const countyTokens = nCounty.split(/\s+/);
    if (countyTokens.every(t => tokens.includes(t))) return county;
  }

  // Not found
  return null;
}

export function getHardMap(): MapObj {
  return hardMap;
}
