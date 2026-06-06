// apps/web/src/components/MarkdownEditor.jsx
//
// The WYSIWYG editor used by the doc pane's Edit mode. TipTap (ProseMirror)
// gives a rich-text surface; the `tiptap-markdown` extension parses the doc's
// markdown into the editor on mount and serializes it back to markdown on every
// keystroke, so the value handed up to the parent is always markdown — the same
// shape we commit and the same text the anchors re-locate against.

import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

export default function MarkdownEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      // html:false keeps round-trips in pure markdown; linkify turns bare URLs
      // into links; breaks:false matches CommonMark (single newline = soft wrap).
      Markdown.configure({ html: false, linkify: true, breaks: false, transformPastedText: true }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.storage.markdown.getMarkdown()),
  });

  return (
    <div className="md-editor">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="md-editor-surface" />
    </div>
  );
}

function Toolbar({ editor }) {
  const btn = (active, run, label, title) => (
    <button
      type="button"
      className={`md-tool${active ? " on" : ""}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus/selection
      onClick={run}
    >
      {label}
    </button>
  );
  const c = editor.chain().focus();
  return (
    <div className="md-toolbar">
      {btn(editor.isActive("heading", { level: 1 }), () => c.toggleHeading({ level: 1 }).run(), "H1", "Heading 1")}
      {btn(editor.isActive("heading", { level: 2 }), () => c.toggleHeading({ level: 2 }).run(), "H2", "Heading 2")}
      {btn(editor.isActive("heading", { level: 3 }), () => c.toggleHeading({ level: 3 }).run(), "H3", "Heading 3")}
      <span className="md-sep" />
      {btn(editor.isActive("bold"), () => c.toggleBold().run(), <b>B</b>, "Bold")}
      {btn(editor.isActive("italic"), () => c.toggleItalic().run(), <i>I</i>, "Italic")}
      {btn(editor.isActive("strike"), () => c.toggleStrike().run(), <s>S</s>, "Strikethrough")}
      {btn(editor.isActive("code"), () => c.toggleCode().run(), "‹›", "Inline code")}
      <span className="md-sep" />
      {btn(editor.isActive("bulletList"), () => c.toggleBulletList().run(), "• List", "Bullet list")}
      {btn(editor.isActive("orderedList"), () => c.toggleOrderedList().run(), "1. List", "Numbered list")}
      {btn(editor.isActive("blockquote"), () => c.toggleBlockquote().run(), "❝", "Quote")}
      {btn(editor.isActive("codeBlock"), () => c.toggleCodeBlock().run(), "{ }", "Code block")}
    </div>
  );
}
