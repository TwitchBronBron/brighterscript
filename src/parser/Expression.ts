import { Token, Identifier, TokenKind } from '../lexer';
import { BrsType, ValueKind, BrsString, FunctionParameter } from '../brsTypes';
import { Block, CommentStatement, FunctionStatement } from './Statement';
import { SourceNode } from 'source-map';
import { Range } from 'vscode-languageserver';
import util from '../util';
import { TranspileState } from './TranspileState';
import { ParseMode } from './Parser';
import * as fileUrl from 'file-url';

/** A BrightScript expression */
export abstract class Expression {
    /** The starting and ending location of the expression. */
    range: Range;

    abstract transpile(state: TranspileState): Array<SourceNode | string>;

    getAllExpressions(expressions: Expression[] = []): Expression[] {
        expressions.push(this);
        return expressions;
    }
}

export class BinaryExpression extends Expression {
    constructor(
        readonly left: Expression,
        readonly operator: Token,
        readonly right: Expression
    ) {
        super();
        this.range = Range.create(this.left.range.start, this.right.range.end);
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.left.range.start.line + 1, this.left.range.start.character, state.pathAbsolute, this.left.transpile(state)),
            ' ',
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, this.operator.text),
            ' ',
            new SourceNode(this.right.range.start.line + 1, this.right.range.start.character, state.pathAbsolute, this.right.transpile(state))
        ];
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.left.getAllExpressions(expressions);
        this.right.getAllExpressions(expressions);

        return expressions;
    }
}

export class CallExpression extends Expression {
    static MaximumArguments = 32;

    constructor(
        readonly callee: Expression,
        readonly openingParen: Token,
        readonly closingParen: Token,
        readonly args: Expression[],
        readonly namespaceName: NamespacedVariableNameExpression
    ) {
        super();
        this.range = Range.create(this.callee.range.start, this.closingParen.range.end);
    }

    transpile(state: TranspileState) {
        let result = [];

        //transpile the name
        result.push(...this.callee.transpile(state));

        result.push(
            new SourceNode(this.openingParen.range.start.line + 1, this.openingParen.range.start.character, state.pathAbsolute, '(')
        );
        for (let i = 0; i < this.args.length; i++) {
            //add comma between args
            if (i > 0) {
                result.push(', ');
            }
            let arg = this.args[i];
            result.push(...arg.transpile(state));
        }
        result.push(
            new SourceNode(this.closingParen.range.start.line + 1, this.closingParen.range.start.character, state.pathAbsolute, ')')
        );
        return result;
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.args.map(e => e.getAllExpressions(expressions));
        this.callee.getAllExpressions(expressions);

        return expressions;
    }
}

export class FunctionExpression extends Expression {
    constructor(
        readonly parameters: FunctionParameter[],
        readonly returns: ValueKind,
        public body: Block,
        readonly functionType: Token | null,
        public end: Token,
        readonly leftParen: Token,
        readonly rightParen: Token,
        readonly asToken?: Token,
        readonly returnTypeToken?: Token,
        /**
     * If this function is enclosed within another function, this will reference that parent function
     */
        readonly parentFunction?: FunctionExpression
    ) {
        super();
    }

    /**
   * The list of function calls that are declared within this function scope. This excludes CallExpressions
   * declared in child functions
   */
    public callExpressions = [] as CallExpression[];

    /**
     * If this function is part of a FunctionStatement, this will be set. Otherwise this will be undefined
     */
    public functionStatement?: FunctionStatement;

    /**
     * A list of all child functions declared directly within this function
     */
    public childFunctionExpressions = [] as FunctionExpression[];

    /**
     * The range of the function, starting at the 'f' in function or 's' in sub (or the open paren if the keyword is missing),
     * and ending with the last n' in 'end function' or 'b' in 'end sub'
     */
    public get range() {
        return Range.create(
            (this.functionType ?? this.leftParen).range.start,
            (this.end ?? this.body ?? this.returnTypeToken ?? this.asToken ?? this.rightParen).range.end
        );
    }

