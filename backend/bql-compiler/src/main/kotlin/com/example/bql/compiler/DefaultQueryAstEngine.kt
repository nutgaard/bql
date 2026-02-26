package com.example.bql.compiler

import com.example.bql.ast.AstEnvelopeValidationResult
import com.example.bql.ast.CompileResult
import com.example.bql.ast.ComparisonNode
import com.example.bql.ast.DiagnosticSeverity
import com.example.bql.ast.ListNode
import com.example.bql.ast.LogicalNode
import com.example.bql.ast.NotNode
import com.example.bql.ast.QueryAstEngine
import com.example.bql.ast.QueryAstEnvelope
import com.example.bql.ast.QueryAstNode
import com.example.bql.ast.QueryDiagnostic
import com.example.bql.ast.QueryLanguageSpec
import com.example.bql.ast.QueryValueNode
import com.example.bql.ast.SourceSpan
import com.example.bql.ast.StringLiteralNode
import com.example.bql.semantics.SemanticValidator
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

class DefaultQueryAstEngine(
    private val supportedAstVersions: Set<String> = setOf("1"),
    private val maxNodeCount: Int = 1_000,
    private val maxDepth: Int = 128,
    private val maxStringLiteralLength: Int = 4_096,
    private val maxRawQueryLength: Int = 20_000,
    private val json: Json = Json {
        ignoreUnknownKeys = false
        classDiscriminator = "kind"
    }
) : QueryAstEngine {
    private val semanticValidator = SemanticValidator()
    private val irCompiler = IrCompiler()

    override fun decodeAndValidateEnvelope(json: String): AstEnvelopeValidationResult {
        val envelope = try {
            this.json.decodeFromString(QueryAstEnvelope.serializer(), json)
        } catch (error: SerializationException) {
            return AstEnvelopeValidationResult(
                valid = false,
                envelope = null,
                diagnostics = listOf(
                    QueryDiagnostic(
                        severity = DiagnosticSeverity.ERROR,
                        code = "AST_DECODE_FAILED",
                        message = error.message ?: "Failed to decode AST envelope",
                        from = 0,
                        to = 1,
                        source = "ast"
                    )
                )
            )
        }

        val diagnostics = validateStructure(envelope)
        return AstEnvelopeValidationResult(
            valid = diagnostics.none { it.severity == DiagnosticSeverity.ERROR },
            envelope = envelope,
            diagnostics = diagnostics
        )
    }

    override fun validateSemantics(ast: QueryAstEnvelope, spec: QueryLanguageSpec) = semanticValidator.validate(ast, spec)

    override fun compile(ast: QueryAstEnvelope, spec: QueryLanguageSpec): CompileResult {
        val structure = validateStructure(ast)
        if (structure.any { it.severity == DiagnosticSeverity.ERROR }) {
            return CompileResult(false, structure, null)
        }
        val semantics = semanticValidator.validate(ast, spec)
        if (!semantics.valid) {
            return CompileResult(false, semantics.diagnostics, null)
        }
        val ir = irCompiler.compile(ast.root)
        return CompileResult(true, emptyList(), ir)
    }

    private fun validateStructure(envelope: QueryAstEnvelope): List<QueryDiagnostic> {
        val diagnostics = mutableListOf<QueryDiagnostic>()

        if (envelope.astVersion !in supportedAstVersions) {
            diagnostics += diagnostic("UNSUPPORTED_AST_VERSION", "Unsupported astVersion '${envelope.astVersion}'")
        }

        if (envelope.grammarVersion.isBlank()) {
            diagnostics += diagnostic("MISSING_GRAMMAR_VERSION", "grammarVersion is required")
        }

        if (envelope.source.rawQuery.length > maxRawQueryLength) {
            diagnostics += diagnostic("RAW_QUERY_TOO_LARGE", "rawQuery exceeds $maxRawQueryLength characters")
        }

        val walker = AstStructureWalker(maxNodeCount, maxDepth, maxStringLiteralLength)
        diagnostics += walker.validate(envelope.root, envelope.source.rawQuery.length)

        val metadata = envelope.metadata
        if (metadata != null) {
            if (metadata.parser != "lezer") {
                diagnostics += diagnostic("UNSUPPORTED_PARSER_METADATA", "metadata.parser must be 'lezer' in v1")
            }
            if (metadata.nodeCount <= 0 || metadata.maxDepth <= 0) {
                diagnostics += diagnostic("INVALID_METADATA", "metadata.nodeCount and metadata.maxDepth must be positive")
            }
        }

        return diagnostics
    }

    private fun diagnostic(code: String, message: String): QueryDiagnostic = QueryDiagnostic(
        severity = DiagnosticSeverity.ERROR,
        code = code,
        message = message,
        from = 0,
        to = 1,
        source = "ast"
    )
}

private class AstStructureWalker(
    private val maxNodeCount: Int,
    private val maxDepth: Int,
    private val maxStringLiteralLength: Int
) {
    private var count: Int = 0
    private val diagnostics = mutableListOf<QueryDiagnostic>()

    fun validate(root: QueryAstNode, rawLength: Int): List<QueryDiagnostic> {
        walkNode(root, depth = 1, rawLength = rawLength)
        if (count > maxNodeCount) {
            diagnostics += diagnostic("AST_TOO_LARGE", "AST node count exceeds $maxNodeCount")
        }
        return diagnostics
    }

    private fun walkNode(node: QueryAstNode, depth: Int, rawLength: Int) {
        count += 1
        validateDepth(depth)
        validateSpan(node.span, rawLength)
        when (node) {
            is ComparisonNode -> {
                validateSpan(node.field.span, rawLength)
                if (node.operator.isBlank()) {
                    diagnostics += diagnostic("EMPTY_OPERATOR", "Comparison operator is required")
                }
                walkValue(node.value, depth + 1, rawLength)
            }
            is LogicalNode -> {
                walkNode(node.left, depth + 1, rawLength)
                walkNode(node.right, depth + 1, rawLength)
            }
            is NotNode -> walkNode(node.expression, depth + 1, rawLength)
        }
    }

    private fun walkValue(value: QueryValueNode, depth: Int, rawLength: Int) {
        count += 1
        validateDepth(depth)
        validateSpan(value.span, rawLength)
        when (value) {
            is ListNode -> value.items.forEach { walkValue(it, depth + 1, rawLength) }
            is StringLiteralNode -> if (value.value.length > maxStringLiteralLength) {
                diagnostics += diagnostic("STRING_LITERAL_TOO_LARGE", "String literal exceeds $maxStringLiteralLength characters")
            }
            else -> Unit
        }
    }

    private fun validateDepth(depth: Int) {
        if (depth > maxDepth) {
            diagnostics += diagnostic("AST_TOO_DEEP", "AST depth exceeds $maxDepth")
        }
    }

    private fun validateSpan(span: SourceSpan?, rawLength: Int) {
        if (span == null) return
        if (span.from < 0 || span.to < span.from || span.to > rawLength) {
            diagnostics += diagnostic("INVALID_SPAN", "Invalid source span (${span.from}, ${span.to})")
        }
    }

    private fun diagnostic(code: String, message: String) = QueryDiagnostic(
        severity = DiagnosticSeverity.ERROR,
        code = code,
        message = message,
        from = 0,
        to = 1,
        source = "ast"
    )
}
