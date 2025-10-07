/**
 * Next.js Instrumentation
 * Runs once when the server starts
 */
export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCronJobs } = await import('./lib/cron/scheduler');
    const { startAutoProcessorCron } = await import('./lib/cron/auto-processor');
    const { ensureDbIndexes } = await import('./lib/db/indexes');
    await ensureDbIndexes();
    startCronJobs();
    startAutoProcessorCron();
  }
}
