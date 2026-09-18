import { randomUUID } from 'node:crypto';
import { writeFile, rename, rm } from 'node:fs/promises';

/** Keep readers on a complete old or new file, including during shutdown. */
export async function writeTextFileAtomic(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf-8', flush: true });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}
