package com.example.bql.compiler

import com.example.bql.ast.BooleanLiteralNode
import com.example.bql.ast.ComparisonNode
import com.example.bql.ast.IrBooleanValue
import com.example.bql.ast.IrComparisonNode
import com.example.bql.ast.IrListValue
import com.example.bql.ast.IrLogicalNode
import com.example.bql.ast.IrNotNode
import com.example.bql.ast.IrNumberValue
import com.example.bql.ast.IrStringValue
import com.example.bql.ast.ListNode
import com.example.bql.ast.LogicalNode
import com.example.bql.ast.NotNode
import com.example.bql.ast.NumberLiteralNode
import com.example.bql.ast.QueryAstNode
import com.example.bql.ast.QueryIrNode
import com.example.bql.ast.QueryIrValue
import com.example.bql.ast.QueryValueNode
import com.example.bql.ast.StringLiteralNode

class IrCompiler {
    fun compile(node: QueryAstNode): QueryIrNode = when (node) {
        is ComparisonNode -> IrComparisonNode(
            field = node.field.name,
            operator = node.operator,
            value = compileValue(node.value)
        )
        is LogicalNode -> IrLogicalNode(
            operator = node.operator,
            left = compile(node.left),
            right = compile(node.right)
        )
        is NotNode -> IrNotNode(compile(node.expression))
    }

    private fun compileValue(value: QueryValueNode): QueryIrValue = when (value) {
        is StringLiteralNode -> IrStringValue(value.value)
        is NumberLiteralNode -> IrNumberValue(value.value)
        is BooleanLiteralNode -> IrBooleanValue(value.value)
        is ListNode -> IrListValue(value.items.map(::compileValue))
    }
}
