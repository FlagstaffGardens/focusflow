import { pgTable, uuid, varchar, text, timestamp, integer, json } from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  // Primary key
  id: uuid('id').primaryKey().defaultRandom(),

  // Status tracking
  status: varchar('status', {
    enum: ['discovered', 'transcribing', 'transcribed', 'summarizing', 'syncing', 'completed', 'failed']
  }).notNull().default('discovered'),

  // Source tracking
  source: varchar('source', { enum: ['plaud', 'cube-acr'] }).notNull(),

  // Google Drive
  gdrive_file_id: varchar('gdrive_file_id').unique(),
  gdrive_file_name: varchar('gdrive_file_name'),
  gdrive_file_size: integer('gdrive_file_size'),
  gdrive_json_id: varchar('gdrive_json_id'),

  // Call metadata (from filename parsing)
  contact_name: varchar('contact_name'),
  contact_number: varchar('contact_number'),
  call_direction: varchar('call_direction', { enum: ['incoming', 'outgoing'] }),
  call_timestamp: timestamp('call_timestamp'),
  call_type: varchar('call_type', { enum: ['phone', 'whatsapp'] }),

  // Duration (from JSON file, in seconds)
  duration_seconds: integer('duration_seconds'),

  // Processing results
  transcript: text('transcript'),
  summary: text('summary'),

  // Notion sync
  notion_page_id: varchar('notion_page_id').unique(),
  notion_url: text('notion_url'),

  // Error tracking
  error_message: text('error_message'),
  retry_count: integer('retry_count').default(0),

  // Timestamps for monitoring
  discovered_at: timestamp('discovered_at').defaultNow(),
  transcription_started_at: timestamp('transcription_started_at'),
  transcription_completed_at: timestamp('transcription_completed_at'),
  summarization_started_at: timestamp('summarization_started_at'),
  summarization_completed_at: timestamp('summarization_completed_at'),
  completed_at: timestamp('completed_at'),

  // Standard timestamps
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),

  // Plaud.ai backwards compatibility
  plaud_url: text('plaud_url'),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