    transpile(state: TranspileState, name?: Identifier) {
        let results = [];
        //'function'|'sub'
        results.push(
            new SourceNode(this.functionType.range.start.line + 1, this.functionType.range.start.character, state.pathAbsolute, this.functionType.text.toLowerCase())
        );
        //functionName?
        if (name) {
            results.push(
                ' ',
                new SourceNode(name.range.start.line + 1, name.range.start.character, state.pathAbsolute, name.text)
            );
        }
        //leftParen
        results.push(
            new SourceNode(this.leftParen.range.start.line + 1, this.leftParen.range.start.character, state.pathAbsolute, '(')
        );
        //parameters
        for (let i = 0; i < this.parameters.length; i++) {
            let param = this.parameters[i];
            //add commas
            if (i > 0) {
                results.push(', ');
            }
            //add parameter
            results.push(param.transpile(state));
        }
        //right paren
        results.push(
            new SourceNode(this.rightParen.range.start.line + 1, this.rightParen.range.start.character, state.pathAbsolute, ')')
        );
        //as [Type]
        if (this.asToken) {
            results.push(
                ' ',
                //as
                new SourceNode(this.asToken.range.start.line + 1, this.asToken.range.start.character, state.pathAbsolute, 'as'),
                ' ',
                //return type
                new SourceNode(this.returnTypeToken.range.start.line + 1, this.returnTypeToken.range.start.character, state.pathAbsolute, this.returnTypeToken.text.toLowerCase())
            );
        }
        state.lineage.unshift(this);
        let body = this.body.transpile(state);
        state.lineage.shift();
        results.push(...body);
        results.push('\n');
        //'end sub'|'end function'
        results.push(
            state.indent(),
            new SourceNode(this.end.range.start.line + 1, this.end.range.start.character, state.pathAbsolute, this.end.text)
        );
        return results;
    }
}

export class NamespacedVariableNameExpression extends Expression {
    constructor(
    //if this is a `DottedGetExpression`, it must be comprised only of `VariableExpression`s
        readonly expression: DottedGetExpression | VariableExpression
    ) {
        super();
        this.range = expression.range;
    }
    range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                this.getName(ParseMode.BrightScript)
            )
        ];
    }

    public getNameParts() {
        let parts = [] as string[];
        if (this.expression instanceof VariableExpression) {
            parts.push(this.expression.name.text);
        } else {
            let expr = this.expression;

            parts.push(expr.name.text);

            while (expr instanceof VariableExpression === false) {
                expr = expr.obj as DottedGetExpression;
                parts.unshift(expr.name.text);
            }
        }
        return parts;
    }

    getName(parseMode: ParseMode) {
        if (parseMode === ParseMode.BrighterScript) {
            return this.getNameParts().join('.');
        } else {
            return this.getNameParts().join('_');
        }
    }

}

export class DottedGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly dot: Token
    ) {
        super();
        this.range = Range.create(this.obj.range.start, this.name.range.end);
    }

    transpile(state: TranspileState) {
    //if the callee starts with a namespace name, transpile the name
        if (state.file.calleeStartsWithNamespace(this)) {
            return new NamespacedVariableNameExpression(this as DottedGetExpression | VariableExpression).transpile(state);
        } else {
            return [
                ...this.obj.transpile(state),
                '.',
                new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text)
            ];
        }
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.obj.getAllExpressions(expressions);

        return expressions;
    }
}

export class XmlAttributeGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly at: Token
    ) {
        super();
        this.range = Range.create(this.obj.range.start, this.name.range.end);
    }

    transpile(state: TranspileState) {
        return [
            ...this.obj.transpile(state),
            '@',
            new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text)
        ];
    }
}

export class IndexedGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) {
        super();
        this.range = Range.create(this.obj.range.start, this.closingSquare.range.end);
    }

    transpile(state: TranspileState) {
        return [
            ...this.obj.transpile(state),
            new SourceNode(this.openingSquare.range.start.line + 1, this.openingSquare.range.start.character, state.pathAbsolute, '['),
            ...this.index.transpile(state),
            new SourceNode(this.closingSquare.range.start.line + 1, this.closingSquare.range.start.character, state.pathAbsolute, ']')
        ];
    }
}

