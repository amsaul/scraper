import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

// Define interface for member data
interface Member {
  name: string;
  constituency: string;
  party: string;
}

puppeteer.use(StealthPlugin());

export class ScraperService {
  private browser: Browser | null = null;

  /**
   * Initializes a stealth browser instance in headless mode
   */
  async initBrowser(): Promise<Browser> {
    console.log('🔧 Initializing headless browser...');
    this.browser = await puppeteer.launch({
      headless: true, // Changed to true to run in background
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-gpu', // Often recommended for headless
        '--disable-dev-shm-usage', // Overcome limited resource problems
      ],
    });
    console.log('✅ Headless browser initialized');
    return this.browser;
  }

  /**
   * Prepares a page with randomized fingerprints
   */
  async createManagedPage(): Promise<Page> {
    if (!this.browser) {
      await this.initBrowser();
    }
    const page = await this.browser!.newPage();

    const userAgents: string[] = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    
    await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
    await page.setViewport({ width: 1280, height: 800 });
    
    return page;
  }

  /**
   * Basic scrape method
   */
  async scrapeMembers(): Promise<Member[]> {
    console.log('🔵 Scraper Service: Initializing...');
    const page = await this.createManagedPage();
    const members: Member[] = [];
    
    try {
      const url = 'https://www.parliament.go.ke/the-national-assembly/members';
      console.log(`🌐 Navigating to: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      const title = await page.title();
      console.log(`✅ Page loaded! Title: "${title}"`);

      await this.waitRandom(2000, 4000);

      const scrapedMembers = await page.evaluate((): Member[] => {
        const memberElements = document.querySelectorAll('tr');
        const results: Member[] = [];
        
        for (let i = 1; i < memberElements.length; i++) {
          const row = memberElements[i];
          const cells = row.querySelectorAll('td');
          
          if (cells.length >= 3) {
            results.push({
              name: cells[0]?.textContent?.trim() || '',
              constituency: cells[1]?.textContent?.trim() || '',
              party: cells[2]?.textContent?.trim() || '',
            });
          }
        }
        
        return results;
      });
      
      members.push(...scrapedMembers);
      console.log(`📊 Scraped ${members.length} members`);
      
      if (members.length > 0) {
        console.log('Sample members:', members.slice(0, 3));
      }
      
    } catch (error) {
      console.error('❌ Scraping failed inside Service:', error);
      throw error;
    } finally {
      await this.closeBrowser();
      console.log('🏁 Browser closed.');
    }
    
    return members;
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Browser closed');
    }
  }

  async waitRandom(min: number = 1000, max: number = 4000): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}

export const scraperEngine = new ScraperService();