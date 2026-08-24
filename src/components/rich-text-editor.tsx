"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Bold, Italic, List, ListOrdered, Link2, Variable } from "lucide-react";
import { useEffect } from "react";
import type { RichNode } from "@/lib/template-engine";

export function RichTextEditor({ value, onChange, onInsertVariable }: { value: RichNode; onChange: (value: RichNode) => void; onInsertVariable: () => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } })],
    content: value,
    editorProps: { attributes: { class: "tiptap-content min-h-[150px] px-3 py-3 text-xs leading-5 outline-none" } },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichNode),
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value);
  }, [editor, value]);

  if (!editor) return <div className="h-40 animate-pulse rounded-xl bg-slate-50" />;
  const link = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", current ?? "https://");
    if (href === null) return;
    if (!href) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  return <div className="overflow-hidden rounded-xl border border-[#d8e1dc] bg-white shadow-sm">
    <div className="flex flex-wrap gap-1 border-b border-[#e2e8e3] bg-[#f8faf8] p-1.5">
      <Toolbar active={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={13} /></Toolbar>
      <Toolbar active={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={13} /></Toolbar>
      <Toolbar active={editor.isActive("bulletList")} label="Bullets" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={13} /></Toolbar>
      <Toolbar active={editor.isActive("orderedList")} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={13} /></Toolbar>
      <Toolbar active={editor.isActive("link")} label="Link" onClick={link}><Link2 size={13} /></Toolbar>
      <button type="button" onClick={onInsertVariable} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-teal-700 hover:bg-teal-50"><Variable size={12} /> Variable</button>
    </div>
    <EditorContent editor={editor} />
  </div>;
}

function Toolbar({ children, label, active, onClick }: { children: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid size-7 place-items-center rounded-md ${active ? "bg-teal-100 text-teal-800" : "text-slate-500 hover:bg-white"}`}>{children}</button>;
}
