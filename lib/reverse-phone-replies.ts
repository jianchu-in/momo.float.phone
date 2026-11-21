/** Blank lines or explicit separators are message boundaries, not extra API calls. */
export function splitReverseReply(text:string):string[] {
  const pieces=text.replace(/\r\n/g,"\n").split(/\n\s*\n|\s*\|\|\|\s*/).map(piece=>piece.trim()).filter(Boolean);
  return pieces.length<=12?pieces:[...pieces.slice(0,11),pieces.slice(11).join("\n\n")];
}
