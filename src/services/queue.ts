import { Queue, QueueEvents, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Redis connection with better error handling
const redis = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy: (times: number) => {
    // Exponential backoff for Redis reconnection
    const delay = Math.min(times * 100, 3000);
    console.log(`🔄 Redis reconnecting in ${delay}ms... (attempt ${times})`);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    console.error('❌ Redis connection error:', err);
    return true; // Reconnect on error
  }
});

redis.on('connect', () => {
  console.log('📡 BullMQ Redis connection established');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

// Define the connection as a configuration object
export const connectionOptions: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null, // Critical for BullMQ
};

// Push queue for sending data to external API
export const pushQueue = new Queue('verivote-push-queue', { 
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 5, // Retry up to 5 times
    backoff: {
      type: 'exponential',
      delay: 10000, // Start with 10s delay
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 500 // Keep last 500 failed jobs
  } as any
});

// Primary queue for all scraping tasks
export const scrapeQueue = new Queue('verivote-scrape-queue', { 
  connection: connectionOptions,
  defaultJobOptions: {
    attempts: 3, // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5s delay
    },
    removeOnComplete: 100,
    removeOnFail: 200
  } as any
});

// Queue events for monitoring
export const scrapeQueueEvents = new QueueEvents('verivote-scrape-queue', { 
  connection: connectionOptions 
});

export const pushQueueEvents = new QueueEvents('verivote-push-queue', { 
  connection: connectionOptions 
});

// Event listeners for monitoring
scrapeQueueEvents.on('completed', ({ jobId }) => {
  console.log(`✅ Scrape job ${jobId} completed`);
});

scrapeQueueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`❌ Scrape job ${jobId} failed:`, failedReason);
});

pushQueueEvents.on('completed', ({ jobId }) => {
  console.log(`✅ Push job ${jobId} completed`);
});

pushQueueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`❌ Push job ${jobId} failed:`, failedReason);
});

// Helper function to clear queues (useful for development)
export async function clearQueues() {
  await scrapeQueue.drain();
  await pushQueue.drain();
  await scrapeQueue.clean(0, 0, 'completed');
  await scrapeQueue.clean(0, 0, 'failed');
  await pushQueue.clean(0, 0, 'completed');
  await pushQueue.clean(0, 0, 'failed');
  console.log('🧹 Queues cleared');
}

// Helper function to get queue status
export async function getQueueStatus() {
  const scrapeCounts = await scrapeQueue.getJobCounts();
  const pushCounts = await pushQueue.getJobCounts();
  
  return {
    scrape: {
      waiting: scrapeCounts.waiting,
      active: scrapeCounts.active,
      completed: scrapeCounts.completed,
      failed: scrapeCounts.failed,
      delayed: scrapeCounts.delayed
    },
    push: {
      waiting: pushCounts.waiting,
      active: pushCounts.active,
      completed: pushCounts.completed,
      failed: pushCounts.failed,
      delayed: pushCounts.delayed
    }
  };
}

// Export the redis instance for direct use if needed
export default redis;