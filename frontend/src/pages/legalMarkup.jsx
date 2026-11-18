/** Разметка юридических страниц: пометки черновика, жирный текст, блоки оферты. */
import { Link } from "react-router-dom";

const TOKEN = /(\*\*[^*]+\*\*|\[(?:уточнить|юрист)[^\]]*])/g;

export function LegalText({ text }) {
  if (!text) return null;
  const parts = String(text).split(TOKEN).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("[уточнить") || part.startsWith("[юрист")) {
      return <mark className="legal-marker" key={index}>{part}</mark>;
    }
    return <span key={index}>{part}</span>;
  });
}

export function LegalDraftBanner({ children }) {
  return <p className="legal-draft" role="note">{children}</p>;
}

export function LegalBlocks({ blocks }) {
  return blocks.map((block, index) => {
    if (block.type === "ul") {
      return (
        <ul key={`ul-${index}`}>
          {block.items.map((item) => <li key={item}><LegalText text={item} /></li>)}
        </ul>
      );
    }
    if (block.type === "ol") {
      return (
        <ol key={`ol-${index}`}>
          {block.items.map((item) => <li key={item}><LegalText text={item} /></li>)}
        </ol>
      );
    }
    if (block.type === "table") {
      return (
        <div className="legal-table-wrap" key={`table-${index}`}>
          <table className="legal-table">
            <thead>
              <tr>{block.headers.map((cell) => <th key={cell}><LegalText text={cell} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}><LegalText text={cell} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <p key={block.text}><LegalText text={block.text} /></p>;
  });
}

export function LegalFooterLinks({ items }) {
  return (
    <p>
      См. также:{" "}
      {items.map((item, index) => (
        <span key={item.to}>
          {index > 0 ? " · " : null}
          <Link to={item.to}>{item.label}</Link>
        </span>
      ))}
    </p>
  );
}
