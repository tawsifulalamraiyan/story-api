declare module "formidable" {
  export interface File {
    size: number;
    filepath: string;
    originalFilename: string | null;
    newFilename: string;
    mimetype: string | null;
    mtime: Date | null;
  }

  export interface Fields {
    [key: string]: string[];
  }

  export interface Files {
    [key: string]: File[];
  }

  export interface Options {
    encoding?: string;
    uploadDir?: string;
    keepExtensions?: boolean;
    allowEmptyFiles?: boolean;
    minFileSize?: number;
    maxFileSize?: number;
    maxFields?: number;
    maxFieldsSize?: number;
    hashAlgorithm?: false | "sha1" | "md5";
    multiples?: boolean;
  }

  export function parse(
    req: unknown,
    callback?: (err: Error | null, fields: Fields, files: Files) => void
  ): void;

  export function parse(req: unknown): Promise<[Fields, Files]>;
}