export class GroupingExpression extends Expression {
    constructor(
        readonly tokens: {
            left: Token;
            right: Token;
        },
        readonly expression: Expression
    ) {
        super();
        this.range = Range.create(this.tokens.left.range.start, this.tokens.right.range.end);
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.left.range.start.line + 1, this.tokens.left.range.start.character, state.pathAbsolute, '('),
            ...this.expression.transpile(state),
            new SourceNode(this.tokens.right.range.start.line + 1, this.tokens.right.range.start.character, state.pathAbsolute, ')')
        ];
    }
}

export class LiteralExpression extends Expression {
    constructor(
        readonly value: BrsType,
        range: Range
    ) {
        super();
        this.range = range ?? Range.create(-1, -1, -1, -1);
    }


    public readonly range: Range;

    transpile(state: TranspileState) {
        let text: string;
        if (this.value.kind === ValueKind.String) {
            //escape quote marks with another quote mark
            text = `"${this.value.value.replace(/"/g, '""')}"`;
        } else {
            text = this.value.toString();
        }

        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                text
            )
        ];
    }
}

/**
 * This is a special expression only used within template strings. It exists so we can prevent producing lots of empty strings
 * during template string transpile by identifying these expressions explicitly and skipping the bslib_toString around them
 */
export class EscapedCharCodeLiteral extends Expression {
    constructor(
        readonly token: Token & { charCode: number }
    ) {
        this.range = token.range;
    }
    readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                `chr(${this.token.charCode})`
            )
        ];
    }
}

export class ArrayLiteralExpression implements Expression {
    constructor(
        readonly elements: Array<Expression>,
        readonly open: Token,
        readonly close: Token
    ) {
        super();
        this.range = Range.create(this.open.range.start, this.close.range.end);
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.open.range.start.line + 1, this.open.range.start.character, state.pathAbsolute, '[')
        );
        let hasChildren = this.elements.length > 0;
        state.blockDepth++;

        for (let i = 0; i < this.elements.length; i++) {
            let previousElement = this.elements[i - 1];
            let element = this.elements[i];

            if (element instanceof CommentExpression) {
                //if the comment is on the same line as opening square or previous statement, don't add newline
                if (util.linesTouch(this.open, element) || util.linesTouch(previousElement, element)) {
                    result.push(' ');
                } else {
                    result.push(
                        '\n',
                        state.indent()
                    );
                }
                state.lineage.unshift(this);
                result.push(element.transpile(state));
                state.lineage.shift();
            } else {
                result.push('\n');

                result.push(
                    state.indent(),
                    ...element.transpile(state)
                );
                //add a comma if we know there will be another non-comment statement after this
                for (let j = i + 1; j < this.elements.length; j++) {
                    let el = this.elements[j];
                    //add a comma if there will be another element after this
                    if (el instanceof CommentExpression === false) {
                        result.push(',');
                        break;
                    }
                }
            }
        }
        state.blockDepth--;
        //add a newline between open and close if there are elements
        if (hasChildren) {
            result.push('\n');
            result.push(state.indent());
        }

        result.push(
            new SourceNode(this.close.range.start.line + 1, this.close.range.start.character, state.pathAbsolute, ']')
        );
        return result;
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        for (let e of this.elements) {
            if (e instanceof Expression) {
                e.getAllExpressions(expressions);
            }
        }
        return expressions;
    }
}

/** A member of an associative array literal. */
export interface AAMemberExpression {
    /** The name of the member. */
    key: BrsString;
    keyToken: Token;
    colonToken: Token;
    /** The expression evaluated to determine the member's initial value. */
    value: Expression;
    range: Range;
}

