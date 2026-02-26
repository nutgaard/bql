import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "./parser";

export const bqlParser = parser.configure({
  props: [
    styleTags({
      "AndOp OrOp NotOp InOperator CompareOperator": t.operatorKeyword,
      "Boolean": t.bool,
      "Identifier": t.variableName,
      "String": t.string,
      "Number": t.number,
      "( )": t.paren,
      ",": t.separator
    })
  ]
});

export const bqlLanguage = LRLanguage.define({
  name: "bql",
  parser: bqlParser
});

export function bqlLanguageSupport() {
  return new LanguageSupport(bqlLanguage);
}
