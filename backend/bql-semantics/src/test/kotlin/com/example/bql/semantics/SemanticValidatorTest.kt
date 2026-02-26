package com.example.bql.semantics

import com.example.bql.ast.ComparisonNode
import com.example.bql.ast.DiagnosticSeverity
import com.example.bql.ast.FieldRefNode
import com.example.bql.ast.FieldSpec
import com.example.bql.ast.FieldType
import com.example.bql.ast.QueryAstEnvelope
import com.example.bql.ast.QueryLanguageSpec
import com.example.bql.ast.QuerySource
import com.example.bql.ast.StringLiteralNode
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SemanticValidatorTest {
    private val spec = QueryLanguageSpec(
        version = "1",
        fields = listOf(
            FieldSpec("status", FieldType.STRING, enumValues = listOf("Open", "Closed")),
            FieldSpec("priority", FieldType.NUMBER)
        ),
        operatorsByType = mapOf(
            FieldType.STRING to listOf("=", "!=", "IN", "NOT IN"),
            FieldType.NUMBER to listOf("=", "!=", ">", ">=", "<", "<=")
        )
    )

    @Test
    fun rejectsUnknownField() {
        val envelope = QueryAstEnvelope(
            astVersion = "1",
            grammarVersion = "1",
            source = QuerySource("unknown = \"x\""),
            root = ComparisonNode(FieldRefNode(name = "unknown"), "=", StringLiteralNode("x"))
        )

        val result = SemanticValidator().validate(envelope, spec)

        assertFalse(result.valid)
        assertTrue(result.diagnostics.any { it.code == "UNKNOWN_FIELD" && it.severity == DiagnosticSeverity.ERROR })
    }

    @Test
    fun rejectsEnumMismatch() {
        val envelope = QueryAstEnvelope(
            astVersion = "1",
            grammarVersion = "1",
            source = QuerySource("status = \"Pending\""),
            root = ComparisonNode(FieldRefNode(name = "status"), "=", StringLiteralNode("Pending"))
        )

        val result = SemanticValidator().validate(envelope, spec)

        assertFalse(result.valid)
        assertTrue(result.diagnostics.any { it.code == "INVALID_ENUM_VALUE" })
    }
}
