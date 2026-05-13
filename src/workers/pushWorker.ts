import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { integrationService } from '../services/intergration';

const connection = new IORedis({ 
  host: process.env.REDIS_HOST || '127.0.0.1', 
  port: 6379, 
  maxRetriesPerRequest: null 
});

const pushWorker = new Worker('verivote-push-queue', async (job: Job) => {
  // Handle both flat and nested data structures
  const memberData = job.data.member || job.data;
  
  console.log(`📡 Pushing data for: ${memberData.fullName || 'Unknown'} to VeriVote`);
  console.log(`📦 Job data:`, JSON.stringify(memberData, null, 2));

  try {
    const status = await integrationService.pushMemberData(memberData);
    console.log(`✅ VeriVote Push Successful for ${memberData.fullName || 'Unknown'} (Status: ${status})`);
    
  } catch (error: any) {
    console.error(`❌ VeriVote Push Failed for ${memberData.fullName || 'Unknown'}: ${error.message}`);
    throw error;
  }
}, { 
  connection, 
  concurrency: 5
});

pushWorker.on('completed', (job: Job) => {
  const memberData = job.data.member || job.data;
  console.log(`✅ Push job ${job.id} completed for ${memberData.fullName || 'Unknown'}`);
});

pushWorker.on('failed', (job: Job | undefined, err: Error) => {
  if (job) {
    const memberData = job.data.member || job.data;
    console.error(`❌ Push job ${job.id} for ${memberData.fullName || 'Unknown'} failed:`, err.message);
  }
});

pushWorker.on('error', (err: Error) => {
  console.error('❌ Push worker error:', err);
});

console.log('🚀 Push Worker is active and listening for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing push worker...');
  await pushWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing push worker...');
  await pushWorker.close();
  process.exit(0);
});