export class AALiteralExpression extends Expression {
    constructor(
        readonly elements: Array<AAMemberExpression | CommentExpression>,
        readonly open: Token,
        readonly close: Token
    ) {
        super();
        this.range = Range.create(this.open.range.start, this.close.range.end);
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        //open curly
        result.push(
            new SourceNode(this.open.range.start.line + 1, this.open.range.start.character, state.pathAbsolute, this.open.text)
        );
        let hasChildren = this.elements.length > 0;
        //add newline if the object has children and the first child isn't a comment starting on the same line as opening curly
        if (hasChildren && ((this.elements[0] instanceof CommentExpression) === false || !util.linesTouch(this.elements[0], this.open))) {
            result.push('\n');
        }
        state.blockDepth++;
        for (let i = 0; i < this.elements.length; i++) {
            let element = this.elements[i];
            let previousElement = this.elements[i - 1];
            let nextElement = this.elements[i + 1];

            //don't indent if comment is same-line
            if (element instanceof CommentExpression &&
        (util.linesTouch(this.open, element) || util.linesTouch(previousElement, element))
            ) {
                result.push(' ');

                //indent line
            } else {
                result.push(state.indent());
            }

            //render comments
            if (element instanceof CommentExpression) {
                result.push(...element.transpile(state));
            } else {
                //key
                result.push(
                    new SourceNode(element.keyToken.range.start.line + 1, element.keyToken.range.start.character, state.pathAbsolute, element.keyToken.text)
                );
                //colon
                result.push(
                    new SourceNode(element.colonToken.range.start.line + 1, element.colonToken.range.start.character, state.pathAbsolute, ':'),
                    ' '
                );

                //determine if comments are the only members left in the array
                let onlyCommentsRemaining = true;
                for (let j = i + 1; j < this.elements.length; j++) {
                    if ((this.elements[j] instanceof CommentExpression) === false) {
                        onlyCommentsRemaining = false;
                        break;
                    }
                }

                //value
                result.push(...element.value.transpile(state));
                //add trailing comma if not final element (excluding comments)
                if (i !== this.elements.length - 1 && onlyCommentsRemaining === false) {
                    result.push(',');
                }
            }


            //if next element is a same-line comment, skip the newline
            if (nextElement && nextElement instanceof CommentExpression && nextElement.range.start.line === element.range.start.line) {

                //add a newline between statements
            } else {
                result.push('\n');
            }
        }
        state.blockDepth--;

        //only indent the closing curly if we have children
        if (hasChildren) {
            result.push(state.indent());
        }
        //close curly
        result.push(
            new SourceNode(this.close.range.start.line + 1, this.close.range.start.character, state.pathAbsolute, this.close.text)
        );
        return result;
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        for (let e of this.elements) {
            if (!(e instanceof CommentExpression)) {
                e.value.getAllExpressions(expressions);
            }
        }

        return expressions;
    }
}

export class UnaryExpression extends Expression {
    constructor(
        readonly operator: Token,
        readonly right: Expression
    ) {
        super();
        this.range = Range.create(this.operator.range.start, this.right.range.end);
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, this.operator.text),
            ' ',
            ...this.right.transpile(state)
        ];
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.right.getAllExpressions(expressions);

        return expressions;
    }
}

export class VariableExpression extends Expression {
    constructor(
        readonly name: Identifier,
        readonly namespaceName: NamespacedVariableNameExpression
    ) {
        super();
        this.range = this.name.range;
    }

    public getName(parseMode: ParseMode) {
        return parseMode === ParseMode.BrightScript ? this.name.text : this.name.text;
    }

    transpile(state: TranspileState) {
        let result = [];
        //if the callee is the name of a known namespace function
        if (state.file.calleeIsKnownNamespaceFunction(this, this.namespaceName?.getName(ParseMode.BrighterScript))) {
            result.push(
                new SourceNode(
                    this.range.start.line + 1,
                    this.range.start.character,
                    state.pathAbsolute,
                    `${this.namespaceName.getName(ParseMode.BrightScript)}_${this.getName(ParseMode.BrightScript)}`
                )
            );

            //transpile  normally
        } else {
            result.push(
                new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text)
            );
        }
        return result;
    }
}

export class SourceLiteralExpression implements Expression {
    constructor(
        readonly token: Token
    ) {
        this.range = token.range;
    }

    public readonly range: Range;

