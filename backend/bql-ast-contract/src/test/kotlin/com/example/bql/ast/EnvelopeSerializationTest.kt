package com.example.bql.ast

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class EnvelopeSerializationTest {
    private val json = Json {
        ignoreUnknownKeys = false
        classDiscriminator = "kind"
    }

    @Test
    fun roundTripEnvelope() {
        val envelope = QueryAstEnvelope(
            astVersion = "1",
            grammarVersion = "1",
            source = QuerySource("status = \"Open\""),
            root = ComparisonNode(
                field = FieldRefNode(name = "status"),
                operator = "=",
                value = StringLiteralNode("Open")
            ),
            metadata = QueryAstMetadata("lezer", nodeCount = 2, maxDepth = 2)
        )

        val encoded = json.encodeToString(QueryAstEnvelope.serializer(), envelope)
        val decoded = json.decodeFromString(QueryAstEnvelope.serializer(), encoded)

        assertEquals("1", decoded.astVersion)
        assertEquals("status", (decoded.root as ComparisonNode).field.name)
    }
}
