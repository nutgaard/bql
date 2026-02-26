package com.example.bql.ast

import kotlinx.serialization.Serializable

@Serializable
enum class DiagnosticSeverity {
    ERROR,
    WARNING,
    INFO
}

@Serializable
data class QueryDiagnostic(
    val severity: DiagnosticSeverity,
    val code: String,
    val message: String,
    val from: Int,
    val to: Int,
    val source: String
)

data class AstEnvelopeValidationResult(
    val valid: Boolean,
    val envelope: QueryAstEnvelope?,
    val diagnostics: List<QueryDiagnostic>
)

data class ValidationResult(
    val valid: Boolean,
    val diagnostics: List<QueryDiagnostic>
)

data class CompileResult(
    val success: Boolean,
    val diagnostics: List<QueryDiagnostic>,
    val ir: QueryIrNode?
)

interface QueryAstEngine {
    fun decodeAndValidateEnvelope(json: String): AstEnvelopeValidationResult
    fun validateSemantics(ast: QueryAstEnvelope, spec: QueryLanguageSpec): ValidationResult
    fun compile(ast: QueryAstEnvelope, spec: QueryLanguageSpec): CompileResult
}

interface FieldCatalogProvider
interface ValueSuggestionProvider
interface FunctionCatalogProvider