    private getFunctionName(state: TranspileState, parseMode: ParseMode) {
        let func = state.file.getFunctionScopeAtPosition(this.token.range.start).func;
        let nameParts = [];
        while (func.parentFunction) {
            let index = func.parentFunction.childFunctionExpressions.indexOf(func);
            nameParts.unshift(`anon${index}`);
            func = func.parentFunction;
        }
        //get the index of this function in its parent
        nameParts.unshift(
            func.functionStatement.getName(parseMode)
        );
        return nameParts.join('$');
    }

    transpile(state: TranspileState) {
        let text: string;
        switch (this.token.kind) {
            case TokenKind.SourceFilePathLiteral:
                text = `"${fileUrl(state.pathAbsolute)}"`;
                break;
            case TokenKind.SourceLineNumLiteral:
                text = `${this.token.range.start.line + 1}`;
                break;
            case TokenKind.FunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrightScript)}"`;
                break;
            case TokenKind.SourceFunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrighterScript)}"`;
                break;
            case TokenKind.SourceLocationLiteral:
                text = `"${fileUrl(state.pathAbsolute)}:${this.token.range.start.line + 1}"`;
                break;
            case TokenKind.PkgPathLiteral:
                let pkgPath1 = `pkg:/${state.file.pkgPath}`
                    .replace(/\\/g, '/')
                    .replace(/\.bs$/i, '.brs');

                text = `"${pkgPath1}"`;
                break;
            case TokenKind.PkgLocationLiteral:
                let pkgPath2 = `pkg:/${state.file.pkgPath}`
                    .replace(/\\/g, '/')
                    .replace(/\.bs$/i, '.brs');

                text = `"${pkgPath2}:" + str(LINE_NUM)`;
                break;
            case TokenKind.LineNumLiteral:
            default:
                //use the original text (because it looks like a variable)
                text = this.token.text;
                break;

        }
        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                text
            )
        ];
    }
}

/**
 * This expression transpiles and acts exactly like a CallExpression,
 * except we need to uniquely identify these statements so we can
 * do more type checking.
 */
export class NewExpression extends Expression {
    constructor(
        readonly newKeyword: Token,
        readonly call: CallExpression
    ) {
        super();
        this.range = Range.create(this.newKeyword.range.start, this.call.range.end);
    }

    /**
   * The name of the class to initialize (with optional namespace prefixed)
   */
    public get className() {
    //the parser guarantees the callee of a new statement's call object will be
    //a NamespacedVariableNameExpression
        return this.call.callee as NamespacedVariableNameExpression;
    }

    public get namespaceName() {
        return this.call.namespaceName;
    }

    public transpile(state: TranspileState) {
        return this.call.transpile(state);
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.call.getAllExpressions(expressions);

        return expressions;
    }
}

export class CallfuncExpression extends Expression {
    constructor(
        readonly callee: Expression,
        readonly operator: Token,
        readonly methodName: Identifier,
        readonly openingParen: Token,
        readonly args: Expression[],
        readonly closingParen: Token
    ) {
        super();
        this.range = Range.create(
            callee.range.start,
            (closingParen ?? args[args.length - 1] ?? openingParen ?? methodName ?? operator).range.end
        );
    }

    public transpile(state: TranspileState) {
        let result = [];
        result.push(
            ...this.callee.transpile(state),
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, '.callfunc'),
            new SourceNode(this.openingParen.range.start.line + 1, this.openingParen.range.start.character, state.pathAbsolute, '('),
            //the name of the function
            new SourceNode(
                this.methodName.range.start.line + 1,
                this.methodName.range.start.character,
                state.pathAbsolute,
                `"${this.methodName.text}"`
            ),
            ', '
        );
        //transpile args
        //callfunc with zero args never gets called, so pass invalid as the first parameter if there are no args
        if (this.args.length === 0) {
            result.push('invalid');
        } else {
            for (let i = 0; i < this.args.length; i++) {
                //add comma between args
                if (i > 0) {
                    result.push(', ');
                }
                let arg = this.args[i];
                result.push(...arg.transpile(state));
            }
        }
        result.push(
            new SourceNode(this.closingParen.range.start.line + 1, this.closingParen.range.start.character, state.pathAbsolute, ')')
        );
        return result;
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.args.map(e => e.getAllExpressions(expressions));
        this.callee.getAllExpressions(expressions);

