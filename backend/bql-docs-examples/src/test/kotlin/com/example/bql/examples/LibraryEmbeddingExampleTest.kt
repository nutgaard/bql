package com.example.bql.examples

import com.example.bql.ast.FieldSpec
import com.example.bql.ast.FieldType
import com.example.bql.ast.QueryLanguageSpec
import com.example.bql.compiler.DefaultQueryAstEngine
import kotlin.test.Test
import kotlin.test.assertFalse

class LibraryEmbeddingExampleTest {
    @Test
    fun invalidPayloadProducesDiagnostics() {
        val engine = DefaultQueryAstEngine()
        val spec = QueryLanguageSpec(
            version = "1",
            fields = listOf(FieldSpec("status", FieldType.STRING)),
            operatorsByType = mapOf(FieldType.STRING to listOf("=", "!=", "IN", "NOT IN"))
        )

        val decode = engine.decodeAndValidateEnvelope("""{"astVersion":"1"}""")
        assertFalse(decode.valid)

        // In a future Ktor/Spring integration, the host app would map these diagnostics to a response.
        @Suppress("UNUSED_VARIABLE")
        val compileIfValid = if (decode.valid) engine.compile(decode.envelope!!, spec) else null
    }
}
