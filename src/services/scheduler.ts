import { scrapeQueue, pushQueue } from './queue';
import { connectDB } from '../config/db';
import Member from '../models/members';

export class SchedulerService {
  private intervals: NodeJS.Timeout[] = [];
  private isRunning = false;

  /**
   * Start all scheduled jobs
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Scheduler is already running');
      return;
    }

    console.log('⏰ Starting scheduler service...');
    this.isRunning = true;

    // Ensure database is connected
    await connectDB();

    // ===== IMMEDIATE STARTUP JOBS =====
    
    // Run MP discovery immediately on startup
    await this.runImmediately('DISCOVER_MPS', {
      type: 'startup_discovery',
      timestamp: new Date().toISOString()
    });

    // Run MP list PDF processing immediately on startup
    await this.runImmediately('PROCESS_MP_LIST_PDF', {
      type: 'startup_pdf_import',
      timestamp: new Date().toISOString()
    });

    // Run Governor discovery immediately on startup
    await this.runImmediately('DISCOVER_GOVERNORS', {
      type: 'startup_governors',
      timestamp: new Date().toISOString()
    });

    // Run CoG leadership scraping immediately on startup
    await this.runImmediately('SCRAPE_COG_LEADERSHIP', {
      type: 'startup_cog',
      timestamp: new Date().toISOString()
    });

    // ===== DAILY JOBS =====
    
    // Schedule daily MP discovery at 2 AM
    this.scheduleDailyJob('DISCOVER_MPS', 2, 0, {
      type: 'daily_discovery',
      timestamp: new Date().toISOString()
    });

    // ===== WEEKLY JOBS =====
    
    // Process MP list PDF weekly on Sunday at 4 AM
    this.scheduleWeeklyJob('PROCESS_MP_LIST_PDF', 0, 4, 0, {
      type: 'weekly_pdf_update',
      timestamp: new Date().toISOString()
    });

    // Refresh member data weekly on Monday at 3 AM
    this.scheduleWeeklyJob('REFRESH_MEMBERS', 1, 3, 0, {
      type: 'weekly_refresh',
      timestamp: new Date().toISOString()
    });

    // Discover Governors weekly on Sunday at 5 AM
    this.scheduleWeeklyJob('DISCOVER_GOVERNORS', 0, 5, 0, {
      type: 'weekly_governors_update',
      timestamp: new Date().toISOString()
    });

    // Scrape CoG leadership weekly on Monday at 6 AM
    this.scheduleWeeklyJob('SCRAPE_COG_LEADERSHIP', 1, 6, 0, {
      type: 'weekly_cog_update',
      timestamp: new Date().toISOString()
    });

    // ===== INTERVAL JOBS (Every X hours) =====
    
    // Check for new Hansard documents every 6 hours
    this.scheduleIntervalJob('CHECK_HANSARD', 6 * 60 * 60 * 1000, {
      type: 'hansard_check',
      timestamp: new Date().toISOString()
    });

    // Retry failed push jobs every hour
    this.scheduleIntervalJob('RETRY_FAILED_PUSHES', 60 * 60 * 1000, {
      type: 'retry_push',
      timestamp: new Date().toISOString()
    });

    console.log('✅ Scheduler started successfully');
    this.logScheduledJobs();
  }

  /**
   * Schedule a daily job at specific hour/minute
   */
  private scheduleDailyJob(jobName: string, hour: number, minute: number, data: any) {
    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);
    
    // If scheduled time has passed today, schedule for tomorrow
    if (scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }
    
    const delay = scheduled.getTime() - now.getTime();
    
    console.log(`📅 Scheduled ${jobName} to run daily at ${hour}:${minute} (first run in ${Math.round(delay / 60000)} minutes)`);
    
