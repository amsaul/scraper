import { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

export class ScreenshotService {
  private screenshotDir: string;
  private errorDir: string;

  constructor() {
    // Create screenshots folder structure
    const projectRoot = process.cwd();
    this.screenshotDir = path.join(projectRoot, 'screenshots');
    this.errorDir = path.join(this.screenshotDir, 'errors');

    // Ensure directories exist
    this.ensureDirectoryExists(this.screenshotDir);
    this.ensureDirectoryExists(this.errorDir);
  }

  /**
   * Ensure directory exists, create if it doesn't
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Take error screenshot and save to file
   * @param page - Puppeteer page object
   * @param errorMessage - Error message or context
   * @param jobName - Name of the job/task
   * @param url - URL where error occurred
   * @returns Path to saved screenshot
   */
  async captureErrorScreenshot(
    page: Page | null,
    errorMessage: string,
    jobName: string = 'unknown',
    url: string = 'unknown'
  ): Promise<string | null> {
    try {
      if (!page) {
        console.warn('⚠️ No page available for screenshot');
        return null;
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedJobName = jobName.replace(/[^a-zA-Z0-9-_]/g, '_');
      const fileName = `error_${sanitizedJobName}_${timestamp}.png`;
      const filePath = path.join(this.errorDir, fileName);

      // Take screenshot
      await page.screenshot({ path: filePath, fullPage: true });

      // Create metadata file
      const metadataFileName = fileName.replace('.png', '.json');
      const metadataPath = path.join(this.errorDir, metadataFileName);

      const metadata = {
        timestamp: new Date().toISOString(),
        jobName,
        url,
        errorMessage,
        screenshotPath: filePath,
        pageTitle: await page.title().catch(() => 'N/A'),
        pageUrl: page.url()
      };

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      console.log(`📸 Error screenshot saved: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error('❌ Failed to capture error screenshot:', error);
      return null;
    }
  }

  /**
   * Take a periodic/debug screenshot
   * @param page - Puppeteer page object
   * @param label - Label for the screenshot
   * @returns Path to saved screenshot
   */
  async captureDebugScreenshot(page: Page | null, label: string = 'debug'): Promise<string | null> {
    try {
      if (!page) {
        console.warn('⚠️ No page available for screenshot');
        return null;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedLabel = label.replace(/[^a-zA-Z0-9-_]/g, '_');
      const fileName = `debug_${sanitizedLabel}_${timestamp}.png`;
      const filePath = path.join(this.screenshotDir, fileName);

      await page.screenshot({ path: filePath, fullPage: true });

      console.log(`📸 Debug screenshot saved: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error('❌ Failed to capture debug screenshot:', error);
      return null;
    }
  }

  /**
   * Get list of all error screenshots
   */
  getErrorScreenshots(): Array<{ filename: string; path: string; metadata?: any }> {
    try {
      const files = fs.readdirSync(this.errorDir);
      const screenshots = files
        .filter(f => f.endsWith('.png'))
        .map(filename => {
          const filePath = path.join(this.errorDir, filename);
          const metadataPath = filePath.replace('.png', '.json');

          let metadata: any = null;
          if (fs.existsSync(metadataPath)) {
            try {
              metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            } catch (e) {
              // Skip metadata parsing errors
            }
          }

          return {
            filename,
            path: filePath,
            metadata
          };
        });

      return screenshots;
    } catch (error) {
      console.error('❌ Failed to get error screenshots:', error);
      return [];
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalErrors: number;
    by_job: { [key: string]: number };
    by_date: { [key: string]: number };
  } {
    const screenshots = this.getErrorScreenshots();
    const stats = {
      totalErrors: screenshots.length,
      by_job: {} as { [key: string]: number },
      by_date: {} as { [key: string]: number }
    };

    screenshots.forEach(ss => {
      // Count by job
      if (ss.metadata?.jobName) {
        stats.by_job[ss.metadata.jobName] = (stats.by_job[ss.metadata.jobName] || 0) + 1;
      }

      // Count by date
      if (ss.metadata?.timestamp) {
        const date = ss.metadata.timestamp.split('T')[0];
        stats.by_date[date] = (stats.by_date[date] || 0) + 1;
      }
    });

    return stats;
  }

  /**
   * Clear old error screenshots (older than X days)
   */
  clearOldScreenshots(daysOld: number = 30): number {
    try {
      const files = fs.readdirSync(this.errorDir);
      const now = Date.now();
      const maxAge = daysOld * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      files.forEach(filename => {
        const filePath = path.join(this.errorDir, filename);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          deletedCount++;

          // Also delete associated metadata
          const metadataPath = filePath.replace('.png', '.json');
          if (fs.existsSync(metadataPath)) {
            fs.unlinkSync(metadataPath);
          }
        }
      });

      console.log(`🧹 Cleaned up ${deletedCount} old error screenshots`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Failed to clear old screenshots:', error);
      return 0;
    }
  }

  /**
   * Generate HTML report of error screenshots
   */
  generateErrorReport(outputPath?: string): string {
    const screenshots = this.getErrorScreenshots();
    const stats = this.getErrorStats();

    const reportPath = outputPath || path.join(this.screenshotDir, 'error_report.html');

    let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Error Screenshots Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .stats { background: white; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .stat-item { display: inline-block; margin-right: 20px; padding: 10px; background: #f0f0f0; border-radius: 3px; }
    .error-section { background: white; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .error-item { border-left: 4px solid #e74c3c; padding: 15px; margin-bottom: 15px; background: #fef5f5; }
    .error-item h3 { margin-top: 0; color: #e74c3c; }
    .error-item img { max-width: 100%; max-height: 500px; border: 1px solid #ddd; }
    .metadata { font-size: 12px; color: #666; margin-top: 10px; }
    .timestamp { color: #999; }
  </style>
</head>
<body>
  <h1>🔴 Error Screenshots Report</h1>
  <div class="stats">
    <h2>Statistics</h2>
    <div class="stat-item">
      <strong>Total Errors:</strong> ${stats.totalErrors}
    </div>
`;

    Object.entries(stats.by_job).forEach(([job, count]) => {
      html += `<div class="stat-item"><strong>${job}:</strong> ${count}</div>`;
    });

    html += `
  </div>
  <div class="error-section">
    <h2>Error Screenshots</h2>
`;

    if (screenshots.length === 0) {
      html += `<p style="color: green;"><strong>✅ No error screenshots found!</strong></p>`;
    } else {
      screenshots.forEach(ss => {
        html += `
    <div class="error-item">
      <h3>📸 ${ss.metadata?.jobName || ss.filename}</h3>
      <p><strong>URL:</strong> ${ss.metadata?.url || 'N/A'}</p>
      <p><strong>Error:</strong> ${ss.metadata?.errorMessage || 'N/A'}</p>
      <p class="timestamp"><strong>Time:</strong> ${ss.metadata?.timestamp || 'N/A'}</p>
      <img src="${ss.filename}" alt="Error screenshot" />
      <div class="metadata">
        <strong>Page Title:</strong> ${ss.metadata?.pageTitle || 'N/A'}<br>
        <strong>Page URL:</strong> ${ss.metadata?.pageUrl || 'N/A'}
      </div>
    </div>
`;
      });
    }

    html += `
  </div>
  <p style="text-align: center; color: #999; margin-top: 40px;">
    Generated: ${new Date().toISOString()}
  </p>
</body>
</html>
`;

    fs.writeFileSync(reportPath, html);
    console.log(`📊 Error report generated: ${reportPath}`);
    return reportPath;
  }

  /**
   * Get screenshot directory path
   */
  getErrorDirectoryPath(): string {
    return this.errorDir;
  }
}

export const screenshotService = new ScreenshotService();
