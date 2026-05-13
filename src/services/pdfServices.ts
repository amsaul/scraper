import axios from 'axios';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// pdf-parse is a CommonJS module; require() returns the function directly
const pdfParse = require('pdf-parse');

export interface IMPFromPDF {
  name: string;
  constituency: string;
  party: string;
}

export class PdfService {
  async parseMPListPDF(url: string): Promise<IMPFromPDF[]> {
    console.log(`📄 Downloading MP list PDF from: ${url}`);

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      console.log(`✅ PDF downloaded (${response.data.length} bytes)`);

      const data = await pdfParse(response.data);
      console.log(`📝 PDF parsed (${data.text.length} characters)`);

      // Debug: print first 500 characters to see the structure
      console.log('🔍 First 500 characters of PDF text:');
      console.log(data.text.substring(0, 500));

      const mps = this.extractMPsFromText(data.text);
      console.log(`✅ Extracted ${mps.length} MPs from PDF`);

      return mps;
    } catch (error) {
      console.error('❌ PDF Parsing Error:', error);
      throw error;
    }
  }

  private extractMPsFromText(text: string): IMPFromPDF[] {
    // Split into lines and trim each
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    console.log(`📊 Processing ${lines.length} lines of text`);

    const mps: IMPFromPDF[] = [];

    // Skip any lines that are page headers/footers
    const isHeaderLine = (line: string) =>
      line.includes('THIRTEENTH PARLIAMENT') ||
      line.includes('MEMBERS OF THE NATIONAL ASSEMBLY') ||
      line.includes('No.') ||
      line.includes('NAME') ||
      line.includes('CONSTITUENCY') ||
      line.includes('PARTY') ||
      line.match(/^Page \d+$/i) ||
      line.match(/^\d+$/);  // just a page number

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Look for a line that is just a number followed by a dot, e.g., "1."
      if (line.match(/^\d+\.$/)) {
        // Next line should be the name
        if (i + 3 >= lines.length) break; // not enough lines left

        const nameLine = lines[i + 1];
        const constituencyLine = lines[i + 2];
        const partyLine = lines[i + 3];

        // Basic validation: party line should be a short code (not a header)
        if (partyLine && !isHeaderLine(partyLine) && partyLine.length < 10) {
          mps.push({
            name: nameLine,
            constituency: constituencyLine,
            party: partyLine
          });
          i += 4; // move past this record
          continue;
        }
      }
      i++;
    }

    console.log(`📊 After extraction: ${mps.length} MPs`);
    return mps;
  }
}

export const pdfService = new PdfService();