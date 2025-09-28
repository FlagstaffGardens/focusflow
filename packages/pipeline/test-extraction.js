const { resolvePlaudAudioUrl } = require('./dist/plaud/resolver');

async function test() {
  console.log('Testing Plaud date extraction...\n');

  const result = await resolvePlaudAudioUrl(
    'https://web.plaud.ai/share/d0b21758805090616',
    (msg) => console.log(`[LOG] ${msg}`)
  );

  console.log('\nResult:');
  console.log('Audio URL:', result.audioUrl);
  console.log('Meeting Date:', result.meetingDate);
  console.log('Meeting Date (readable):', result.meetingDate ? new Date(result.meetingDate).toLocaleString() : 'none');
}

test();