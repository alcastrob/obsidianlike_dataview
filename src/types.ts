/** Core value/model types shared by the indexer, parser and query engine. */

export class DVLink {
  constructor(
    public path: string,
    public display?: string,
    public subpath?: string
  ) {}

  toString(): string {
    return this.display ?? this.subpath ? `${this.path}#${this.subpath}` : this.path;
  }

  static file(path: string, display?: string, subpath?: string): DVLink {
    return new DVLink(path, display, subpath);
  }
}

/** Duration expressed in milliseconds, printable like "3 days". */
export class DVDuration {
  constructor(public millis: number) {}

  static fromParts(parts: Partial<Record<"years" | "months" | "weeks" | "days" | "hours" | "minutes" | "seconds", number>>): DVDuration {
    const ms =
      (parts.years ?? 0) * 365 * 24 * 3600 * 1000 +
      (parts.months ?? 0) * 30 * 24 * 3600 * 1000 +
      (parts.weeks ?? 0) * 7 * 24 * 3600 * 1000 +
      (parts.days ?? 0) * 24 * 3600 * 1000 +
      (parts.hours ?? 0) * 3600 * 1000 +
      (parts.minutes ?? 0) * 60 * 1000 +
      (parts.seconds ?? 0) * 1000;
    return new DVDuration(ms);
  }

  toString(): string {
    const totalSeconds = Math.floor(this.millis / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const bits: string[] = [];
    if (days) bits.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours) bits.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes) bits.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    if (seconds || bits.length === 0) bits.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
    return bits.join(", ");
  }
}

/** A parsed `- [ ] text` / `- [x] text` list item. */
export interface DVTask {
  text: string;
  completed: boolean;
  status: string; // the character inside [ ], e.g. " ", "x", "/"
  line: number;
  path: string;
  tags: string[];
  children: DVTask[];
  annotatedFields: Record<string, DVValue>;
}

export type DVPrimitive = null | boolean | number | string | Date | DVDuration | DVLink;
export type DVValue = DVPrimitive | DVValue[] | { [key: string]: DVValue };

export interface DVFileInfo {
  path: string;
  name: string;
  folder: string;
  extension: string;
  ctime: Date;
  mtime: Date;
  size: number;
  tags: string[];
  outlinks: DVLink[];
  inlinks: DVLink[];
  tasks: DVTask[];
  frontmatterRaw: Record<string, unknown>;
}

/** A single indexed note ("page" in Dataview terminology). */
export interface DVPage {
  file: DVFileInfo;
  fields: Record<string, DVValue>;
}
