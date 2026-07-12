import { DVJsOutputNode } from "../dataviewjs/api";
import { QueryResult } from "../engine/queryEngine";
import { DVLink, DVValue } from "../types";
import { isDVLink, renderValue } from "../values";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkHtml(link: DVLink): string {
  // `data-wiki` (not an href) so this integrates with host renderers that resolve navigation
  // client-side via a wikilink-style target (e.g. the Obsidianlike custom editor's
  // `[data-wiki]` click handler) rather than a `command:` URI, which isn't supported by plain
  // webviews. `data-path` is kept alongside for consumers that want the raw indexed path.
  const wikiTarget = link.path.replace(/\.md$/i, "");
  return `<a class="dv-link" href="#" data-wiki="${esc(wikiTarget)}" data-path="${esc(link.path)}">${esc(link.display ?? link.path)}</a>`;
}

function cellHtml(v: DVValue): string {
  if (v === null || v === undefined) return "";
  if (isDVLink(v)) return linkHtml(v);
  if (Array.isArray(v)) return v.map(cellHtml).join(", ");
  return esc(renderValue(v));
}

export function renderQueryResultHtml(result: QueryResult): string {
  switch (result.type) {
    case "ERROR":
      return `<div class="dv-error">Dataview error: ${esc(result.message)}</div>`;

    case "LIST": {
      if (result.rows.length === 0) return `<div class="dv-empty">No results.</div>`;
      const items = result.rows
        .map((row) => {
          if (row.link && (row.display === row.link || row.display === undefined)) return `<li>${linkHtml(row.link)}</li>`;
          if (row.link) return `<li>${linkHtml(row.link)}: ${cellHtml(row.display)}</li>`;
          return `<li>${cellHtml(row.display)}</li>`;
        })
        .join("\n");
      return `<ul class="dv-list">\n${items}\n</ul>`;
    }

    case "TABLE": {
      if (result.rows.length === 0) return `<div class="dv-empty">No results.</div>`;
      const head = `<tr>${result.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
      const body = result.rows.map((row) => `<tr>${row.map((c) => `<td>${cellHtml(c)}</td>`).join("")}</tr>`).join("\n");
      return `<table class="dv-table">\n<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
    }

    case "TASK": {
      if (result.groups.length === 0) return `<div class="dv-empty">No results.</div>`;
      const groups = result.groups
        .map((g) => {
          const items = g.tasks
            .map((t) => `<li><input type="checkbox" disabled ${t.completed ? "checked" : ""}/> ${esc(t.text)}</li>`)
            .join("\n");
          return `<div class="dv-task-group">${linkHtml(new DVLink(g.page.file.path, g.page.file.name))}<ul class="dv-task-list">\n${items}\n</ul></div>`;
        })
        .join("\n");
      return groups;
    }

    case "CALENDAR": {
      if (result.days.length === 0) return `<div class="dv-empty">No results.</div>`;
      const rows = result.days
        .map((d) => {
          const links = d.pages.map((p) => linkHtml(new DVLink(p.file.path, p.file.name))).join(", ");
          return `<div class="dv-calendar-day"><strong>${esc(d.date.toISOString().slice(0, 10))}</strong>: ${links}</div>`;
        })
        .join("\n");
      return rows;
    }
  }
}

export function renderDataviewJsOutputHtml(nodes: DVJsOutputNode[], error?: string): string {
  const parts: string[] = [];
  if (error) parts.push(`<div class="dv-error">DataviewJS error: ${esc(error)}</div>`);
  for (const node of nodes) {
    switch (node.kind) {
      case "header":
        parts.push(`<h${node.level}>${esc(node.text)}</h${node.level}>`);
        break;
      case "paragraph":
        parts.push(`<p>${esc(node.text)}</p>`);
        break;
      case "list":
        parts.push(`<ul class="dv-list">\n${node.items.map((i) => `<li>${cellHtml(i)}</li>`).join("\n")}\n</ul>`);
        break;
      case "table":
        parts.push(
          `<table class="dv-table"><thead><tr>${node.headers
            .map((h) => `<th>${esc(h)}</th>`)
            .join("")}</tr></thead><tbody>\n${node.rows
            .map((row) => `<tr>${row.map((c) => `<td>${cellHtml(c)}</td>`).join("")}</tr>`)
            .join("\n")}\n</tbody></table>`
        );
        break;
      case "taskList":
        parts.push(
          `<ul class="dv-task-list">\n${node.tasks
            .map((t) => `<li><input type="checkbox" disabled ${t.completed ? "checked" : ""}/> ${esc(t.text)}</li>`)
            .join("\n")}\n</ul>`
        );
        break;
      case "html":
        parts.push(node.html);
        break;
    }
  }
  return parts.join("\n");
}
