import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { StorageProvider } from "@prisma/client";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";

type UploadInput = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
};

export type StoredAsset = {
  provider: StorageProvider;
  storageKey: string;
};

export class StorageService {
  async store(input: UploadInput): Promise<StoredAsset> {
    this.normalizeStorageKey(input.storageKey);

    return this.storeLocally(input);
  }

  async remove(storageKey: string) {
    const safeStorageKey = this.normalizeStorageKey(storageKey);

    try {
      await fs.unlink(this.resolveLocalPath(safeStorageKey));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async checkReadiness() {
    

    await fs.mkdir(path.resolve(env.STORAGE_LOCAL_ROOT), { recursive: true });
    const probe = path.join(path.resolve(env.STORAGE_LOCAL_ROOT), `.ready-${randomUUID()}`);
    try { await fs.writeFile(probe, "ready", { flag: "wx", mode: 0o600 }); }
    finally { await fs.rm(probe, { force: true }); }
  }

  async read(storageKey: string) {
    const safeStorageKey = this.normalizeStorageKey(storageKey);

    return fs.readFile(this.resolveLocalPath(safeStorageKey));
  }

  private async storeLocally(input: UploadInput): Promise<StoredAsset> {
    const safeStorageKey = this.normalizeStorageKey(input.storageKey);
    const targetPath = this.resolveLocalPath(safeStorageKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, input.buffer);

    return {
      provider: StorageProvider.LOCAL,
      storageKey: safeStorageKey,
    };
  }

  

  private normalizeStorageKey(storageKey: string) {
    const normalized = storageKey.replaceAll("\\", "/").replace(/^\/+/, "");
    if (normalized.length === 0 || normalized.includes("..")) {
      throw new AppError(400, "uploads.invalid_storage_key", "Invalid storage key.");
    }

    return normalized;
  }

  private resolveLocalPath(storageKey: string) {
    const localRoot = path.resolve(env.STORAGE_LOCAL_ROOT);
    const targetPath = path.resolve(localRoot, storageKey);
    if (!targetPath.startsWith(`${localRoot}${path.sep}`)) {
      throw new AppError(400, "uploads.invalid_storage_key", "Invalid storage key.");
    }
    return targetPath;
  }
}

export const storageService = new StorageService();
