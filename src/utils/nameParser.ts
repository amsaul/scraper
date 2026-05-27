// src/utils/nameParser.ts

interface ParsedName {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}

// Common Kenyan honorifics and post-nominals to strip
const HONORIFICS = /^(Hon\.?|Dr\.?|Prof\.?|Eng\.?|Amb\.?|Sen\.?|MP|H\.E\.?|Mr\.?|Mrs\.?|Ms\.?|Miss\.?|Mx\.?)\s+/i;
const POST_NOMINALS = /\s+(EGH|CBS|OGW|MBS|HSC|MP|SC|EBS|OBS|MGH|BBS|MBE|Nominated)\b/gi;

export function parseName(fullName: string): ParsedName {
  if (!fullName || fullName.trim().length < 2) {
    return { firstName: null, middleName: null, lastName: null };
  }

  let cleaned = fullName.trim();
  // Remove honorifics
  cleaned = cleaned.replace(HONORIFICS, '');
  // Remove post-nominals
  cleaned = cleaned.replace(POST_NOMINALS, '');
  // Remove extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Handle comma-flipped surnames, e.g. "Doe, John"
  if (cleaned.includes(',')) {
    const [last, firstMiddle] = cleaned.split(',');
    const firstParts = firstMiddle.trim().split(/\s+/);
    const firstName = firstParts[0] || null;
    const middleName = firstParts.length > 1 ? firstParts.slice(1).join(' ') : null;
    return { firstName, middleName, lastName: last.trim() };
  }

  // Normal name: split by spaces
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    // Single word - assume it's a last name or mononym
    return { firstName: null, middleName: null, lastName: parts[0] };
  } else if (parts.length === 2) {
    return { firstName: parts[0], middleName: null, lastName: parts[1] };
  } else {
    // First, middle(s), last
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const middleName = parts.slice(1, -1).join(' ');
    return { firstName, middleName, lastName };
  }
}