export interface CubeACRMetadata {
  contactName: string;
  contactNumber?: string;
  callDirection: 'incoming' | 'outgoing';
  callTimestamp: Date;
  callType: 'phone' | 'whatsapp';
  fileName: string;
}

export interface ParsedFilename {
  metadata: CubeACRMetadata | null;
  error?: string;
}
