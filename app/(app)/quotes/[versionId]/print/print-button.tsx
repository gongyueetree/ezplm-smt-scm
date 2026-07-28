"use client";

export function PrintButton() {
  return (
    <button className="btn primary" onClick={() => window.print()}>
      打印 / 另存为 PDF
    </button>
  );
}
