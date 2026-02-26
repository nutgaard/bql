# Integration Notes (Ktor / Spring later)

The backend modules are library-only and intentionally avoid HTTP concerns.

Typical host integration flow:
1. Receive `rawQuery + ast` payload from the frontend query editor.
2. Call `DefaultQueryAstEngine.decodeAndValidateEnvelope(...)`.
3. If valid, load your runtime `QueryLanguageSpec` and call `validateSemantics(...)`.
4. If valid, call `compile(...)` to obtain normalized IR.
5. Convert IR to your execution layer (SQL/JPA/Elasticsearch/etc.).

Authentication/authorization should live in the host app. Field visibility restrictions can be enforced by generating a user-specific `QueryLanguageSpec` or by adding provider-backed checks before compile/execution.
