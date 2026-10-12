"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export default function AssistantMarkdown({ text, components }: { text: string; components: Components }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed components={components}>
      {text}
    </ReactMarkdown>
  );
}
