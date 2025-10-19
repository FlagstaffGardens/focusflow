import { ParsedFilename } from './types';
import { localTimeInZoneToDate } from '../utils/timezone';

/**
 * Parse Cube ACR filename to extract call metadata
 *
 * Supported formats:
 * - Phone: "2025-10-03 16-54-44 (phone) Contact Name (0486300265) ↙.m4a"
 * - Phone: "2025-10-03 16-32-29 (phone) Contact Name (+61 403 692 612) ↗.m4a"
 * - WhatsApp: "2025-10-03 17-09-31 (whatsapp) Contact Name.m4a"
 *
 * Arrows: ↗ = outgoing, ↙ = incoming
 */
export function parseCubeACRFilename(filename: string): ParsedFilename {
  try {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.(m4a|amr|mp3|wav)$/i, '');

    // Extract timestamp (YYYY-MM-DD HH-MM-SS)
    const timestampMatch = nameWithoutExt.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}-\d{2}-\d{2})/);
    if (!timestampMatch) {
      return { metadata: null, error: 'Could not extract timestamp from filename' };
    }

    const [, datePart, timePart] = timestampMatch;
    const [year, month, day] = datePart.split('-').map((v) => parseInt(v, 10));
    const [hh, mm, ss] = timePart.split('-').map((v) => parseInt(v, 10));
    // Interpret filename time as Melbourne local time and convert to absolute UTC
    const callTimestamp = localTimeInZoneToDate(year, month, day, hh, mm, ss, 'Australia/Melbourne');

    // Extract call type (phone or whatsapp)
    const typeMatch = nameWithoutExt.match(/\((phone|whatsapp|mic)\)/);
    if (!typeMatch) {
      return { metadata: null, error: 'Could not extract call type from filename' };
    }
    const callType = typeMatch[1] as 'phone' | 'whatsapp' | 'mic';

    // Extract direction arrow (↗ = outgoing, ↙ = incoming)
    // For WhatsApp we default to incoming (no arrow). For mic we leave undefined.
    const hasOutgoingArrow = nameWithoutExt.includes('↗');
    const hasIncomingArrow = nameWithoutExt.includes('↙');
    let callDirection: 'incoming' | 'outgoing' | undefined = undefined;
    if (callType === 'mic') {
      callDirection = undefined;
    } else {
      callDirection = 'incoming'; // default for WhatsApp
      if (hasOutgoingArrow) callDirection = 'outgoing';
      else if (hasIncomingArrow) callDirection = 'incoming';
    }

    // Extract contact name and phone number
    // Pattern after timestamp and type: "Contact Name (Phone Number) Arrow" or "Contact Name" (WhatsApp)
    const afterType = nameWithoutExt.split(`(${callType})`)[1]?.trim();
    if (!afterType) {
      return { metadata: null, error: 'Could not extract contact info from filename' };
    }

    let contactName = '';
    let contactNumber: string | undefined;

    if (callType === 'phone') {
      // Phone: "Contact Name (Phone Number) Arrow"
      // Extract phone number (last parentheses before arrow)
      const phoneMatch = afterType.match(/\(([^)]+)\)\s*[↗↙]/);
      if (phoneMatch) {
        contactNumber = phoneMatch[1].replace(/\s+/g, ''); // Remove spaces from phone number
        // Contact name is everything before the phone number parentheses
        contactName = afterType.split(`(${phoneMatch[1]})`)[0].trim();
      } else {
        // Fallback: no phone number, just contact name
        contactName = afterType.replace(/[↗↙]/g, '').trim();
      }
    } else if (callType === 'whatsapp') {
      // WhatsApp: "Contact Name" (no phone number, no arrow)
      contactName = afterType.trim();
    } else {
      // mic: treat remainder as a meeting title if present; otherwise generic label
      contactName = afterType.trim() || 'In-person meeting';
    }

    // Clean up contact name (remove any trailing arrows)
    contactName = contactName.replace(/[↗↙]/g, '').trim();

    if (!contactName) {
      return { metadata: null, error: 'Could not extract contact name from filename' };
    }

    return {
      metadata: {
        contactName,
        contactNumber,
        callDirection,
        callTimestamp,
        callType,
        fileName: filename,
      },
    };
  } catch (error) {
    return {
      metadata: null,
      error: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  }
}

/**
 * Check if a filename matches Cube ACR pattern
 */
export function isCubeACRFile(filename: string): boolean {
  const audioExtensions = /\.(m4a|amr|mp3|wav)$/i;
  const cubePattern = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2} \((phone|whatsapp|mic)\)/;

  return audioExtensions.test(filename) && cubePattern.test(filename);
}

/**
 * Get corresponding JSON metadata filename
 */
export function getJsonFilename(audioFilename: string): string {
  return audioFilename.replace(/\.(m4a|amr|mp3|wav)$/i, '.json');
}
