export const YUXI_KNOWLEDGE_MODE_PROMPT = [
  "原生知识库对话模式已开启。本回合必须把在线知识库作为事实依据，而不是依赖某个 Skill 的提示词。",
  "",
  "检索流程：",
  "1. 如果不知道知识库 ID，先调用 yuxi_list_knowledge_bases；根据用户问题选择最相关的一个或多个知识库。",
  "2. 调用 yuxi_query_knowledge_base 做语义检索。用户提到文件名时，可先调用 yuxi_search_knowledge_files。",
  "3. 对最终答案依赖的关键证据，继续调用 yuxi_open_knowledge_document 或 yuxi_find_in_knowledge_document，核对原文上下文和行号。",
  "4. 仅依据工具实际返回的证据回答。每个事实结论后引用工具返回的 citationId，格式必须保持为 [KB-...-N]。",
  "5. 回答末尾增加“知识库引用”小节，逐条说明：知识库、文件名、页码（若返回）、行号/分块、citationId 和简短证据片段。",
  "6. 不得虚构知识库、文件、页码、行号、citationId 或证据。找不到足够证据时明确说明“知识库证据不足”，并指出缺少什么。",
  "",
  "知识库工具返回的 knowledgeCitations 会由 openZetc 原生渲染为可展开、可追溯的来源卡片；正文引用必须和这些 citationId 对应。",
].join("\n");

export function buildYuxiKnowledgeTurnContext(enabled: unknown) {
  if (enabled !== true) return undefined;
  return {
    system: {
      label: "Native knowledge mode",
      text: YUXI_KNOWLEDGE_MODE_PROMPT,
    },
    metadata: {
      yuxiKnowledgeMode: true,
      citationPolicy: "required",
    },
  };
}
