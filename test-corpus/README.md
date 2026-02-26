# Shared Test Corpus

This folder stores cross-tier test cases for:
- frontend parse + AST snapshots
- backend semantic validation
- AST tamper / version mismatch checks

Suggested convention:
- one JSON file per case
- include `input`, `expectedSyntaxOk`, `expectedDiagnostics`, and optional `expectedIr`
