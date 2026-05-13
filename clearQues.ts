// clear-queue.js
import { scrapeQueue } from './src/services/queue.js';

async function clear() {
  await scrapeQueue.drain();          // remove all waiting jobs
  await scrapeQueue.clean(0, 0, 'wait');
  await scrapeQueue.clean(0, 0, 'active');
  await scrapeQueue.clean(0, 0, 'delayed');
  console.log('Queue cleared');
  process.exit(0);
}
clear();