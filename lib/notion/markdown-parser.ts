/**
 * Convert markdown text to Notion blocks
 * Handles headers, bold, lists, paragraphs
 */
export function markdownToNotionBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = markdown.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      i++;
      continue;
    }

    // Table detection (look for lines with pipes)
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      // Check if next line is separator (|---|---|)
      if (nextLine.match(/^\|[\s\-:|]+\|$/)) {
        const tableBlocks = parseMarkdownTable(lines, i);
        blocks.push(...tableBlocks.blocks);
        i = tableBlocks.nextIndex;
        continue;
      }
    }

    // Heading 1 (# or single word on own line)
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: parseRichText(line.substring(2)),
        },
      });
      i++;
      continue;
    }

    // Heading 2
    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: parseRichText(line.substring(3)),
        },
      });
      i++;
      continue;
    }

    // Heading 3
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseRichText(line.substring(4)),
        },
      });
      i++;
      continue;
    }

    // Bulleted list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const listText = line.substring(2);
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseRichText(listText),
        },
      });
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: parseRichText(numberedMatch[1]),
        },
      });
      i++;
      continue;
    }

    // Regular paragraph - collect consecutive lines
    let paragraphText = line;
    i++;

    // Collect continuation lines (non-empty, non-header, non-list)
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('-') &&
      !lines[i].trim().startsWith('*') &&
      !lines[i].trim().match(/^\d+\./)
    ) {
      paragraphText += '\n' + lines[i].trim();
      i++;
    }

    // Split long paragraphs into chunks (2000 char limit)
    const chunks = splitTextIntoChunks(paragraphText, 2000);
    for (const chunk of chunks) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: parseRichText(chunk),
        },
      });
    }
  }

  return blocks;
}

/**
 * Parse inline markdown (bold, italic) into Notion rich text format
 */
function parseRichText(text: string): any[] {
  const richText: any[] = [];
  let currentText = '';
  let i = 0;

  while (i < text.length) {
    // Bold (**text**)
    if (text.substring(i, i + 2) === '**') {
      // Flush current text
      if (currentText) {
        richText.push({ type: 'text', text: { content: currentText } });
        currentText = '';
      }

      // Find closing **
      const closeIndex = text.indexOf('**', i + 2);
      if (closeIndex !== -1) {
        const boldText = text.substring(i + 2, closeIndex);
        richText.push({
          type: 'text',
          text: { content: boldText },
          annotations: { bold: true },
        });
        i = closeIndex + 2;
        continue;
      }
    }

    // Code (`text`)
    if (text[i] === '`') {
      // Flush current text
      if (currentText) {
        richText.push({ type: 'text', text: { content: currentText } });
        currentText = '';
      }

      // Find closing `
      const closeIndex = text.indexOf('`', i + 1);
      if (closeIndex !== -1) {
        const codeText = text.substring(i + 1, closeIndex);
        richText.push({
          type: 'text',
          text: { content: codeText },
          annotations: { code: true },
        });
        i = closeIndex + 1;
        continue;
      }
    }

    currentText += text[i];
    i++;
  }

  // Flush remaining text
  if (currentText) {
    richText.push({ type: 'text', text: { content: currentText } });
  }

  // If no formatting found, return simple text
  if (richText.length === 0) {
    return [{ type: 'text', text: { content: text } }];
  }

  return richText;
}

/**
 * Split text into chunks respecting Notion's 2000 char limit
 */
function splitTextIntoChunks(text: string, maxLength: number = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let currentChunk = '';
  const words = text.split(' ');

  for (const word of words) {
    if ((currentChunk + word + ' ').length <= maxLength) {
      currentChunk += word + ' ';
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = word + ' ';
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

/**
 * Parse markdown table and convert to Notion bulleted list
 * (Notion API doesn't support table blocks easily, so we convert to list)
 */
function parseMarkdownTable(lines: string[], startIndex: number): { blocks: any[], nextIndex: number } {
  const blocks: any[] = [];
  let i = startIndex;

  // Parse header row
  const headerLine = lines[i].trim();
  const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);

  // Skip separator row
  i += 2;

  // Parse data rows
  while (i < lines.length) {
    const line = lines[i].trim();

    // Stop if we hit a non-table line
    if (!line.includes('|')) break;

    const cells = line.split('|').map(c => c.trim()).filter(c => c);

    // Create a bulleted list item for each row
    let rowText = '';
    for (let j = 0; j < Math.min(headers.length, cells.length); j++) {
      if (headers[j] && cells[j]) {
        rowText += `**${headers[j]}:** ${cells[j]}`;
        if (j < Math.min(headers.length, cells.length) - 1) {
          rowText += ' | ';
        }
      }
    }

    if (rowText) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseRichText(rowText),
        },
      });
    }

    i++;
  }

  return { blocks, nextIndex: i };
}
