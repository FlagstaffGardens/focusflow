import { NextResponse } from 'next/server';
import { discoverNewRecordings, getDiscoveryStats } from '@/lib/gdrive/discovery';

/**
 * POST /api/gdrive/poll
 * Discover new recordings from Google Drive
 * Protected by CRON_SECRET for automated polling
 */
export async function POST(request: Request) {
  try {
    // Check authorization
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (token !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Run discovery
    const result = await discoverNewRecordings();
    const stats = await getDiscoveryStats();

    return NextResponse.json({
      success: true,
      discovery: result,
      stats,
    });

  } catch (error) {
    console.error('Poll endpoint error:', error);
    return NextResponse.json(
      {
        error: 'Discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gdrive/poll
 * Get discovery statistics (for manual checking)
 */
export async function GET() {
  try {
    const stats = await getDiscoveryStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Stats endpoint error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
