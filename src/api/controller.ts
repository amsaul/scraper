import { Request, Response } from 'express';
import { scrapeQueue } from '../services/queue';

export const triggerScrape = async (req: Request, res: Response) => {
  try {
    // Add the initial discovery job to the queue
    await scrapeQueue.add('DISCOVER_MPS', {});
    
    res.status(202).json({ 
      message: 'Scraping process initiated',
      queue: 'verivote-scrape-queue'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger scraper' });
  }
};