package com.example.bql.ast

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
data class SourceSpan(
    val from: Int,
    val to: Int
)

@Serializable
data class QuerySource(
    val rawQuery: String
)

@Serializable
data class QueryAstMetadata(
    val parser: String,
    val nodeCount: Int,
    val maxDepth: Int
)

@Serializable
data class QueryAstEnvelope(
    val astVersion: String,
    val grammarVersion: String,
    val source: QuerySource,
    val root: QueryAstNode,
    val metadata: QueryAstMetadata? = null
)

@Serializable
@JsonClassDiscriminator("kind")
sealed class QueryAstNode {
    abstract val span: SourceSpan?
}

@Serializable
@SerialName("comparison")
data class ComparisonNode(
    val field: FieldRefNode,
    val operator: String,
    val value: QueryValueNode,
    override val span: SourceSpan? = null
) : QueryAstNode()

@Serializable
@SerialName("logical")
data class LogicalNode(
    val operator: LogicalOperator,
    val left: QueryAstNode,
    val right: QueryAstNode,
    override val span: SourceSpan? = null
) : QueryAstNode()

@Serializable
@SerialName("not")
data class NotNode(
    val expression: QueryAstNode,
    override val span: SourceSpan? = null
) : QueryAstNode()

@Serializable
enum class LogicalOperator {
    AND,
    OR
}

@Serializable
data class FieldRefNode(
    val kind: String = "fieldRef",
    val name: String,
    val span: SourceSpan? = null
)

@Serializable
@JsonClassDiscriminator("kind")
sealed class QueryValueNode {
    abstract val span: SourceSpan?
}

@Serializable
@SerialName("stringLiteral")
data class StringLiteralNode(
    val value: String,
    override val span: SourceSpan? = null
) : QueryValueNode()

@Serializable
@SerialName("numberLiteral")
data class NumberLiteralNode(
    val value: Double,
    val raw: String,
    override val span: SourceSpan? = null
) : QueryValueNode()

@Serializable
@SerialName("booleanLiteral")
data class BooleanLiteralNode(
    val value: Boolean,
    override val span: SourceSpan? = null
) : QueryValueNode()

@Serializable
@SerialName("list")
data class ListNode(
    val items: List<QueryValueNode>,
    override val span: SourceSpan? = null
) : QueryValueNode()

@Serializable
enum class FieldType {
    STRING,
    NUMBER,
    BOOLEAN
}

@Serializable
data class FieldSpec(
    val name: String,
    val type: FieldType,
    val operators: List<String>? = null,
    val enumValues: List<String>? = null,
    val completionProviderKey: String? = null
)

@Serializable
data class FunctionSpec(
    val name: String
)

@Serializable
data class QueryLanguageSpec(
    val version: String,
    val fields: List<FieldSpec>,
    val operatorsByType: Map<FieldType, List<String>>,
    val functions: List<FunctionSpec> = emptyList(),
    val completionPolicies: Map<String, String> = emptyMap()
)

@Serializable
@JsonClassDiscriminator("kind")
sealed class QueryIrNode

@Serializable
@SerialName("irLogical")
data class IrLogicalNode(
    val operator: LogicalOperator,
    val left: QueryIrNode,
    val right: QueryIrNode
) : QueryIrNode()

@Serializable
@SerialName("irNot")
data class IrNotNode(
    val expression: QueryIrNode
) : QueryIrNode()

@Serializable
@SerialName("irComparison")
data class IrComparisonNode(
    val field: String,
    val operator: String,
    val value: QueryIrValue
) : QueryIrNode()

@Serializable
@JsonClassDiscriminator("kind")
sealed class QueryIrValue

@Serializable
@SerialName("irString")
data class IrStringValue(val value: String) : QueryIrValue()

@Serializable
@SerialName("irNumber")
data class IrNumberValue(val value: Double) : QueryIrValue()

@Serializable
@SerialName("irBoolean")
data class IrBooleanValue(val value: Boolean) : QueryIrValue()

@Serializable
@SerialName("irList")
data class IrListValue(val items: List<QueryIrValue>) : QueryIrValue()
