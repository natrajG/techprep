import { answerBlocks, splitBold } from "./rich-text.mjs";

function InlineText({ text }) {
  return splitBold(text).map((part, i) =>
    part.bold ? <strong key={i}>{part.text}</strong> : part.text);
}

export default function AnswerContent({ text }) {
  return (
    <div className="hud-answer-body">
      {answerBlocks(text).map((block, i) => {
        if (block.type === "code") {
          return (
            <div className="hud-code-block" key={i}>
              {block.language && <span className="hud-code-language">{block.language}</span>}
              <pre><code>{block.lines.join("\n")}</code></pre>
            </div>
          );
        }
        if (block.type === "points") {
          return (
            <ul className="hud-answer-points" key={i}>
              {block.items.map((item, j) => <li key={j}><InlineText text={item} /></li>)}
            </ul>
          );
        }
        return <p className="hud-answer-paragraph" key={i}><InlineText text={block.lines.join("\n")} /></p>;
      })}
    </div>
  );
}
