import { Expr } from "../parser/ast";

/** Render an expression back to a short source-like label, used as a default TABLE column header. */
export function exprLabel(expr: Expr): string {
  switch (expr.kind) {
    case "null":
      return "null";
    case "bool":
      return String(expr.value);
    case "number":
      return String(expr.value);
    case "string":
      return expr.value;
    case "ident":
      return expr.name;
    case "tag":
      return expr.name;
    case "link":
      return expr.display ?? expr.path;
    case "list":
      return `[${expr.items.map(exprLabel).join(", ")}]`;
    case "object":
      return `{${expr.entries.map((e) => `${e.key}: ${exprLabel(e.value)}`).join(", ")}}`;
    case "unary":
      return `${expr.op}${exprLabel(expr.expr)}`;
    case "binary":
      return `${exprLabel(expr.left)} ${expr.op} ${exprLabel(expr.right)}`;
    case "member":
      return `${exprLabel(expr.target)}.${expr.property}`;
    case "index":
      return `${exprLabel(expr.target)}[${exprLabel(expr.index)}]`;
    case "call":
      return `${expr.name}(${expr.args.map(exprLabel).join(", ")})`;
  }
}
