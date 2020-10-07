import { Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassFieldStatement, ClassMethodStatement, ClassStatement, Statement } from '../parser/Statement';
import { LiteralExpression, Expression, BinaryExpression, CallExpression, FunctionExpression, NamespacedVariableNameExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression } from '../parser/Expression';
import { BrsString, ValueKind, BrsInvalid, BrsBoolean, RoString, RoArray, RoAssociativeArray, RoSGNode, FunctionParameterExpression } from '../brsTypes';
import { BrsNumber } from '../brsTypes/BrsNumber';
import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';
import { InternalWalkMode } from './visitors';
import { FunctionType } from '../types/FunctionType';
import { File } from '../interfaces';
import { StringType } from '../types/StringType';

// File reflection

export function isBrsFile(file: (BrsFile | XmlFile | File)): file is BrsFile {
    return file?.constructor.name === 'BrsFile';
}

export function isXmlFile(file: (BrsFile | XmlFile)): file is XmlFile {
    return file?.constructor.name === 'XmlFile';
}

// Statements reflection

/**
 * Determine if the variable is a descendent of the Statement base class.
 * Due to performance restrictions, this expects all statements to
 * directly extend Statement or FunctionStatement,
 * so it only checks the immediate parent's class name.
 */
export function isStatement(element: Statement | Expression): element is Statement {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitStatements);
}

export function isBody(element: Statement | Expression): element is Body {
    return element?.constructor?.name === 'Body';
}
export function isAssignmentStatement(element: Statement | Expression): element is AssignmentStatement {
    return element?.constructor?.name === 'AssignmentStatement';
}
export function isBlock(element: Statement | Expression): element is Block {
    return element?.constructor?.name === 'Block';
}
export function isExpressionStatement(element: Statement | Expression): element is ExpressionStatement {
    return element?.constructor?.name === 'ExpressionStatement';
}
export function isCommentStatement(element: Statement | Expression): element is CommentStatement {
    return element?.constructor?.name === 'CommentStatement';
}
export function isExitForStatement(element: Statement | Expression): element is ExitForStatement {
    return element?.constructor?.name === 'ExitForStatement';
}
export function isExitWhileStatement(element: Statement | Expression): element is ExitWhileStatement {
    return element?.constructor?.name === 'ExitWhileStatement';
}
export function isFunctionStatement(element: Statement | Expression): element is FunctionStatement {
    return element?.constructor?.name === 'FunctionStatement';
}
export function isIfStatement(element: Statement | Expression): element is IfStatement {
    return element?.constructor?.name === 'IfStatement';
}
export function isIncrementStatement(element: Statement | Expression): element is IncrementStatement {
    return element?.constructor?.name === 'IncrementStatement';
}
export function isPrintStatement(element: Statement | Expression): element is PrintStatement {
    return element?.constructor?.name === 'PrintStatement';
}
export function isGotoStatement(element: Statement | Expression): element is GotoStatement {
    return element?.constructor?.name === 'GotoStatement';
}
export function isLabelStatement(element: Statement | Expression): element is LabelStatement {
    return element?.constructor?.name === 'LabelStatement';
}
export function isReturnStatement(element: Statement | Expression): element is ReturnStatement {
    return element?.constructor?.name === 'ReturnStatement';
}
export function isEndStatement(element: Statement | Expression): element is EndStatement {
    return element?.constructor?.name === 'EndStatement';
}
export function isStopStatement(element: Statement | Expression): element is StopStatement {
    return element?.constructor?.name === 'StopStatement';
}
export function isForStatement(element: Statement | Expression): element is ForStatement {
    return element?.constructor?.name === 'ForStatement';
}
export function isForEachStatement(element: Statement | Expression): element is ForEachStatement {
    return element?.constructor?.name === 'ForEachStatement';
}
export function isWhileStatement(element: Statement | Expression): element is WhileStatement {
    return element?.constructor?.name === 'WhileStatement';
}
export function isDottedSetStatement(element: Statement | Expression): element is DottedSetStatement {
    return element?.constructor?.name === 'DottedSetStatement';
}
export function isIndexedSetStatement(element: Statement | Expression): element is IndexedSetStatement {
    return element?.constructor?.name === 'IndexedSetStatement';
}
export function isLibraryStatement(element: Statement | Expression): element is LibraryStatement {
    return element?.constructor?.name === 'LibraryStatement';
}
export function isNamespaceStatement(element: Statement | Expression): element is NamespaceStatement {
    return element?.constructor?.name === 'NamespaceStatement';
}
export function isClassStatement(element: Statement | Expression): element is ClassStatement {
    return element?.constructor?.name === 'ClassStatement';
}
export function isImportStatement(element: Statement | Expression): element is ImportStatement {
    return element?.constructor?.name === 'ImportStatement';
}
export function isClassMethodStatement(element: Statement | Expression): element is ClassMethodStatement {
    return element?.constructor.name === 'ClassMethodStatement';
}
export function isClassFieldStatement(element: Statement | Expression): element is ClassFieldStatement {
    return element?.constructor.name === 'ClassFieldStatement';
}

// Expressions reflection
/**
 * Determine if the variable is a descendent of the Expression base class.
 * Due to performance restrictions, this expects all statements to directly extend Expression,
 * so it only checks the immediate parent's class name. For example:
 * this will work for StringLiteralExpression -> Expression,
 * but will not work CustomStringLiteralExpression -> StringLiteralExpression -> Expression
 */