        return expressions;
    }
}

/**
 * Since template strings can contain newlines, we need to concatenate multiple strings together with chr() calls.
 * This is a single expression that represents the string contatenation of all parts of a single quasi.
 */
export class TemplateStringQuasiExpression extends Expression {
    constructor(
        readonly expressions: Array<LiteralExpression | EscapedCharCodeLiteral>
    ) {
        this.range = Range.create(
            this.expressions[0].range.start,
            this.expressions[this.expressions.length - 1].range.end
        );
    }
    readonly range: Range;

    transpile(state: TranspileState, skipEmptyStrings = true) {
        let result = [];
        let plus = '';
        for (let expression of this.expressions) {
            //skip empty strings
            if (((expression as LiteralExpression)?.value as BrsString)?.value === '' && skipEmptyStrings === true) {
                continue;
            }
            result.push(
                plus,
                ...expression.transpile(state)
            );
            plus = ' + ';
        }
        return result;
    }
}

export class TemplateStringExpression extends Expression {
    constructor(
        readonly openingBacktick: Token,
        readonly quasis: TemplateStringQuasiExpression[],
        readonly expressions: Expression[],
        readonly closingBacktick: Token
    ) {
        this.range = Range.create(
            quasis[0].range.start,
            quasis[quasis.length - 1].range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        if (this.quasis.length === 1 && this.expressions.length === 0) {
            return this.quasis[0].transpile(state);
        }
        let result = [];
        //wrap the expression in parens to readability
        // result.push(
        //     new SourceNode(
        //         this.openingBacktick.range.start.line + 1,
        //         this.openingBacktick.range.start.character,
        //         state.pathAbsolute,
        //         '('
        //     )
        // );
        let plus = '';
        //helper function to figure out when to include the plus
        function add(...items) {
            if (items.length > 0) {
                result.push(
                    plus,
                    ...items
                );
            }
            plus = ' + ';
        }

        for (let i = 0; i < this.quasis.length; i++) {
            let quasi = this.quasis[i];
            let expression = this.expressions[i];

            add(
                ...quasi.transpile(state)
            );
            if (expression) {
                //skip the toString wrapper around certain expressions
                if (
                    expression instanceof EscapedCharCodeLiteral ||
                    (expression instanceof LiteralExpression && expression.value.kind === ValueKind.String)
                ) {
                    add(
                        ...expression.transpile(state)
                    );

                    //wrap all other expressions with a bslib_toString call to prevent runtime type mismatch errors
                } else {
                    add(
                        'bslib_toString(',
                        ...expression.transpile(state),
                        ')'
                    );
                }
            }
        }

        //wrap the expression in parens to readability
        // result.push(
        //     new SourceNode(
        //         this.openingBacktick.range.end.line + 1,
        //         this.openingBacktick.range.end.character,
        //         state.pathAbsolute,
        //         ')'
        //     )
        // );
        return result;
    }
}

export class TaggedTemplateStringExpression extends Expression {
    constructor(
        readonly tagName: Identifier,
        readonly openingBacktick: Token,
        readonly quasis: TemplateStringQuasiExpression[],
        readonly expressions: Expression[],
        readonly closingBacktick: Token
    ) {
        this.range = Range.create(
            quasis[0].range.start,
            quasis[quasis.length - 1].range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(
                this.tagName.range.start.line + 1,
                this.tagName.range.start.character,
                state.pathAbsolute,
                this.tagName.text
            ),
            '(['
        );

        //add quasis as the first array
        for (let i = 0; i < this.quasis.length; i++) {
            let quasi = this.quasis[i];
            //separate items with a comma
            if (i > 0) {
                result.push(
                    ', '
                );
            }
            result.push(
                ...quasi.transpile(state, false)
            );
        }
        result.push(
            '], ['
        );

        //add expressions as the second array
        for (let i = 0; i < this.expressions.length; i++) {
            let expression = this.expressions[i];
            if (i > 0) {
                result.push(
                    ', '
                );
            }
            result.push(
                ...expression.transpile(state)
            );
        }
        result.push(
            new SourceNode(
                this.closingBacktick.range.end.line + 1,
                this.closingBacktick.range.end.character,
                state.pathAbsolute,
                '])'
            )
        );
        return result;
    }
}

export class TernaryExpression extends Expression {
    constructor(
        readonly test: Expression,
        readonly consequent: Expression,
        readonly alternate: Expression
    ) {
        super();
        this.range = Range.create(
            test.range.start,
            alternate.range.end
        );
    }

