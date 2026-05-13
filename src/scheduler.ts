import { scheduler } from './services/scheduler';
import { connectDB } from './config/db';

async function main() {
  console.log('🚀 Starting scheduler process...');
  
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Database connected');
    
    // Start the scheduler
    await scheduler.start();
    
    // Log status every hour
    setInterval(() => {
      const status = scheduler.getStatus();
      console.log('📊 Scheduler status:', status);
    }, 60 * 60 * 1000);
    
  } catch (error) {
    console.error('❌ Failed to start scheduler:', error);
    process.exit(1);
  }
  
  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📥 SIGTERM received, shutting down gracefully...');
    scheduler.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('📥 SIGINT received, shutting down gracefully...');
    scheduler.stop();
    process.exit(0);
  });
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    scheduler.stop();
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
  });
}

main();