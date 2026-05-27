// src/utils/genderInference.ts
import fs from 'fs';
import path from 'path';

interface GenderMap {
  [name: string]: 'Male' | 'Female';
}

let nameGenderMap: GenderMap = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, '../data/kenyan-names-gender.json'), 'utf-8');
  nameGenderMap = JSON.parse(raw);
} catch (err) {
  console.warn('Name-gender mapping file not found. Gender inference will rely only on honorifics.');
}

export function inferGender(
  firstName: string | null,
  honorifics: string[],
): 'Male' | 'Female' | null {
  // 1. Honorifics take precedence
  for (const h of honorifics) {
    const lower = h.toLowerCase();
    if (lower.includes('mrs') || lower.includes('ms') || lower.includes('miss')) {
      return 'Female';
    }
    if (lower.includes('mr')) {
      return 'Male';
    }
  }

  // 2. Check first name against mapping
  if (firstName) {
    const normalized = firstName.toLowerCase().trim();
    if (nameGenderMap[normalized]) {
      return nameGenderMap[normalized];
    }
  }

  // 3. Fallback
  return null;
}