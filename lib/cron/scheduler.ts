import cron from 'node-cron';
import { discoverNewRecordings } from '../gdrive/discovery';

let cronJob: cron.ScheduledTask | null = null;

/**
 * Start the cron job for discovering new recordings every 5 minutes
 */
export function startCronJobs() {
  // Prevent multiple cron jobs in development (hot reload)
  if (cronJob) {
    console.log('Cron job already running, skipping initialization');
    return;
  }

  // Run every 5 minutes: */5 * * * *
  cronJob = cron.schedule('*/5 * * * *', async () => {
    console.log('[CRON] Running Google Drive discovery...');
    try {
      const result = await discoverNewRecordings();
      console.log(`[CRON] Discovery complete: ${result.newRecordings} new, ${result.skipped} skipped`);
    } catch (error) {
      console.error('[CRON] Discovery failed:', error);
    }
  });

  console.log('✓ Cron job scheduled: Google Drive discovery every 5 minutes');

  // Run once immediately on startup
  console.log('[CRON] Running initial discovery...');
  discoverNewRecordings()
    .then(result => {
      console.log(`[CRON] Initial discovery complete: ${result.newRecordings} new, ${result.skipped} skipped`);
    })
    .catch(error => {
      console.error('[CRON] Initial discovery failed:', error);
    });
}

/**
 * Stop the cron job (useful for cleanup)
 */
export function stopCronJobs() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('Cron job stopped');
  }
}
