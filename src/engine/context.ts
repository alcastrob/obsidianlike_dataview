import { DVLink, DVPage, DVTask, DVValue } from "../types";

/** Builds the record used for identifier resolution when evaluating expressions against a page. */
export function pageToRecord(page: DVPage): Record<string, DVValue> {
  const fileObj: Record<string, DVValue> = {
    path: page.file.path,
    name: page.file.name,
    folder: page.file.folder,
    ext: page.file.extension,
    ctime: page.file.ctime,
    mtime: page.file.mtime,
    size: page.file.size,
    tags: page.file.tags,
    etags: page.file.tags,
    tasks: null, // populated lazily by callers that need task rows; avoids O(n^2) conversion here.
    outlinks: page.file.outlinks,
    inlinks: page.file.inlinks,
    link: new DVLink(page.file.path, page.file.name),
  };

  return {
    ...page.fields,
    file: fileObj,
    tags: page.file.tags,
  };
}

export interface EvalRow {
  /** Identifier bindings visible to expressions: page fields, `file`, plus any FLATTEN/GROUP BY bindings. */
  record: Record<string, DVValue>;
  /** The originating page, when this row still corresponds 1:1 with a page (pre-GROUP BY). */
  page?: DVPage;
  /** The originating task, for TASK queries. */
  task?: DVTask;
}

export function cloneRow(row: EvalRow): EvalRow {
  return { record: { ...row.record }, page: row.page };
}
