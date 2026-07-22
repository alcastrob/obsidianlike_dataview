export type TokenType =
  | "ident"
  | "number"
  | "string"
  | "link"
  | "tag"
  | "punct"
  | "op"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const PUNCT = new Set(["(", ")", "[", "]", "{", "}", ",", ":", "."]);
const MULTI_OPS = ["<=", ">=", "!=", "=="];
const SINGLE_OPS = new Set(["=", "<", ">", "+", "-", "*", "/", "%", "!"]);

export class DQLLexer {
  private i = 0;
  private tokens: Token[] = [];

  constructor(private readonly src: string) {
    this.tokenize();
  }

  getTokens(): Token[] {
    return this.tokens;
  }

  private tokenize(): void {
    const s = this.src;
    while (this.i < s.length) {
      const c = s[this.i];

      if (/\s/.test(c)) {
        this.i++;
        continue;
      }

      if (c === "[" && s[this.i + 1] === "[") {
        const end = s.indexOf("]]", this.i + 2);
        const raw = end === -1 ? s.slice(this.i + 2) : s.slice(this.i + 2, end);
        this.tokens.push({ type: "link", value: raw, pos: this.i });
        this.i = end === -1 ? s.length : end + 2;
        continue;
      }

      if (c === "#") {
        const start = this.i + 1;
        let j = start;
        while (j < s.length && /[\w/-]/.test(s[j])) j++;
        this.tokens.push({ type: "tag", value: s.slice(start, j), pos: this.i });
        this.i = j;
        continue;
      }

      if (c === '"' || c === "'") {
        let j = this.i + 1;
        let out = "";
        while (j < s.length && s[j] !== c) {
          if (s[j] === "\\" && j + 1 < s.length) {
            out += s[j + 1];
            j += 2;
            continue;
          }
          out += s[j];
          j++;
        }
        this.tokens.push({ type: "string", value: out, pos: this.i });
        this.i = j + 1;
        continue;
      }

      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[this.i + 1] ?? ""))) {
        let j = this.i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        this.tokens.push({ type: "number", value: s.slice(this.i, j), pos: this.i });
        this.i = j;
        continue;
      }

      if (/[\p{L}_]/u.test(c)) {
        let j = this.i;
        while (j < s.length && /[\p{L}\p{N}_-]/u.test(s[j])) j++;
        this.tokens.push({ type: "ident", value: s.slice(this.i, j), pos: this.i });
        this.i = j;
        continue;
      }

      const two = s.slice(this.i, this.i + 2);
      if (MULTI_OPS.includes(two)) {
        this.tokens.push({ type: "op", value: two === "==" ? "=" : two, pos: this.i });
        this.i += 2;
        continue;
      }

      if (SINGLE_OPS.has(c)) {
        this.tokens.push({ type: "op", value: c, pos: this.i });
        this.i++;
        continue;
      }

      if (PUNCT.has(c)) {
        this.tokens.push({ type: "punct", value: c, pos: this.i });
        this.i++;
        continue;
      }

      // Unknown character: skip it rather than throwing, to stay resilient to odd input.
      this.i++;
    }

    this.tokens.push({ type: "eof", value: "", pos: this.i });
  }
}
