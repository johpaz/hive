import type { Config } from "../config/loader.ts";
import { logger } from "../utils/logger.ts";
import { dbService } from "../storage/sqlite.ts";

export interface Note {
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryStore {
  private log = logger.child("memory");

  constructor(config: Config) {
    // Configuration can remain unused as sqlite db handles path resolution
  }

  write(title: string, content: string): Note {
    const row = dbService.writeNote(title, content);
    this.log.debug(`Wrote note: ${title}`);
    return {
      title: row.title,
      content: row.content,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  }

  read(title: string): Note | null {
    const row = dbService.readNote(title);
    if (!row) return null;
    return {
      title: row.title,
      content: row.content,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  }

  list(): Array<{ title: string; path: string }> {
    return dbService.listNotes().map(row => ({
      title: row.title,
      path: `sqlite://notes/${row.id}`
    }));
  }

  delete(title: string): boolean {
    const deleted = dbService.deleteNote(title);
    if (deleted) {
      this.log.debug(`Deleted note: ${title}`);
    }
    return deleted;
  }

  search(query: string): Note[] {
    return dbService.searchNotes(query).map(row => ({
      title: row.title,
      content: row.content,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    }));
  }
}

export function createMemoryStore(config: Config): MemoryStore {
  return new MemoryStore(config);
}
