// src/utils/dateParser.ts
import axios from 'axios';

interface WikipediaBirthDate {
  year?: number;
  month?: number;
  day?: number;
}

async function fetchDOBFromWikipedia(fullName: string): Promise<Date | null> {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(fullName)}&format=json&origin=*`;
    const searchRes = await axios.get(searchUrl);
    const pages = searchRes.data.query.search;
    if (!pages || pages.length === 0) return null;

    const pageTitle = pages[0].title;
    const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`;
    const contentRes = await axios.get(contentUrl);
    const pagesObj = contentRes.data.query.pages;
    const page = Object.values(pagesObj)[0] as any;
    const text = page.extract || '';

    // Look for patterns like "born 12 March 1965" or "born (1965-03-12)"
    const bornRegex = /born\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i;
    const isoRegex = /born\s+\((\d{4})-(\d{2})-(\d{2})\)/i;
    let match = text.match(bornRegex);
    if (match) {
      const day = parseInt(match[1], 10);
      const monthStr = match[2];
      const year = parseInt(match[3], 10);
      const month = new Date(Date.parse(`${monthStr} 1, 2000`)).getMonth() + 1;
      if (!isNaN(month)) return new Date(year, month - 1, day);
    }
    match = text.match(isoRegex);
    if (match) {
      return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    }
    return null;
  } catch (err) {
    console.error(`Wikipedia DOB fetch failed for ${fullName}:`, err);
    return null;
  }
}

export async function parseDOB(pageText: string, fullName?: string): Promise<Date | null> {
  // Patterns
  const patterns = [
    /Born(?:\s+on)?\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i,
    /DOB\s*:?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i,
    /Date of Birth\s*:?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i,
    /Year of Birth\s*:?\s*(\d{4})/i,
    /Born\s+(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    if (match) {
      if (pattern.toString().includes('Year of Birth') || (pattern.toString().includes('Born') && match.length === 2)) {
        // Year only
        const year = parseInt(match[1], 10);
        if (!isNaN(year)) return new Date(year, 0, 1);
      } else if (match.length === 4) {
        // Day, month, year
        let day = parseInt(match[1], 10);
        let month: number;
        let year = parseInt(match[3], 10);
        if (pattern.source.includes('[A-Za-z]+')) {
          // Month name
          month = new Date(Date.parse(`${match[2]} 1, 2000`)).getMonth() + 1;
        } else {
          // Numeric month
          month = parseInt(match[2], 10);
          // If month > 12, assume day-month-year swap
          if (month > 12 && day <= 12) {
            const temp = day;
            day = month;
            month = temp;
          }
        }
        if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return new Date(year, month - 1, day);
        }
      }
    }
  }

  // Fallback to Wikipedia
  if (fullName) {
    return await fetchDOBFromWikipedia(fullName);
  }

  return null;
}