export function isExpression(element: Expression | Statement): element is Expression {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitExpressions);
}

export function isBinaryExpression(element: Expression | Statement): element is BinaryExpression {
    return element?.constructor.name === 'BinaryExpression';
}
export function isCallExpression(element: Expression | Statement): element is CallExpression {
    return element?.constructor.name === 'CallExpression';
}
export function isFunctionExpression(element: Expression | Statement): element is FunctionExpression {
    return element?.constructor.name === 'FunctionExpression';
}
export function isNamespacedVariableNameExpression(element: Expression | Statement): element is NamespacedVariableNameExpression {
    return element?.constructor.name === 'NamespacedVariableNameExpression';
}
export function isDottedGetExpression(element: Expression | Statement): element is DottedGetExpression {
    return element?.constructor.name === 'DottedGetExpression';
}
export function isXmlAttributeGetExpression(element: Expression | Statement): element is XmlAttributeGetExpression {
    return element?.constructor.name === 'XmlAttributeGetExpression';
}
export function isIndexedGetExpression(element: Expression | Statement): element is IndexedGetExpression {
    return element?.constructor.name === 'IndexedGetExpression';
}
export function isGroupingExpression(element: Expression | Statement): element is GroupingExpression {
    return element?.constructor.name === 'GroupingExpression';
}
export function isLiteralExpression(element: Expression | Statement): element is LiteralExpression {
    return element?.constructor.name === 'LiteralExpression';
}
export function isEscapedCharCodeLiteralExpression(element: Expression | Statement): element is EscapedCharCodeLiteralExpression {
    return element?.constructor.name === 'EscapedCharCodeLiteralExpression';
}
export function isArrayLiteralExpression(element: Expression | Statement): element is ArrayLiteralExpression {
    return element?.constructor.name === 'ArrayLiteralExpression';
}
export function isAALiteralExpression(element: Expression | Statement): element is AALiteralExpression {
    return element?.constructor.name === 'AALiteralExpression';
}
export function isUnaryExpression(element: Expression | Statement): element is UnaryExpression {
    return element?.constructor.name === 'UnaryExpression';
}
export function isVariableExpression(element: Expression | Statement): element is VariableExpression {
    return element?.constructor.name === 'VariableExpression';
}
export function isSourceLiteralExpression(element: Expression | Statement): element is SourceLiteralExpression {
    return element?.constructor.name === 'SourceLiteralExpression';
}
export function isNewExpression(element: Expression | Statement): element is NewExpression {
    return element?.constructor.name === 'NewExpression';
}
export function isCallfuncExpression(element: Expression | Statement): element is CallfuncExpression {
    return element?.constructor.name === 'CallfuncExpression';
}
export function isTemplateStringQuasiExpression(element: Expression | Statement): element is TemplateStringQuasiExpression {
    return element?.constructor.name === 'TemplateStringQuasiExpression';
}
export function isTemplateStringExpression(element: Expression | Statement): element is TemplateStringExpression {
    return element?.constructor.name === 'TemplateStringExpression';
}
export function isTaggedTemplateStringExpression(element: Expression | Statement): element is TaggedTemplateStringExpression {
    return element?.constructor.name === 'TaggedTemplateStringExpression';
}
export function isFunctionParameterExpression(element: Expression | Statement): element is FunctionParameterExpression {
    return element?.constructor.name === 'FunctionParameterExpression';
}

// Value/Type reflection

export function isInvalid(value: any): value is BrsInvalid {
    return value?.kind === ValueKind.Invalid;
}
export function isBoolean(value: any): value is BrsBoolean {
    return value?.kind === ValueKind.Boolean;
}
export function isString(value: any): value is BrsString {
    return value?.kind === ValueKind.String;
}
export function isNumber(value: any): value is BrsNumber {
    return value && (
        value.kind === ValueKind.Int32 ||
        value.kind === ValueKind.Int64 ||
        value.kind === ValueKind.Float ||
        value.kind === ValueKind.Double
    );
}
export function isStringType(value: any): value is StringType {
    return value?.constructor.name === 'StringType';
}

export function isFunctionType(e: any): e is FunctionType {
    return e?.constructor.name === 'FunctionType';
}
export function isRoArray(e: any): e is RoArray {
    return e?.constructor.name === 'RoArray';
}
export function isRoAssociativeArray(e: any): e is RoAssociativeArray {
    return e?.constructor.name === 'RoAssociativeArray';
}
export function isRoSGNode(e: any): e is RoSGNode {
    return e?.constructor.name === 'RoSGNode';
}

// Literal reflection

export function isLiteralInvalid(e: any): e is LiteralExpression & { value: BrsInvalid } {
    return isLiteralExpression(e) && isInvalid(e.value);
}
export function isLiteralBoolean(e: any): e is LiteralExpression & { value: BrsBoolean } {
    return isLiteralExpression(e) && isBoolean(e.value);
}
export function isLiteralString(e: any): e is LiteralExpression & { value: BrsString } {
    return isLiteralExpression(e) && isString(e.value);
}
export function isLiteralNumber(e: any): e is LiteralExpression & { value: BrsNumber } {
    return isLiteralExpression(e) && isNumber(e.value);
}
export function isRoString(s: any): s is RoString {
    return s.constructor.name === 'RoString';
}
