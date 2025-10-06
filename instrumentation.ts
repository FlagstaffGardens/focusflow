/**
 * Next.js Instrumentation
 * Runs once when the server starts
 */
export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCronJobs } = await import('./lib/cron/scheduler');
    startCronJobs();
  }
}
