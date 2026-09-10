export type MemoryKind = "rule" | "fact" | "episode" | "error" | "preference";

export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
};

export type MemoryWriteInput = {
  kind: MemoryKind;
  title: string;
  content: string;
  tags?: string[];
  importance?: number;
  id?: string;
};

export type MemorySearchHit = MemoryRecord & { score: number };
