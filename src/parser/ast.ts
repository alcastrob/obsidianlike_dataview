export type QueryType = "LIST" | "TABLE" | "TASK" | "CALENDAR";

export type Expr =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "link"; path: string; subpath?: string; display?: string }
  | { kind: "tag"; name: string }
  | { kind: "list"; items: Expr[] }
  | { kind: "object"; entries: Array<{ key: string; value: Expr }> }
  | { kind: "unary"; op: "-" | "!"; expr: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "member"; target: Expr; property: string }
  | { kind: "index"; target: Expr; index: Expr }
  | { kind: "call"; name: string; args: Expr[] };

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "contains"
  | "in";

export interface OrderTerm {
  expr: Expr;
  direction: "ASC" | "DESC";
}

export type Source =
  | { kind: "all" }
  | { kind: "tag"; tag: string }
  | { kind: "folder"; path: string }
  | { kind: "link"; path: string; direction: "outgoing" | "incoming" }
  | { kind: "binary"; op: "and" | "or"; left: Source; right: Source }
  | { kind: "not"; source: Source };

export interface TableField {
  expr: Expr;
  alias?: string;
}

export interface FlattenClause {
  expr: Expr;
  alias?: string;
}

export interface Query {
  type: QueryType;
  withoutId: boolean;
  fields: TableField[]; // TABLE columns, or single LIST display expr (alias unused)
  from?: Source;
  where?: Expr;
  groupBy?: { expr: Expr; alias?: string };
  sort: OrderTerm[];
  limit?: number;
  flatten: FlattenClause[];
}
