package com.example.bql.semantics

import com.example.bql.ast.BooleanLiteralNode
import com.example.bql.ast.ComparisonNode
import com.example.bql.ast.DiagnosticSeverity
import com.example.bql.ast.FieldSpec
import com.example.bql.ast.FieldType
import com.example.bql.ast.ListNode
import com.example.bql.ast.NotNode
import com.example.bql.ast.NumberLiteralNode
import com.example.bql.ast.QueryAstEnvelope
import com.example.bql.ast.QueryAstNode
import com.example.bql.ast.QueryDiagnostic
import com.example.bql.ast.QueryLanguageSpec
import com.example.bql.ast.QueryValueNode
import com.example.bql.ast.StringLiteralNode
import com.example.bql.ast.ValidationResult
import com.example.bql.ast.LogicalNode

class SemanticValidator {
    fun validate(ast: QueryAstEnvelope, spec: QueryLanguageSpec): ValidationResult {
        val diagnostics = mutableListOf<QueryDiagnostic>()
        val fieldsByName = spec.fields.associateBy(FieldSpec::name)
        validateNode(ast.root, spec, fieldsByName, diagnostics)
        return ValidationResult(valid = diagnostics.none { it.severity == DiagnosticSeverity.ERROR }, diagnostics = diagnostics)
    }

    private fun validateNode(
        node: QueryAstNode,
        spec: QueryLanguageSpec,
        fieldsByName: Map<String, FieldSpec>,
        diagnostics: MutableList<QueryDiagnostic>
    ) {
        when (node) {
            is ComparisonNode -> validateComparison(node, spec, fieldsByName, diagnostics)
            is LogicalNode -> {
                validateNode(node.left, spec, fieldsByName, diagnostics)
                validateNode(node.right, spec, fieldsByName, diagnostics)
            }
            is NotNode -> validateNode(node.expression, spec, fieldsByName, diagnostics)
        }
    }

    private fun validateComparison(
        node: ComparisonNode,
        spec: QueryLanguageSpec,
        fieldsByName: Map<String, FieldSpec>,
        diagnostics: MutableList<QueryDiagnostic>
    ) {
        val field = fieldsByName[node.field.name]
        if (field == null) {
            diagnostics += node.error("UNKNOWN_FIELD", "Unknown field '${node.field.name}'", node.field.span?.from, node.field.span?.to)
            return
        }

        val allowedOperators = field.operators ?: spec.operatorsByType[field.type].orEmpty()
        if (allowedOperators.none { it.equals(node.operator, ignoreCase = false) }) {
            diagnostics += node.error(
                "UNSUPPORTED_OPERATOR",
                "Operator '${node.operator}' is not allowed for field '${field.name}'",
                node.span?.from,
                node.span?.to
            )
        }

        validateValueForField(node, field, diagnostics)
    }

    private fun validateValueForField(
        node: ComparisonNode,
        field: FieldSpec,
        diagnostics: MutableList<QueryDiagnostic>
    ) {
        when (val value = node.value) {
            is ListNode -> {
                if (node.operator != "IN" && node.operator != "NOT IN") {
                    diagnostics += node.error(
                        "LIST_OPERATOR_MISMATCH",
                        "List values require IN or NOT IN",
                        value.span?.from,
                        value.span?.to
                    )
                }
                if (value.items.isEmpty()) {
                    diagnostics += node.error("EMPTY_LIST", "IN list must contain at least one value", value.span?.from, value.span?.to)
                }
                value.items.forEach { validateScalarValue(it, field, diagnostics) }
            }
            else -> {
                if (node.operator == "IN" || node.operator == "NOT IN") {
                    diagnostics += node.error(
                        "SCALAR_OPERATOR_MISMATCH",
                        "IN and NOT IN require a list value",
                        value.span?.from,
                        value.span?.to
                    )
                }
                validateScalarValue(value, field, diagnostics)
            }
        }
    }

    private fun validateScalarValue(value: QueryValueNode, field: FieldSpec, diagnostics: MutableList<QueryDiagnostic>) {
        when (field.type) {
            FieldType.STRING -> if (value !is StringLiteralNode) {
                diagnostics += errorForValue(value, "TYPE_MISMATCH", "Field '${field.name}' expects a string")
            }
            FieldType.NUMBER -> if (value !is NumberLiteralNode) {
                diagnostics += errorForValue(value, "TYPE_MISMATCH", "Field '${field.name}' expects a number")
            }
            FieldType.BOOLEAN -> if (value !is BooleanLiteralNode) {
                diagnostics += errorForValue(value, "TYPE_MISMATCH", "Field '${field.name}' expects a boolean")
            }
        }

        val enumValues = field.enumValues
        if (enumValues != null && value is StringLiteralNode && value.value !in enumValues) {
            diagnostics += errorForValue(value, "INVALID_ENUM_VALUE", "Value '${value.value}' is not allowed for field '${field.name}'")
        }
    }

    private fun errorForValue(value: QueryValueNode, code: String, message: String): QueryDiagnostic {
        val span = value.span
        return QueryDiagnostic(
            severity = DiagnosticSeverity.ERROR,
            code = code,
            message = message,
            from = span?.from ?: 0,
            to = span?.to ?: (span?.from ?: 0) + 1,
            source = "semantic"
        )
    }

    private fun ComparisonNode.error(code: String, message: String, from: Int?, to: Int?): QueryDiagnostic {
        return QueryDiagnostic(
            severity = DiagnosticSeverity.ERROR,
            code = code,
            message = message,
            from = from ?: 0,
            to = to ?: (from ?: 0) + 1,
            source = "semantic"
        )
    }
}
