export type StorageName = "CLOUDINARY" | "S3" | "LOCAL";
/** How the file is kept: Cloudinary needs to know image / video / raw (everything else). */
export type MediaKind = "image" | "video" | "raw";

export interface PutOptions {
  folder: string;
  ext: string;
  mime: string;
  kind: MediaKind;
}

export interface StoredObject {
  /** Cloudinary public_id, S3 key or local path; what is saved as cloud_public_id. */
  key: string;
  /** The canonical address of the original (not directly fetchable for private storage). */
  url: string;
}

export interface SignedUrls {
  /** View the original. Short-lived or signed; generate per request, never store. */
  url: string;
  /** A small preview for images and videos (null when the driver can't make one). */
  thumbnailUrl: string | null;
  /** Download with the original file name. */
  downloadUrl: string;
}

export interface StorageDriver {
  readonly name: StorageName;
  put(body: Buffer, opts: PutOptions): Promise<StoredObject>;
  urls(obj: { key: string; mime: string; kind: MediaKind; fileName: string }): Promise<SignedUrls>;
}
