package com.example.bql.compiler

import com.example.bql.ast.ComparisonNode
import com.example.bql.ast.FieldRefNode
import com.example.bql.ast.FieldSpec
import com.example.bql.ast.FieldType
import com.example.bql.ast.IrComparisonNode
import com.example.bql.ast.QueryAstEnvelope
import com.example.bql.ast.QueryLanguageSpec
import com.example.bql.ast.QuerySource
import com.example.bql.ast.StringLiteralNode
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DefaultQueryAstEngineTest {
    private val engine = DefaultQueryAstEngine()
    private val json = Json { classDiscriminator = "kind" }

    private val spec = QueryLanguageSpec(
        version = "1",
        fields = listOf(FieldSpec("status", FieldType.STRING)),
        operatorsByType = mapOf(FieldType.STRING to listOf("=", "!=", "IN", "NOT IN"))
    )

    @Test
    fun rejectsUnsupportedAstVersion() {
        val payload = """
            {
              "astVersion": "999",
              "grammarVersion": "1",
              "source": {"rawQuery": "status = \\\"Open\\\""},
              "root": {
                "kind": "comparison",
                "field": {"kind": "fieldRef", "name": "status"},
                "operator": "=",
                "value": {"kind": "stringLiteral", "value": "Open"}
              }
            }
        """.trimIndent()

        val result = engine.decodeAndValidateEnvelope(payload)

        assertFalse(result.valid)
        assertTrue(result.diagnostics.any { it.code == "UNSUPPORTED_AST_VERSION" })
    }

    @Test
    fun compilesValidAst() {
        val envelope = QueryAstEnvelope(
            astVersion = "1",
            grammarVersion = "1",
            source = QuerySource("status = \"Open\""),
            root = ComparisonNode(FieldRefNode(name = "status"), "=", StringLiteralNode("Open"))
        )
        val payload = json.encodeToString(QueryAstEnvelope.serializer(), envelope)
        val decoded = engine.decodeAndValidateEnvelope(payload)

        assertTrue(decoded.valid)
        val compile = engine.compile(decoded.envelope!!, spec)
        assertTrue(compile.success)
        assertTrue(compile.ir is IrComparisonNode)
    }
}
