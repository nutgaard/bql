# bql-docs-examples

This module intentionally contains no web server code.

It exists to show how the Kotlin library can be embedded later in Ktor, Spring Boot,
or any other host application. The examples focus on:
- decoding and validating AST envelopes
- semantic validation against a runtime `QueryLanguageSpec`
- compiling a validated AST to normalized IR