    transpile(state: TranspileState) {
        let result = [];
        let testInfo = getExpressionInfo(this.test);
        let consequentInfo = getExpressionInfo(this.consequent);
        let alternateInfo = getExpressionInfo(this.alternate);

        let allExpressions = [...testInfo.expressions, ...consequentInfo.expressions, ...alternateInfo.expressions];
        let allUniqueVarNames = [...new Set([...testInfo.uniqueVarNames, ...consequentInfo.uniqueVarNames, ...alternateInfo.uniqueVarNames])];

        let mutatingExpressions = allExpressions.filter(e => e instanceof CallExpression || e instanceof CallfuncExpression || e instanceof DottedGetExpression);

        if (mutatingExpressions.length > 0) {
            //we need to do a scope-safe ternary operation
            let scope = '{';
            // eslint-disable-next-line no-return-assign
            for (let name of allUniqueVarNames) {
                scope += `\n  "${name}": ${name}`;
            }
            scope += '\n}';

            result.push(`bslib_scopeSafeTernary(`);
            result.push(...this.test.transpile(state));
            result.push(`, ${scope},`);
            result.push(...getScopedFunction(state, this.consequent, consequentInfo.uniqueVarNames));
            result.push('\n ');
            result.push(...getScopedFunction(state, this.alternate, alternateInfo.uniqueVarNames));
            result.push(') ');
        } else {
            result.push(`bslib_simpleTernary(`);
            result.push(...this.test.transpile(state));
            result.push(`, `);
            result.push(...this.consequent.transpile(state));
            result.push(`, `);
            result.push(...this.alternate.transpile(state));
            result.push(`) `);
        }
        return result;
    }
    getAllExpressions(expressions: Expression[] = []): Expression[] {
        super.getAllExpressions(expressions);
        this.test.getAllExpressions(expressions);
        this.consequent.getAllExpressions(expressions);
        this.alternate.getAllExpressions(expressions);

        return expressions;
    }
}

function getExpressionInfo(expression: Expression): {
    expressions: Expression[];
    varExpressions: Expression[];
    uniqueVarNames: string[];
} {
    const expressions = expression.getAllExpressions();
    const varExpressions = expressions.filter(e => e instanceof VariableExpression) as VariableExpression[];
    const uniqueVarNames = [...new Set(varExpressions.map(e => e.name.text))];
    return { expressions: expressions, varExpressions: varExpressions, uniqueVarNames: uniqueVarNames };
}

function getScopedFunction(state: TranspileState, alternate: Expression, scopeVarNames: string[]): Array<string | SourceNode> {
    let result = [];
    let text = 'function(scope)\n';
    for (let name of scopeVarNames) {
        text += `  ${name} = scope.${name}\n`;
    }
    result.push(text);
    result.push('  return ');
    result.push(...alternate.transpile(state));
    result.push('\nend function');
    return result;
}


export class CommentExpression extends Expression {
    constructor(
        public comments: Token[]
    ) {
        super();
        this.range = Range.create(
            this.comments[0].range.start,
            this.comments[this.comments.length - 1].range.end
        );
    }

    get text() {
        return this.comments.map(x => x.text).join('\n');
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        for (let i = 0; i < this.comments.length; i++) {
            let comment = this.comments[i];
            if (i > 0) {
                result.push(state.indent());
            }
            result.push(
                new SourceNode(comment.range.start.line + 1, comment.range.start.character, state.pathAbsolute, comment.text)
            );
            //add newline for all except final comment
            if (i < this.comments.length - 1) {
                result.push('\n');
            }
        }
        return result;
    }
}
