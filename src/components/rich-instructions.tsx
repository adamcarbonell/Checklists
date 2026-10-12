import type { ReactNode } from "react";
import type { RichNode } from "@/lib/template-engine";
export function RichInstructions({ value }: { value: RichNode }) {
  return (
    <div className="tiptap-content whitespace-pre-wrap text-sm leading-6 text-slate-600">
      {render(value, "root")}
    </div>
  );
}
function render(node: RichNode, key: string): ReactNode {
  const children = (node.content ?? []).map((child, index) =>
    render(child, `${key}-${index}`),
  );
  if (node.type === "text") {
    let content: ReactNode = node.text ?? "";
    if (Array.isArray(node.marks))
      for (const mark of node.marks as {
        type: string;
        attrs?: { href?: string };
      }[]) {
        if (mark.type === "bold") content = <strong>{content}</strong>;
        else if (mark.type === "italic") content = <em>{content}</em>;
        else if (mark.type === "strike") content = <s>{content}</s>;
        else if (mark.type === "code") content = <code>{content}</code>;
        else if (
          mark.type === "link" &&
          typeof mark.attrs?.href === "string" &&
          /^(https?:|mailto:)/i.test(mark.attrs.href)
        )
          content = (
            <a
              className="text-teal-800 underline"
              href={mark.attrs.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {content}
            </a>
          );
      }
    return <span key={key}>{content}</span>;
  }
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "heading")
    return (
      <h3 key={key} className="font-semibold">
        {children}
      </h3>
    );
  if (node.type === "bulletList")
    return (
      <ul key={key} className="ml-5 list-disc">
        {children}
      </ul>
    );
  if (node.type === "orderedList")
    return (
      <ol key={key} className="ml-5 list-decimal">
        {children}
      </ol>
    );
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "blockquote")
    return (
      <blockquote key={key} className="border-l-2 pl-3">
        {children}
      </blockquote>
    );
  if (node.type === "hardBreak") return <br key={key} />;
  return <div key={key}>{children}</div>;
}