    setTimeout(() => {
      // Run the job now
      this.addJob(jobName, { ...data, scheduled: true });
      
      // Then schedule it to run every 24 hours
      const interval = setInterval(() => {
        this.addJob(jobName, { ...data, scheduled: true });
      }, 24 * 60 * 60 * 1000);
      
      this.intervals.push(interval);
      
    }, delay);
  }

  /**
   * Schedule a weekly job
   */
  private scheduleWeeklyJob(jobName: string, dayOfWeek: number, hour: number, minute: number, data: any) {
    // dayOfWeek: 0 = Sunday, 1 = Monday, etc.
    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);
    
    // Set to correct day of week
    const daysUntilTarget = (dayOfWeek - now.getDay() + 7) % 7;
    scheduled.setDate(now.getDate() + daysUntilTarget);
    
    // If today is the target day but time has passed, schedule for next week
    if (daysUntilTarget === 0 && scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 7);
    }
    
    const delay = scheduled.getTime() - now.getTime();
    
    console.log(`📅 Scheduled ${jobName} to run weekly on day ${this.getDayName(dayOfWeek)} at ${hour}:${minute} (first run in ${Math.round(delay / 3600000)} hours)`);
    
    setTimeout(() => {
      // Run the job now
      this.addJob(jobName, { ...data, scheduled: true });
      
      // Then schedule it to run every 7 days
      const interval = setInterval(() => {
        this.addJob(jobName, { ...data, scheduled: true });
      }, 7 * 24 * 60 * 60 * 1000);
      
      this.intervals.push(interval);
      
    }, delay);
  }

  /**
   * Schedule a job to run at regular intervals
   */
  private scheduleIntervalJob(jobName: string, intervalMs: number, data: any) {
    console.log(`🔄 Scheduled ${jobName} to run every ${this.formatDuration(intervalMs)}`);
    
    // Run immediately
    this.addJob(jobName, { ...data, scheduled: true });
    
    // Then run at intervals
    const interval = setInterval(() => {
      this.addJob(jobName, { ...data, scheduled: true });
    }, intervalMs);
    
    this.intervals.push(interval);
  }

  /**
   * Run a job immediately
   */
  private async runImmediately(jobName: string, data: any) {
    console.log(`⚡ Running ${jobName} immediately on startup`);
    await this.addJob(jobName, { ...data, immediate: true });
  }

  /**
   * Add a job to the queue
   */
  private async addJob(jobName: string, data: any) {
    try {
      // Ensure jobName is a string
      if (!jobName) {
        console.error('❌ Cannot add job: jobName is undefined');
        return;
      }

      // Add job with retry options
      const job = await scrapeQueue.add(jobName, data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000 // Start with 1 minute delay
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 200, // Keep last 200 failed jobs
        priority: this.getJobPriority(jobName)
      });
      
      console.log(`📦 Added scheduled job: ${jobName} (ID: ${job.id})`);
      
      // Log to database for monitoring (optional)
      await this.logJobSchedule(jobName, String(job.id));
      
    } catch (error) {
      console.error(`❌ Failed to add scheduled job ${jobName}:`, error);
    }
  }

  /**
   * Get job priority (lower number = higher priority)
   */
  private getJobPriority(jobName: string): number {
    // Safety check
    if (!jobName) {
      return 5;
    }
    
    const priorities: Record<string, number> = {
      // Highest priority (1) - Core data sources
      'DISCOVER_MPS': 1,
      'DISCOVER_GOVERNORS': 1,
      'PROCESS_MP_LIST_PDF': 1,
      
      // High priority (2) - Detail parsing
      'PARSE_MEMBER_DETAIL': 2,
      'PARSE_GOVERNOR_DETAIL': 2,
      'SCRAPE_COUNTY_GOVERNOR': 2, // This will now only be triggered by DISCOVER_GOVERNORS
      
      // Medium priority (3) - Updates and refreshes
      'REFRESH_MEMBERS': 3,
      'SCRAPE_COG_LEADERSHIP': 3,
      
      // Low priority (4) - Background tasks
      'CHECK_HANSARD': 4,
      'RETRY_FAILED_PUSHES': 4
    };
    
    return priorities[jobName] || 5;
  }

  /**
   * Log job to database for monitoring
   */
  private async logJobSchedule(jobName: string, jobId: string) {
    try {
      console.log(`📝 Job scheduled: ${jobName} (${jobId}) at ${new Date().toISOString()}`);
    } catch (error) {
      // Ignore logging errors
    }
  }

  /**
   * Get scheduler status with all jobs
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeIntervals: this.intervals.length,
      scheduledJobs: [
        // Immediate startup jobs
        'STARTUP: DISCOVER_MPS',
        'STARTUP: PROCESS_MP_LIST_PDF',
        'STARTUP: DISCOVER_GOVERNORS',
        'STARTUP: SCRAPE_COG_LEADERSHIP',
        
        // Daily jobs
        'DAILY: DISCOVER_MPS (2:00 AM)',
        
        // Weekly jobs
        'WEEKLY: PROCESS_MP_LIST_PDF (Sunday 4:00 AM)',
        'WEEKLY: REFRESH_MEMBERS (Monday 3:00 AM)',
        'WEEKLY: DISCOVER_GOVERNORS (Sunday 5:00 AM)',
        'WEEKLY: SCRAPE_COG_LEADERSHIP (Monday 6:00 AM)',
        
        // Interval jobs
        'INTERVAL: CHECK_HANSARD (every 6 hours)',
        'INTERVAL: RETRY_FAILED_PUSHES (every hour)'
        // SCRAPE_COUNTY_GOVERNOR removed - now triggered by DISCOVER_GOVERNORS
      ]
    };
  }

  /**
   * Log all scheduled jobs summary
   */
  private logScheduledJobs() {
    console.log('\n📋 ===== SCHEDULED JOBS SUMMARY =====');
    console.log('🚀 Immediate on startup:');
    console.log('   ├─ DISCOVER_MPS');
    console.log('   ├─ PROCESS_MP_LIST_PDF');
    console.log('   ├─ DISCOVER_GOVERNORS');
    console.log('   └─ SCRAPE_COG_LEADERSHIP');
    
    console.log('\n📅 Daily:');
    console.log('   └─ DISCOVER_MPS (2:00 AM)');
    
    console.log('\n📆 Weekly:');
    console.log('   ├─ PROCESS_MP_LIST_PDF (Sunday 4:00 AM)');
    console.log('   ├─ REFRESH_MEMBERS (Monday 3:00 AM)');
    console.log('   ├─ DISCOVER_GOVERNORS (Sunday 5:00 AM)');
    console.log('   └─ SCRAPE_COG_LEADERSHIP (Monday 6:00 AM)');
    
    console.log('\n⏱️ Interval:');
    console.log('   ├─ CHECK_HANSARD (every 6 hours)');
    console.log('   └─ RETRY_FAILED_PUSHES (every hour)');
    console.log('\n📌 Note: SCRAPE_COUNTY_GOVERNOR is triggered by DISCOVER_GOVERNORS for each county');
    console.log('================================\n');
  }

  /**
   * Helper to format duration
   */
  private formatDuration(ms: number): string {
    const hours = ms / (60 * 60 * 1000);
    if (hours >= 24) {
      const days = hours / 24;
      return `${days} day${days > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  /**
   * Helper to get day name
   */
  private getDayName(day: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day] || 'Unknown';
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    console.log('⏹️ Stopping scheduler...');
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    this.isRunning = false;
    console.log('✅ Scheduler stopped');
  }
}

export const scheduler = new SchedulerService();